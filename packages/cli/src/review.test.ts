import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DefaultCredentialResolver } from '@pr-reviewer/credentials'
import { afterEach, describe, expect, it } from 'vitest'
import { main } from './main.js'

const GH = 'https://api.github.com/repos/octo/app'
const TOKEN = ['gh-test-', 'token-abcdef'].join('')
const AI_KEY = ['sk-ant-', 'test-', 'key-0123456789abcdefghij'].join('')
const LEAKED = ['AK', 'IA', 'QWERTYUIOPASDFGH'].join('')

const pull = {
  title: 'Add retry',
  body: 'Adds retries.',
  user: { login: 'dev' },
  state: 'open',
  draft: false,
  base: { ref: 'main', sha: 'base0001', repo: { full_name: 'octo/app' } },
  head: { ref: 'retry', sha: 'head0002', repo: { full_name: 'octo/app' } },
}
const files = (withSecret: boolean) => [
  {
    filename: 'src/retry.ts',
    status: 'modified',
    additions: 2,
    deletions: 0,
    changes: 2,
    patch: `@@ -1,2 +1,4 @@\n export const n = 1\n+export const retries = 3\n+${withSecret ? `export const awsKey = "${LEAKED}"` : 'export const delay = 10'}\n export const m = 2`,
  },
]
const head = (withSecret: boolean) => `export const n = 1\nexport const retries = 3\n${withSecret ? `export const awsKey = "${LEAKED}"` : 'export const delay = 10'}\nexport const m = 2\n`

function fakeFetch(opts: { withSecret?: boolean; aiFindings?: unknown[]; aiStatus?: number } = {}, aiBodies: string[] = []) {
  const withSecret = opts.withSecret ?? false
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init)
    const url = req.url
    if (url.startsWith('https://api.anthropic.com/')) {
      aiBodies.push(await req.text())
      if (opts.aiStatus) return new Response(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'x' } }), { status: opts.aiStatus })
      return Response.json({
        id: 'msg',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [{ type: 'text', text: JSON.stringify({ findings: opts.aiFindings ?? [] }) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 900, output_tokens: 40 },
      })
    }
    const routes: Record<string, unknown> = {
      [`${GH}/pulls/9`]: pull,
      [`${GH}/compare/base0001...head0002?per_page=1`]: { merge_base_commit: { sha: 'mb000003' } },
      [`${GH}/pulls/9/files?per_page=100`]: files(withSecret),
      [`${GH}/pulls/9/reviews?per_page=100`]: [],
      [`${GH}/pulls/9/comments?per_page=100`]: [],
      [`${GH}/issues/9/comments?per_page=100`]: [],
    }
    if (url === `${GH}/contents/src/retry.ts?ref=head0002`) return new Response(head(withSecret))
    if (url === `${GH}/contents/src/retry.ts?ref=mb000003`) return new Response('export const n = 1\nexport const m = 2\n')
    return url in routes ? Response.json(routes[url]) : new Response('{}', { status: 404 })
  }) as typeof fetch
}

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

async function review(argv: string[], fetchImpl: typeof fetch, env: Record<string, string> = { GITHUB_TOKEN: TOKEN, ANTHROPIC_API_KEY: AI_KEY }) {
  let out = ''
  let err = ''
  const credentials = new DefaultCredentialResolver({ env, keychain: async () => undefined, ghToken: async () => undefined })
  const code = await main(['review', ...argv], { stdout: (t) => (out += t), stderr: (t) => (err += t) }, {
    env: { PR_REVIEWER_CONFIG: '/nonexistent/config.yml', ...env },
    fetch: fetchImpl,
    credentials,
  })
  return { code, out, err }
}

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

describe('pr-reviewer review', () => {
  it('runs the pipeline end to end and exits 1 for AI-only findings (0 with --warnings-ok)', async () => {
    const aiBodies: string[] = []
    const r = await review(['octo/app#9'], fakeFetch({ aiFindings: [aiFinding] }, aiBodies))
    expect(r.code).toBe(1)
    expect(r.out).toContain('**Overall: PASSED_WITH_WARNINGS**')
    expect(r.out).toContain('### MAJOR · CORRECTNESS · Retries without backoff')
    expect(r.out).toContain('`src/retry.ts:2` · AI (claude-opus-5-5) · confidence MEDIUM · NEW')
    expect(r.err).toMatch(/PASSED\s+CONTEXT/)
    expect(aiBodies).toHaveLength(1)
    const warningsOk = await review(['octo/app#9', '--warnings-ok'], fakeFetch({ aiFindings: [aiFinding] }))
    expect(warningsOk.code).toBe(0)
  })

  it('fails on a committed secret and never sends it to the AI', async () => {
    const aiBodies: string[] = []
    const r = await review(['octo/app#9', '--json'], fakeFetch({ withSecret: true }, aiBodies))
    expect(r.code).toBe(2)
    const report = JSON.parse(r.out)
    expect(report).toMatchObject({ schemaVersion: 1, overallStatus: 'FAILED', run: { headSha: 'head0002', channel: 'CLI', fpv: 1, repo: { fullName: 'octo/app' } } })
    expect(report.findings[0]).toMatchObject({ ruleId: 'secrets/aws-access-key-id', scope: 'NEW', location: { path: 'src/retry.ts', startLine: 3 } })
    expect(aiBodies.join('')).not.toContain(LEAKED)
    expect(aiBodies.join('')).toContain('[REDACTED]')
    expect(r.out + r.err).not.toContain(LEAKED)
  })

  it('reports the AI layer as SKIPPED, never PASSED, without an AI key', async () => {
    const r = await review(['octo/app#9'], fakeFetch(), { GITHUB_TOKEN: TOKEN })
    expect(r.code).toBe(1)
    expect(r.out).toContain('| AI_REVIEW | ai.review | SKIPPED (PROVIDER_UNAVAILABLE) |')
    expect(r.out).toContain('a check that did not run is not a pass')
  })

  it('exits 4 when the PR cannot be loaded, and 64 for a bad reference', async () => {
    expect((await review(['octo/app#404'], fakeFetch())).code).toBe(4)
    expect((await review(['nope'], fakeFetch())).code).toBe(64)
  })

  it('writes report.md and report.json, with no credential anywhere', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prr-out-'))
    dirs.push(dir)
    const r = await review(['https://github.com/octo/app/pull/9', '--out', dir], fakeFetch({ aiStatus: 500 }))
    expect(r.code).toBe(1)
    const md = readFileSync(join(dir, 'report.md'), 'utf8')
    const json = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'))
    expect(md).toContain('AI_REVIEW | ai.review | ERROR (PROVIDER_UNAVAILABLE)')
    expect(json.layers.map((l: { layer: string }) => l.layer)).toEqual(['CONTEXT', 'SECRETS', 'AI_REVIEW'])
    for (const text of [md, JSON.stringify(json), r.out, r.err]) {
      expect(text).not.toContain(TOKEN)
      expect(text).not.toContain(AI_KEY)
    }
  })
})
