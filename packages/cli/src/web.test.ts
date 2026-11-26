import { readdirSync, readFileSync, mkdtempSync } from 'node:fs'
import { createServer } from 'node:net'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startWeb, webConfigProblems, type RunningWeb } from './web.js'

const GH = 'https://api.github.com/repos/octo/app'
const FILE = 'export const n = 1\nexport const retries = 3\nexport const delay = 10\nexport const m = 2\n'
const finding = (title: string, line: number) => ({ category: 'CORRECTNESS', severity: 'MAJOR', confidence: 'HIGH', title, description: 'd', impact: null, recommendation: null, path: 'src/retry.ts', startLine: line, endLine: line })

const USERS: Record<string, { id: number; login: string }> = { gho_alice: { id: 1, login: 'alice' }, gho_bob: { id: 2, login: 'bob' }, gho_carol: { id: 3, login: 'carol' } }

function fakeGitHub() {
  const state = { aiKeys: [] as string[], answers: [[finding('Retries without backoff', 2)], [finding('Retries without backoff', 2), finding('Delay is not configurable', 3)]] as unknown[][], reviews: 0 }
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init)
    const { url, method } = req
    const auth = (req.headers.get('authorization') ?? '').replace('Bearer ', '')
    if (url === 'https://github.com/login/oauth/access_token') {
      const { code } = (await req.json()) as { code: string }
      return Response.json({ access_token: `gho_${code}`, token_type: 'bearer', scope: 'repo' })
    }
    if (url.startsWith('https://api.anthropic.com/')) {
      state.aiKeys.push(req.headers.get('x-api-key') ?? auth)
      const findings = state.answers[Math.min(state.reviews++, state.answers.length - 1)]
      return Response.json({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: JSON.stringify({ findings }) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } })
    }
    if (url === 'https://api.github.com/user') return USERS[auth] ? Response.json({ ...USERS[auth], avatar_url: `https://avatars.githubusercontent.com/u/${USERS[auth]!.id}` }) : new Response('{}', { status: 401 })
    if (url === 'https://api.github.com/user/memberships/orgs/acme') return auth === 'gho_carol' ? Response.json({ state: 'active' }) : new Response('{}', { status: 404 })
    if (method === 'GET') {
      if (url === `${GH}/pulls/9`) return Response.json({ title: 'Add retry', body: '', user: { login: 'dev', id: 7 }, state: 'open', draft: false, base: { ref: 'main', sha: 'base1', repo: { id: 5, full_name: 'octo/app' } }, head: { ref: 'r', sha: 'head1', repo: { id: 5, full_name: 'octo/app' } } })
      if (url.startsWith(`${GH}/compare/`)) return Response.json({ merge_base_commit: { sha: 'mb' } })
      if (url === `${GH}/pulls/9/files?per_page=100`) return Response.json([{ filename: 'src/retry.ts', status: 'modified', additions: 2, deletions: 0, changes: 2, patch: '@@ -1,2 +1,4 @@\n export const n = 1\n+export const retries = 3\n+export const delay = 10\n export const m = 2' }])
      if (/\/(pulls|issues)\/9\/(reviews|comments)\?/.test(url)) return Response.json([])
      if (url.startsWith(`${GH}/contents/src/retry.ts?ref=`)) return new Response(FILE)
      if (/\/commits\/.+\/(check-runs|status)/.test(url)) return Response.json({ check_runs: [], statuses: [] })
    }
    return new Response('{}', { status: 404 })
  }) as typeof fetch
  return { state, impl }
}

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port
      s.close(() => resolve(port))
    })
  })
}

interface Res { status: number; headers: Record<string, string | string[] | undefined>; body: string }

/** Raw HTTP so the Host, Origin, and Cookie headers are exactly what a browser would send. */
function call(port: number, method: string, path: string, headers: Record<string, string> = {}, body?: unknown): Promise<Res> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
    const req = request({ host: '127.0.0.1', port, method, path, headers: { host: `localhost:${port}`, ...(data ? { 'content-type': typeof body === 'string' ? 'application/x-www-form-urlencoded' : 'application/json' } : {}), ...headers } }, (res) => {
      let text = ''
      res.setEncoding('utf8').on('data', (d: string) => (text += d))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }))
    })
    req.on('error', reject)
    req.end(data)
  })
}

let web: RunningWeb | undefined
afterEach(async () => {
  await web?.close()
  web = undefined
})

async function start(over: { allowUsers?: string[]; allowOrgs?: string[]; extensionIds?: string[]; admins?: string[] } = {}) {
  const gh = fakeGitHub()
  const port = await freePort()
  const dataDir = mkdtempSync(join(tmpdir(), 'prr-web-'))
  const origin = `http://localhost:${port}`
  web = await startWeb({ publicUrl: origin, clientId: 'cid', clientSecret: 'csecret', secret: 'x'.repeat(40), dataDir, allowUsers: over.allowUsers ?? ['alice'], allowOrgs: over.allowOrgs ?? ['acme'], fetch: gh.impl, port, host: '127.0.0.1', extensionIds: over.extensionIds, admins: over.admins })
  /** Signs a user in through the real OAuth flow and returns their session cookie. */
  const signIn = async (code: string): Promise<{ cookie?: string; res: Res }> => {
    const login = await call(port, 'GET', '/auth/login')
    const state = new URL(String(login.headers.location)).searchParams.get('state')!
    const stateCookie = String((login.headers['set-cookie'] as string[])[0]).split(';')[0]!
    const res = await call(port, 'GET', `/auth/callback?code=${code}&state=${state}`, { cookie: stateCookie })
    const session = ((res.headers['set-cookie'] as string[] | undefined) ?? []).find((c) => c.startsWith('prr_session=') && !c.startsWith('prr_session=;'))
    return { cookie: session?.split(';')[0], res }
  }
  return { gh, port, origin, dataDir, signIn }
}

describe('team dashboard (roadmap item 14)', () => {
  it('answers admins only, and marks them in the session', async () => {
    const { port, signIn } = await start({ admins: ['ALICE'] })
    const { cookie } = await signIn('alice')
    const team = await call(port, 'GET', '/v1/team?days=7', { cookie: cookie! })
    expect(team.status).toBe(200)
    expect(JSON.parse(team.body)).toMatchObject({ schemaVersion: 1, days: 7, reviews: 0, repos: [], people: [] })
    expect(JSON.parse((await call(port, 'GET', '/v1/session', { cookie: cookie! })).body).user.admin).toBe(true)
    expect((await call(port, 'GET', '/v1/team?days=0', { cookie: cookie! })).status).toBe(400)
  })

  it('refuses everyone when no admins are named', async () => {
    const { port, signIn } = await start()
    const { cookie } = await signIn('alice')
    expect((await call(port, 'GET', '/v1/team', { cookie: cookie! })).status).toBe(403)
  })
})

describe('browser extension access (Story 7.7)', () => {
  const EXT = 'abcdefghijklmnopabcdefghijklmnop'
  const OTHER = 'ponmlkjihgfedcbaponmlkjihgfedcba'
  it('lets a signed-in user allow an allowed extension, which then calls /v1 with its token from its own origin only', async () => {
    const { port, origin, signIn } = await start({ extensionIds: [EXT] })
    const state = 'state-0123456789abcdef'
    expect((await call(port, 'GET', `/auth/extension?ext=${EXT}&state=${state}`)).status).toBe(401)
    const { cookie } = await signIn('alice')
    expect((await call(port, 'GET', `/auth/extension?ext=${OTHER}&state=${state}`, { cookie: cookie! })).status).toBe(403)
    const ask = await call(port, 'GET', `/auth/extension?ext=${EXT}&state=${state}`, { cookie: cookie! })
    expect(ask.status).toBe(200)
    expect(ask.body).toContain('Allow the pr-reviewer extension to use your account?')
    expect((await call(port, 'POST', '/auth/extension', { cookie: cookie! }, `ext=${EXT}&state=${state}`)).status).toBe(403)
    const allowed = await call(port, 'POST', '/auth/extension', { cookie: cookie!, origin }, `ext=${EXT}&state=${state}`)
    expect(allowed.status).toBe(302)
    const back = new URL(String(allowed.headers.location))
    expect(back.origin).toBe(`https://${EXT}.chromiumapp.org`)
    const params = new URLSearchParams(back.hash.slice(1))
    expect(params.get('state')).toBe(state)
    const token = params.get('token')!

    const fromExt = { authorization: `Bearer ${token}`, origin: `chrome-extension://${EXT}`, 'sec-fetch-site': 'cross-site' }
    const session = await call(port, 'GET', '/v1/session', fromExt)
    expect(session.status).toBe(200)
    expect(JSON.parse(session.body).user.login).toBe('alice')
    expect((await call(port, 'PUT', '/v1/settings', fromExt, { provider: { type: 'anthropic' } })).status).toBe(200)
    expect((await call(port, 'GET', '/v1/session', { ...fromExt, origin: `chrome-extension://${OTHER}` })).status).toBe(403)
    expect((await call(port, 'GET', '/v1/session', { authorization: `Bearer ${token}` })).status).toBe(401)
    expect((await call(port, 'GET', '/v1/session', { ...fromExt, authorization: 'Bearer wrong-token-wrong-token-wrong-token-wrong0' })).status).toBe(401)
    // The page's own CSRF rules are unchanged.
    expect((await call(port, 'PUT', '/v1/settings', { cookie: cookie!, 'sec-fetch-site': 'cross-site', origin }, { provider: { type: 'anthropic' } })).status).toBe(403)

    const list = await call(port, 'GET', '/auth/extension/tokens', { cookie: cookie! })
    const id = /name="id" value="([0-9a-f]{16})"/.exec(list.body)![1]!
    expect((await call(port, 'POST', '/auth/extension/tokens', { cookie: cookie!, origin }, `id=${id}`)).status).toBe(200)
    expect((await call(port, 'GET', '/v1/session', fromExt)).status).toBe(401)
  })

  it('comes back to the confirm page after signing in, and to nowhere else', async () => {
    const { port } = await start({ extensionIds: [EXT] })
    const state = 'state-0123456789abcdef'
    const signedOut = await call(port, 'GET', `/auth/extension?ext=${EXT}&state=${state}`)
    const href = /href="(\/auth\/login\?next=[^"]+)"/.exec(signedOut.body)![1]!.replace(/&amp;/g, '&')
    const login = await call(port, 'GET', href)
    const ghState = new URL(String(login.headers.location)).searchParams.get('state')!
    const jar = (login.headers['set-cookie'] as string[]).map((c) => c.split(';')[0]).join('; ')
    const cb = await call(port, 'GET', `/auth/callback?code=alice&state=${ghState}`, { cookie: jar })
    expect(cb.headers.location).toBe(`/auth/extension?ext=${EXT}&state=${state}`)

    const evil = await call(port, 'GET', `/auth/login?next=${encodeURIComponent('https://evil.example/')}`)
    expect((evil.headers['set-cookie'] as string[]).some((c) => c.startsWith('prr_next='))).toBe(false)
  })
})

describe('Web App sign-in (Story 6.1)', () => {
  it('refuses to start without an allow-list, OAuth app, or secret', () => {
    expect(webConfigProblems({ publicUrl: 'https://r.example', clientId: 'a', clientSecret: 'b', secret: 'x'.repeat(40), allowUsers: [], allowOrgs: [] })).toEqual([
      'Set PR_REVIEWER_ALLOW_USERS and/or PR_REVIEWER_ALLOW_ORGS: only people on the allow-list can sign in',
    ])
    expect(webConfigProblems({ publicUrl: '', clientId: '', clientSecret: '', secret: 'short', allowUsers: ['a'], allowOrgs: [] })).toHaveLength(3)
  })

  it('signs in allow-listed users and org members only, with a narrow scope, a state check, and an HttpOnly session', async () => {
    const { port, signIn } = await start()
    expect((await call(port, 'GET', '/')).body).toContain('content="web"')
    const anon = await call(port, 'GET', '/v1/session')
    expect(anon.status).toBe(401)
    expect(JSON.parse(anon.body)).toMatchObject({ login: '/auth/login' })

    const login = await call(port, 'GET', '/auth/login')
    const target = new URL(String(login.headers.location))
    expect(target.origin + target.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(target.searchParams.get('scope')).toBe('repo read:org')
    expect(target.searchParams.get('redirect_uri')).toBe(`http://localhost:${port}/auth/callback`)
    expect((await call(port, 'GET', `/auth/callback?code=alice&state=${target.searchParams.get('state')}`)).status).toBe(400)

    const alice = await signIn('alice')
    expect(alice.res.status).toBe(302)
    expect(String((alice.res.headers['set-cookie'] as string[]).find((c) => c.startsWith('prr_session=')))).toMatch(/HttpOnly; SameSite=Lax/)
    const session = JSON.parse((await call(port, 'GET', '/v1/session', { cookie: alice.cookie! })).body)
    expect(session).toMatchObject({ mode: 'web', user: { login: 'alice' }, github: { login: 'alice' }, ai: { ready: false } })

    const bob = await signIn('bob')
    expect(bob.res.status).toBe(403)
    expect(bob.res.body).toContain('@bob is not on this server')
    expect(bob.cookie).toBeUndefined()
    expect((await signIn('carol')).cookie).toBeDefined()

    expect((await call(port, 'POST', '/auth/logout', { cookie: alice.cookie!, origin: `http://localhost:${port}` })).status).toBe(204)
    expect((await call(port, 'GET', '/v1/session', { cookie: alice.cookie! })).status).toBe(401)
  })
})

describe('Web App keys and isolation (Stories 6.1, 6.2)', () => {
  it('stores each user\'s key encrypted, never returns it, blocks cross-site writes, and limits endpoints', async () => {
    const { port, origin, dataDir, signIn } = await start()
    const { cookie } = await signIn('alice')
    const key = 'sk-ant-alice-key-0000000000000000'
    expect((await call(port, 'PUT', '/v1/settings', { cookie: cookie! }, { provider: { type: 'anthropic' }, apiKey: key })).status).toBe(403)
    const saved = await call(port, 'PUT', '/v1/settings', { cookie: cookie!, origin }, { provider: { type: 'anthropic' }, apiKey: key })
    expect(JSON.parse(saved.body)).toMatchObject({ provider: { type: 'anthropic' }, apiKeySaved: true })
    expect(saved.body).not.toContain(key)
    const onDisk = readdirSync(join(dataDir, 'users', '1')).map((f) => (f.endsWith('.json') ? readFileSync(join(dataDir, 'users', '1', f), 'utf8') : '')).join('\n')
    expect(onDisk).not.toContain(key)
    expect(onDisk).not.toContain('gho_alice')
    const ssrf = await call(port, 'PUT', '/v1/settings', { cookie: cookie!, origin }, { provider: { type: 'openai-compatible', model: 'm', baseUrl: 'http://169.254.169.254/latest' } })
    expect(JSON.parse(ssrf.body).error.code).toBe('endpoint_not_allowed')
  })

  it('reviews with the user\'s own key, keeps runs private to their owner, and records history', async () => {
    const { gh, port, origin, signIn } = await start()
    const alice = (await signIn('alice')).cookie!
    const carol = (await signIn('carol')).cookie!
    await call(port, 'PUT', '/v1/settings', { cookie: alice, origin }, { provider: { type: 'anthropic' }, apiKey: 'sk-ant-alice-key-0000000000000000' })

    const run = async () => {
      const created = JSON.parse((await call(port, 'POST', '/v1/runs', { cookie: alice, origin }, { pr: 'octo/app#9' })).body) as { id: string }
      await call(port, 'GET', `/v1/runs/${created.id}/events`, { cookie: alice })
      return created.id
    }
    const first = await run()
    const second = await run()
    expect(gh.state.aiKeys).toEqual(['sk-ant-alice-key-0000000000000000', 'sk-ant-alice-key-0000000000000000'])

    const report = JSON.parse((await call(port, 'GET', `/v1/runs/${second}/report`, { cookie: alice })).body)
    expect(report.run.channel).toBe('WEB')
    expect((await call(port, 'GET', `/v1/runs/${second}/report`, { cookie: carol })).status).toBe(404)
    expect((await call(port, 'GET', `/v1/runs/${second}/events`, { cookie: carol })).status).toBe(404)

    const history = JSON.parse((await call(port, 'GET', '/v1/history?pr=octo/app%239', { cookie: alice })).body)
    expect(history.runs.map((r: { id: string; new: number; resolved: number; unchanged: number }) => [r.id, r.new, r.resolved, r.unchanged])).toEqual([
      [second, 1, 0, 1],
      [first, 1, 0, 0],
    ])
    expect(JSON.parse((await call(port, 'GET', '/v1/history', { cookie: carol })).body).runs).toEqual([])
  })
})

describe('Web App selective publish with edits (Story 6.3)', () => {
  it('previews the user\'s rewording, bound to the digest', async () => {
    const { port, origin, signIn } = await start()
    const alice = (await signIn('alice')).cookie!
    await call(port, 'PUT', '/v1/settings', { cookie: alice, origin }, { provider: { type: 'anthropic' }, apiKey: 'sk-ant-alice-key-0000000000000000' })
    const { id } = JSON.parse((await call(port, 'POST', '/v1/runs', { cookie: alice, origin }, { pr: 'octo/app#9' })).body) as { id: string }
    await call(port, 'GET', `/v1/runs/${id}/events`, { cookie: alice })
    const report = JSON.parse((await call(port, 'GET', `/v1/runs/${id}/report`, { cookie: alice })).body)
    const fp = report.findings[0].fingerprint as string
    const plain = JSON.parse((await call(port, 'POST', `/v1/runs/${id}/publish`, { cookie: alice, origin }, { dryRun: true })).body)
    const edited = JSON.parse((await call(port, 'POST', `/v1/runs/${id}/publish`, { cookie: alice, origin }, { dryRun: true, edits: { [fp]: { title: 'Add exponential backoff to retries' } } })).body)
    expect(edited.preview.inline[0].body).toContain('Add exponential backoff to retries')
    expect(edited.digest).not.toBe(plain.digest)
    // The stored Report keeps the original wording.
    expect(JSON.parse((await call(port, 'GET', `/v1/runs/${id}/report`, { cookie: alice })).body).findings[0].title).toBe('Retries without backoff')
  })
})
