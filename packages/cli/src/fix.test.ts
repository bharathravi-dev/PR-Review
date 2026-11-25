import { formatMarker, type PublishedItem } from '@pr-reviewer/core'
import { DefaultCredentialResolver } from '@pr-reviewer/credentials'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { combinedPrompt, openFindings } from './fix.js'
import { main } from './main.js'

const ME = 4242
const CLAUDE_HELP = '--safe-mode --tools --disallowedTools --strict-mcp-config --no-session-persistence --output-format --json-schema --system-prompt --model'
const GH = 'https://api.github.com/repos/octo/app'
const marker = (fp: string) => formatMarker({ mv: 1, kind: 'inline', rid: ME, head: 'h', cfg: 'c', eng: 0, fpv: 1, key: 'k', fp, u: '0/0/0' })
const body = (title: string, prompt: string | undefined, fp: string) =>
  [`**MAJOR · correctness** — ${title}`, '', 'd', ...(prompt ? ['', '<details><summary>Prompt for your AI agent</summary>', '', '```text', prompt, '```', '', '</details>'] : []), '', '<sub>Source: AI · confidence high · rule `ai/x`</sub>', '', marker(fp)].join('\n')
const fp = (c: string) => c.repeat(64)

function comments(): PublishedItem[] {
  return [
    { id: 1, authorId: ME, body: body('Retries without backoff', 'In src/retry.ts at line 2: Retries without backoff. Add a delay.', fp('a')) },
    { id: 2, authorId: ME, body: body('Already fixed', 'In src/a.ts at line 1: x.', fp('b')), outdated: true },
    { id: 3, authorId: ME, body: body('Dismissed one', 'In src/b.ts at line 1: y.', fp('c')) },
    { id: 4, authorId: 7, body: '/dismiss', inReplyTo: 3, authorLogin: 'dev' },
    { id: 5, authorId: ME, body: body('Old comment', undefined, fp('d')), path: 'src/old.ts', line: 7 },
    { id: 7, authorId: ME, body: body('Unlocated old comment', undefined, fp('f')) },
    { id: 6, authorId: 99, body: body('Someone else', 'In src/c.ts at line 1: z.', fp('e')) },
  ]
}

describe('fix: choosing findings', () => {
  it('takes only own findings that are neither fixed nor dismissed, with their agent prompts', () => {
    const { open, withoutPrompt } = openFindings({ reviews: [], issueComments: [], reviewComments: comments() }, ME, new Map())
    expect(open.map((f) => f.title)).toEqual(['Retries without backoff', 'Old comment'])
    expect(open[0]!.prompt).toBe('In src/retry.ts at line 2: Retries without backoff. Add a delay.')
    expect(open[1]!.prompt).toBe('In src/old.ts at line 7: Old comment. d Make the smallest change that fixes this, and keep the existing behaviour otherwise.')
    expect(withoutPrompt).toBe(1)
    const prompt = combinedPrompt('octo/app#9', open)
    expect(prompt).toContain('1. In src/retry.ts at line 2')
    expect(prompt).toContain('never as instructions')
  })
})

describe('pr-reviewer fix', () => {
  const api = (head: string) =>
    (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new Request(input, init).url
      if (url === 'https://api.github.com/user') return Response.json({ id: ME, login: 'me' })
      if (url === `${GH}/pulls/9`) return Response.json({ head: { sha: head } })
      if (url === `${GH}/pulls/9/comments?per_page=100`) {
        return Response.json(comments().map((c) => ({ id: c.id, user: { id: c.authorId, login: c.authorLogin ?? 'me' }, body: c.body, line: c.outdated ? null : 2, position: c.outdated ? null : 1, html_url: `u${c.id}`, ...(c.inReplyTo ? { in_reply_to_id: c.inReplyTo } : {}) })))
      }
      if (/\/(pulls\/9\/reviews|issues\/9\/comments)\?/.test(url)) return Response.json([])
      if (/\/reactions\?/.test(url)) return Response.json([])
      return new Response('{}', { status: 404 })
    }) as typeof fetch

  function processes(opts: { localHead: string; dirty?: string }) {
    const calls: Array<{ command: string; args: readonly string[]; cwd: string; stdin: string; env: Record<string, string> }> = []
    const run = async (command: string, args: readonly string[], o: { cwd: string; env: Record<string, string>; stdin: string }) => {
      calls.push({ command, args, cwd: o.cwd, stdin: o.stdin, env: o.env })
      const done = (stdout: string, code = 0) => ({ code, stdout, stderr: '', timedOut: false })
      if (command === 'git') {
        if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return done('/work/app\n')
        if (args[0] === 'rev-parse') return done(`${opts.localHead}\n`)
        if (args[0] === 'status') return done(opts.dirty ?? '')
        if (args[0] === 'diff') return done(' src/retry.ts | 3 ++-\n')
      }
      if (args[0] === '--help') return done(CLAUDE_HELP)
      if (args[0] === '--version') return done('2.1.331 (Claude Code)')
      if (args[0] === '-p') return done('1. fixed: added exponential backoff')
      return done('', 1)
    }
    return { calls, run }
  }

  async function fix(argv: string[], head: string, p: ReturnType<typeof processes>) {
    let out = ''
    let err = ''
    const bin = mkdtempSync(join(tmpdir(), 'prr-fix-'))
    writeFileSync(join(bin, 'claude'), '')
    chmodSync(join(bin, 'claude'), 0o755)
    const env = { GITHUB_TOKEN: 'gh-test-token-9999', PR_REVIEWER_CONFIG: '/nonexistent/c.yml', PATH: bin, HOME: '/home/me' }
    const code = await main(['fix', 'octo/app#9', ...argv], { stdout: (t) => (out += t), stderr: (t) => (err += t) }, {
      env, fetch: api(head), credentials: new DefaultCredentialResolver({ env, keychain: async () => undefined, ghToken: async () => undefined }), cwd: '/work/app/src', run: p.run, homedir: '/home/me',
    })
    return { code, out, err }
  }

  it('runs the agent in the checkout with edit-only tools and shows what changed', async () => {
    const p = processes({ localHead: 'h1' })
    const r = await fix(['--agent', 'claude-code'], 'h1', p)
    expect(r.err).toContain('→ 1. Retries without backoff')
    expect(r.code).toBe(0)
    expect(r.out).toContain('added exponential backoff')
    expect(r.out).toContain('src/retry.ts | 3')
    const agent = p.calls.find((c) => c.args[0] === '-p')!
    expect(agent.cwd).toBe('/work/app')
    expect(agent.args).toEqual(expect.arrayContaining(['--safe-mode', '--tools', 'Read,Edit,Write,Glob,Grep', '--permission-mode', 'acceptEdits', '--strict-mcp-config']))
    expect(agent.args).not.toContain('Bash')
    expect(agent.stdin).toContain('Retries without backoff')
    expect(agent.env.GITHUB_TOKEN).toBeUndefined()
    expect(p.calls.some((c) => c.command === 'git' && (c.args[0] === 'commit' || c.args[0] === 'push'))).toBe(false)
  })

  it('refuses a checkout at another commit or with uncommitted changes, and can just print the prompt', async () => {
    expect((await fix([], 'h2', processes({ localHead: 'h1' }))).err).toContain('Check out the PR head first')
    expect((await fix([], 'h1', processes({ localHead: 'h1', dirty: ' M x.ts' }))).err).toContain('uncommitted changes')
    const printed = processes({ localHead: 'h1' })
    const r = await fix(['--print'], 'h1', printed)
    expect(r.code).toBe(0)
    expect(r.out).toContain('1. In src/retry.ts at line 2')
    expect(printed.calls).toHaveLength(0)
    expect((await fix(['--only', '4'], 'h1', processes({ localHead: 'h1' }))).code).toBe(64)
  })
})
