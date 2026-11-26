import { mkdtempSync, readFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseUserConfig, resolveSettings, type ResolvedConfig, type RunEvent, type Secret } from '@pr-reviewer/core'
import { DefaultCredentialResolver } from '@pr-reviewer/credentials'
import { afterEach, describe, expect, it } from 'vitest'
import type { CliDeps } from './deps.js'
import { main } from './main.js'
import { newPairCode } from './pairing.js'
import { startServer, type RunningServer } from './serve.js'

const GH = 'https://api.github.com/repos/octo/app'
const ME = 4242
const GH_TOKEN = 'gh-test-token-9999'
const FILE = 'export const n = 1\nexport const retries = 3\nexport const delay = 10\nexport const m = 2\n'
const finding = { category: 'CORRECTNESS', severity: 'MAJOR', confidence: 'HIGH', title: 'Retries without backoff', description: 'd', impact: null, recommendation: null, path: 'src/retry.ts', startLine: 2, endLine: 2 }

/** A fake GitHub + Anthropic behind the injected fetch; the page itself is called over real HTTP. */
function github() {
  const state = {
    reviews: [] as Array<{ id: number; user: { id: number }; body: string; state: string; event: string }>,
    inline: [] as Array<{ id: number; user: { id: number; login: string }; body: string; line: number; position: number; created_at: string; html_url: string }>,
    comments: [] as Array<{ id: number; user: { id: number; login: string }; body: string; created_at: string; html_url: string }>,
  }
  let next = 100
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init)
    const { url, method } = req
    if (url.startsWith('https://api.anthropic.com/')) {
      return Response.json({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: JSON.stringify({ findings: [finding] }) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } })
    }
    if (method === 'GET') {
      if (url === 'https://api.github.com/user') return Response.json({ id: ME, login: 'me' })
      if (url === `${GH}/pulls/9`) {
        // The title carries the token, to prove every response is redacted.
        return Response.json({ title: `Add retry ${GH_TOKEN}`, body: '', user: { login: 'dev', id: 7 }, state: 'open', draft: false, base: { ref: 'main', sha: 'base0001', repo: { id: 555, full_name: 'octo/app' } }, head: { ref: 'retry', sha: 'head0002', repo: { id: 555, full_name: 'octo/app' } } })
      }
      if (url.startsWith(`${GH}/pulls?state=open`)) {
        return Response.json([{ number: 9, title: 'Add retry', user: { login: 'dev' }, head: { sha: 'head0002' }, draft: false, updated_at: '2026-11-25T00:00:00Z' }])
      }
      if (url.startsWith(`${GH}/compare/`)) return Response.json({ merge_base_commit: { sha: 'mb000003' } })
      if (url === `${GH}/pulls/9/files?per_page=100`) {
        return Response.json([{ filename: 'src/retry.ts', status: 'modified', additions: 2, deletions: 0, changes: 2, patch: '@@ -1,2 +1,4 @@\n export const n = 1\n+export const retries = 3\n+export const delay = 10\n export const m = 2' }])
      }
      if (url === `${GH}/pulls/9/reviews?per_page=100`) return Response.json(state.reviews)
      if (url === `${GH}/pulls/9/comments?per_page=100`) return Response.json(state.inline)
      if (url === `${GH}/issues/9/comments?per_page=100`) return Response.json(state.comments)
      if (url.startsWith(`${GH}/contents/src/retry.ts?ref=`)) return new Response(FILE)
      if (/\/reactions\?/.test(url)) return Response.json([])
    }
    if (method === 'POST' && url === `${GH}/pulls/9/reviews`) {
      const body = JSON.parse(await req.text()) as { body: string; event: string; comments: Array<{ line: number; body: string }> }
      const id = next++
      state.reviews.push({ id, user: { id: ME }, body: body.body, state: 'COMMENTED', event: body.event })
      for (const c of body.comments) {
        const cid = next++
        state.inline.push({ id: cid, user: { id: ME, login: 'me' }, body: c.body, line: c.line, position: 1, created_at: '2026-11-25T00:00:00Z', html_url: `https://github.com/octo/app/pull/9#discussion_r${cid}` })
      }
      return Response.json({ id, html_url: `https://github.com/octo/app/pull/9#pullrequestreview-${id}` })
    }
    if (method === 'POST' && url === `${GH}/issues/9/comments`) {
      const id = next++
      state.comments.push({ id, user: { id: ME, login: 'me' }, body: (JSON.parse(await req.text()) as { body: string }).body, created_at: '2026-11-25T00:00:00Z', html_url: `https://github.com/octo/app/pull/9#issuecomment-${id}` })
      return Response.json({ id, html_url: `https://github.com/octo/app/pull/9#issuecomment-${id}` })
    }
    return new Response('{}', { status: 404 })
  }) as typeof fetch
  return { state, impl }
}

const env = { GITHUB_TOKEN: GH_TOKEN, ANTHROPIC_API_KEY: 'sk-ant-test-key-0123456789abcdefghij', PR_REVIEWER_CONFIG: '/nonexistent/c.yml' }

function deps(fetchImpl: typeof fetch, over: Partial<CliDeps> = {}): CliDeps {
  return {
    env,
    fetch: fetchImpl,
    platform: 'linux',
    homedir: '/home/test',
    credentials: new DefaultCredentialResolver({ env, keychain: async () => undefined, ghToken: async () => undefined }),
    isTTY: false,
    prompt: async () => '',
    openUrl: () => undefined,
    untilStopped: async () => undefined,
    ...over,
  }
}

function config(raw: unknown = { version: 1 }): ResolvedConfig {
  const user = parseUserConfig(raw)
  if (!user.ok) throw new Error(user.error.message)
  const resolved = resolveSettings({ user: user.value })
  if (!resolved.ok) throw new Error(resolved.error.message)
  return resolved.value
}

let server: RunningServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

async function start(gh = github(), cfg = config(), ui?: 'classic' | 'v2') {
  const secrets: Secret[] = []
  server = await startServer({ deps: deps(gh.impl), config: cfg, secrets, token: 'test-token-0123456789abcdef', ...(ui ? { ui } : {}) })
  const call = (path: string, init: RequestInit & { json?: unknown } = {}) => {
    const headers = new Headers(init.headers)
    if (!headers.has('authorization')) headers.set('authorization', `Bearer ${server!.token}`)
    if (init.json !== undefined) headers.set('content-type', 'application/json')
    return fetch(`${server!.url}${path}`, { ...init, headers, ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}) })
  }
  return { gh, call, server: server! }
}

/** Reads a whole SSE response into events. */
async function readEvents(res: Response): Promise<RunEvent[]> {
  const text = await res.text()
  return text
    .split('\n\n')
    .map((chunk) => chunk.split('\n').find((l) => l.startsWith('data: ')))
    .filter((l): l is string => l !== undefined)
    .map((l) => JSON.parse(l.slice(6)) as RunEvent)
}

/** Raw request with a chosen Host header (fetch does not allow setting Host). */
function rawGet(url: string, path: string, headers: Record<string, string>): Promise<number> {
  const u = new URL(url)
  return new Promise((resolve, reject) => {
    const req = request({ host: u.hostname, port: u.port, path, method: 'GET', headers }, (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on('error', reject)
    req.end()
  })
}

async function runToEnd(call: Awaited<ReturnType<typeof start>>['call']) {
  const created = await call('/v1/runs', { method: 'POST', json: { pr: 'octo/app#9' } })
  expect(created.status).toBe(202)
  const { id } = (await created.json()) as { id: string }
  const events = await readEvents(await call(`/v1/runs/${id}/events`))
  return { id, events }
}

describe('classic and v2 side by side (Story 9.3)', () => {
  it('serves both pages and their modules, and / opens the server default (v2 unless --ui classic)', async () => {
    const { server: s } = await start(undefined, undefined, 'classic')
    const get = async (p: string) => {
      const r = await fetch(`${s.url}${p}`)
      return { status: r.status, type: r.headers.get('content-type') ?? '', text: await r.text() }
    }
    expect((await get('/')).text).toContain('src="/app.js"')
    expect((await get('/classic/')).text).toContain('src="/app.js"')
    expect((await get('/v2/')).text).toContain('src="/v2/app.js"')
    for (const p of ['/ui-switch.js', '/v2/app.js', '/v2/api.js', '/v2/dom.js', '/v2/keys.js', '/v2/model.js', '/findings-view.js']) expect(await get(p)).toMatchObject({ status: 200, type: expect.stringContaining('text/javascript') })
    expect((await get('/v2/app.css')).type).toContain('text/css')
    expect((await get('/classic/')).text).toContain('id="ui-switch"')
    await s.close()
    server = undefined
    const v2 = await start()
    expect(await (await fetch(`${v2.server.url}/`)).text()).toContain('src="/v2/app.js"')
  })
})

describe('local review page (Story 8.1)', () => {
  it('serves the page and guards the API with the token, loopback Host, and same Origin', async () => {
    const { call, server: s } = await start()
    expect(s.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(s.pageUrl).toBe(`${s.url}/#token=${s.token}`)

    const page = await fetch(`${s.url}/`)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-security-policy')).toContain("script-src 'self'")
    expect(await page.text()).toContain('src="/v2/app.js"')
    expect(await (await fetch(`${s.url}/classic/`)).text()).toContain('<script type="module" src="/app.js">')
    // app.js imports the findings view module; it must be served as JavaScript (Story 9.1).
    expect(await (await fetch(`${s.url}/app.js`)).text()).toContain("from '/findings-view.js'")
    const view = await fetch(`${s.url}/findings-view.js`)
    expect(view.status).toBe(200)
    expect(view.headers.get('content-type')).toContain('text/javascript')

    expect((await call('/v1/session', { headers: { authorization: '' } })).status).toBe(401)
    expect((await call('/v1/session', { headers: { authorization: 'Bearer wrong-token-0123456789abc' } })).status).toBe(401)
    expect((await call('/v1/session', { headers: { origin: 'https://evil.example' } })).status).toBe(403)
    expect((await call('/v1/session', { headers: { 'accept-schema': '2' } })).status).toBe(406)
    expect(await rawGet(s.url, '/v1/session', { host: 'evil.example', authorization: `Bearer ${s.token}` })).toBe(403)
    expect(await rawGet(s.url, '/', { host: `localhost:${new URL(s.url).port}` })).toBe(200)

    const ok = await call('/v1/session', { headers: { origin: s.url } })
    expect(ok.status).toBe(200)
    expect(ok.headers.get('access-control-allow-origin')).toBeNull()
    expect(await ok.json()).toMatchObject({
      schemaVersion: 1,
      github: { host: 'github.com', login: 'me' },
      ai: { provider: 'anthropic', ready: true },
      publish: { allowRequestChanges: false, commitStatus: false },
    })
  })

  it('runs a review, streams RunEvents in order, and serves the Report redacted', async () => {
    const { call } = await start()
    expect((await call('/v1/runs', { method: 'POST', json: { pr: 'not a pr' } })).status).toBe(400)
    expect((await call('/v1/runs', { method: 'POST', body: 'pr=octo/app#9', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status).toBe(415)

    const { id, events } = await runToEnd(call)
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1))
    expect(events.every((e) => e.runId === id && e.schemaVersion === 1)).toBe(true)
    const stages = events.filter((e) => e.type === 'STAGE_STARTED').map((e) => e.payload.stage)
    expect(stages).toEqual(['fetchContext', 'detect', 'validate', 'execute', 'review', 'dedupe', 'gate'])
    expect(events.filter((e) => e.type === 'LAYER_STATUS' && e.payload.status !== 'NOT_APPLICABLE').map((e) => [e.payload.layer, e.payload.status])).toEqual([
      ['CONTEXT', 'PASSED'],
      ['SECURITY', 'PASSED'],
      ['SECURITY', 'PASSED'],
      ['SECRETS', 'PASSED'],
      ['AI_REVIEW', 'WARNING'],
    ])
    expect(events.at(-1)).toMatchObject({ type: 'DONE', payload: { overallStatus: 'PASSED_WITH_WARNINGS', findings: 1 } })

    // Resuming with Last-Event-ID sends only later events.
    const resumed = await readEvents(await call(`/v1/runs/${id}/events`, { headers: { 'last-event-id': String(events.length - 1) } }))
    expect(resumed.map((e) => e.type)).toEqual(['DONE'])

    const report = await call(`/v1/runs/${id}/report`)
    const text = await report.text()
    expect(text).not.toContain(GH_TOKEN)
    const json = JSON.parse(text) as { run: { id: string; channel: string }; title: string; findings: Array<{ title: string }> }
    expect(json.run).toMatchObject({ id, channel: 'CLI' })
    expect(json.title).toBe('Add retry [REDACTED]')
    expect(json.findings.map((f) => f.title)).toEqual(['Retries without backoff'])

    const md = await call(`/v1/runs/${id}/report?format=markdown`)
    expect(md.headers.get('content-type')).toContain('text/markdown')
    expect(await md.text()).toContain('# PR review: octo/app#9 — Add retry [REDACTED]')
    expect((await call('/v1/runs/00000000-0000-7000-8000-000000000000/report')).status).toBe(404)

    // The diff around each finding, for review page v2 (Story 9.6).
    const hunks = (await (await call(`/v1/runs/${id}/hunks`)).json()) as { files: Array<{ path: string; hunks: Array<{ lines: Array<{ kind: string; newLine?: number; text: string }> }> }>; unavailable: string[] }
    expect(hunks.unavailable).toEqual([])
    expect(hunks.files.map((f) => f.path)).toEqual(['src/retry.ts'])
    expect(hunks.files[0]!.hunks[0]!.lines).toContainEqual({ kind: 'add', newLine: 2, text: 'export const retries = 3' })
    expect((await call('/v1/runs/00000000-0000-7000-8000-000000000000/hunks')).status).toBe(404)
  })
})

describe('posting from the page (Story 8.2)', () => {
  it('previews, refuses a stale or missing digest, then posts exactly the preview', async () => {
    const { call, gh } = await start()
    const { id } = await runToEnd(call)
    const publish = (json: unknown) => call(`/v1/runs/${id}/publish`, { method: 'POST', json })

    const dry = (await (await publish({ dryRun: true })).json()) as { digest: string; preview: { inline: Array<{ path: string; line: number }>; summaryBody: string } }
    expect(dry.preview.inline).toEqual([expect.objectContaining({ path: 'src/retry.ts', line: 2 })])
    expect(gh.state.reviews).toHaveLength(0)

    expect((await publish({})).status).toBe(400)
    const stale = await publish({ previewDigest: 'f'.repeat(64) })
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ error: { code: 'preview_changed' }, digest: dry.digest })
    expect((await publish({ event: 'REQUEST_CHANGES', previewDigest: dry.digest })).status).toBe(400)

    const posted = await publish({ previewDigest: dry.digest })
    expect(posted.status).toBe(200)
    expect(await posted.json()).toMatchObject({ record: { status: 'PUBLISHED', commentCount: 1 } })
    expect(gh.state.reviews).toEqual([expect.objectContaining({ event: 'COMMENT' })])
    expect(gh.state.inline).toHaveLength(1)
    expect(gh.state.comments[0]!.body).toBe(dry.preview.summaryBody.replace(GH_TOKEN, '[REDACTED]'))

    // After posting, the same Finding is "still open", so a new preview differs from the old one.
    const again = (await (await publish({ dryRun: true })).json()) as { digest: string; preview: { inline: unknown[]; stillOpen: unknown[] } }
    expect(again.digest).not.toBe(dry.digest)
    expect(again.preview.inline).toHaveLength(0)
    expect(again.preview.stillOpen).toHaveLength(1)
  })

  it('posts only the selected Findings', async () => {
    const { call } = await start()
    const { id } = await runToEnd(call)
    const res = (await (await call(`/v1/runs/${id}/publish`, { method: 'POST', json: { dryRun: true, include: [] } })).json()) as { preview: { inline: unknown[]; withheld: number } }
    expect(res.preview.inline).toHaveLength(0)
    expect(res.preview.withheld).toBe(1)
  })

  it('offers REQUEST_CHANGES only when the user config allows it', async () => {
    const { call } = await start(github(), config({ version: 1, publish: { allowRequestChanges: true } }))
    expect(await (await call('/v1/session')).json()).toMatchObject({ publish: { allowRequestChanges: true } })
    const { id } = await runToEnd(call)
    const res = await call(`/v1/runs/${id}/publish`, { method: 'POST', json: { dryRun: true, event: 'REQUEST_CHANGES' } })
    expect(await res.json()).toMatchObject({ preview: { event: 'REQUEST_CHANGES' } })
  })
})

describe('picking an open PR (Story 8.3)', () => {
  it('lists open PRs with the reviewed state', async () => {
    const { call } = await start()
    const res = await call('/v1/pulls?repo=octo/app')
    expect(await res.json()).toMatchObject({ repo: 'octo/app', reviewerKnown: true, pulls: [{ number: 9, reviewed: 'NONE' }] })
    expect((await call('/v1/pulls?repo=nope')).status).toBe(400)
  })

  it('checks the stats period and repository before asking GitHub', async () => {
    const { call } = await start()
    expect((await call('/v1/stats?days=0')).status).toBe(400)
    expect((await call('/v1/stats?repo=nope')).status).toBe(400)
  })
})

describe('pr-reviewer serve', () => {
  it('prints the page link and stops cleanly', async () => {
    let out = ''
    let err = ''
    let opened = ''
    const code = await main(['serve', '--open'], { stdout: (t) => (out += t), stderr: (t) => (err += t) }, deps(github().impl, { openUrl: (u) => (opened = u) }))
    expect(code).toBe(0)
    expect(out).toMatch(/Open: http:\/\/127\.0\.0\.1:\d+\/#token=[A-Za-z0-9_-]{32}\n/)
    expect(opened).toBe(/Open: (\S+)/.exec(out)![1])
    expect(err).toBe('Stopped.\n')
  })

  it('rejects a bad port', async () => {
    let err = ''
    expect(await main(['serve', '--port', 'abc'], { stdout: () => undefined, stderr: (t) => (err += t) }, deps(github().impl))).toBe(64)
    expect(err).toContain('--port must be a whole number')
  })
})

describe('pairing the browser extension (Story 7.8)', () => {
  const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'
  const OTHER = 'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba'

  /** Raw request with chosen Origin and Host (fetch would add its own). */
  function raw(url: string, method: string, path: string, headers: Record<string, string>, body?: unknown): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
    const u = new URL(url)
    const data = body === undefined ? undefined : JSON.stringify(body)
    return new Promise((resolve, reject) => {
      const req = request({ host: u.hostname, port: u.port, path, method, headers: { ...(data ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
        let text = ''
        res.on('data', (c: Buffer) => (text += c.toString()))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }))
      })
      req.on('error', reject)
      req.end(data)
    })
  }

  async function startPairing(dir: string, open = true, now?: () => number) {
    server = await startServer({ deps: deps(github().impl), config: config(), secrets: [], token: 'test-token-0123456789abcdef', pairing: { dir, open, computer: 'devbox', code: 'ABCD2345', ...(now ? { now } : {}) } })
    return server
  }

  it('exchanges the code once for a token that works from that extension only', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prr-pair-'))
    const s = await startPairing(dir)
    expect(s.pairCode).toBe('ABCD2345')
    const ext = { origin: EXT, 'sec-fetch-site': 'none' }
    expect((await raw(s.url, 'GET', '/v1/session', ext)).status).toBe(403)
    const wrong = await raw(s.url, 'POST', '/pair', ext, { code: 'ABCD-0000' })
    expect(wrong.status).toBe(400)
    expect(JSON.parse(wrong.body).error.message).toBe("That code didn't match.")
    const ok = await raw(s.url, 'POST', '/pair', ext, { code: 'abcd-2345' })
    expect(ok.status).toBe(200)
    expect(ok.headers['access-control-allow-origin']).toBe(EXT)
    const paired = JSON.parse(ok.body) as { token: string; computer: string; port: number }
    expect(paired.computer).toBe('devbox')
    expect(paired.port).toBe(Number(new URL(s.url).port))
    expect(readFileSync(join(dir, 'paired-extensions.json'), 'utf8')).not.toContain(paired.token)
    expect((await raw(s.url, 'POST', '/pair', ext, { code: 'ABCD2345' })).status).toBe(410)

    const withToken = { ...ext, authorization: `Bearer ${paired.token}` }
    const session = await raw(s.url, 'GET', '/v1/session', withToken)
    expect(session.status).toBe(200)
    expect(session.headers['access-control-allow-origin']).toBe(EXT)
    const pre = await raw(s.url, 'OPTIONS', '/v1/runs', { origin: EXT })
    expect(pre.status).toBe(204)
    expect(String(pre.headers['access-control-allow-headers'])).toContain('authorization')
    expect((await raw(s.url, 'GET', '/v1/session', { ...withToken, origin: OTHER })).status).toBe(403)
    expect((await raw(s.url, 'GET', '/v1/session', { ...withToken, origin: 'https://evil.example' })).status).toBe(403)
    expect((await raw(s.url, 'GET', '/v1/session', { ...withToken, host: 'evil.example' })).status).toBe(403)
    expect((await raw(s.url, 'GET', '/v1/session', { ...ext, authorization: 'Bearer nope' })).status).toBe(401)
    // The page's launch token is not a pairing token.
    expect((await raw(s.url, 'GET', '/v1/session', { ...ext, authorization: `Bearer ${s.token}` })).status).toBe(401)
    // Without pairing open, nothing changes for ordinary requests.
    expect((await raw(s.url, 'GET', '/v1/session', { authorization: `Bearer ${s.token}` })).status).toBe(200)

    // A later launch without --pair still accepts the pairing, until --unpair.
    await s.close()
    const again = await startPairing(dir, false)
    expect(again.pairCode).toBeUndefined()
    expect((await raw(again.url, 'POST', '/pair', ext, { code: 'ABCD2345' })).status).toBe(409)
    expect((await raw(again.url, 'GET', '/v1/session', withToken)).status).toBe(200)
    let out = ''
    expect(await main(['serve', '--unpair'], { stdout: (t) => (out += t), stderr: () => undefined }, deps(github().impl, { env: { ...env, PR_REVIEWER_STATE_DIR: dir } }))).toBe(0)
    expect(out).toContain('Removed 1 paired browser extension.')
    expect((await raw(again.url, 'GET', '/v1/session', withToken)).status).toBe(403)
  })

  it('expires the code after ten minutes or five wrong tries', async () => {
    let t = 1_000_000
    const s = await startPairing(mkdtempSync(join(tmpdir(), 'prr-pair-')), true, () => t)
    t += 10 * 60_000
    expect(JSON.parse((await raw(s.url, 'POST', '/pair', { origin: EXT }, { code: 'ABCD2345' })).body).error.code).toBe('pair_code_expired')
    await s.close()
    t = 0
    const s2 = await startPairing(mkdtempSync(join(tmpdir(), 'prr-pair-')), true, () => t)
    for (let i = 0; i < 4; i++) expect((await raw(s2.url, 'POST', '/pair', { origin: EXT }, { code: 'WRONG000' })).status).toBe(400)
    expect((await raw(s2.url, 'POST', '/pair', { origin: EXT }, { code: 'WRONG000' })).status).toBe(410)
    expect((await raw(s2.url, 'POST', '/pair', { origin: EXT }, { code: 'ABCD2345' })).status).toBe(410)
  })

  it('prints the pairing code on the stable port', async () => {
    let out = ''
    const dir = mkdtempSync(join(tmpdir(), 'prr-pair-'))
    expect(await main(['serve', '--pair', '--port', '0'], { stdout: (t) => (out += t), stderr: () => undefined }, deps(github().impl, { env: { ...env, PR_REVIEWER_STATE_DIR: dir } }))).toBe(0)
    expect(out).toMatch(/Pairing code for the browser extension: [A-Z2-9]{4}-[A-Z2-9]{4}\n/)
    expect(out).toMatch(/keep port \d+/)
    expect(newPairCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$/)
  })
})
