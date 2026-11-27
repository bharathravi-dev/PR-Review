// The CLI companion (AD-16): a loopback-only server implementing ReviewService v1, plus the local review page.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { PrContext, PrRef, Report, ResolvedConfig, Secret } from '@pr-reviewer/core'
import type { CliDeps } from './deps.js'
import type { GitHubConnection } from './engine.js'
import { createPairingWindow, isExtensionOrigin, pairedFor, pairedOrigins } from './pairing.js'
import { checkSchema, createReviewService, HttpError, loadAssets, PAGE_CSP, readJson, SECURITY_HEADERS, sendJson, type Principal, type UiVersion } from './review-service.js'

export interface ServeOptions {
  deps: CliDeps
  config: ResolvedConfig
  /** Resolved Credentials; every response is redacted of them (AD-10). */
  secrets: Secret[]
  /** 0 picks any free port. */
  port?: number
  /** Which review page `/` opens (`--ui`); v2 by default. */
  ui?: UiVersion | undefined
  /** Fixed token (tests only); otherwise 192 random bits per launch. */
  token?: string
  log?: (text: string) => void
  /**
   * Browser-extension pairing (Story 7.8). With `dir`, tokens paired earlier are accepted from their own
   * extension origin; with `open`, a pairing code is issued for this launch.
   */
  pairing?: { dir: string; open?: boolean; computer: string; code?: string; now?: () => number } | undefined
  /** Pre-completed CLI run to open immediately in the browser UI. */
  initialRun?: { ref: PrRef; github: GitHubConnection; report: Report; context?: PrContext | undefined } | undefined
}

export interface RunningServer {
  /** Base URL, e.g. http://127.0.0.1:43123 */
  url: string
  /** Page URL carrying the token in the fragment (never sent to the server). */
  pageUrl: string
  token: string
  /** The pairing code for this launch, when `pairing.open`. */
  pairCode?: string | undefined
  pairExpiresAt?: number | undefined
  close(): Promise<void>
}

/** Starts the local review page on 127.0.0.1 (AD-16 CLI companion rules). */
export async function startServer(opts: ServeOptions): Promise<RunningServer> {
  const log = opts.log ?? (() => undefined)
  const token = opts.token ?? randomBytes(24).toString('base64url')
  const tokenBytes = Buffer.from(token)
  const assets = loadAssets('local', opts.ui)
  const service = createReviewService({ channel: 'CLI', log, maxRuns: 25 })
  const principal: Principal = { id: 'local', config: opts.config, deps: opts.deps, secrets: opts.secrets }
  if (opts.initialRun) {
    const r = opts.initialRun
    service.runs.set(r.report.run.id, {
      id: r.report.run.id,
      owner: principal.id,
      ref: r.ref,
      status: 'done',
      events: [{ schemaVersion: 1, runId: r.report.run.id, seq: 1, at: r.report.run.finishedAt, type: 'DONE', payload: { overallStatus: r.report.overallStatus, findings: r.report.findings.length } }],
      listeners: new Set(),
      github: r.github,
      report: r.report,
      context: r.context,
      publishing: false,
      startedAt: r.report.run.startedAt,
    })
  }
  let port = 0
  const allowedHosts = () => [`127.0.0.1:${port}`, `localhost:${port}`]
  const allowedOrigins = () => allowedHosts().map((h) => `http://${h}`)
  const pairing = opts.pairing
  const pairWindow = pairing?.open ? createPairingWindow({ dir: pairing.dir, ...(pairing.code ? { code: pairing.code } : {}), ...(pairing.now ? { now: pairing.now } : {}) }) : undefined
  const bearer = (req: IncomingMessage) => {
    const header = req.headers.authorization ?? ''
    return header.startsWith('Bearer ') ? header.slice(7) : ''
  }

  /** Requests from the paired extension: CORS for exactly its origin (a deliberate exception to Story 8.1). */
  const handleExtension = async (req: IncomingMessage, res: ServerResponse, url: URL, method: string, origin: string) => {
    const dir = pairing!.dir
    const isPair = url.pathname === '/pair'
    if (!isPair && !(url.pathname.startsWith('/v1/') && pairedOrigins(dir).has(origin))) throw new HttpError(403, 'forbidden_origin', 'This extension is not paired. Run pr-reviewer serve --pair.')
    res.setHeader('access-control-allow-origin', origin)
    res.setHeader('vary', 'Origin')
    if (method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-methods': 'GET, POST, PUT, DELETE', 'access-control-allow-headers': 'authorization, content-type, accept, last-event-id', 'access-control-max-age': '600', ...SECURITY_HEADERS })
      res.end()
      return
    }
    if (isPair) {
      if (method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Method not allowed.')
      if (!pairWindow) throw new HttpError(409, 'not_pairing', "Pairing isn't open. Run pr-reviewer serve --pair.")
      const body = (await readJson(req)) as { code?: unknown } | undefined
      const result = pairWindow.exchange(body?.code, origin)
      if (!result.ok) {
        if (result.reason === 'wrong') throw new HttpError(400, 'pair_code_wrong', "That code didn't match.")
        throw new HttpError(410, 'pair_code_expired', 'That code expired. Run pr-reviewer serve --pair again.')
      }
      log(`Paired with the browser extension (${origin}).\n`)
      sendJson(res, 200, { schemaVersion: 1, token: result.token, computer: pairing!.computer, port }, opts.secrets)
      return
    }
    if (!pairedFor(dir, origin, bearer(req))) throw new HttpError(401, 'unauthorized', 'This pairing was removed. Pair again with pr-reviewer serve --pair.')
    checkSchema(req)
    if (!(await service.handle(req, res, url, principal))) throw new HttpError(404, 'not_found', 'Not found.')
  }

  const authorize = (req: IncomingMessage) => {
    const given = Buffer.from(bearer(req))
    if (given.length !== tokenBytes.length || !timingSafeEqual(given, tokenBytes)) {
      throw new HttpError(401, 'unauthorized', 'Missing or wrong token. Open the page with the link printed by `pr-reviewer serve`.')
    }
    checkSchema(req)
  }

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    // DNS rebinding and cross-site requests (AD-16): only loopback Hosts and our own Origin.
    if (!allowedHosts().includes(String(req.headers.host ?? ''))) throw new HttpError(403, 'forbidden_host', 'Requests must address 127.0.0.1 or localhost.')
    const origin = req.headers.origin
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const method = req.method ?? 'GET'
    if (pairing && isExtensionOrigin(origin)) return handleExtension(req, res, url, method, origin)
    if (origin !== undefined && !allowedOrigins().includes(origin)) throw new HttpError(403, 'forbidden_origin', 'Cross-origin requests are not allowed.')
    if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'forbidden_origin', 'Cross-site requests are not allowed.')

    const asset = assets[url.pathname]
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
    if (!(await service.handle(req, res, url, principal))) throw new HttpError(404, 'not_found', 'Not found.')
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      if (res.headersSent) {
        res.end()
        return
      }
      if (e instanceof HttpError) sendJson(res, e.status, { error: { code: e.code, message: e.message }, ...e.extra }, opts.secrets)
      else {
        log(`Unexpected error: ${(e as Error).message}\n`)
        sendJson(res, 500, { error: { code: 'internal', message: 'Unexpected error; see the terminal running pr-reviewer serve.' } }, opts.secrets)
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
  const query = opts.initialRun ? `?run=${encodeURIComponent(opts.initialRun.report.run.id)}` : ''
  return {
    url,
    pageUrl: `${url}/${query}#token=${token}`,
    token,
    pairCode: pairWindow?.code,
    pairExpiresAt: pairWindow?.expiresAt,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  }
}
