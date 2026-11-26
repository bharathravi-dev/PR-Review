import { DEFAULT_CONTEXT_LIMITS, parsePrRef } from '@pr-reviewer/core'
import { describe, expect, it } from 'vitest'
import { GitLabReader, GitLabWriter } from './gitlab.js'

const API = 'https://gitlab.com/api/v4'
const P = '/projects/acme%2Fplatform%2Fapi'
const ref = { host: 'gitlab.com', owner: 'acme/platform', repo: 'api', number: 12 }
const MR = { iid: 12, title: 'Add retry', description: 'Fixes #3', state: 'opened', draft: false, sha: 'head1', source_branch: 'retry', target_branch: 'main', author: { username: 'dev' }, source_project_id: 1, target_project_id: 1, diff_refs: { base_sha: 'mb0', start_sha: 'main1', head_sha: 'head1' } }
const DISCUSSIONS = [
  { id: 'd1', notes: [{ id: 101, body: 'finding <!-- pr-reviewer kind=inline -->', author: { id: 7, username: 'bot' }, position: { new_path: 'src/retry.ts', new_line: 2 }, resolvable: true, resolved: false }, { id: 102, body: '@pr-reviewer why', author: { id: 5, username: 'ann' } }] },
  { id: 'd2', individual_note: true, notes: [{ id: 201, body: 'summary <!-- pr-reviewer kind=review head=head0 -->', author: { id: 7, username: 'bot' } }] },
  { id: 'd3', individual_note: true, notes: [{ id: 301, body: 'assigned to @dev', system: true, author: { id: 1 } }] },
]

function fake() {
  const calls: Array<{ method: string; path: string; body?: unknown; token: string | null }> = []
  const impl = (async (url: string, init: RequestInit = {}) => {
    const path = url.slice(API.length)
    const method = init.method ?? 'GET'
    calls.push({ method, path, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}), token: new Headers(init.headers).get('private-token') })
    const json = (v: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json', ...headers } })
    if (path === `${P}/merge_requests/12`) return json(MR)
    if (path.startsWith(`${P}/merge_requests/12/diffs`)) return json([{ old_path: 'src/retry.ts', new_path: 'src/retry.ts', new_file: false, renamed_file: false, deleted_file: false, diff: '@@ -1,1 +1,2 @@\n x\n+y\n' }, { old_path: 'logo.png', new_path: 'logo.png', new_file: true, renamed_file: false, deleted_file: false, diff: '' }])
    if (path.startsWith(`${P}/merge_requests/12/discussions`) && method === 'GET') return json(DISCUSSIONS)
    if (path.startsWith(`${P}/repository/files/src%2Fretry.ts/raw?ref=head1`)) return new Response('x\ny\n')
    if (path.startsWith(`${P}/repository/files/src%2Fretry.ts/raw?ref=mb0`)) return new Response('x\n')
    if (path.startsWith(`${P}/repository/files/`)) return new Response('not found', { status: 404 })
    if (path === '/user') return json({ id: 7, username: 'bot' })
    if (path.startsWith(`${P}/members/all`)) return json([{ username: 'ann', access_level: 30 }, { username: 'guest', access_level: 10 }])
    if (method === 'POST' && path === `${P}/merge_requests/12/notes`) return json({ id: 900 })
    if (method === 'POST' && path === `${P}/merge_requests/12/discussions`) return json({ id: 'dx', notes: [{ id: 901 }] })
    if (method === 'POST' && path === `${P}/merge_requests/12/discussions/d1/notes`) return json({ id: 902 })
    if (method === 'POST' && path === `${P}/merge_requests/12/approve`) return json({})
    if (method === 'PUT' && path.startsWith(`${P}/merge_requests/12/discussions/d1`)) return json({})
    return new Response('{}', { status: 404 })
  }) as unknown as typeof fetch
  return { impl, calls }
}

describe('GitLab merge requests (roadmap item 10)', () => {
  it('parses merge request URLs, nested groups included', () => {
    expect(parsePrRef('https://gitlab.com/acme/platform/api/-/merge_requests/12', 'github.com')).toEqual({ ok: true, value: ref })
    expect(parsePrRef('https://gitlab.example.com/team/svc/-/merge_requests/3/diffs', 'github.com')).toEqual({ ok: true, value: { host: 'gitlab.example.com', owner: 'team', repo: 'svc', number: 3 } })
    expect(parsePrRef('https://gitlab.com/a b/c/-/merge_requests/1', 'github.com').ok).toBe(false)
  })

  it('reads a merge request as a PR context: diffs, contents at head and merge base, comments', async () => {
    const { impl, calls } = fake()
    const r = new GitLabReader({ apiUrl: API, token: 'glpat-x', fetch: impl, userAgent: 't' })
    const ctx = await r.getPrContext(ref, DEFAULT_CONTEXT_LIMITS)
    expect(ctx.ok).toBe(true)
    if (!ctx.ok) return
    expect(ctx.value).toMatchObject({ title: 'Add retry', author: 'dev', state: 'open', baseRef: 'main', headRef: 'retry', headSha: 'head1', mergeBaseSha: 'mb0', baseSha: 'main1', fromFork: false })
    expect(ctx.value.files[0]).toMatchObject({ path: 'src/retry.ts', status: 'modified', additions: 1, deletions: 0, patch: '@@ -1,1 +1,2 @@\n x\n+y', head: { text: 'x\ny\n' }, base: { text: 'x\n' } })
    expect(ctx.value.files[1]).toMatchObject({ path: 'logo.png', status: 'added' })
    expect(ctx.value.reviewComments.map((c) => [c.id, c.path, c.line])).toEqual([[101, 'src/retry.ts', 2], [102, undefined, undefined]])
    expect(ctx.value.issueComments.map((c) => c.id)).toEqual([201])
    expect(calls.every((c) => c.token === 'glpat-x')).toBe(true)
  })

  it('maps discussions to inline comments with replies, notes to comments, and review notes to reviews', async () => {
    const r = new GitLabReader({ apiUrl: API, fetch: fake().impl, userAgent: 't' })
    const items = await r.listPublished(ref)
    expect(items.ok).toBe(true)
    if (!items.ok) return
    expect(items.value.reviewComments.map((c) => ({ id: c.id, inReplyTo: c.inReplyTo, path: c.path, line: c.line, authorId: c.authorId }))).toEqual([
      { id: 101, inReplyTo: undefined, path: 'src/retry.ts', line: 2, authorId: 7 },
      { id: 102, inReplyTo: 101, path: 'src/retry.ts', line: 2, authorId: 5 },
    ])
    expect(items.value.issueComments.map((c) => c.id)).toEqual([201])
    expect(items.value.reviews.map((c) => c.id)).toEqual([201])
    expect(items.value.reviewComments[0]!.url).toBe('https://gitlab.com/acme/platform/api/-/merge_requests/12#note_101')
    expect(await r.canPush(ref, 'ann')).toEqual({ ok: true, value: true })
    expect(await r.canPush(ref, 'guest')).toEqual({ ok: true, value: false })
    expect(await r.viewer()).toEqual({ ok: true, value: { id: 7, login: 'bot' } })
  })

  it('posts a review as positioned diff threads plus a note, approving only when asked, and refuses a moved head', async () => {
    const { impl, calls } = fake()
    const w = new GitLabWriter({ apiUrl: API, fetch: impl, userAgent: 't' })
    const posted = await w.createReview(ref, { commitId: 'head1', event: 'APPROVE', body: 'PR Reviewer: 1 inline', comments: [{ path: 'src/retry.ts', line: 2, side: 'RIGHT', body: 'Retries forever' }] })
    expect(posted).toEqual({ ok: true, value: { id: 900, url: 'https://gitlab.com/acme/platform/api/-/merge_requests/12#note_900' } })
    const thread = calls.find((c) => c.method === 'POST' && c.path.endsWith('/discussions'))!
    expect(thread.body).toEqual({ body: 'Retries forever', position: { position_type: 'text', base_sha: 'mb0', start_sha: 'main1', head_sha: 'head1', new_path: 'src/retry.ts', old_path: 'src/retry.ts', new_line: 2 } })
    expect(calls.some((c) => c.path.endsWith('/approve'))).toBe(true)
    const moved = await w.createReview(ref, { commitId: 'older', event: 'COMMENT', body: 'x', comments: [] })
    expect(moved.ok).toBe(false)
  })

  it('replies in a thread and resolves its own threads', async () => {
    const { impl, calls } = fake()
    const w = new GitLabWriter({ apiUrl: API, fetch: impl, userAgent: 't' })
    expect(await w.replyToReviewComment(ref, 101, 'Because…')).toEqual({ ok: true, value: { id: 902, url: 'https://gitlab.com/acme/platform/api/-/merge_requests/12#note_902' } })
    expect(await w.resolveThreads(ref, [101])).toEqual({ ok: true, value: 1 })
    expect(calls.some((c) => c.method === 'PUT' && c.path === `${P}/merge_requests/12/discussions/d1?resolved=true`)).toBe(true)
  })
})
