import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatMarker, resolveSettings } from '@pr-reviewer/core'
import { DefaultCredentialResolver } from '@pr-reviewer/credentials'
import { afterEach, describe, expect, it } from 'vitest'
import type { CliDeps } from './deps.js'
import { MCP_TOOLS, mcpCommand } from './mcp.js'

const ME = 4242
const GH = 'https://api.github.com/repos/octo/app'
const TOKEN = ['gh-test-', 'token-abcdef'].join('')
const AI_KEY = ['sk-ant-', 'test-', 'key-0123456789abcdefghij'].join('')

const pull = {
  title: 'Add retry',
  body: 'Adds retries.',
  user: { login: 'dev' },
  state: 'open',
  draft: false,
  base: { ref: 'main', sha: 'base0001', repo: { full_name: 'octo/app' } },
  head: { ref: 'retry', sha: 'head0002', repo: { full_name: 'octo/app' } },
}
const patch = '@@ -1,2 +1,4 @@\n export const n = 1\n+export const retries = 3\n+export const delay = 10\n export const m = 2'
const aiFinding = {
  category: 'CORRECTNESS',
  severity: 'MAJOR',
  confidence: 'MEDIUM',
  title: 'Retries without backoff',
  description: 'Retrying immediately can amplify load.',
  impact: null,
  recommendation: 'Add exponential backoff.',
  path: 'src/retry.ts',
  startLine: 2,
  endLine: 2,
}
const marker = (fp: string) => formatMarker({ mv: 1, kind: 'inline', rid: ME, head: 'h', cfg: 'c', eng: 0, fpv: 1, key: 'k', fp, u: '0/0/0' })
const commentBody = (title: string, prompt: string, fp: string) =>
  [`**MAJOR · correctness** — ${title}`, '', 'd', '', '<details><summary>Prompt for your AI agent</summary>', '', '```text', prompt, '```', '', '</details>', '', marker(fp)].join('\n')

function fakeFetch(aiCalls: string[], writes: string[] = []) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init)
    const url = req.url
    if (url.startsWith('https://api.anthropic.com/')) {
      aiCalls.push(await req.text())
      return Response.json({
        id: 'msg',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [{ type: 'text', text: JSON.stringify({ findings: [aiFinding] }) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 900, output_tokens: 40 },
      })
    }
    if (req.method !== 'GET' && !url.endsWith('/graphql')) writes.push(`${req.method} ${url}`)
    const routes: Record<string, unknown> = {
      'https://api.github.com/user': { id: ME, login: 'me' },
      [`${GH}/pulls/9`]: pull,
      [`${GH}/compare/base0001...head0002?per_page=1`]: { merge_base_commit: { sha: 'mb000003' } },
      [`${GH}/pulls/9/files?per_page=100`]: [{ filename: 'src/retry.ts', status: 'modified', additions: 2, deletions: 0, changes: 2, patch }],
      [`${GH}/pulls/9/reviews?per_page=100`]: [],
      [`${GH}/issues/9/comments?per_page=100`]: [],
      [`${GH}/pulls/9/comments?per_page=100`]: [
        { id: 1, user: { id: ME, login: 'me' }, body: commentBody('Retries without backoff', 'In src/retry.ts at line 2: add backoff.', 'a'.repeat(64)), path: 'src/retry.ts', line: 2, position: 1, html_url: 'u1', created_at: '2026-11-20T00:00:00Z' },
        { id: 2, user: { id: 99, login: 'other' }, body: commentBody('Not mine', 'In src/x.ts at line 1: z.', 'b'.repeat(64)), path: 'src/x.ts', line: 1, position: 1, html_url: 'u2', created_at: '2026-11-20T00:00:00Z' },
      ],
    }
    if (url === `${GH}/contents/src/retry.ts?ref=head0002`) return new Response('export const n = 1\nexport const retries = 3\nexport const delay = 10\nexport const m = 2\n')
    if (url === `${GH}/contents/src/retry.ts?ref=mb000003`) return new Response('export const n = 1\nexport const m = 2\n')
    if (/\/reactions\?/.test(url)) return Response.json([])
    return url in routes ? Response.json(routes[url]) : new Response('{}', { status: 404 })
  }) as typeof fetch
}

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

async function session(messages: unknown[], aiCalls: string[] = [], writes: string[] = []) {
  const home = mkdtempSync(join(tmpdir(), 'prr-mcp-'))
  dirs.push(home)
  const env = { GITHUB_TOKEN: TOKEN, ANTHROPIC_API_KEY: AI_KEY, PR_REVIEWER_CONFIG: '/nonexistent/c.yml', HOME: home }
  const deps: CliDeps = {
    env,
    fetch: fakeFetch(aiCalls, writes),
    platform: 'linux',
    homedir: home,
    credentials: new DefaultCredentialResolver({ env, keychain: async () => undefined, ghToken: async () => undefined }),
    isTTY: false,
    prompt: async () => '',
    openUrl: () => {},
    untilStopped: async () => {},
    runGh: async () => ({ code: 1, stdout: '', stderr: '' }),
  }
  const config = resolveSettings({ user: {} })
  if (!config.ok) throw new Error(config.error.message)
  let out = ''
  let err = ''
  async function* lines() {
    for (const m of messages) yield typeof m === 'string' ? m : JSON.stringify(m)
  }
  const code = await mcpCommand({ stdout: (t) => (out += t), stderr: (t) => (err += t) }, deps, [], () => config.value, lines())
  const replies = out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { id: unknown; result?: any; error?: { code: number } })
  return { code, replies, out, err, byId: (id: number) => replies.find((r) => r.id === id)! }
}

const call = (id: number, name: string, args: Record<string, unknown>) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })

describe('pr-reviewer mcp', () => {
  it('speaks JSON-RPC on stdout: initialize, tools/list, errors, and silence for notifications', async () => {
    const s = await session([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'ping' },
      { jsonrpc: '2.0', id: 4, method: 'resources/list' },
      call(5, 'post_review', {}),
      '{not json',
      { jsonrpc: '2.0', method: 'tools/call', params: { name: 'review_pr', arguments: { pr: 'octo/app#9' } } },
      { jsonrpc: '2.0', id: 6, method: 'initialize', params: { protocolVersion: '1999-01-01' } },
    ])
    expect(s.code).toBe(0)
    expect(s.byId(1).result.protocolVersion).toBe('2025-03-26')
    expect(s.byId(1).result.serverInfo.name).toBe('pr-reviewer')
    expect(s.byId(2).result.tools.map((t: { name: string }) => t.name)).toEqual(['review_pr', 'open_findings'])
    expect(s.byId(3).result).toEqual({})
    expect(s.byId(4).error!.code).toBe(-32601)
    expect(s.byId(5).error!.code).toBe(-32602)
    expect(s.replies.find((r) => r.id === null)!.error!.code).toBe(-32700)
    expect(s.byId(6).result.protocolVersion).toBe('2025-06-18')
    // One reply per request with an id, plus the parse error; the notifications get none.
    expect(s.replies).toHaveLength(7)
    expect(MCP_TOOLS.every((t) => t.annotations.readOnlyHint)).toBe(true)
  })

  it('review_pr returns the findings with fix prompts and never writes to GitHub', async () => {
    const aiCalls: string[] = []
    const writes: string[] = []
    const s = await session([call(1, 'review_pr', { pr: 'https://github.com/octo/app/pull/9' })], aiCalls, writes)
    const res = s.byId(1).result
    expect(res.isError).toBeUndefined()
    const body = JSON.parse(res.content[0].text)
    expect(body.pr).toBe('octo/app#9')
    expect(body.headSha).toBe('head0002')
    expect(body.findings).toHaveLength(1)
    expect(body.findings[0]).toMatchObject({ severity: 'MAJOR', title: 'Retries without backoff', path: 'src/retry.ts', lines: [2, 2], source: 'AI' })
    expect(body.findings[0].fixPrompt).toContain('src/retry.ts')
    expect(body.note).toContain('Nothing was posted')
    expect(aiCalls).toHaveLength(1)
    expect(writes).toEqual([])
    // stdout carries only protocol messages.
    expect(s.out.trim().split('\n')).toHaveLength(1)
  })

  it('reports a bad PR reference as a tool error, not a protocol error', async () => {
    const s = await session([call(1, 'review_pr', { pr: 'not a pr' })])
    expect(s.byId(1).result.isError).toBe(true)
    expect(s.byId(1).error).toBeUndefined()
  })

  it('open_findings lists only your own unresolved findings with their prompts', async () => {
    const s = await session([call(1, 'open_findings', { pr: 'octo/app#9' })])
    const body = JSON.parse(s.byId(1).result.content[0].text)
    expect(body.open).toEqual([{ title: 'Retries without backoff', fixPrompt: 'In src/retry.ts at line 2: add backoff.', url: 'u1' }])
  })
})
