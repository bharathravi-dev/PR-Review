import { DefaultCredentialResolver } from '@pr-reviewer/credentials'
import { describe, expect, it } from 'vitest'
import { main } from './main.js'

const GH = 'https://api.github.com/repos/octo/app'
const ME = 4242
const FILE = 'export const n = 1\nexport const retries = 3\nexport const delay = 10\nexport const m = 2\n'

const finding = (title: string, line: number | null) => ({
  category: 'CORRECTNESS',
  severity: 'MAJOR',
  confidence: 'HIGH',
  title,
  description: `${title}.`,
  impact: null,
  recommendation: null,
  path: line === null ? null : 'src/retry.ts',
  startLine: line,
  endLine: line,
})

/** Stateful GitHub + Anthropic fake whose head and AI answer can change between runs. */
function server() {
  const state = {
    head: 'head0002',
    aiFindings: [] as unknown[],
    reviews: [] as Array<{ id: number; user: { id: number }; body: string; state: string }>,
    inline: [] as Array<{ id: number; user: { id: number }; body: string; path: string; line: number; created_at: string; html_url: string }>,
    comments: [] as Array<{ id: number; user: { id: number }; body: string; created_at: string; html_url: string }>,
    writes: [] as string[],
  }
  let next = 100
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init)
    const { url, method } = req
    if (url.startsWith('https://api.anthropic.com/')) {
      return Response.json({
        id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
        content: [{ type: 'text', text: JSON.stringify({ findings: state.aiFindings }) }],
        stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 },
      })
    }
    if (method === 'GET') {
      if (url === 'https://api.github.com/user') return Response.json({ id: ME, login: 'me' })
      if (url === `${GH}/pulls/9`) {
        return Response.json({
          title: 'Add retry', body: '', user: { login: 'dev', id: 7 }, state: 'open', draft: false,
          base: { ref: 'main', sha: 'base0001', repo: { id: 555, full_name: 'octo/app' } },
          head: { ref: 'retry', sha: state.head, repo: { id: 555, full_name: 'octo/app' } },
        })
      }
      if (url.startsWith(`${GH}/compare/`)) return Response.json({ merge_base_commit: { sha: 'mb000003' } })
      if (url === `${GH}/pulls/9/files?per_page=100`) {
        return Response.json([{ filename: 'src/retry.ts', status: 'modified', additions: 2, deletions: 0, changes: 2, patch: '@@ -1,2 +1,4 @@\n export const n = 1\n+export const retries = 3\n+export const delay = 10\n export const m = 2' }])
      }
      if (url === `${GH}/pulls/9/reviews?per_page=100`) return Response.json(state.reviews)
      if (url === `${GH}/pulls/9/comments?per_page=100`) return Response.json(state.inline)
      if (url === `${GH}/issues/9/comments?per_page=100`) return Response.json(state.comments)
      if (url.startsWith(`${GH}/contents/src/retry.ts?ref=`)) return new Response(FILE)
    }
    if (method === 'POST' && url === `${GH}/pulls/9/reviews`) {
      const body = JSON.parse(await req.text()) as { body: string; comments: Array<{ path: string; line: number; body: string }>; commit_id: string }
      const id = next++
      state.reviews.push({ id, user: { id: ME }, body: body.body, state: 'COMMENTED' })
      for (const c of body.comments) {
        const cid = next++
        state.inline.push({ id: cid, user: { id: ME }, body: c.body, path: c.path, line: c.line, created_at: '2026-11-25T00:00:00Z', html_url: `https://github.com/octo/app/pull/9#discussion_r${cid}` })
      }
      state.writes.push(`review@${body.commit_id}:${body.comments.length}`)
      return Response.json({ id, html_url: `https://github.com/octo/app/pull/9#pullrequestreview-${id}` })
    }
    if (method === 'POST' && url === `${GH}/issues/9/comments`) {
      const body = JSON.parse(await req.text()) as { body: string }
      const id = next++
      state.comments.push({ id, user: { id: ME }, body: body.body, created_at: '2026-11-25T00:00:00Z', html_url: `https://github.com/octo/app/pull/9#issuecomment-${id}` })
      state.writes.push('summary:create')
      return Response.json({ id, html_url: `https://github.com/octo/app/pull/9#issuecomment-${id}` })
    }
    const patch = /\/issues\/comments\/(\d+)$/.exec(url)
    if (method === 'PATCH' && patch) {
      const c = state.comments.find((x) => x.id === Number(patch[1]))!
      c.body = (JSON.parse(await req.text()) as { body: string }).body
      state.writes.push(`summary:update:${c.id}`)
      return Response.json({ id: c.id, html_url: c.html_url })
    }
    return new Response('{}', { status: 404 })
  }) as typeof fetch
  return { state, impl }
}

async function review(s: ReturnType<typeof server>) {
  let err = ''
  const env = { GITHUB_TOKEN: 'gh-test-token-1234', ANTHROPIC_API_KEY: 'sk-ant-test-key-0123456789abcdefghij', PR_REVIEWER_CONFIG: '/nonexistent/c.yml' }
  const code = await main(['review', 'octo/app#9', '--post', '--yes'], { stdout: () => {}, stderr: (t) => (err += t) }, {
    env,
    fetch: s.impl,
    credentials: new DefaultCredentialResolver({ env, keychain: async () => undefined, ghToken: async () => undefined }),
    isTTY: false,
    prompt: async () => '',
  })
  return { code, err }
}

describe('re-review across pushes (Story 2.3)', () => {
  it('posts only new Findings inline, keeps one summary, and lists still-open and resolved ones', async () => {
    const s = server()
    s.state.aiFindings = [finding('Retries without backoff', 2), finding('No tests for retries', null)]
    const first = await review(s)
    expect(first.code).toBe(1)
    expect(s.state.writes).toEqual(['review@head0002:1', 'summary:create'])

    // A new push: the backoff problem remains (same code, so same fingerprint), the test gap is fixed,
    // and the model reports a new problem on line 3.
    s.state.head = 'head0003'
    s.state.aiFindings = [finding('Retries without backoff', 2), finding('Delay is too short', 3)]
    const second = await review(s)
    expect(second.code).toBe(1)
    expect(s.state.writes).toEqual(['review@head0002:1', 'summary:create', 'review@head0003:1', 'summary:update:102'])
    expect(second.err).toContain('Posted 1 new inline comment(s) and the summary (1 still open, 1 resolved).')

    const newInline = s.state.inline.filter((c) => c.body.includes('head=head0003'))
    expect(newInline.map((c) => c.body.split('\n')[0])).toEqual(['**MAJOR · correctness** — Delay is too short'])
    expect(s.state.comments).toHaveLength(1)
    const summary = s.state.comments[0]!.body
    expect(summary).toContain('**Still open from earlier reviews:**')
    expect(summary).toContain('— Retries without backoff ([comment](https://github.com/octo/app/pull/9#discussion_r101))')
    expect(summary).toContain('**Resolved since the last review:**')
    expect(summary).toContain('~~An earlier summary-only finding~~')
    expect(summary).toContain('head=head0003')

    // Re-running on the same head changes nothing but the summary.
    const third = await review(s)
    expect(third.err).toContain('already reviewed with the same settings')
    expect(s.state.writes.slice(4)).toEqual(['summary:update:102'])
  })
})
