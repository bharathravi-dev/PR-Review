// The CLI companion (AD-16): a loopback-only server implementing ReviewService v1, plus the local review page.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  CreateRunRequest,
  PublishRequest,
  SERVICE_SCHEMA_VERSION,
  formatPrRef,
  parsePrRef,
  parseRepoRef,
  previewDigest,
  redactText,
  renderMarkdown,
  uuidv7,
  type PrContext,
  type PrRef,
  type PublishPreview,
  type Report,
  type ResolvedConfig,
  type RunEvent,
  type Secret,
} from '@pr-reviewer/core'
import type { CliDeps } from './deps.js'
import { buildProvider, connectGitHub, executeReview, listPullsWithState, performPublish, preparePublish, providerName, type GitHubConnection } from './engine.js'
import { VERSION } from './version.js'

export interface ServeOptions {
  deps: CliDeps
  config: ResolvedConfig
  /** Resolved Credentials; every response is redacted of them (AD-10). */
  secrets: Secret[]
  /** 0 picks any free port. */
  port?: number
  /** Fixed token (tests only); otherwise 192 random bits per launch. */
  token?: string
  log?: (text: string) => void
}

export interface RunningServer {
  /** Base URL, e.g. http://127.0.0.1:43123 */
  url: string
  /** Page URL carrying the token in the fragment (never sent to the server). */
  pageUrl: string
  token: string
  close(): Promise<void>
}

interface Run {
  id: string
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
}

const MAX_RUNS = 25
const MAX_BODY = 64 * 1024
const RUN_PATH = /^\/v1\/runs\/([0-9a-f-]{36})\/(events|report|publish)$/

const PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
const STATIC: Record<string, { file: string; type: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/app.css': { file: 'app.css', type: 'text/css; charset=utf-8' },
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

/** Starts the local review page on 127.0.0.1 (AD-16 CLI companion rules). */
export async function startServer(opts: ServeOptions): Promise<RunningServer> {
  const { deps, config, secrets } = opts
  const log = opts.log ?? (() => undefined)
  const token = opts.token ?? randomBytes(24).toString('base64url')
  const tokenBytes = Buffer.from(token)
  const assets = Object.fromEntries(
    Object.entries(STATIC).map(([path, a]) => [path, { ...a, body: readFileSync(new URL(`../static/${a.file}`, import.meta.url)) }]),
  )
  const runs = new Map<string, Run>()
  const defaultHost = config.settings.github?.host ?? 'github.com'
  let port = 0
  const allowedHosts = () => [`127.0.0.1:${port}`, `localhost:${port}`]
  const allowedOrigins = () => allowedHosts().map((h) => `http://${h}`)
  const redact = (text: string) => redactText(text, secrets)

  const send = (res: ServerResponse, status: number, body: unknown, type = 'application/json; charset=utf-8') => {
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    res.writeHead(status, { 'content-type': type, 'content-schema': String(SERVICE_SCHEMA_VERSION), ...SECURITY_HEADERS })
    res.end(redact(text))
  }

  const authorize = (req: IncomingMessage) => {
    const header = req.headers.authorization ?? ''
    const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '')
    if (given.length !== tokenBytes.length || !timingSafeEqual(given, tokenBytes)) {
      throw new HttpError(401, 'unauthorized', 'Missing or wrong token. Open the page with the link printed by `pr-reviewer serve`.')
    }
    const accept = req.headers['accept-schema']
    if (accept !== undefined && !String(accept).split(',').map((v) => v.trim()).includes(String(SERVICE_SCHEMA_VERSION))) {
      throw new HttpError(406, 'schema_unsupported', `This server speaks ReviewService v${SERVICE_SCHEMA_VERSION}.`)
    }
  }

  const readJson = async (req: IncomingMessage): Promise<unknown> => {
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

  const getRun = (id: string): Run => {
    const run = runs.get(id)
    if (!run) throw new HttpError(404, 'run_not_found', 'No such run. Runs are kept only while the server runs.')
    return run
  }

  const pushEvent = (run: Run, e: RunEvent) => {
    run.events.push(e)
    for (const l of run.listeners) l(e)
  }

  const startRun = async (body: CreateRunRequest): Promise<Run> => {
    const ref = parsePrRef(body.pr, defaultHost)
    if (!ref.ok) throw new HttpError(400, 'invalid_pr', ref.error.message)
    const github = await connectGitHub(config, deps, secrets, ref.value.host)
    const run: Run = { id: uuidv7(Date.now()), ref: ref.value, status: 'running', events: [], listeners: new Set(), github, publishing: false }
    for (const [id, r] of runs) {
      if (runs.size < MAX_RUNS) break
      if (r.status !== 'running') runs.delete(id)
    }
    runs.set(run.id, run)
    log(`Reviewing ${formatPrRef(ref.value)}…\n`)
    executeReview({
      config,
      deps,
      secrets,
      ref: ref.value,
      github,
      provider: body.provider,
      model: body.model,
      runId: run.id,
      onEvent: (e) => pushEvent(run, e),
      onNotice: (t) => log(`${t}\n`),
    }).then(
      ({ report, context }) => {
        run.report = report
        run.context = context
        run.status = 'done'
        log(`  ${formatPrRef(ref.value)}: ${report.overallStatus}, ${report.findings.length} finding(s)\n`)
        for (const l of run.listeners) l()
      },
      (e: unknown) => {
        run.status = 'failed'
        run.error = (e as Error).message
        log(`  ${formatPrRef(ref.value)}: failed: ${redact(run.error)}\n`)
        pushEvent(run, { schemaVersion: 1, runId: run.id, seq: (run.events.at(-1)?.seq ?? 0) + 1, at: new Date().toISOString(), type: 'DONE', payload: { overallStatus: 'ERROR', error: run.error } })
      },
    )
    return run
  }

  const streamEvents = (req: IncomingMessage, res: ServerResponse, run: Run) => {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'content-schema': String(SERVICE_SCHEMA_VERSION), connection: 'keep-alive', ...SECURITY_HEADERS })
    const after = Number(req.headers['last-event-id'] ?? 0) || 0
    const write = (e: RunEvent) => res.write(redact(`id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`))
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

  const presentPreview = (p: PublishPreview) => ({
    event: p.event,
    reviewBody: p.reviewBody,
    summaryBody: p.summaryBody,
    inline: p.inline.map((c) => ({ path: c.path, line: c.line, startLine: c.startLine ?? null, fingerprint: c.fingerprint, body: c.body })),
    summaryOnly: p.summaryOnly.map((f) => ({ fingerprint: f.fingerprint ?? null, title: f.title, severity: f.severity })),
    withheld: p.withheld,
    stillOpen: p.stillOpen.map((s) => ({ fingerprint: s.finding.fingerprint ?? null, title: s.finding.title, url: s.url ?? null })),
    resolved: p.resolved.map((r) => ({ title: r.title, url: r.url ?? null })),
  })

  const handlePublish = async (run: Run, raw: unknown) => {
    if (run.status !== 'done' || !run.report) throw new HttpError(409, 'run_not_finished', 'The review has not finished yet.')
    if (!run.context) throw new HttpError(409, 'nothing_to_publish', 'The PR could not be loaded, so there is nothing to post.')
    const body = PublishRequest.safeParse(raw)
    if (!body.success) throw new HttpError(400, 'invalid_request', body.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '))
    const { event, include, dryRun, previewDigest: shown } = body.data
    if (event === 'REQUEST_CHANGES' && !config.settings.publish?.allowRequestChanges) {
      throw new HttpError(400, 'request_changes_disabled', 'REQUEST_CHANGES is off; set publish.allowRequestChanges: true in your user config to enable it.')
    }
    if (!run.github.viewer) throw new HttpError(403, 'no_github_identity', `Posting needs a GitHub token: ${run.github.tokenError ?? run.github.viewerError}`)
    if (run.publishing) throw new HttpError(409, 'publish_in_progress', 'A post for this review is already in progress.')
    run.publishing = true
    try {
      const prepared = await preparePublish(run.report, run.context, run.ref, run.github, config, { event, include, unattended: false })
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
      const outcome = await performPublish(run.report, plan, preview, run.ref, run.github, config)
      log(`  ${formatPrRef(run.ref)}: post ${outcome.record.status}${outcome.record.reason ? ` (${outcome.record.reason})` : ''}\n`)
      return outcome
    } finally {
      run.publishing = false
    }
  }

  const session = async () => {
    const github = await connectGitHub(config, deps, secrets, defaultHost)
    const name = providerName(config)
    const provider = await buildProvider(config, undefined, undefined, deps, secrets)
    return {
      schemaVersion: SERVICE_SCHEMA_VERSION,
      version: VERSION,
      github: { host: defaultHost, ...(github.viewer ? { login: github.viewer.login } : { error: github.tokenError ?? github.viewerError ?? 'unknown' }) },
      ai: {
        provider: name,
        ...(config.settings.providers?.[name]?.model ? { model: config.settings.providers[name].model } : {}),
        ready: provider.ok,
        ...(provider.ok ? {} : { reason: provider.error.message }),
      },
      publish: { allowRequestChanges: config.settings.publish?.allowRequestChanges === true, commitStatus: config.settings.publish?.commitStatus === true },
    }
  }

  const pulls = async (url: URL) => {
    const repo = parseRepoRef(url.searchParams.get('repo') ?? '', defaultHost)
    if (!repo.ok) throw new HttpError(400, 'invalid_repo', repo.error.message)
    const limit = Number(url.searchParams.get('limit') ?? 30)
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, 'invalid_limit', 'limit must be a whole number from 1 to 100.')
    const github = await connectGitHub(config, deps, secrets, repo.value.host)
    const list = await listPullsWithState(github.reader, repo.value, limit, github.viewer?.id)
    if (!list.ok) throw new HttpError(502, list.error.code, list.error.message)
    return { repo: `${repo.value.owner}/${repo.value.repo}`, host: repo.value.host, reviewerKnown: github.viewer !== undefined, pulls: list.value }
  }

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    // DNS rebinding and cross-site requests (AD-16): only loopback Hosts and our own Origin.
    if (!allowedHosts().includes(String(req.headers.host ?? ''))) throw new HttpError(403, 'forbidden_host', 'Requests must address 127.0.0.1 or localhost.')
    const origin = req.headers.origin
    if (origin !== undefined && !allowedOrigins().includes(origin)) throw new HttpError(403, 'forbidden_origin', 'Cross-origin requests are not allowed.')
    if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'forbidden_origin', 'Cross-site requests are not allowed.')

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const method = req.method ?? 'GET'
    const asset = STATIC[url.pathname] ? assets[url.pathname] : undefined
    if (asset) {
      if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'method_not_allowed', 'Method not allowed.')
      res.writeHead(200, { 'content-type': asset.type, 'content-security-policy': PAGE_CSP, ...SECURITY_HEADERS })
      res.end(method === 'HEAD' ? undefined : asset.body)
      return
    }
    if (url.pathname === '/favicon.ico') {
      res.writeHead(204, SECURITY_HEADERS)
      res.end()
      return
    }
    if (!url.pathname.startsWith('/v1/')) throw new HttpError(404, 'not_found', 'Not found.')
    authorize(req)

    if (url.pathname === '/v1/session' && method === 'GET') return send(res, 200, await session())
    if (url.pathname === '/v1/pulls' && method === 'GET') return send(res, 200, await pulls(url))
    if (url.pathname === '/v1/runs' && method === 'POST') {
      const body = CreateRunRequest.safeParse(await readJson(req))
      if (!body.success) throw new HttpError(400, 'invalid_request', 'Send {"pr": "<PR link or owner/repo#number>"}.')
      const run = await startRun(body.data)
      return send(res, 202, { schemaVersion: SERVICE_SCHEMA_VERSION, id: run.id, pr: formatPrRef(run.ref), events: `/v1/runs/${run.id}/events`, report: `/v1/runs/${run.id}/report` })
    }
    const m = RUN_PATH.exec(url.pathname)
    if (m) {
      const run = getRun(m[1]!)
      if (m[2] === 'events' && method === 'GET') return streamEvents(req, res, run)
      if (m[2] === 'report' && method === 'GET') {
        if (run.status === 'running') return send(res, 202, { status: 'running' })
        if (!run.report) throw new HttpError(500, 'run_failed', run.error ?? 'The review failed.')
        if (url.searchParams.get('format') === 'markdown') return send(res, 200, renderMarkdown(run.report), 'text/markdown; charset=utf-8')
        return send(res, 200, run.report)
      }
      if (m[2] === 'publish' && method === 'POST') return send(res, 200, await handlePublish(run, await readJson(req)))
    }
    throw new HttpError(404, 'not_found', 'Not found.')
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      if (res.headersSent) {
        res.end()
        return
      }
      if (e instanceof HttpError) send(res, e.status, { error: { code: e.code, message: e.message }, ...e.extra })
      else {
        log(`Unexpected error: ${redact((e as Error).message)}\n`)
        send(res, 500, { error: { code: 'internal', message: 'Unexpected error; see the terminal running pr-reviewer serve.' } })
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  port = (server.address() as AddressInfo).port
  const url = `http://127.0.0.1:${port}`
  return {
    url,
    pageUrl: `${url}/#token=${token}`,
    token,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  }
}

const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-resource-policy': 'same-origin',
} as const
