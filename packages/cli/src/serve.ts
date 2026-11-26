// The CLI companion (AD-16): a loopback-only server implementing ReviewService v1, plus the local review page.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { ResolvedConfig, Secret } from '@pr-reviewer/core'
import type { CliDeps } from './deps.js'
import { checkSchema, createReviewService, HttpError, loadAssets, PAGE_CSP, SECURITY_HEADERS, sendJson, type Principal, type UiVersion } from './review-service.js'

export interface ServeOptions {
  deps: CliDeps
  config: ResolvedConfig
  /** Resolved Credentials; every response is redacted of them (AD-10). */
  secrets: Secret[]
  /** 0 picks any free port. */
  port?: number
  /** Which review page `/` opens (`--ui`); classic by default. */
  ui?: UiVersion | undefined
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

/** Starts the local review page on 127.0.0.1 (AD-16 CLI companion rules). */
export async function startServer(opts: ServeOptions): Promise<RunningServer> {
  const log = opts.log ?? (() => undefined)
  const token = opts.token ?? randomBytes(24).toString('base64url')
  const tokenBytes = Buffer.from(token)
  const assets = loadAssets('local', opts.ui)
  const service = createReviewService({ channel: 'CLI', log, maxRuns: 25 })
  const principal: Principal = { id: 'local', config: opts.config, deps: opts.deps, secrets: opts.secrets }
  let port = 0
  const allowedHosts = () => [`127.0.0.1:${port}`, `localhost:${port}`]
  const allowedOrigins = () => allowedHosts().map((h) => `http://${h}`)

  const authorize = (req: IncomingMessage) => {
    const header = req.headers.authorization ?? ''
    const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '')
    if (given.length !== tokenBytes.length || !timingSafeEqual(given, tokenBytes)) {
      throw new HttpError(401, 'unauthorized', 'Missing or wrong token. Open the page with the link printed by `pr-reviewer serve`.')
    }
    checkSchema(req)
  }

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    // DNS rebinding and cross-site requests (AD-16): only loopback Hosts and our own Origin.
    if (!allowedHosts().includes(String(req.headers.host ?? ''))) throw new HttpError(403, 'forbidden_host', 'Requests must address 127.0.0.1 or localhost.')
    const origin = req.headers.origin
    if (origin !== undefined && !allowedOrigins().includes(origin)) throw new HttpError(403, 'forbidden_origin', 'Cross-origin requests are not allowed.')
    if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'forbidden_origin', 'Cross-site requests are not allowed.')

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const method = req.method ?? 'GET'
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
