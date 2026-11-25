import { DEFAULT_CONTEXT_LIMITS, fetchContext, type PrRef } from '@pr-reviewer/core'
import { describe, expect, it } from 'vitest'
import { GITHUB_API_VERSION, GitHubClient, apiUrlForHost } from './client.js'
import { GitHubPrReader } from './pr-context.js'

const API = 'https://ghe.example.com/api/v3'
const REF: PrRef = { host: 'ghe.example.com', owner: 'octo', repo: 'app', number: 7 }
const REPO = `${API}/repos/octo/app`

type Route = { status?: number; body?: unknown; text?: string; headers?: Record<string, string> }

function fakeFetch(routes: Record<string, Route>) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = []
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
    const route = routes[url]
    if (!route) return new Response('not found', { status: 404 })
    const body = route.text ?? JSON.stringify(route.body ?? null)
    return new Response(body, { status: route.status ?? 200, headers: route.headers ?? {} })
  }) as typeof fetch
  return { impl, calls }
}

const pull = {
  title: 'Add feature',
  body: null,
  user: { login: 'dev' },
  state: 'open',
  draft: false,
  base: { ref: 'main', sha: 'base111', repo: { full_name: 'octo/app' } },
  head: { ref: 'feat', sha: 'head222', repo: { full_name: 'fork/app' } },
}

function happyRoutes(extra: Record<string, Route> = {}): Record<string, Route> {
  return {
    [`${REPO}/pulls/7`]: { body: pull },
    [`${REPO}/compare/base111...head222?per_page=1`]: { body: { merge_base_commit: { sha: 'mb333' } } },
    [`${REPO}/pulls/7/files?per_page=100`]: {
      body: [{ filename: 'src/a.ts', status: 'modified', additions: 1, deletions: 1, changes: 2, patch: '@@ -1 +1 @@\n-a\n+b' }],
      headers: { link: `<${REPO}/pulls/7/files?per_page=100&page=2>; rel="next", <${REPO}/pulls/7/files?per_page=100&page=2>; rel="last"` },
    },
    [`${REPO}/pulls/7/files?per_page=100&page=2`]: {
      body: [
        { filename: 'img/logo.png', status: 'added', additions: 0, deletions: 0, changes: 0 },
        { filename: 'src/new name.ts', previous_filename: 'src/old.ts', status: 'renamed', additions: 3, deletions: 0, changes: 3, patch: '+x' },
        { filename: 'big.ts', status: 'modified', additions: 9000, deletions: 0, changes: 9000 },
        { filename: 'gone.ts', status: 'removed', additions: 0, deletions: 4, changes: 4, patch: '-x' },
      ],
    },
    [`${REPO}/pulls/7/reviews?per_page=100`]: { body: [{ id: 1, user: { login: 'rev' }, state: 'COMMENTED', body: 'hi', submitted_at: '2026-11-01T00:00:00Z' }] },
    [`${REPO}/pulls/7/comments?per_page=100`]: { body: [{ id: 2, user: null, body: 'c', path: 'src/a.ts', line: 1, created_at: '2026-11-01T00:00:00Z' }] },
    [`${REPO}/issues/7/comments?per_page=100`]: { body: [] },
    [`${REPO}/contents/src/a.ts?ref=head222`]: { text: 'b\n' },
    [`${REPO}/contents/src/a.ts?ref=mb333`]: { text: 'a\n' },
    [`${REPO}/contents/src/new%20name.ts?ref=head222`]: { text: 'x'.repeat(10) },
    [`${REPO}/contents/src/old.ts?ref=mb333`]: { text: 'y'.repeat(10) },
    [`${REPO}/contents/big.ts?ref=head222`]: { text: 'z'.repeat(70_000) },
    [`${REPO}/contents/big.ts?ref=mb333`]: { text: 'z'.repeat(10) },
    [`${REPO}/contents/gone.ts?ref=mb333`]: { text: 'old' },
    ...extra,
  }
}

describe('GitHubPrReader', () => {
  it('assembles a schema-valid PrContext with pagination, merge base, and per-file contents', async () => {
    const { impl, calls } = fakeFetch(happyRoutes())
    const reader = new GitHubPrReader(new GitHubClient({ apiUrl: API, token: 't0k', fetch: impl }))
    const res = await fetchContext(reader, REF, DEFAULT_CONTEXT_LIMITS)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const ctx = res.value
    expect(ctx).toMatchObject({ headSha: 'head222', baseSha: 'base111', mergeBaseSha: 'mb333', fromFork: true, body: '', author: 'dev' })
    expect(ctx.files.map((f) => f.path)).toEqual(['src/a.ts', 'img/logo.png', 'src/new name.ts', 'big.ts', 'gone.ts'])

    const byPath = Object.fromEntries(ctx.files.map((f) => [f.path, f]))
    expect(byPath['src/a.ts']).toMatchObject({ head: { text: 'b\n' }, base: { text: 'a\n' }, binary: false })
    expect(byPath['img/logo.png']).toMatchObject({ binary: true, head: { omitted: 'binary' } })
    expect(byPath['src/new name.ts']).toMatchObject({ previousPath: 'src/old.ts', base: { text: 'y'.repeat(10) } })
    expect(byPath['big.ts']).toMatchObject({ patchTruncated: true, head: { omitted: 'too_large' }, base: { text: 'z'.repeat(10) } })
    expect(byPath['gone.ts']?.head).toBeUndefined()
    expect(byPath['gone.ts']?.base).toEqual({ text: 'old' })

    expect(ctx.truncated.join('\n')).toContain('Diff for big.ts was too large')
    expect(ctx.truncated.join('\n')).toContain('exceeded 60000 bytes')
    expect(ctx.reviews).toEqual([{ id: 1, author: 'rev', state: 'COMMENTED', body: 'hi', submittedAt: '2026-11-01T00:00:00Z' }])
    expect(ctx.reviewComments[0]).toMatchObject({ author: 'ghost', path: 'src/a.ts', line: 1 })

    for (const c of calls) {
      expect(c.url.startsWith(API)).toBe(true)
      expect(c.headers['x-github-api-version']).toBe(GITHUB_API_VERSION)
      expect(c.headers.authorization).toBe('Bearer t0k')
    }
  })

  it('stops loading content once the total budget is spent and says so', async () => {
    const { impl } = fakeFetch(happyRoutes())
    const reader = new GitHubPrReader(new GitHubClient({ apiUrl: API, fetch: impl }))
    const res = await fetchContext(reader, REF, { ...DEFAULT_CONTEXT_LIMITS, maxTotalBytes: 5 })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value.truncated.join('\n')).toContain('context budget')
  })

  it('lists truncation when the file count limit is hit', async () => {
    const { impl } = fakeFetch(happyRoutes())
    const reader = new GitHubPrReader(new GitHubClient({ apiUrl: API, fetch: impl }))
    const res = await fetchContext(reader, REF, { ...DEFAULT_CONTEXT_LIMITS, maxFiles: 2 })
    expect(res.ok && res.value.files).toHaveLength(2)
    expect(res.ok && res.value.truncated[0]).toBe('Only the first 2 changed files were loaded.')
  })

  it('names the missing permission when the PR is unreadable', async () => {
    const { impl } = fakeFetch({ [`${REPO}/pulls/7`]: { status: 404, body: { message: 'Not Found' } } })
    const withToken = await new GitHubPrReader(new GitHubClient({ apiUrl: API, token: 't', fetch: impl })).getPrContext(REF, DEFAULT_CONTEXT_LIMITS)
    expect(withToken.ok).toBe(false)
    if (!withToken.ok) {
      expect(withToken.error.code).toBe('github_no_access')
      expect(withToken.error.message).toContain('Pull requests: read')
    }
    const anonymous = await new GitHubPrReader(new GitHubClient({ apiUrl: API, fetch: impl })).getPrContext(REF, DEFAULT_CONTEXT_LIMITS)
    expect(!anonymous.ok && anonymous.error.message).toContain('No GitHub token was found')
  })

  it('reports rate limiting as retryable and bad tokens clearly', async () => {
    const limited = fakeFetch({ [`${REPO}/pulls/7`]: { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' } } })
    const r1 = await new GitHubPrReader(new GitHubClient({ apiUrl: API, fetch: limited.impl })).getPrContext(REF, DEFAULT_CONTEXT_LIMITS)
    expect(!r1.ok && r1.error).toMatchObject({ code: 'github_rate_limited', retryable: true })
    const bad = fakeFetch({ [`${REPO}/pulls/7`]: { status: 401 } })
    const r2 = await new GitHubPrReader(new GitHubClient({ apiUrl: API, token: 'x', fetch: bad.impl })).getPrContext(REF, DEFAULT_CONTEXT_LIMITS)
    expect(!r2.ok && r2.error.code).toBe('github_unauthorized')
  })

  it('derives API URLs: public GitHub default, /api/v3 for Enterprise hosts', () => {
    expect(apiUrlForHost('github.com')).toBe('https://api.github.com')
    expect(apiUrlForHost('ghe.example.com')).toBe('https://ghe.example.com/api/v3')
  })
})
