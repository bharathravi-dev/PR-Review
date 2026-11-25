import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DefaultCredentialResolver } from '@pr-reviewer/credentials'
import { afterEach, describe, expect, it } from 'vitest'
import { main } from './main.js'

const GH = 'https://api.github.com/repos/octo/app'
const TOKEN = ['gh-test-', 'token-zyx987'].join('')
const AI_KEY = ['sk-ant-', 'test-', 'key-abcdefghij0123456789'].join('')
const ME = 4242

/** A stateful fake of the GitHub and Anthropic APIs. */
function fakeServer(opts: { headAfterReview?: string; headAfterContext?: string } = {}) {
  const reviews: Array<{ id: number; user: { id: number; login: string }; body: string; state: string; comments: unknown[]; event: string }> = []
  const comments: Array<{ id: number; user: { id: number; login: string }; body: string; created_at: string }> = []
  const writes: string[] = []
  let next = 100
  let head = 'head0002'
  let pullReads = 0
  const pull = () => ({
    title: 'Add retry',
    body: 'Adds retries.',
    user: { login: 'dev', id: 7 },
    state: 'open',
    draft: false,
    base: { ref: 'main', sha: 'base0001', repo: { id: 555, full_name: 'octo/app' } },
    head: { ref: 'retry', sha: head, repo: { id: 555, full_name: 'octo/app' } },
  })
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init)
    const url = req.url
    const method = req.method
    if (url.startsWith('https://api.anthropic.com/')) {
      return Response.json({
        id: 'msg',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              findings: [
                { category: 'CORRECTNESS', severity: 'MAJOR', confidence: 'HIGH', title: 'Retries without backoff', description: 'Retrying immediately can amplify load; ask @ops.', impact: null, recommendation: 'Add exponential backoff.', path: 'src/retry.ts', startLine: 2, endLine: 2 },
                { category: 'TESTS', severity: 'MINOR', confidence: 'MEDIUM', title: 'No tests for retries', description: 'Add a test.', impact: null, recommendation: null, path: null, startLine: null, endLine: null },
              ],
            }),
          },
        ],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 900, output_tokens: 40 },
      })
    }
    if (method === 'GET') {
      if (url === 'https://api.github.com/user') return Response.json({ id: ME, login: 'me' })
      if (url === `${GH}/pulls/9`) {
        const body = pull()
        pullReads++
        if (opts.headAfterContext && pullReads === 1) head = opts.headAfterContext
        return Response.json(body)
      }
      if (url.startsWith(`${GH}/compare/base0001...`)) return Response.json({ merge_base_commit: { sha: 'mb000003' } })
      if (url === `${GH}/pulls/9/files?per_page=100`) {
        return Response.json([{ filename: 'src/retry.ts', status: 'modified', additions: 2, deletions: 0, changes: 2, patch: '@@ -1,2 +1,4 @@\n export const n = 1\n+export const retries = 3\n+export const delay = 10\n export const m = 2' }])
      }
      if (url === `${GH}/pulls/9/reviews?per_page=100`) return Response.json(reviews)
      if (url === `${GH}/pulls/9/comments?per_page=100`) return Response.json([])
      if (url === `${GH}/issues/9/comments?per_page=100`) return Response.json(comments)
      if (url.startsWith(`${GH}/contents/src/retry.ts?ref=`)) return new Response('export const n = 1\nexport const retries = 3\nexport const delay = 10\nexport const m = 2\n')
    }
    if (method === 'POST' && url === `${GH}/pulls/9/reviews`) {
      const body = JSON.parse(await req.text())
      const id = next++
      reviews.push({ id, user: { id: ME, login: 'me' }, body: body.body, state: 'COMMENTED', comments: body.comments, event: body.event })
      writes.push(`review:${body.event}:${body.comments.length}:${body.commit_id}`)
      if (opts.headAfterReview) head = opts.headAfterReview
      return Response.json({ id, html_url: `https://github.com/octo/app/pull/9#pullrequestreview-${id}` })
    }
    if (method === 'POST' && url === `${GH}/issues/9/comments`) {
      const body = JSON.parse(await req.text())
      const id = next++
      comments.push({ id, user: { id: ME, login: 'me' }, body: body.body, created_at: '2026-11-25T00:00:00Z' })
      writes.push(`comment:create:${id}`)
      return Response.json({ id, html_url: `https://github.com/octo/app/pull/9#issuecomment-${id}` })
    }
    const patch = /\/issues\/comments\/(\d+)$/.exec(url)
    if (method === 'PATCH' && patch) {
      const body = JSON.parse(await req.text())
      const c = comments.find((x) => x.id === Number(patch[1]))!
      c.body = body.body
      writes.push(`comment:update:${c.id}`)
      return Response.json({ id: c.id, html_url: `https://github.com/octo/app/pull/9#issuecomment-${c.id}` })
    }
    return new Response('{}', { status: 404 })
  }) as typeof fetch
  return { impl, reviews, comments, writes }
}

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function configFile(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'prr-post-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'config.yml'), yaml)
  return join(dir, 'config.yml')
}

async function run(argv: string[], server: ReturnType<typeof fakeServer>, opts: { tty?: boolean; answer?: string; config?: string } = {}) {
  let out = ''
  let err = ''
  const asked: string[] = []
  const env = { GITHUB_TOKEN: TOKEN, ANTHROPIC_API_KEY: AI_KEY, PR_REVIEWER_CONFIG: opts.config ?? '/nonexistent/config.yml' }
  const code = await main(['review', 'octo/app#9', ...argv], { stdout: (t) => (out += t), stderr: (t) => (err += t) }, {
    env,
    fetch: server.impl,
    credentials: new DefaultCredentialResolver({ env, keychain: async () => undefined, ghToken: async () => undefined }),
    isTTY: opts.tty ?? false,
    prompt: async (q) => {
      asked.push(q)
      return opts.answer ?? ''
    },
  })
  return { code, out, err, asked }
}

describe('review --post', () => {
  it('previews exactly what will be posted, asks, and posts on yes', async () => {
    const s = fakeServer()
    const r = await run(['--post'], s, { tty: true, answer: 'y' })
    expect(r.asked).toEqual(['Post this review to octo/app#9? [y/N] '])
    expect(r.err).toContain('──── Preview: what will be posted to octo/app#9 (COMMENT) ────')
    expect(r.err).toContain('Inline comments (1):')
    expect(r.err).toContain('src/retry.ts:2  **MAJOR · correctness** — Retries without backoff')
    expect(s.writes).toEqual(['review:COMMENT:1:head0002', 'comment:create:101'])
    expect(r.err).toContain('Posted 1 inline comment(s) and the summary.')
    expect(r.err).toContain('pullrequestreview-100')
    expect(r.code).toBe(1) // PASSED_WITH_WARNINGS: AI findings never fail the gate

    const inline = JSON.stringify(s.reviews[0]!.comments)
    expect(inline).toContain('`@ops`')
    expect(inline).toContain('<!-- pr-reviewer mv=1 kind=inline rid=4242')
    expect(s.comments[0]!.body).toContain('**Findings not shown inline:**')
    expect(s.comments[0]!.body).toContain('No tests for retries')
    for (const text of [r.out, r.err, JSON.stringify(s.reviews), JSON.stringify(s.comments)]) {
      expect(text).not.toContain(TOKEN)
      expect(text).not.toContain(AI_KEY)
    }
  })

  it('posts nothing when the user declines', async () => {
    const s = fakeServer()
    const r = await run(['--post'], s, { tty: true, answer: 'n' })
    expect(r.err).toContain('Not posted.')
    expect(s.writes).toEqual([])
    expect(r.code).toBe(1)
  })

  it('refuses to post from a non-interactive terminal without --yes, before any network call', async () => {
    const s = fakeServer()
    const r = await run(['--post'], s, { tty: false })
    expect(r.code).toBe(64)
    expect(r.err).toContain('pass --yes')
    expect(s.writes).toEqual([])
  })

  it('posts with --yes and never duplicates on a second run', async () => {
    const s = fakeServer()
    expect((await run(['--post', '--yes'], s)).code).toBe(1)
    const again = await run(['--post', '--yes'], s)
    expect(again.code).toBe(1)
    expect(again.err).toContain('already reviewed with the same settings')
    expect(s.writes).toEqual(['review:COMMENT:1:head0002', 'comment:create:101', 'comment:update:101'])
    expect(s.reviews).toHaveLength(1)
  })

  it('marks unattended posts as published automatically', async () => {
    const s = fakeServer()
    await run(['--post', '--yes'], s, { tty: false })
    expect(s.comments[0]!.body).toContain('published automatically')
  })

  it('allows REQUEST_CHANGES only when the user config enables it, and never approves', async () => {
    const s = fakeServer()
    const refused = await run(['--post', '--yes', '--event', 'REQUEST_CHANGES'], s)
    expect(refused.code).toBe(64)
    expect(refused.err).toContain('publish.allowRequestChanges')
    expect((await run(['--post', '--yes', '--event', 'APPROVE'], s)).code).toBe(64)
    expect(s.writes).toEqual([])

    const config = configFile('version: 1\npublish:\n  allowRequestChanges: true\n')
    const ok = await run(['--post', '--yes', '--event', 'request_changes'], s, { config })
    expect(ok.code).toBe(1)
    expect(s.writes[0]).toBe('review:REQUEST_CHANGES:1:head0002')
  })

  it('writes nothing and exits 6 when the PR head moves between review and post', async () => {
    const s = fakeServer({ headAfterContext: 'head0009' })
    const r = await run(['--post', '--yes'], s)
    expect(r.code).toBe(6)
    expect(r.err).toContain('Not posted (CANCELLED): SUPERSEDED: the PR head moved to head000')
    expect(s.writes).toEqual([])
  })

  it('rejects --yes or --event without --post', async () => {
    expect((await run(['--yes'], fakeServer())).code).toBe(64)
  })
})
