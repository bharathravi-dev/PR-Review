import { DEFAULT_CONTEXT_LIMITS, parsePatch, parsePrRef } from '@pr-reviewer/core'
import { describe, expect, it } from 'vitest'
import { AzureDevOpsReader, AzureDevOpsWriter } from './azure-devops.js'

const BASE = 'https://dev.azure.com/acme/Platform/_apis/git/repositories/api'
const ref = { host: 'dev.azure.com', owner: 'acme/Platform', repo: 'api', number: 42 }
const HEAD = 'a'.repeat(40)
const TARGET = 'b'.repeat(40)
const MB = 'c'.repeat(40)
const ME = '11111111-2222-3333-4444-555555555555'
const PR = { pullRequestId: 42, title: 'Add retry', description: 'ENG-1', status: 'active', isDraft: false, createdBy: { uniqueName: 'dev@acme.com' }, sourceRefName: 'refs/heads/retry', targetRefName: 'refs/heads/main', lastMergeSourceCommit: { commitId: HEAD }, lastMergeTargetCommit: { commitId: TARGET } }
const THREADS = {
  value: [
    { id: 7, threadContext: { filePath: '/src/retry.ts', rightFileStart: { line: 2 }, rightFileEnd: { line: 2 } }, comments: [{ id: 1, content: 'finding <!-- pr-reviewer kind=inline -->', author: { id: ME, uniqueName: 'bot@acme.com' } }, { id: 2, parentCommentId: 1, content: '@pr-reviewer why', author: { id: '99999999-0000-0000-0000-000000000000', uniqueName: 'ann@acme.com' } }] },
    { id: 8, comments: [{ id: 1, content: 'summary <!-- pr-reviewer kind=review head=x -->', author: { id: ME, uniqueName: 'bot@acme.com' } }] },
    { id: 9, comments: [{ id: 1, content: 'Policy check', commentType: 'system' }] },
  ],
}

function fake() {
  const calls: Array<{ method: string; url: string; body?: unknown; auth: string | null }> = []
  const impl = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    const u = url.replace(/[?&]api-version=7\.1/, '')
    calls.push({ method, url: u, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}), auth: new Headers(init.headers).get('authorization') })
    const json = (v: unknown) => Response.json(v)
    if (u === `${BASE}/pullrequests/42`) return json(PR)
    if (u.startsWith(`${BASE}/commits/${HEAD}/mergebases`)) return json({ value: [{ commitId: MB }] })
    if (u === `${BASE}/pullrequests/42/iterations`) return json({ value: [{ id: 1 }, { id: 2 }] })
    if (u.startsWith(`${BASE}/pullrequests/42/iterations/2/changes`)) return json({ changeEntries: [{ changeType: 'edit', item: { path: '/src/retry.ts' } }, { changeType: 'add', item: { path: '/src/new.ts' } }, { changeType: 'edit', item: { path: '/src', isFolder: true } }] })
    if (u === `${BASE}/pullrequests/42/threads` && method === 'GET') return json(THREADS)
    if (u.startsWith(`${BASE}/items?path=%2Fsrc%2Fretry.ts`) && u.includes(HEAD)) return new Response('x\ny\n')
    if (u.startsWith(`${BASE}/items?path=%2Fsrc%2Fretry.ts`) && u.includes(MB)) return new Response('x\n')
    if (u.startsWith(`${BASE}/items?path=%2Fsrc%2Fnew.ts`) && u.includes(HEAD)) return new Response('n\n')
    if (u.includes('/connectionData')) return json({ authenticatedUser: { id: ME, properties: { Account: { $value: 'bot@acme.com' } } } })
    if (method === 'POST' && u === `${BASE}/pullrequests/42/threads`) return json({ id: 77, comments: [{ id: 1 }] })
    if (method === 'POST' && u === `${BASE}/pushes`) return json({ commits: [{ commitId: 'd'.repeat(40), url: 'u' }] })
    if (method === 'PUT' || method === 'POST' || method === 'PATCH') return json({ id: 3 })
    return new Response('{}', { status: 404 })
  }) as unknown as typeof fetch
  return { impl, calls }
}

describe('Azure DevOps pull requests', () => {
  it('parses dev.azure.com and visualstudio.com pull request URLs', () => {
    expect(parsePrRef('https://dev.azure.com/acme/Platform/_git/api/pullrequest/42', 'github.com')).toEqual({ ok: true, value: ref })
    expect(parsePrRef('https://acme.visualstudio.com/Platform/_git/api/pullrequest/42?_a=files', 'github.com')).toEqual({ ok: true, value: ref })
  })

  it('reads a PR with computed patches, contents at head and merge base, and threads; with a PAT', async () => {
    const { impl, calls } = fake()
    const ctx = await new AzureDevOpsReader({ token: 'pat', fetch: impl, userAgent: 't' }).getPrContext(ref, DEFAULT_CONTEXT_LIMITS)
    expect(ctx.ok).toBe(true)
    if (!ctx.ok) return
    expect(ctx.value).toMatchObject({ title: 'Add retry', author: 'dev@acme.com', state: 'open', headRef: 'retry', baseRef: 'main', headSha: HEAD, mergeBaseSha: MB })
    const [retry, added] = ctx.value.files
    expect(retry).toMatchObject({ path: 'src/retry.ts', status: 'modified', additions: 1, deletions: 0, head: { text: 'x\ny\n' }, base: { text: 'x\n' } })
    expect(parsePatch(retry!.patch!).added).toEqual([{ line: 2, text: 'y' }])
    expect(added).toMatchObject({ path: 'src/new.ts', status: 'added', patch: '@@ -0,0 +1,1 @@\n+n' })
    expect(ctx.value.files).toHaveLength(2)
    expect(ctx.value.reviewComments.map((c) => [c.id, c.path, c.line])).toEqual([[7001, 'src/retry.ts', 2], [7002, 'src/retry.ts', 2]])
    expect(ctx.value.issueComments.map((c) => c.id)).toEqual([8001])
    expect(calls[0]!.auth).toBe(`Basic ${Buffer.from(':pat').toString('base64')}`)
  })

  it('maps threads to inline comments with replies and finds its own review note', async () => {
    const items = await new AzureDevOpsReader({ fetch: fake().impl, userAgent: 't', organisation: 'acme' }).listPublished(ref)
    expect(items.ok && items.value.reviewComments.map((c) => [c.id, c.inReplyTo])).toEqual([[7001, undefined], [7002, 7001]])
    expect(items.ok && items.value.reviews.map((c) => c.id)).toEqual([8001])
  })

  it('posts threads at lines and a summary, votes to approve when asked, replies by thread, and pushes fixes guarded by the reviewed head', async () => {
    const { impl, calls } = fake()
    const w = new AzureDevOpsWriter({ fetch: impl, userAgent: 't' })
    expect(await w.createReview(ref, { commitId: HEAD, event: 'APPROVE', body: 'summary', comments: [{ path: 'src/retry.ts', line: 2, side: 'RIGHT', body: 'Retries forever' }] })).toEqual({ ok: true, value: { id: 77001, url: 'https://dev.azure.com/acme/Platform/_git/api/pullrequest/42?discussionId=77' } })
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({ comments: [{ content: 'Retries forever' }], threadContext: { filePath: '/src/retry.ts', rightFileEnd: { line: 2 } } })
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ url: `${BASE}/pullrequests/42/reviewers/${ME}`, body: { vote: 10 } })
    expect((await w.createReview(ref, { commitId: 'f'.repeat(40), event: 'COMMENT', body: 'x', comments: [] })).ok).toBe(false)
    await w.replyToReviewComment(ref, 7001, 'Because…')
    expect(calls.at(-1)).toMatchObject({ url: `${BASE}/pullrequests/42/threads/7/comments`, body: { parentCommentId: 1, content: 'Because…' } })
    expect(await w.commitFile({ host: 'dev.azure.com', owner: 'acme/Platform', repo: 'api' }, { branch: 'retry', path: 'src/retry.ts', content: 'z\n', message: 'Apply', expectedHead: HEAD })).toEqual({ ok: true, value: { commitSha: 'd'.repeat(40), url: 'u' } })
    expect(calls.at(-1)!.body).toMatchObject({ refUpdates: [{ name: 'refs/heads/retry', oldObjectId: HEAD }] })
  })
})
