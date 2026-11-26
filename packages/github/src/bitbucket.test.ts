import { DEFAULT_CONTEXT_LIMITS, parsePrRef } from '@pr-reviewer/core'
import { describe, expect, it } from 'vitest'
import { accountNumber, BitbucketReader, BitbucketWriter } from './bitbucket.js'

const API = 'https://api.bitbucket.org/2.0'
const R = '/repositories/acme/api'
const ref = { host: 'bitbucket.org', owner: 'acme', repo: 'api', number: 7 }
const HEAD = 'a'.repeat(40)
const BASE = 'b'.repeat(40)
const MB = 'c'.repeat(40)
const BOT = '{11111111-2222-3333-4444-555555555555}'
const PR = { id: 7, title: 'Add retry', description: 'ENG-1', state: 'OPEN', author: { nickname: 'dev' }, source: { branch: { name: 'retry' }, commit: { hash: HEAD.slice(0, 12) }, repository: { full_name: 'acme/api' } }, destination: { branch: { name: 'main' }, commit: { hash: BASE.slice(0, 12) }, repository: { full_name: 'acme/api' } } }
const COMMENTS = [
  { id: 1, content: { raw: 'finding <!-- pr-reviewer kind=inline -->' }, user: { uuid: BOT, nickname: 'bot' }, inline: { path: 'src/retry.ts', to: 2 } },
  { id: 2, content: { raw: '@pr-reviewer why' }, user: { uuid: '{99999999-0000-0000-0000-000000000000}', nickname: 'ann' }, parent: { id: 1 } },
  { id: 3, content: { raw: 'summary <!-- pr-reviewer kind=review head=x -->' }, user: { uuid: BOT, nickname: 'bot' } },
  { id: 4, content: { raw: 'gone' }, deleted: true },
]
const DIFF = 'diff --git a/src/retry.ts b/src/retry.ts\nindex 1..2 100644\n--- a/src/retry.ts\n+++ b/src/retry.ts\n@@ -1,1 +1,2 @@\n x\n+y\n'

function fake() {
  const calls: Array<{ method: string; path: string; body?: unknown; auth: string | null }> = []
  const impl = (async (url: string, init: RequestInit = {}) => {
    const path = url.replace(API, '')
    const method = init.method ?? 'GET'
    calls.push({ method, path, ...(typeof init.body === 'string' ? { body: JSON.parse(init.body) } : {}), auth: new Headers(init.headers).get('authorization') })
    const json = (v: unknown) => Response.json(v)
    if (path === `${R}/pullrequests/7`) return json(PR)
    if (path.startsWith(`${R}/commit/${HEAD.slice(0, 12)}`)) return json({ hash: HEAD })
    if (path.startsWith(`${R}/commit/${BASE.slice(0, 12)}`)) return json({ hash: BASE })
    if (path.startsWith(`${R}/merge-base/`)) return json({ hash: MB })
    if (path.startsWith(`${R}/pullrequests/7/diffstat`)) return json({ values: [{ status: 'modified', old: { path: 'src/retry.ts' }, new: { path: 'src/retry.ts' }, lines_added: 1, lines_removed: 0 }] })
    if (path === `${R}/pullrequests/7/diff`) return new Response(DIFF)
    if (path.startsWith(`${R}/pullrequests/7/comments`) && method === 'GET') return json({ values: COMMENTS })
    if (path === `${R}/src/${HEAD}/src/retry.ts`) return new Response('x\ny\n')
    if (path === `${R}/src/${MB}/src/retry.ts`) return new Response('x\n')
    if (path === '/user') return json({ uuid: BOT, nickname: 'bot' })
    if (method === 'POST' && path === `${R}/pullrequests/7/comments`) return json({ id: 50, links: { html: { href: 'https://bitbucket.org/acme/api/pull-requests/7#comment-50' } } })
    if (method === 'POST') return json({})
    return new Response('{}', { status: 404 })
  }) as unknown as typeof fetch
  return { impl, calls }
}

describe('Bitbucket Cloud pull requests', () => {
  it('parses pull request URLs and turns account UUIDs into stable numbers', () => {
    expect(parsePrRef('https://bitbucket.org/acme/api/pull-requests/7/diff', 'github.com')).toEqual({ ok: true, value: ref })
    expect(accountNumber(BOT)).toBe(accountNumber('{11111111-2222-3333-4444-555555555555}'))
    expect(Number.isSafeInteger(accountNumber(BOT))).toBe(true)
  })

  it('reads a PR: full hashes, merge base, diff, contents, comments; with a Bearer or Basic token', async () => {
    const { impl, calls } = fake()
    const r = new BitbucketReader({ token: 'bb-token', fetch: impl, userAgent: 't' })
    const ctx = await r.getPrContext(ref, DEFAULT_CONTEXT_LIMITS)
    expect(ctx.ok).toBe(true)
    if (!ctx.ok) return
    expect(ctx.value).toMatchObject({ title: 'Add retry', author: 'dev', state: 'open', headSha: HEAD, baseSha: BASE, mergeBaseSha: MB, headRef: 'retry', baseRef: 'main', fromFork: false })
    expect(ctx.value.files[0]).toMatchObject({ path: 'src/retry.ts', status: 'modified', additions: 1, patch: '@@ -1,1 +1,2 @@\n x\n+y', head: { text: 'x\ny\n' }, base: { text: 'x\n' } })
    expect(ctx.value.reviewComments.map((c) => c.id)).toEqual([1])
    expect(ctx.value.issueComments.map((c) => c.id)).toEqual([2, 3])
    expect(calls[0]!.auth).toBe('Bearer bb-token')
    const basic = new BitbucketReader({ token: 'me:app-pass', fetch: fake().impl, userAgent: 't' })
    expect((await basic.getHeadSha(ref))).toEqual({ ok: true, value: HEAD })
  })

  it('maps comment threads to inline comments with replies, and the review note to a review', async () => {
    const r = new BitbucketReader({ fetch: fake().impl, userAgent: 't' })
    const items = await r.listPublished(ref)
    expect(items.ok && items.value.reviewComments.map((c) => [c.id, c.inReplyTo, c.path, c.line, c.authorId === accountNumber(BOT)])).toEqual([
      [1, undefined, 'src/retry.ts', 2, true],
      [2, 1, 'src/retry.ts', 2, false],
    ])
    expect(items.ok && items.value.reviews.map((c) => c.id)).toEqual([3])
    expect(await r.viewer()).toEqual({ ok: true, value: { id: accountNumber(BOT), login: 'bot' } })
  })

  it('posts inline comments and the summary, approving only when asked, and refuses a moved head', async () => {
    const { impl, calls } = fake()
    const w = new BitbucketWriter({ fetch: impl, userAgent: 't' })
    expect(await w.createReview(ref, { commitId: HEAD, event: 'APPROVE', body: 'summary', comments: [{ path: 'src/retry.ts', line: 2, side: 'RIGHT', body: 'Retries forever' }] })).toEqual({ ok: true, value: { id: 50, url: 'https://bitbucket.org/acme/api/pull-requests/7#comment-50' } })
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ content: { raw: 'Retries forever' }, inline: { path: 'src/retry.ts', to: 2 } })
    expect(calls.some((c) => c.path.endsWith('/approve'))).toBe(true)
    expect((await w.createReview(ref, { commitId: 'f'.repeat(40), event: 'COMMENT', body: 'x', comments: [] })).ok).toBe(false)
    expect(await w.replyToReviewComment(ref, 1, 'Because…')).toMatchObject({ ok: true })
    expect(calls.at(-1)!.body).toEqual({ content: { raw: 'Because…' }, parent: { id: 1 } })
  })
})
