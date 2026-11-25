import { formatMarker, parseRepoRef, reviewedState } from '@pr-reviewer/core'
import { DefaultCredentialResolver } from '@pr-reviewer/credentials'
import { describe, expect, it } from 'vitest'
import { main } from './main.js'

const GH = 'https://api.github.com/repos/octo/app'
const ME = 4242
const reviewMarker = (rid: number, head: string) =>
  formatMarker({ mv: 1, kind: 'review', rid, head, cfg: 'c', eng: 0, fpv: 1, key: 'k', fp: '-', u: '0/0/0' })

const pulls = [
  { number: 3, title: 'Third   change', user: { login: 'carol' }, draft: true, head: { sha: 'ccccccc3', ref: 'c', repo: null }, base: { sha: 'b', ref: 'main', repo: { id: 1, full_name: 'octo/app' } }, updated_at: '2026-11-25T03:00:00Z', state: 'open', body: '' },
  { number: 2, title: 'Second change', user: { login: 'bob' }, draft: false, head: { sha: 'bbbbbbb2', ref: 'b', repo: null }, base: { sha: 'b', ref: 'main', repo: { id: 1, full_name: 'octo/app' } }, updated_at: '2026-11-25T02:00:00Z', state: 'open', body: '' },
  { number: 1, title: 'First change', user: { login: 'alice' }, draft: false, head: { sha: 'aaaaaaa1', ref: 'a', repo: null }, base: { sha: 'b', ref: 'main', repo: { id: 1, full_name: 'octo/app' } }, updated_at: '2026-11-25T01:00:00Z', state: 'open', body: '' },
]
const reviews: Record<number, unknown[]> = {
  3: [{ id: 1, user: { id: ME }, body: reviewMarker(ME, 'ccccccc3'), state: 'COMMENTED' }],
  2: [{ id: 2, user: { id: ME }, body: reviewMarker(ME, 'old0000'), state: 'COMMENTED' }],
  1: [{ id: 3, user: { id: 666 }, body: reviewMarker(ME, 'aaaaaaa1'), state: 'COMMENTED' }], // someone else copied our marker
}

const fake = (async (input: string | URL | Request, init?: RequestInit) => {
  const { url } = new Request(input, init)
  if (url === 'https://api.github.com/user') return Response.json({ id: ME, login: 'me' })
  if (url === `${GH}/pulls?state=open&sort=updated&direction=desc&per_page=30`) return Response.json(pulls)
  const m = /\/pulls\/(\d+)\/reviews\?per_page=100$/.exec(url)
  if (m) return Response.json(reviews[Number(m[1])] ?? [])
  if (/\/(pulls\/\d+\/comments|issues\/\d+\/comments)\?per_page=100$/.test(url)) return Response.json([])
  return new Response('{}', { status: 404 })
}) as typeof fetch

async function run(argv: string[], opts: { tty?: boolean; answer?: string; token?: boolean } = {}) {
  let out = ''
  let err = ''
  const env: Record<string, string> = { PR_REVIEWER_CONFIG: '/nonexistent/c.yml', ...(opts.token === false ? {} : { GITHUB_TOKEN: 'gh-test-token-5678' }) }
  const code = await main(['list', ...argv], { stdout: (t) => (out += t), stderr: (t) => (err += t) }, {
    env,
    fetch: fake,
    credentials: new DefaultCredentialResolver({ env, keychain: async () => undefined, ghToken: async () => undefined }),
    isTTY: opts.tty ?? false,
    prompt: async () => opts.answer ?? '',
  })
  return { code, out, err }
}

describe('reviewedState and parseRepoRef', () => {
  it('classifies by own review markers only', () => {
    const items = (r: unknown[]) => ({ reviews: r as never, reviewComments: [], issueComments: [] })
    expect(reviewedState(items([{ id: 1, authorId: ME, body: reviewMarker(ME, 'h1') }]), ME, 'h1')).toBe('CURRENT')
    expect(reviewedState(items([{ id: 1, authorId: ME, body: reviewMarker(ME, 'h0') }]), ME, 'h1')).toBe('OUTDATED')
    expect(reviewedState(items([{ id: 1, authorId: 9, body: reviewMarker(ME, 'h1') }]), ME, 'h1')).toBe('NONE')
  })

  it('parses owner/repo and repository URLs', () => {
    expect(parseRepoRef('octo/app', 'github.com')).toEqual({ ok: true, value: { host: 'github.com', owner: 'octo', repo: 'app' } })
    expect(parseRepoRef('https://GHE.example.com/team/svc.git/pulls', 'github.com')).toEqual({ ok: true, value: { host: 'ghe.example.com', owner: 'team', repo: 'svc' } })
    expect(parseRepoRef('octo/app#1', 'github.com').ok).toBe(false)
  })
})

describe('pr-reviewer list', () => {
  it('shows open PRs with whether their latest commit was reviewed', async () => {
    const r = await run(['octo/app'])
    expect(r.code).toBe(0)
    const lines = r.out.trim().split('\n')
    expect(lines[0]).toMatch(/^PR\s+REVIEWED\s+HEAD\s+AUTHOR\s+TITLE$/)
    expect(lines[1]).toMatch(/^#3\s+reviewed\s+ccccccc\s+carol\s+\[draft\] Third change$/)
    expect(lines[2]).toMatch(/^#2\s+outdated\s+bbbbbbb\s+bob\s+Second change$/)
    expect(lines[3]).toMatch(/^#1\s+-\s+aaaaaaa\s+alice\s+First change$/)
  })

  it('prints JSON with the reviewed state', async () => {
    const r = await run(['https://github.com/octo/app', '--json'])
    expect(JSON.parse(r.out).map((p: { number: number; reviewed: string }) => [p.number, p.reviewed])).toEqual([[3, 'CURRENT'], [2, 'OUTDATED'], [1, 'NONE']])
  })

  it('shows "?" and explains when there is no token', async () => {
    const r = await run(['octo/app'], { token: false })
    expect(r.out).toMatch(/#3\s+\?\s+/)
    expect(r.err).toContain('Reviewed state needs a GitHub token')
  })

  it('lets the user pick a PR to review in an interactive terminal', async () => {
    expect((await run(['octo/app'], { tty: true, answer: '' })).code).toBe(0)
    expect((await run(['octo/app'], { tty: true, answer: '9' })).code).toBe(64)
    const picked = await run(['octo/app'], { tty: true, answer: '#2' })
    expect(picked.err).toContain('Reviewing octo/app#2…')
  })

  it('rejects bad input', async () => {
    expect((await run([])).code).toBe(64)
    expect((await run(['octo/app#1'])).code).toBe(64)
    expect((await run(['octo/app', '--limit', '0'])).code).toBe(64)
  })
})
