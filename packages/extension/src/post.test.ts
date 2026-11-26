import { describe, expect, it } from 'vitest'
import { pollDeviceFlow, postReview, previewPost, runStandalone, startDeviceFlow, testAiKey, testGitHubToken, type StandaloneSettings } from './compose.js'
import { createSecureStore } from './secure-store.js'

const GH = 'https://api.github.com/repos/octo/app'
const pull = { title: 'Add retry', body: '', user: { login: 'dev' }, state: 'open', draft: false, base: { ref: 'main', sha: 'base0001', repo: { id: 5, full_name: 'octo/app' } }, head: { ref: 'retry', sha: 'head0002', repo: { id: 5, full_name: 'octo/app' } } }
const patch = '@@ -1,2 +1,4 @@\n export const n = 1\n+export const retries = 3\n+export const delay = 10\n export const m = 2'
const finding = { category: 'CORRECTNESS', severity: 'MAJOR', confidence: 'HIGH', title: 'Retries without backoff', description: 'Retrying immediately can amplify load.', impact: null, recommendation: 'Add backoff.', path: 'src/retry.ts', startLine: 2, endLine: 2 }
const settings: StandaloneSettings = { githubToken: 'gh-test-token-0000', provider: { type: 'anthropic', apiKey: ['sk-ant-', 'test-', 'key-0123456789abcdefghij'].join('') } }

function github(writes: Array<{ method: string; url: string; body: unknown }>) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init)
    const url = req.url
    if (url.endsWith('/graphql')) return Response.json({ data: { repository: { pullRequest: { closingIssuesReferences: { nodes: [] } } } } })
    if (req.method !== 'GET') {
      const body = req.method === 'DELETE' ? null : await req.json().catch(() => null)
      writes.push({ method: req.method, url, body })
      if (url.endsWith('/pulls/9/reviews')) return Response.json({ id: 1, html_url: 'https://github.com/octo/app/pull/9#pullrequestreview-1' })
      if (url.endsWith('/issues/9/comments')) return Response.json({ id: 2, html_url: 'https://github.com/octo/app/pull/9#issuecomment-2' })
      return Response.json({})
    }
    if (url.startsWith('https://api.anthropic.com/v1/models')) return req.headers.get('x-api-key')?.startsWith('sk-ant-') ? Response.json({ data: [] }) : new Response('{}', { status: 401 })
    if (url.startsWith('https://api.osv.dev/')) return Response.json({ results: [] })
    const routes: Record<string, unknown> = {
      'https://api.github.com/user': { id: 7, login: 'tom' },
      [`${GH}/pulls/9`]: pull,
      [`${GH}/compare/base0001...head0002?per_page=1`]: { merge_base_commit: { sha: 'mb000003' } },
      [`${GH}/pulls/9/files?per_page=100`]: [{ filename: 'src/retry.ts', status: 'modified', additions: 2, deletions: 0, changes: 2, patch }],
      [`${GH}/pulls/9/reviews?per_page=100`]: [],
      [`${GH}/pulls/9/comments?per_page=100`]: [],
      [`${GH}/issues/9/comments?per_page=100`]: [],
    }
    if (url === `${GH}/contents/src/retry.ts?ref=head0002`) return new Response('export const n = 1\nexport const retries = 3\nexport const delay = 10\nexport const m = 2\n')
    if (url === `${GH}/contents/src/retry.ts?ref=mb000003`) return new Response('export const n = 1\nexport const m = 2\n')
    return url in routes ? Response.json(routes[url]) : new Response('{}', { status: 404 })
  }) as typeof fetch
}

function withAi(base: typeof fetch): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init)
    if (req.url === 'https://api.anthropic.com/v1/messages') return Response.json({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: JSON.stringify({ findings: [finding] }) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 9, output_tokens: 4 } })
    return base(input, init)
  }) as typeof fetch
}

describe('posting from the extension (Story 7.3)', () => {
  it('previews exactly what will be posted, applies edits, then posts through the single writer', async () => {
    const writes: Array<{ method: string; url: string; body: unknown }> = []
    const f = withAi(github(writes))
    const result = await runStandalone({ pr: 'octo/app#9', settings, fetch: f })
    const fp = result.report.findings.find((x) => x.title === 'Retries without backoff')!.fingerprint!
    const shown = await previewPost(result, settings, f, { event: 'COMMENT', include: [fp], edits: { [fp]: { title: 'Retries need a delay' } } })
    expect(shown.preview.inline).toHaveLength(1)
    expect(shown.preview.inline[0]!.body).toContain('Retries need a delay')
    expect(writes).toEqual([])
    const record = await postReview(result, settings, f, shown)
    expect(record.status).toBe('PUBLISHED')
    const review = writes.find((w) => w.url.endsWith('/pulls/9/reviews'))!
    expect(review.body).toMatchObject({ event: 'COMMENT', commit_id: 'head0002' })
    expect(JSON.stringify(review.body)).toContain('Retries need a delay')
    expect(writes.some((w) => JSON.stringify(w.body).includes('APPROVE'))).toBe(false)
  })
})

describe('setup checks (Story 7.2)', () => {
  it('tests the GitHub token and the AI key with small calls', async () => {
    const f = github([])
    expect(await testGitHubToken('gh-test-token-0000', f)).toEqual({ ok: true, login: 'tom' })
    expect(await testAiKey(settings.provider, f)).toMatchObject({ ok: true })
    expect(await testAiKey({ type: 'anthropic', apiKey: 'wrong' }, f)).toEqual({ ok: false, message: 'AI key: Anthropic rejected it (401). Check the key or create a new one.' })
  })

  it('runs the device flow until GitHub approves or the code expires', async () => {
    let polls = 0
    const f = (async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.endsWith('/login/device/code')) return Response.json({ device_code: 'dc', user_code: 'WDJB-MJHT', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 })
      polls++
      return Response.json(polls === 1 ? { error: 'authorization_pending' } : polls === 2 ? { error: 'slow_down', interval: 10 } : polls === 3 ? { access_token: 'gho_x' } : { error: 'expired_token' })
    }) as typeof fetch
    const s = await startDeviceFlow('client-id', f)
    expect(s.userCode).toBe('WDJB-MJHT')
    expect(await pollDeviceFlow('client-id', s.deviceCode, f)).toEqual({ status: 'pending' })
    expect(await pollDeviceFlow('client-id', s.deviceCode, f)).toEqual({ status: 'slow_down', interval: 10 })
    expect(await pollDeviceFlow('client-id', s.deviceCode, f)).toEqual({ status: 'approved', token: 'gho_x' })
    expect(await pollDeviceFlow('client-id', s.deviceCode, f)).toEqual({ status: 'expired' })
  })

  it('keeps credentials encrypted at rest and readable only with the stored key', async () => {
    let key: CryptoKey | undefined
    const blobs = new Map<string, string>()
    const store = createSecureStore({ load: async () => key, save: async (k) => void (key = k) }, { get: async (n) => blobs.get(n), set: async (n, v) => void blobs.set(n, v), remove: async (n) => void blobs.delete(n) })
    await store.set('settings', settings)
    expect([...blobs.values()][0]).not.toContain('gh-test-token')
    expect([...blobs.values()][0]).not.toContain('sk-ant')
    expect(key!.extractable).toBe(false)
    expect(await store.get('settings')).toEqual(settings)
    const other = createSecureStore({ load: async () => undefined, save: async () => undefined }, { get: async (n) => blobs.get(n), set: async () => undefined, remove: async () => undefined })
    expect(await other.get('settings')).toBeUndefined()
    await store.remove('settings')
    expect(await store.get('settings')).toBeUndefined()
  })
})
