// The self-hosted Web App (Epic 6, FR-30..FR-35): GitHub sign-in limited to an allow-list, per-user isolation, keys
// kept server-side and encrypted, history, and the same ReviewService v1 and page as `pr-reviewer serve`.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { err, ok, resolveSettings, Secret, type CredentialResolver, type Secret as SecretT } from '@pr-reviewer/core'
import * as z from 'zod'
import { apiUrlForHost } from './compose.js'
import type { CliDeps } from './deps.js'
import { checkSchema, createReviewService, HttpError, loadAssets, PAGE_CSP, readBody, readJson, SECURITY_HEADERS, sendJson, type Principal, type Run, type UiVersion } from './review-service.js'
import { USER_AGENT } from './version.js'
import { WebStore, type UserSettings, type WebUser } from './web-store.js'

export interface WebOptions {
  /** Public base URL, e.g. https://reviews.example.com (OAuth callback and CSRF origin). */
  publicUrl: string
  clientId: string
  clientSecret: string
  /** ≥ 32 characters; encrypts stored Credentials. */
  secret: string
  dataDir: string
  allowUsers: readonly string[]
  allowOrgs: readonly string[]
  githubHost?: string | undefined
  /** OAuth scope: "repo" (default; private repositories) or "public_repo". */
  scope?: string | undefined
  /** Base URLs users may point an openai-compatible provider at (SSRF guard); OpenAI's own is always allowed. */
  allowedEndpoints?: readonly string[] | undefined
  /** Run compile and lint in containers (needs a container runtime the server can reach). Default off. */
  sandbox?: boolean | undefined
  /** Which review page `/` opens (PR_REVIEWER_DEFAULT_UI); v2 by default. */
  ui?: UiVersion | undefined
  /** Browser extension IDs allowed to connect (PR_REVIEWER_EXTENSION_IDS); none by default (Story 7.7). */
  extensionIds?: readonly string[] | undefined
  fetch: typeof fetch
  port?: number | undefined
  host?: string | undefined
  log?: (text: string) => void
}

export interface RunningWeb {
  url: string
  close(): Promise<void>
}

const OPENAI = 'https://api.openai.com/v1'
const SESSION_COOKIE = 'prr_session'
const STATE_COOKIE = 'prr_state'
const NEXT_COOKIE = 'prr_next'

const SettingsBody = z.object({
  provider: z.object({
    type: z.enum(['anthropic', 'openai-compatible']),
    model: z.string().trim().min(1).max(200).optional(),
    baseUrl: z.string().trim().max(300).optional(),
  }),
  /** A new API key; null removes the stored one; omitted keeps it. */
  apiKey: z.string().trim().min(8).max(500).nullable().optional(),
})

function cookies(req: IncomingMessage): Record<string, string> {
  return Object.fromEntries(
    String(req.headers.cookie ?? '')
      .split(';')
      .map((c) => c.trim().split('='))
      .filter((p) => p.length === 2 && p[0])
      .map(([k, v]) => [k!, decodeURIComponent(v!)]),
  )
}

/** Checks the operator configuration; returns a message for each problem. */
export function webConfigProblems(o: Pick<WebOptions, 'publicUrl' | 'clientId' | 'clientSecret' | 'secret' | 'allowUsers' | 'allowOrgs'>): string[] {
  const problems: string[] = []
  if (!/^https?:\/\/[^/]+/.test(o.publicUrl)) problems.push('PR_REVIEWER_PUBLIC_URL must be the URL people open, e.g. https://reviews.example.com')
  if (!o.clientId || !o.clientSecret) problems.push('PR_REVIEWER_GITHUB_CLIENT_ID and PR_REVIEWER_GITHUB_CLIENT_SECRET are required (a GitHub OAuth app)')
  if (o.secret.length < 32) problems.push('PR_REVIEWER_WEB_SECRET must be at least 32 random characters (it encrypts stored keys)')
  if (o.allowUsers.length === 0 && o.allowOrgs.length === 0) problems.push('Set PR_REVIEWER_ALLOW_USERS and/or PR_REVIEWER_ALLOW_ORGS: only people on the allow-list can sign in')
  return problems
}

export async function startWeb(o: WebOptions): Promise<RunningWeb> {
  const problems = webConfigProblems(o)
  if (problems.length) throw new Error(problems.join('\n'))
  const log = o.log ?? (() => undefined)
  const store = new WebStore(o.dataDir, o.secret)
  const host = o.githubHost ?? 'github.com'
  const apiUrl = apiUrlForHost(host)
  const publicUrl = new URL(o.publicUrl)
  const secure = publicUrl.protocol === 'https:'
  const allowUsers = new Set(o.allowUsers.map((u) => u.toLowerCase()))
  const allowOrgs = o.allowOrgs.map((x) => x.toLowerCase())
  const scope = [o.scope ?? 'repo', ...(allowOrgs.length ? ['read:org'] : [])].join(' ')
  const endpoints = new Set([OPENAI, ...(o.allowedEndpoints ?? [])].map((e) => e.replace(/\/+$/, '')))
  const assets = loadAssets('web', o.ui)

  const service = createReviewService({
    channel: 'WEB',
    log,
    maxRunningPerPrincipal: 2,
    onRunChange: (p, run) => saveRun(Number(p.id), run),
    loadReport: async (p, id) => store.run(Number(p.id), id)?.report,
  })

  const saveRun = (userId: number, run: Run) => {
    if (!run.report) return
    store.saveRun(userId, {
      id: run.id,
      pr: `${run.ref.owner}/${run.ref.repo}#${run.ref.number}`.toLowerCase(),
      startedAt: run.startedAt,
      overallStatus: run.report.overallStatus,
      findings: run.report.findings.length,
      fingerprints: run.report.findings.flatMap((f) => f.fingerprints ?? (f.fingerprint ? [f.fingerprint] : [])),
      ...(run.published ? { published: run.published.status } : {}),
      report: run.report,
    })
  }

  const github = async <T>(path: string, token: string): Promise<T | undefined> => {
    const res = await o.fetch(`${apiUrl}${path}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': USER_AGENT } })
    return res.ok ? ((await res.json()) as T) : undefined
  }

  const allowed = async (login: string, token: string): Promise<boolean> => {
    if (allowUsers.has(login.toLowerCase())) return true
    for (const org of allowOrgs) {
      const m = await github<{ state: string }>(`/user/memberships/orgs/${encodeURIComponent(org)}`, token)
      if (m?.state === 'active') return true
    }
    return false
  }

  /** A signed-in user's principal: only their own token and key; never the server's environment, keychain, or gh. */
  const principal = (user: WebUser): Principal => {
    const settings = store.settings(user.id)
    const token = store.githubToken(user.id)
    const key = store.apiKey(user.id)
    const secrets: SecretT[] = [...(token ? [new Secret(token)] : []), ...(key ? [new Secret(key)] : [])]
    const values = new Map<string, SecretT>([...(token ? [['github', new Secret(token)] as const] : []), ...(key ? [['provider:ai', new Secret(key)] as const] : [])])
    const credentials: CredentialResolver = {
      resolve: async (ref) => {
        const v = values.get(ref)
        return v ? ok(v) : err('credential_missing', ref === 'github' ? 'Sign in again.' : 'Add your API key in Settings.')
      },
    }
    const name = settings.provider.type === 'anthropic' ? 'anthropic' : 'openai'
    const resolved = resolveSettings({
      user: {
        version: 1,
        github: { host, apiUrl, credential: 'github' },
        defaultProvider: name,
        providers: { [name]: { type: settings.provider.type, credential: 'provider:ai', ...(settings.provider.model ? { model: settings.provider.model } : {}), ...(settings.provider.baseUrl ? { baseUrl: settings.provider.baseUrl } : {}) } },
        sandbox: { enabled: o.sandbox === true },
      },
    })
    if (!resolved.ok) throw new HttpError(500, 'settings_invalid', resolved.error.message)
    const dir = store.userDir(user.id)
    const deps: CliDeps = {
      env: { PR_REVIEWER_STATE_DIR: join(dir, 'state'), PR_REVIEWER_CACHE_DIR: join(dir, 'cache') },
      fetch: o.fetch,
      platform: process.platform,
      homedir: dir,
      credentials,
      isTTY: false,
      prompt: async () => '',
      openUrl: () => undefined,
      untilStopped: () => new Promise(() => undefined),
      runGh: async () => ({ code: 1, stdout: '', stderr: 'not available in the Web App' }),
    }
    return { id: String(user.id), config: resolved.value, deps, secrets, session: { mode: 'web', user: { login: user.login, ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}) } } }
  }

  const cookie = (name: string, value: string, maxAge: number, path = '/') =>
    `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`

  const redirect = (res: ServerResponse, to: string, setCookie: string[] = []) => {
    res.writeHead(302, { location: to, ...SECURITY_HEADERS, ...(setCookie.length ? { 'set-cookie': setCookie } : {}) })
    res.end()
  }

  const page = (res: ServerResponse, status: number, title: string, text: string) => {
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", ...SECURITY_HEADERS })
    res.end(`<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><body style="font:16px system-ui;max-width:40rem;margin:4rem auto;padding:0 1rem"><h1>${esc(title)}</h1><p>${esc(text)}</p><p><a href="/">Back</a></p>`)
  }

  /** Only the extension's confirm page may be returned to after sign-in (no open redirect). */
  const NEXT = /^\/auth\/extension\?ext=[a-p]{32}&state=[A-Za-z0-9_-]{16,64}$/
  const login = (res: ServerResponse, url?: URL) => {
    const state = randomBytes(24).toString('base64url')
    const q = new URLSearchParams({ client_id: o.clientId, redirect_uri: new URL('/auth/callback', publicUrl).toString(), scope, state, allow_signup: 'false' })
    const next = url?.searchParams.get('next') ?? ''
    redirect(res, `https://${host}/login/oauth/authorize?${q}`, [cookie(STATE_COOKIE, state, 600, '/auth'), ...(NEXT.test(next) ? [cookie(NEXT_COOKIE, next, 600, '/auth')] : [])])
  }

  const callback = async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    const given = Buffer.from(url.searchParams.get('state') ?? '')
    const expected = Buffer.from(cookies(req)[STATE_COOKIE] ?? '')
    if (!expected.length || given.length !== expected.length || !timingSafeEqual(given, expected)) return page(res, 400, 'Sign-in expired', 'Start again from the home page.')
    const code = url.searchParams.get('code')
    if (!code) return page(res, 400, 'Sign-in cancelled', 'GitHub did not complete the sign-in.')
    const tokenRes = await o.fetch(`https://${host}/login/oauth/access_token`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': USER_AGENT },
      body: JSON.stringify({ client_id: o.clientId, client_secret: o.clientSecret, code, redirect_uri: new URL('/auth/callback', publicUrl).toString() }),
    })
    const token = tokenRes.ok ? ((await tokenRes.json()) as { access_token?: string }).access_token : undefined
    if (!token) return page(res, 502, 'Sign-in failed', 'GitHub did not issue a token. Try again.')
    const me = await github<{ id: number; login: string; avatar_url?: string }>('/user', token)
    if (!me) return page(res, 502, 'Sign-in failed', 'Could not read your GitHub profile.')
    if (!(await allowed(me.login, token))) {
      log(`Sign-in refused for @${me.login} (not on the allow-list)\n`)
      return page(res, 403, 'Not allowed', `@${me.login} is not on this server's allow-list. Ask its operator to add you.`)
    }
    store.saveUser({ id: me.id, login: me.login, ...(me.avatar_url ? { avatarUrl: me.avatar_url } : {}) }, token)
    const sid = store.createSession(me.id)
    log(`Signed in: @${me.login}\n`)
    const next = cookies(req)[NEXT_COOKIE] ?? ''
    redirect(res, NEXT.test(next) ? next : '/', [cookie(SESSION_COOKIE, sid, 7 * 24 * 3600), cookie(STATE_COOKIE, '', 0, '/auth'), cookie(NEXT_COOKIE, '', 0, '/auth')])
  }

  const extensionIds = new Set((o.extensionIds ?? []).filter((x) => /^[a-p]{32}$/.test(x)))
  /** The allowed extension a request comes from (its Origin), if any. */
  const extensionOf = (req: IncomingMessage): string | undefined => {
    const m = /^chrome-extension:\/\/([a-p]{32})$/.exec(String(req.headers.origin ?? ''))
    return m && extensionIds.has(m[1]!) ? m[1] : undefined
  }
  const bearer = (req: IncomingMessage) => {
    const h = String(req.headers.authorization ?? '')
    return h.startsWith('Bearer ') ? h.slice(7) : undefined
  }

  const currentUser = (req: IncomingMessage): WebUser | undefined => {
    // The browser extension: a bearer token issued to that extension, from that extension's origin only.
    const ext = extensionOf(req)
    if (ext) {
      const uid = store.extensionToken(bearer(req), ext)
      return uid === undefined ? undefined : store.user(uid)
    }
    const id = store.session(cookies(req)[SESSION_COOKIE])
    return id === undefined ? undefined : store.user(id)
  }

  const htmlPage = (res: ServerResponse, status: number, title: string, body: string) => {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'self'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'", ...SECURITY_HEADERS })
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><link rel="stylesheet" href="/app.css"></head><body><main class="wrap"><section class="card">${body}</section><p class="footer"><a class="credit" href="https://bharathravi.dev/">Built by <span class="br">BR</span><span class="dev">.dev</span></a></p></main></body></html>`)
  }
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

  /** Story 7.7: a signed-in user lets an allowed extension act for them; the token goes back via Chrome's identity flow. */
  const extensionAuth = async (req: IncomingMessage, res: ServerResponse, url: URL, method: string) => {
    const user = (() => {
      const id = store.session(cookies(req)[SESSION_COOKIE])
      return id === undefined ? undefined : store.user(id)
    })()
    if (url.pathname === '/auth/extension/tokens') {
      if (!user) return htmlPage(res, 401, 'Sign in', '<h1>Sign in first</h1><p><a class="btn primary" href="/auth/login">Sign in with GitHub</a></p>')
      if (method === 'POST') {
        const form = new URLSearchParams(await readBody(req))
        store.revokeExtensionToken(user.id, form.get('id') ?? '')
      }
      const rows = store.extensionTokens(user.id).map((t) => `<li>Extension ${esc(t.extensionId.slice(0, 8))}… · since ${esc(new Date(t.createdAt).toISOString().slice(0, 10))} · expires ${esc(new Date(t.expiresAt).toISOString().slice(0, 10))} <form method="post" action="/auth/extension/tokens"><input type="hidden" name="id" value="${esc(t.id)}"><button class="btn small" type="submit">Revoke</button></form></li>`)
      return htmlPage(res, 200, 'Extension access', `<h1>Browser extension access</h1>${rows.length ? `<ul class="list-plain">${rows.join('')}</ul>` : '<p class="muted">No extension can use your account.</p>'}<p><a href="/">Back</a></p>`)
    }
    const ext = (method === 'POST' ? new URLSearchParams(await readBody(req)) : url.searchParams)
    const extId = ext.get('ext') ?? ''
    const state = ext.get('state') ?? ''
    if (!extensionIds.has(extId)) return htmlPage(res, 403, 'Not allowed', '<h1>This extension is not allowed</h1><p>Ask the administrator to add its ID to PR_REVIEWER_EXTENSION_IDS.</p>')
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(state)) return htmlPage(res, 400, 'Bad request', '<h1>The sign-in request is incomplete</h1><p>Start again from the extension.</p>')
    if (!user) {
      const next = `/auth/extension?${new URLSearchParams({ ext: extId, state })}`
      return htmlPage(res, 401, 'Sign in', `<h1>Sign in to connect the extension</h1><p>Sign in to this Web App with GitHub; you will come back here to allow the extension.</p><p><a class="btn primary" href="/auth/login?next=${esc(encodeURIComponent(next))}">Sign in with GitHub</a></p>`)
    }
    if (method === 'GET') {
      return htmlPage(res, 200, 'Allow the extension', `<h1>Allow the pr-reviewer extension to use your account?</h1><p>It will start reviews and post them as @${esc(user.login)} with your settings on this Web App. You can revoke this any time at <a href="/auth/extension/tokens">Extension access</a>.</p><form method="post" action="/auth/extension"><input type="hidden" name="ext" value="${esc(extId)}"><input type="hidden" name="state" value="${esc(state)}"><button class="btn primary" type="submit">Allow</button> <a class="btn" href="/">Cancel</a></form>`)
    }
    const token = store.createExtensionToken(user.id, extId)
    log(`Extension access granted: @${user.login}\n`)
    redirect(res, `https://${extId}.chromiumapp.org/#token=${encodeURIComponent(token)}&state=${encodeURIComponent(state)}`)
  }

  const settingsView = (user: WebUser) => {
    const s = store.settings(user.id)
    return { provider: s.provider, apiKeySaved: store.apiKey(user.id) !== undefined, allowedEndpoints: [...endpoints] }
  }

  const saveSettings = async (req: IncomingMessage, user: WebUser) => {
    const body = SettingsBody.safeParse(await readJson(req))
    if (!body.success) throw new HttpError(400, 'invalid_request', body.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
    const p = body.data.provider
    if (p.type === 'openai-compatible') {
      const base = (p.baseUrl ?? OPENAI).replace(/\/+$/, '')
      if (!endpoints.has(base)) throw new HttpError(400, 'endpoint_not_allowed', `This server only allows: ${[...endpoints].join(', ')}.`)
      if (!p.model) throw new HttpError(400, 'model_required', 'Choose a model for an OpenAI-compatible provider.')
    } else if (p.baseUrl) throw new HttpError(400, 'endpoint_not_allowed', 'Custom endpoints are only for OpenAI-compatible providers.')
    const settings: UserSettings = { provider: { type: p.type, ...(p.model ? { model: p.model } : {}), ...(p.type === 'openai-compatible' && p.baseUrl ? { baseUrl: p.baseUrl.replace(/\/+$/, '') } : {}) } }
    store.saveSettings(user.id, settings)
    if (body.data.apiKey !== undefined) store.saveApiKey(user.id, body.data.apiKey)
    return settingsView(user)
  }

  /** Per-PR history with what changed between runs (FR-34). */
  const history = (user: WebUser, url: URL) => {
    const pr = url.searchParams.get('pr')?.toLowerCase()
    const all = store.runs(user.id, 200)
    const list = pr ? all.filter((r) => r.pr === pr) : all.slice(0, 50)
    return {
      runs: list.map((r) => {
        const previous = all.find((x) => x.pr === r.pr && x.id < r.id)
        const before = new Set(previous?.fingerprints ?? [])
        const now = new Set(r.fingerprints)
        return {
          id: r.id,
          pr: r.pr,
          startedAt: r.startedAt,
          overallStatus: r.overallStatus,
          findings: r.findings,
          ...(r.published ? { published: r.published } : {}),
          ...(previous ? { new: [...now].filter((f) => !before.has(f)).length, resolved: [...before].filter((f) => !now.has(f)).length, unchanged: [...now].filter((f) => before.has(f)).length } : { new: now.size, resolved: 0, unchanged: 0 }),
        }
      }),
    }
  }

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    // Liveness only (no data), so container health checks can reach it on any host name.
    if (req.url === '/healthz') return sendJson(res, 200, { ok: true }, [])
    // DNS rebinding: only the public host. CSRF: state-changing requests must come from our own origin.
    if (String(req.headers.host ?? '') !== publicUrl.host) throw new HttpError(403, 'forbidden_host', 'Unknown host.')
    const method = req.method ?? 'GET'
    const url = new URL(req.url ?? '/', publicUrl)
    // The allowed extension calls /v1 with its bearer token from its own origin; everything else keeps the CSRF rules.
    const fromExtension = extensionOf(req) !== undefined && bearer(req) !== undefined && url.pathname.startsWith('/v1/')
    if (!fromExtension) {
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'forbidden_origin', 'Cross-site requests are not allowed.')
      if (method !== 'GET' && method !== 'HEAD' && req.headers.origin !== publicUrl.origin) throw new HttpError(403, 'forbidden_origin', 'Requests must come from this site.')
    }

    const asset = assets[url.pathname]
    if (asset && (method === 'GET' || method === 'HEAD')) {
      res.writeHead(200, { 'content-type': asset.type, 'content-security-policy': PAGE_CSP, ...SECURITY_HEADERS, ...(secure ? { 'strict-transport-security': 'max-age=31536000' } : {}) })
      res.end(method === 'HEAD' ? undefined : asset.body)
      return
    }
    if (url.pathname === '/favicon.ico') {
      res.writeHead(204, SECURITY_HEADERS)
      res.end()
      return
    }
    if (url.pathname === '/auth/login' && method === 'GET') return login(res, url)
    if (url.pathname === '/auth/callback' && method === 'GET') return callback(req, res, url)
    if ((url.pathname === '/auth/extension' || url.pathname === '/auth/extension/tokens') && (method === 'GET' || method === 'POST')) return extensionAuth(req, res, url, method)
    if (url.pathname === '/auth/logout' && method === 'POST') {
      const sid = cookies(req)[SESSION_COOKIE]
      if (sid) store.endSession(sid)
      res.writeHead(204, { ...SECURITY_HEADERS, 'set-cookie': cookie(SESSION_COOKIE, '', 0) })
      res.end()
      return
    }
    if (!url.pathname.startsWith('/v1/')) throw new HttpError(404, 'not_found', 'Not found.')

    const user = currentUser(req)
    if (!user) throw new HttpError(401, 'signed_out', 'Sign in with GitHub.', { login: '/auth/login' })
    checkSchema(req)
    if (url.pathname === '/v1/settings' && method === 'GET') return sendJson(res, 200, settingsView(user), [])
    if (url.pathname === '/v1/settings' && method === 'PUT') return sendJson(res, 200, await saveSettings(req, user), [])
    if (url.pathname === '/v1/history' && method === 'GET') return sendJson(res, 200, history(user, url), [])
    const p = principal(user)
    if (!(await service.handle(req, res, url, p))) throw new HttpError(404, 'not_found', 'Not found.')
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      if (res.headersSent) {
        res.end()
        return
      }
      if (e instanceof HttpError) sendJson(res, e.status, { error: { code: e.code, message: e.message }, ...e.extra }, [])
      else {
        log(`Unexpected error: ${(e as Error).message}\n`)
        sendJson(res, 500, { error: { code: 'internal', message: 'Unexpected error.' } }, [])
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(o.port ?? 8080, o.host ?? '0.0.0.0', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const addr = server.address() as AddressInfo
  return {
    url: `http://${o.host ?? '0.0.0.0'}:${addr.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  }
}
