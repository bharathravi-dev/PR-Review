// ReviewService v1 (AD-16): one implementation shared by the CLI companion (`serve`) and the Web App (`web`), so the
// two cannot drift. A request runs as a Principal: who is asking, with their own configuration and Credentials.
import { readdirSync, readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  CreateRunRequest,
  PublishRequest,
  SERVICE_SCHEMA_VERSION,
  formatPrRef,
  hunksAround,
  parsePrRef,
  parseRepoRef,
  previewDigest,
  redactText,
  renderMarkdown,
  uuidv7,
  type Channel,
  type DiffHunk,
  type PrContext,
  type PrRef,
  type PublishPreview,
  type Report,
  type ResolvedConfig,
  type RunEvent,
  type Secret,
} from '@pr-reviewer/core'
import type { CliDeps } from './deps.js'
import { buildProvider, connectGitHub, executeReview, listPullsWithState, performPublish, preparePublish, providerName, type GitHubConnection, type PublishOutcome } from './engine.js'
import { collectStats } from './stats.js'
import { VERSION } from './version.js'

export interface Principal {
  /** Stable owner id: runs are visible only to the principal that started them. */
  id: string
  config: ResolvedConfig
  deps: CliDeps
  /** Resolved Credentials; every response is redacted of them (AD-10). */
  secrets: Secret[]
  /** Extra fields for GET /v1/session (e.g. the Web App's signed-in user). */
  session?: Record<string, unknown> | undefined
}

export interface Run {
  id: string
  owner: string
  ref: PrRef
  status: 'running' | 'done' | 'failed'
  events: RunEvent[]
  /** Called with each new event, or with nothing when the run's state changes. */
  listeners: Set<(e?: RunEvent) => void>
  github: GitHubConnection
  report?: Report
  context?: PrContext | undefined
  error?: string
  publishing: boolean
  startedAt: string
  published?: PublishOutcome['record']
}

export interface ServiceOptions {
  channel: Channel
  log?: (text: string) => void
  /** Called when a run finishes or is published (the Web App stores history). */
  onRunChange?: (principal: Principal, run: Run) => void | Promise<void>
  /** A finished run from storage, when it is no longer in memory (e.g. after a restart). */
  loadReport?: (principal: Principal, id: string) => Promise<Report | undefined>
  /** Limits how many runs one principal may have in flight. */
  maxRunningPerPrincipal?: number
  maxRuns?: number
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

export const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-resource-policy': 'same-origin',
} as const

export const PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; img-src 'self' data: https://avatars.githubusercontent.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

const MAX_BODY = 64 * 1024
const RUN_PATH = /^\/v1\/runs\/([0-9a-f-]{36})\/(events|report|publish|hunks)$/

/** Limits of `GET /v1/runs/:id/hunks` (review page v2): context lines around a finding, lines per file and per run. */
const HUNK_CONTEXT = 3
const HUNK_LINES_PER_FILE = 400
const HUNK_LINES_PER_RUN = 4000

/**
 * The PR's diff around each finding's lines, so a page can show a finding under its code (additive read route, UX-DR27).
 * Built from the run's PR context; files without a patch (binary, too large, removed from the diff) are listed as unavailable.
 */
export function hunksForReport(report: Report, context: PrContext | undefined): { schemaVersion: number; files: Array<{ path: string; hunks: DiffHunk[]; truncated: boolean }>; unavailable: string[] } {
  const ranges = new Map<string, Array<{ start: number; end: number }>>()
  for (const f of report.findings) {
    const l = f.location
    if (l.anchorKind !== 'LINE' || !l.path || !l.startLine) continue
    ranges.set(l.path, [...(ranges.get(l.path) ?? []), { start: l.startLine, end: l.endLine ?? l.startLine }])
  }
  const files: Array<{ path: string; hunks: DiffHunk[]; truncated: boolean }> = []
  const unavailable: string[] = []
  let budget = HUNK_LINES_PER_RUN
  for (const [path, rs] of ranges) {
    const patch = context?.files.find((f) => f.path === path)?.patch
    if (!patch || budget <= 0) {
      unavailable.push(path)
      continue
    }
    const { hunks, truncated } = hunksAround(patch, rs, HUNK_CONTEXT, Math.min(HUNK_LINES_PER_FILE, budget))
    budget -= hunks.reduce((n, h) => n + h.lines.length, 0)
    if (hunks.length) files.push({ path, hunks, truncated })
  }
  return { schemaVersion: SERVICE_SCHEMA_VERSION, files, unavailable }
}

/** Which review page `/` opens: v2 (the default since 2026-11-26) or classic, the earlier page, kept at `/classic/`. */
export type UiVersion = 'classic' | 'v2'

/**
 * The page's static files. Classic is served at `/classic/`, v2 at `/v2/`, and `/` serves the default; each page then
 * follows the browser's own remembered choice. `index.html` gets its mode substituted (local page or Web App).
 */
export function loadAssets(mode: 'local' | 'web', ui: UiVersion = 'v2'): Record<string, { type: string; body: Buffer }> {
  const read = (f: string) => readFileSync(new URL(`../static/${f}`, import.meta.url))
  const html = (f: string) => ({ type: 'text/html; charset=utf-8', body: Buffer.from(read(f).toString('utf8').replace('content="local"', `content="${mode}"`)) })
  const js = (f: string) => ({ type: 'text/javascript; charset=utf-8', body: read(f) })
  const css = (f: string) => ({ type: 'text/css; charset=utf-8', body: read(f) })
  const classic = html('index.html')
  const v2 = html('v2/index.html')
  return {
    '/': ui === 'v2' ? v2 : classic,
    '/classic/': classic,
    '/v2/': v2,
    '/app.js': js('app.js'),
    '/app.css': css('app.css'),
    '/findings-view.js': js('findings-view.js'),
    '/ui-switch.js': js('ui-switch.js'),
    // Inter, bundled: the pages load nothing from other sites (BR.dev brand font).
    '/fonts/inter.woff2': { type: 'font/woff2', body: read('fonts/inter.woff2') },
    // Every module and stylesheet of v2.
    ...Object.fromEntries(
      readdirSync(new URL('../static/v2/', import.meta.url))
        .filter((f) => /\.(js|css)$/.test(f))
        .map((f) => [`/v2/${f}`, f.endsWith('.css') ? css(`v2/${f}`) : js(`v2/${f}`)]),
    ),
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown, secrets: readonly Secret[], type = 'application/json; charset=utf-8', extraHeaders: Record<string, string | string[]> = {}): void {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, { 'content-type': type, 'content-schema': String(SERVICE_SCHEMA_VERSION), ...SECURITY_HEADERS, ...extraHeaders })
  res.end(redactText(text, secrets))
}

/** A small form body (application/x-www-form-urlencoded), for the Web App's own HTML forms. */
export async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) throw new HttpError(413, 'too_large', 'Request body is too large.')
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export async function readJson(req: IncomingMessage): Promise<unknown> {
  if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', 'Send JSON (content-type: application/json).')
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) throw new HttpError(413, 'too_large', 'Request body is too large.')
    chunks.push(chunk as Buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body is not valid JSON.')
  }
}

export function checkSchema(req: IncomingMessage): void {
  const accept = req.headers['accept-schema']
  if (accept !== undefined && !String(accept).split(',').map((v) => v.trim()).includes(String(SERVICE_SCHEMA_VERSION))) {
    throw new HttpError(406, 'schema_unsupported', `This server speaks ReviewService v${SERVICE_SCHEMA_VERSION}.`)
  }
}

export function presentPreview(p: PublishPreview) {
  return {
    event: p.event,
    reviewBody: p.reviewBody,
    summaryBody: p.summaryBody,
    inline: p.inline.map((c) => ({ path: c.path, line: c.line, startLine: c.startLine ?? null, fingerprint: c.fingerprint, body: c.body })),
    summaryOnly: p.summaryOnly.map((f) => ({ fingerprint: f.fingerprint ?? null, title: f.title, severity: f.severity })),
    withheld: p.withheld,
    stillOpen: p.stillOpen.map((s) => ({ fingerprint: s.finding.fingerprint ?? null, title: s.finding.title, url: s.url ?? null })),
    resolved: p.resolved.map((r) => ({ title: r.title, url: r.url ?? null })),
  }
}

/** Applies the user's wording changes to Findings before publishing (Story 6.3); the stored Report is unchanged. */
function withEdits(report: Report, edits: PublishRequest['edits']): Report {
  if (!edits || Object.keys(edits).length === 0) return report
  return {
    ...report,
    findings: report.findings.map((f) => {
      const e = f.fingerprint ? edits[f.fingerprint] : undefined
      if (!e) return f
      return { ...f, ...(e.title !== undefined ? { title: e.title } : {}), ...(e.description !== undefined ? { description: e.description } : {}), ...(e.recommendation !== undefined ? { recommendation: e.recommendation } : {}) }
    }),
  }
}

export function createReviewService(opts: ServiceOptions) {
  const runs = new Map<string, Run>()
  const log = opts.log ?? (() => undefined)
  const maxRuns = opts.maxRuns ?? 200

  const getRun = (p: Principal, id: string): Run => {
    const run = runs.get(id)
    // Another principal's run is indistinguishable from a missing one (per-user isolation, FR-30).
    if (!run || run.owner !== p.id) throw new HttpError(404, 'run_not_found', 'No such run.')
    return run
  }

  const pushEvent = (run: Run, e: RunEvent) => {
    run.events.push(e)
    for (const l of run.listeners) l(e)
  }

  const startRun = async (p: Principal, body: CreateRunRequest): Promise<Run> => {
    const host = p.config.settings.github?.host ?? 'github.com'
    const ref = parsePrRef(body.pr, host)
    if (!ref.ok) throw new HttpError(400, 'invalid_pr', ref.error.message)
    const running = [...runs.values()].filter((r) => r.owner === p.id && r.status === 'running').length
    if (opts.maxRunningPerPrincipal !== undefined && running >= opts.maxRunningPerPrincipal) {
      throw new HttpError(429, 'too_many_runs', `You already have ${running} review(s) running; wait for one to finish.`)
    }
    const github = await connectGitHub(p.config, p.deps, p.secrets, ref.value.host)
    const run: Run = { id: uuidv7(Date.now()), owner: p.id, ref: ref.value, status: 'running', events: [], listeners: new Set(), github, publishing: false, startedAt: new Date().toISOString() }
    for (const [id, r] of runs) {
      if (runs.size < maxRuns) break
      if (r.status !== 'running') runs.delete(id)
    }
    runs.set(run.id, run)
    log(`Reviewing ${formatPrRef(ref.value)}…\n`)
    executeReview({
      config: p.config,
      deps: p.deps,
      secrets: p.secrets,
      ref: ref.value,
      github,
      provider: body.provider,
      model: body.model,
      runId: run.id,
      channel: opts.channel,
      onEvent: (e) => pushEvent(run, e),
      onNotice: (t) => log(`${t}\n`),
    }).then(
      async ({ report, context }) => {
        run.report = report
        run.context = context
        run.status = 'done'
        log(`  ${formatPrRef(ref.value)}: ${report.overallStatus}, ${report.findings.length} finding(s)\n`)
        await Promise.resolve(opts.onRunChange?.(p, run)).catch((e: unknown) => log(`Could not store the run: ${(e as Error).message}\n`))
        for (const l of run.listeners) l()
      },
      (e: unknown) => {
        run.status = 'failed'
        run.error = (e as Error).message
        log(`  ${formatPrRef(ref.value)}: failed: ${redactText(run.error, p.secrets)}\n`)
        pushEvent(run, { schemaVersion: 1, runId: run.id, seq: (run.events.at(-1)?.seq ?? 0) + 1, at: new Date().toISOString(), type: 'DONE', payload: { overallStatus: 'ERROR', error: run.error } })
      },
    )
    return run
  }

  const streamEvents = (req: IncomingMessage, res: ServerResponse, run: Run, p: Principal) => {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'content-schema': String(SERVICE_SCHEMA_VERSION), connection: 'keep-alive', ...SECURITY_HEADERS })
    const after = Number(req.headers['last-event-id'] ?? 0) || 0
    const write = (e: RunEvent) => res.write(redactText(`id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`, p.secrets))
    for (const e of run.events) if (e.seq > after) write(e)
    // The stream ends once the run is over and the client has every event, including DONE.
    const finished = () => run.status !== 'running' && run.events.some((e) => e.type === 'DONE')
    if (finished()) {
      res.end()
      return
    }
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000)
    ping.unref()
    const listener = (e?: RunEvent) => {
      if (e && e.seq > after && !res.writableEnded) write(e)
      if (finished()) stop()
    }
    const stop = () => {
      clearInterval(ping)
      run.listeners.delete(listener)
      if (!res.writableEnded) res.end()
    }
    run.listeners.add(listener)
    req.on('close', stop)
  }

  const handlePublish = async (p: Principal, run: Run, raw: unknown) => {
    if (run.status !== 'done' || !run.report) throw new HttpError(409, 'run_not_finished', 'The review has not finished yet.')
    if (!run.context) throw new HttpError(409, 'nothing_to_publish', 'The PR could not be loaded, so there is nothing to post.')
    const body = PublishRequest.safeParse(raw)
    if (!body.success) throw new HttpError(400, 'invalid_request', body.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '))
    const { event, include, dryRun, previewDigest: shown, edits } = body.data
    if (event === 'REQUEST_CHANGES' && !p.config.settings.publish?.allowRequestChanges) {
      throw new HttpError(400, 'request_changes_disabled', 'REQUEST_CHANGES is off; set publish.allowRequestChanges: true in your user config to enable it.')
    }
    if (!run.github.viewer) throw new HttpError(403, 'no_github_identity', `Posting needs a GitHub token: ${run.github.tokenError ?? run.github.viewerError}`)
    if (run.publishing) throw new HttpError(409, 'publish_in_progress', 'A post for this review is already in progress.')
    run.publishing = true
    try {
      const report = withEdits(run.report, edits)
      const prepared = await preparePublish(report, run.context, run.ref, run.github, p.config, { event, include, unattended: false })
      if (!prepared.ok) throw new HttpError(502, prepared.error.code, prepared.error.message)
      const { plan, preview } = prepared.value
      const digest = await previewDigest(preview)
      if (dryRun) return { preview: presentPreview(preview), digest }
      if (!shown) throw new HttpError(400, 'preview_required', 'Preview the post first; send its digest as previewDigest.')
      if (shown !== digest) {
        throw new HttpError(409, 'preview_changed', 'What would be posted changed since your preview (for example, someone posted on the PR). Check the new preview.', {
          preview: presentPreview(preview),
          digest,
        })
      }
      const outcome = await performPublish(report, plan, preview, run.ref, run.github, p.config)
      run.published = outcome.record
      await Promise.resolve(opts.onRunChange?.(p, run)).catch(() => undefined)
      log(`  ${formatPrRef(run.ref)}: post ${outcome.record.status}${outcome.record.reason ? ` (${outcome.record.reason})` : ''}\n`)
      return outcome
    } finally {
      run.publishing = false
    }
  }

  const session = async (p: Principal) => {
    const host = p.config.settings.github?.host ?? 'github.com'
    const github = await connectGitHub(p.config, p.deps, p.secrets, host)
    const name = providerName(p.config)
    const provider = await buildProvider(p.config, undefined, undefined, p.deps, p.secrets)
    return {
      schemaVersion: SERVICE_SCHEMA_VERSION,
      version: VERSION,
      github: { host, ...(github.viewer ? { login: github.viewer.login } : { error: github.tokenError ?? github.viewerError ?? 'unknown' }) },
      ai: {
        provider: name,
        ...(p.config.settings.providers?.[name]?.model ? { model: p.config.settings.providers[name].model } : {}),
        ready: provider.ok,
        ...(provider.ok ? {} : { reason: provider.error.message }),
      },
      publish: { allowRequestChanges: p.config.settings.publish?.allowRequestChanges === true, commitStatus: p.config.settings.publish?.commitStatus === true },
      ...(p.session ?? {}),
    }
  }

  const pulls = async (p: Principal, url: URL) => {
    const repo = parseRepoRef(url.searchParams.get('repo') ?? '', p.config.settings.github?.host ?? 'github.com')
    if (!repo.ok) throw new HttpError(400, 'invalid_repo', repo.error.message)
    const limit = Number(url.searchParams.get('limit') ?? 30)
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, 'invalid_limit', 'limit must be a whole number from 1 to 100.')
    const github = await connectGitHub(p.config, p.deps, p.secrets, repo.value.host)
    const list = await listPullsWithState(github.reader, repo.value, limit, github.viewer?.id)
    if (!list.ok) throw new HttpError(502, list.error.code, list.error.message)
    return { repo: `${repo.value.owner}/${repo.value.repo}`, host: repo.value.host, reviewerKnown: github.viewer !== undefined, pulls: list.value }
  }

  /** How the principal's posted findings fared (addressed rate), from GitHub only. */
  const stats = async (p: Principal, url: URL) => {
    const days = Number(url.searchParams.get('days') ?? 30)
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new HttpError(400, 'invalid_days', 'days must be a whole number from 1 to 365.')
    const host = p.config.settings.github?.host ?? 'github.com'
    const repoText = url.searchParams.get('repo')
    const repo = repoText ? parseRepoRef(repoText, host) : undefined
    if (repo && !repo.ok) throw new HttpError(400, 'invalid_repo', repo.error.message)
    const github = await connectGitHub(p.config, p.deps, p.secrets, host)
    if (!github.viewer) throw new HttpError(502, 'no_reviewer_identity', github.tokenError ?? github.viewerError ?? 'The GitHub identity is unknown.')
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
    const result = await collectStats(github.reader, github.viewer, host, since, repo?.ok ? repo.value : undefined)
    if (!result.ok) throw new HttpError(502, 'github_error', result.message)
    return { schemaVersion: SERVICE_SCHEMA_VERSION, ...result.value }
  }

  /** Handles a /v1 request for an authenticated principal; returns false when the path is not a ReviewService route. */
  async function handle(req: IncomingMessage, res: ServerResponse, url: URL, p: Principal): Promise<boolean> {
    const method = req.method ?? 'GET'
    const send = (status: number, body: unknown, type?: string) => sendJson(res, status, body, p.secrets, type)
    if (url.pathname === '/v1/session' && method === 'GET') return send(200, await session(p)), true
    if (url.pathname === '/v1/pulls' && method === 'GET') return send(200, await pulls(p, url)), true
    if (url.pathname === '/v1/stats' && method === 'GET') return send(200, await stats(p, url)), true
    if (url.pathname === '/v1/runs' && method === 'POST') {
      const body = CreateRunRequest.safeParse(await readJson(req))
      if (!body.success) throw new HttpError(400, 'invalid_request', 'Send {"pr": "<PR link or owner/repo#number>"}.')
      const run = await startRun(p, body.data)
      return send(202, { schemaVersion: SERVICE_SCHEMA_VERSION, id: run.id, pr: formatPrRef(run.ref), events: `/v1/runs/${run.id}/events`, report: `/v1/runs/${run.id}/report` }), true
    }
    const m = RUN_PATH.exec(url.pathname)
    if (!m) return false
    if (m[2] === 'report' && method === 'GET' && !runs.has(m[1]!) && opts.loadReport) {
      const stored = await opts.loadReport(p, m[1]!)
      if (!stored) throw new HttpError(404, 'run_not_found', 'No such run.')
      if (url.searchParams.get('format') === 'markdown') return send(200, renderMarkdown(stored), 'text/markdown; charset=utf-8'), true
      return send(200, stored), true
    }
    const run = getRun(p, m[1]!)
    if (m[2] === 'events' && method === 'GET') return streamEvents(req, res, run, p), true
    if (m[2] === 'report' && method === 'GET') {
      if (run.status === 'running') return send(202, { status: 'running' }), true
      if (!run.report) throw new HttpError(500, 'run_failed', run.error ?? 'The review failed.')
      if (url.searchParams.get('format') === 'markdown') return send(200, renderMarkdown(run.report), 'text/markdown; charset=utf-8'), true
      return send(200, run.report), true
    }
    if (m[2] === 'publish' && method === 'POST') return send(200, await handlePublish(p, run, await readJson(req))), true
    if (m[2] === 'hunks' && method === 'GET') {
      if (run.status === 'running') return send(202, { status: 'running' }), true
      if (!run.report) throw new HttpError(500, 'run_failed', run.error ?? 'The review failed.')
      return send(200, hunksForReport(run.report, run.context)), true
    }
    return false
  }

  return { handle, runs }
}
