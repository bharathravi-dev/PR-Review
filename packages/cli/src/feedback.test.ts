import { DefaultCredentialResolver } from '@pr-reviewer/credentials'
import { describe, expect, it } from 'vitest'
import { main } from './main.js'

const GH = 'https://api.github.com/repos/octo/app'
const ME = 4242
const FILE = 'export const n = 1\nexport const retries = 3\nexport const delay = 10\nexport const m = 2\n'
const backoff = { category: 'CORRECTNESS', severity: 'MAJOR', confidence: 'HIGH', title: 'Retries without backoff', description: 'd', impact: null, recommendation: null, path: 'src/retry.ts', startLine: 2, endLine: 2 }

function server() {
  const state = {
    head: 'head0002',
    reviews: [] as Array<{ id: number; user: { id: number }; body: string; state: string }>,
    inline: [] as Array<{ id: number; user: { id: number; login: string }; body: string; line: number | null; position: number | null; created_at: string; html_url: string }>,
    comments: [] as Array<{ id: number; user: { id: number; login: string }; body: string; created_at: string; html_url: string }>,
    thumbsDown: new Map<number, string[]>(),
  }
  let next = 100
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init)
    const { url, method } = req
    if (url.startsWith('https://api.anthropic.com/')) {
      return Response.json({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: JSON.stringify({ findings: [backoff] }) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } })
    }
    if (method === 'GET') {
      if (url === 'https://api.github.com/user') return Response.json({ id: ME, login: 'me' })
      if (url === `${GH}/pulls/9`) {
        return Response.json({ title: 'Add retry', body: '', user: { login: 'dev', id: 7 }, state: 'open', draft: false, base: { ref: 'main', sha: 'base0001', repo: { id: 555, full_name: 'octo/app' } }, head: { ref: 'retry', sha: state.head, repo: { id: 555, full_name: 'octo/app' } } })
      }
      if (url.startsWith(`${GH}/compare/`)) return Response.json({ merge_base_commit: { sha: 'mb000003' } })
      if (url === `${GH}/pulls/9/files?per_page=100`) {
        return Response.json([{ filename: 'src/retry.ts', status: 'modified', additions: 2, deletions: 0, changes: 2, patch: '@@ -1,2 +1,4 @@\n export const n = 1\n+export const retries = 3\n+export const delay = 10\n export const m = 2' }])
      }
      if (url === `${GH}/pulls/9/reviews?per_page=100`) return Response.json(state.reviews)
      if (url === `${GH}/pulls/9/comments?per_page=100`) return Response.json(state.inline)
      if (url === `${GH}/issues/9/comments?per_page=100`) return Response.json(state.comments)
      if (url.startsWith(`${GH}/contents/src/retry.ts?ref=`)) return new Response(FILE)
      const reactions = /\/pulls\/comments\/(\d+)\/reactions\?content=-1&per_page=100$/.exec(url)
      if (reactions) return Response.json((state.thumbsDown.get(Number(reactions[1])) ?? []).map((login) => ({ user: { login }, content: '-1' })))
      if (url.startsWith('https://api.github.com/search/issues?q=')) {
        return Response.json({ items: [{ number: 9, title: 'Add retry', repository_url: 'https://api.github.com/repos/octo/app', user: { login: 'dev' } }] })
      }
    }
    if (method === 'POST' && url === `${GH}/pulls/9/reviews`) {
      const body = JSON.parse(await req.text()) as { body: string; comments: Array<{ line: number; body: string }> }
      const id = next++
      state.reviews.push({ id, user: { id: ME }, body: body.body, state: 'COMMENTED' })
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
    const patch = /\/issues\/comments\/(\d+)$/.exec(url)
    if (method === 'PATCH' && patch) {
      const c = state.comments.find((x) => x.id === Number(patch[1]))!
      c.body = (JSON.parse(await req.text()) as { body: string }).body
      return Response.json({ id: c.id, html_url: c.html_url })
    }
    return new Response('{}', { status: 404 })
  }) as typeof fetch
  return { state, impl }
}

async function cli(argv: string[], s: ReturnType<typeof server>) {
  let out = ''
  let err = ''
  const env = { GITHUB_TOKEN: 'gh-test-token-9999', ANTHROPIC_API_KEY: 'sk-ant-test-key-0123456789abcdefghij', PR_REVIEWER_CONFIG: '/nonexistent/c.yml' }
  const code = await main(argv, { stdout: (t) => (out += t), stderr: (t) => (err += t) }, {
    env,
    fetch: s.impl,
    credentials: new DefaultCredentialResolver({ env, keychain: async () => undefined, ghToken: async () => undefined }),
    isTTY: false,
    prompt: async () => '',
  })
  return { code, out, err }
}

describe('Finding feedback (Story 2.5)', () => {
  it('a 👎 stops a Finding from being posted again without changing the result', async () => {
    const s = server()
    await cli(['review', 'octo/app#9', '--post', '--yes'], s)
    expect(s.state.inline).toHaveLength(1)

    s.state.thumbsDown.set(s.state.inline[0]!.id, ['dev'])
    s.state.head = 'head0003'
    const second = await cli(['review', 'octo/app#9', '--post', '--yes', '--json'], s)
    const report = JSON.parse(second.out)
    expect(report.findings[0]).toMatchObject({ title: 'Retries without backoff', dismissed: { by: 'dev', byPrAuthor: true } })
    expect(report.overallStatus).toBe('PASSED_WITH_WARNINGS')
    expect(s.state.inline).toHaveLength(1) // not re-posted
    const summary = s.state.comments[0]!.body
    expect(summary).toContain('1 finding(s) withheld from this post (deselected or dismissed)')
    expect(summary).not.toContain('Still open from earlier reviews')
    expect(summary).not.toContain('Resolved since the last review')
  })

  it('stats counts posted findings from GitHub data only', async () => {
    const s = server()
    await cli(['review', 'octo/app#9', '--post', '--yes'], s)
    let r = await cli(['stats', '--since', '2026-11-01', '--json'], s)
    expect(JSON.parse(r.out)).toMatchObject({ addressedRate: 0, total: { posted: 1, resolved: 0, dismissed: 0, open: 1, summaryOnly: 0, bySource: { AI: { posted: 1, open: 1 } }, bySeverity: { MAJOR: { posted: 1 } } } })

    s.state.inline[0]!.line = null
    s.state.inline[0]!.position = null // code changed: GitHub marks the comment outdated
    r = await cli(['stats', '--since', '2026-11-01'], s)
    expect(r.out).toContain('Inline findings posted: 1 — resolved 1 (100%), dismissed 0 (0%), still open 0 (0%).')
    expect(r.out).toMatch(/major\s+1 posted\s+addressed 100%/)
    expect(r.out).toMatch(/AI review\s+1 posted\s+addressed 100%/)
    expect((await cli(['stats', '--since', 'yesterday'], s)).code).toBe(64)
  })
})
