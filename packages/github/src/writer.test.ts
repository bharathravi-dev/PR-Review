import { describe, expect, it } from 'vitest'
import { GitHubClient } from './client.js'
import { GitHubPrWriter } from './writer.js'

function fake(branchSha: string) {
  const calls: Array<{ method: string; url: string; body?: unknown }> = []
  const impl = (async (url: string, init: RequestInit = {}) => {
    calls.push({ method: init.method ?? 'GET', url, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) })
    if (url.includes('/branches/')) return Response.json({ commit: { sha: branchSha } })
    if ((init.method ?? 'GET') === 'GET') return Response.json({ sha: 'blob1' })
    return Response.json({ commit: { sha: 'c0ffee1', html_url: 'https://github.com/dev/r/commit/c0ffee1' } })
  }) as unknown as typeof fetch
  return { writer: new GitHubPrWriter(new GitHubClient({ apiUrl: 'https://api.github.com', token: 't', fetch: impl, userAgent: 'x' })), calls }
}

describe('GitHub writer: Apply fix', () => {
  it('commits a file to the branch with the current blob sha', async () => {
    const { writer, calls } = fake('h1')
    const done = await writer.commitFile({ host: 'github.com', owner: 'dev', repo: 'r' }, { branch: 'feat/x', path: 'src/a b.ts', content: 'new\n', message: 'Apply', expectedHead: 'h1' })
    expect(done).toEqual({ ok: true, value: { commitSha: 'c0ffee1', url: 'https://github.com/dev/r/commit/c0ffee1' } })
    const put = calls.find((c) => c.method === 'PUT')!
    expect(put.url).toBe('https://api.github.com/repos/dev/r/contents/src/a%20b.ts')
    expect(put.body).toEqual({ message: 'Apply', content: Buffer.from('new\n').toString('base64'), sha: 'blob1', branch: 'feat/x' })
  })

  it('refuses when the branch moved since the review', async () => {
    const { writer, calls } = fake('h2')
    expect(await writer.commitFile({ host: 'github.com', owner: 'dev', repo: 'r' }, { branch: 'feat/x', path: 'a.ts', content: 'x', message: 'm', expectedHead: 'h1' })).toMatchObject({ ok: false, error: { code: 'head_moved' } })
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
  })
})
