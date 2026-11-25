import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DefaultCredentialResolver } from '@pr-reviewer/credentials'
import { CLAUDE_CODE_REQUIRED_FLAGS } from '@pr-reviewer/providers-cli'
import { afterEach, describe, expect, it } from 'vitest'
import { main } from './main.js'

const GH = 'https://api.github.com/repos/octo/app'
const FILE = 'export const n = 1\nexport const retries = 3\nexport const delay = 10\nexport const m = 2\n'
const FINDING = { category: 'CORRECTNESS', severity: 'MAJOR', confidence: 'HIGH', title: 'Retries without backoff', description: 'd', impact: null, recommendation: null, path: 'src/retry.ts', startLine: 2, endLine: 2 }

/** Fake GitHub; everything else goes to the real network stack (the local mock server). */
const github = (async (input: string | URL | Request, init?: RequestInit) => {
  const req = new Request(input, init)
  const url = req.url
  if (!url.startsWith('https://api.github.com/')) return fetch(req)
  if (url === 'https://api.github.com/user') return Response.json({ id: 4242, login: 'me' })
  if (url === `${GH}/pulls/9`) return Response.json({ title: 'Add retry', body: '', user: { login: 'dev', id: 7 }, state: 'open', draft: false, base: { ref: 'main', sha: 'b1', repo: { id: 555, full_name: 'octo/app' } }, head: { ref: 'r', sha: 'h2', repo: { id: 555, full_name: 'octo/app' } } })
  if (url.startsWith(`${GH}/compare/`)) return Response.json({ merge_base_commit: { sha: 'mb' } })
  if (url === `${GH}/pulls/9/files?per_page=100`) return Response.json([{ filename: 'src/retry.ts', status: 'modified', additions: 2, deletions: 0, changes: 2, patch: '@@ -1,2 +1,4 @@\n export const n = 1\n+export const retries = 3\n+export const delay = 10\n export const m = 2' }])
  if (/\/(pulls|issues)\/9\/(reviews|comments)\?/.test(url)) return Response.json([])
  if (url.startsWith(`${GH}/contents/src/retry.ts?ref=`)) return new Response(FILE)
  return new Response('{}', { status: 404 })
}) as typeof fetch

/** An OpenAI-compatible mock endpoint on 127.0.0.1 that answers with `status` (200 = findings). */
let servers: Server[] = []
afterEach(() => {
  for (const s of servers) s.close()
  servers = []
})
async function mockOpenAi(status: number, seen: Array<{ path: string; auth?: string; body: Record<string, unknown> }> = []): Promise<string> {
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      seen.push({ path: req.url ?? '', auth: req.headers.authorization, body: JSON.parse(body) as Record<string, unknown> })
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(
        status === 200
          ? JSON.stringify({ model: 'local-model', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ findings: [FINDING] }) } }], usage: { prompt_tokens: 2000, completion_tokens: 100 } })
          : JSON.stringify({ error: { message: 'slow down' } }),
      )
    })
  })
  servers.push(server)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
}

function setup(configYaml: string, env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'prr-providers-'))
  const configPath = join(dir, 'config.yml')
  writeFileSync(configPath, configYaml)
  const fullEnv = { GITHUB_TOKEN: 'gh-test-token-9999', PR_REVIEWER_CONFIG: configPath, PR_REVIEWER_STATE_DIR: join(dir, 'state'), PATH: process.env.PATH ?? '', HOME: dir, ...env }
  const cli = async (argv: string[]) => {
    let out = ''
    let err = ''
    const code = await main(argv, { stdout: (t) => (out += t), stderr: (t) => (err += t) }, {
      env: fullEnv,
      fetch: github,
      homedir: dir,
      credentials: new DefaultCredentialResolver({ env: fullEnv, keychain: async () => undefined, ghToken: async () => undefined }),
    })
    return { code, out, err }
  }
  return { dir, cli }
}

describe('openai-compatible from configuration only (Story 3.1)', () => {
  it('reviews through a custom endpoint defined in the user config', async () => {
    const seen: Array<{ path: string; auth?: string; body: Record<string, unknown> }> = []
    const base = await mockOpenAi(200, seen)
    const { cli } = setup(`version: 1\ndefaultProvider: local\nproviders:\n  local:\n    type: openai-compatible\n    baseUrl: ${base}\n    model: my-model\n    credential: provider:local\n`, { PR_REVIEWER_LOCAL_API_KEY: 'local-key-0000' })
    const r = await cli(['review', 'octo/app#9', '--json'])
    const report = JSON.parse(r.out)
    expect(report.ai.attempts).toEqual([{ provider: 'local', model: 'local-model', outcome: 'SUCCEEDED', billing: 'METERED', usage: { input: 2000, output: 100 } }])
    expect(report.findings[0]).toMatchObject({ title: 'Retries without backoff', provenance: { provider: 'local', model: 'local-model' } })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ path: '/v1/chat/completions', auth: 'Bearer local-key-0000', body: { model: 'my-model' } })
    expect(r.out).not.toContain('local-key-0000')
  })

  it('explains a missing model or key', async () => {
    const { cli } = setup('version: 1\ndefaultProvider: openai\n')
    const r = await cli(['review', 'octo/app#9', '--json'])
    expect(JSON.parse(r.out).layers.find((l: { layer: string }) => l.layer === 'AI_REVIEW')).toMatchObject({ status: 'SKIPPED', detail: expect.stringContaining('Set the model for "openai"') })
  })
})

describe('fallback (Story 3.2)', () => {
  it('moves to the next provider on a rate limit and names both in the Report', async () => {
    const limited = await mockOpenAi(429)
    const working = await mockOpenAi(200)
    const { cli } = setup(
      `version: 1\ndefaultProvider: busy\nfallback: [spare]\nproviders:\n  busy:\n    type: openai-compatible\n    baseUrl: ${limited}\n    model: m1\n  spare:\n    type: openai-compatible\n    baseUrl: ${working}\n    model: m2\n`,
    )
    const r = await cli(['review', 'octo/app#9', '--json'])
    const report = JSON.parse(r.out)
    expect(report.ai.attempts.map((a: { provider: string; outcome: string }) => [a.provider, a.outcome])).toEqual([['busy', 'FAILED'], ['spare', 'SUCCEEDED']])
    expect(report.ai.attempts[0].reason).toContain('rate limit')
    expect(report.findings[0].provenance).toMatchObject({ provider: 'spare' })
    expect(report.layers.find((l: { layer: string }) => l.layer === 'AI_REVIEW').detail).toContain('Used "spare" after: busy failed')
  })
})

describe('claude-code through the user\'s own login (Story 3.3)', () => {
  function fakeClaude(dir: string): { command: string; log: string } {
    const log = join(dir, 'claude-call.json')
    const command = join(dir, 'claude')
    const help = CLAUDE_CODE_REQUIRED_FLAGS.map((f) => `  ${f} <x>`).join('\\n')
    writeFileSync(
      command,
      `#!${process.execPath}
import { readdirSync, writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
if (args[0] === '--help') { console.log('Usage: claude\\n${help}'); process.exit(0) }
if (args[0] === '--version') { console.log('9.9.9 (Claude Code)'); process.exit(0) }
let stdin = ''
process.stdin.on('data', (d) => (stdin += d))
process.stdin.on('end', () => {
  writeFileSync(${JSON.stringify(log)}, JSON.stringify({ args, cwdFiles: readdirSync(process.cwd()), env: process.env, stdin }))
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, structured_output: { findings: [${JSON.stringify(FINDING)}] }, total_cost_usd: 0.31, usage: { input_tokens: 3000, output_tokens: 200 }, modelUsage: { 'claude-opus-5-5': {} } }))
})
`,
    )
    chmodSync(command, 0o755)
    return { command, log }
  }

  it('reviews with Claude Code, isolated, and shows the plan notice once', async () => {
    const { dir, cli } = setup('version: 1\n', { ANTHROPIC_API_KEY: 'sk-ant-must-not-leak-0000' })
    const { command, log } = fakeClaude(dir)
    writeFileSync(join(dir, 'config.yml'), `version: 1\ndefaultProvider: claude-code\nproviders:\n  claude-code:\n    type: claude-code\n    command: ${command}\n    model: opus\n`)
    const first = await cli(['review', 'octo/app#9'])
    expect(first.err).toContain('reviews through your own Claude Code login (Claude plan)')
    expect(first.out).toContain('### MAJOR · CORRECTNESS · Retries without backoff')
    expect(first.out).toContain("claude-code claude-opus-5-5 SUCCEEDED, 3000 input / 200 output tokens, drawn from your plan's usage (≈ $0.31 at list price, as reported)")

    const call = JSON.parse(readFileSync(log, 'utf8')) as { args: string[]; cwdFiles: string[]; env: Record<string, string>; stdin: string }
    expect(call.args.slice(0, 3)).toEqual(['-p', '--safe-mode', '--tools'])
    expect(call.args).toContain('--model')
    expect(call.cwdFiles).toEqual([])
    expect(call.env.GITHUB_TOKEN).toBeUndefined()
    expect(call.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(call.stdin).toContain('<pr_data>')

    const second = await cli(['review', 'octo/app#9'])
    expect(second.err).not.toContain('reviews through your own Claude Code login')
  })

  it('falls back to an API key when Claude Code is missing', async () => {
    const { cli } = setup('version: 1\ndefaultProvider: claude-code\nfallback: [anthropic]\nproviders:\n  claude-code:\n    type: claude-code\n    command: /nonexistent/claude\n')
    const r = await cli(['review', 'octo/app#9', '--json'])
    const report = JSON.parse(r.out)
    expect(report.ai.attempts[0]).toMatchObject({ provider: 'claude-code', outcome: 'FAILED', reason: expect.stringContaining('Claude Code was not found') })
    expect(report.ai.attempts[1]).toMatchObject({ provider: 'anthropic', outcome: 'SKIPPED' })
  })
})

describe('usage, cost, and ceilings (Story 3.5)', () => {
  it('estimates cost from configured pricing, records it locally, and stops at the monthly ceiling', async () => {
    const base = await mockOpenAi(200)
    const { dir, cli } = setup(
      `version: 1\ndefaultProvider: local\nlimits:\n  maxCostPerMonthUsd: 0.02\nproviders:\n  local:\n    type: openai-compatible\n    baseUrl: ${base}\n    model: m\n    pricing: { inputPerMTok: 10, outputPerMTok: 0 }\n`,
    )
    const first = await cli(['review', 'octo/app#9'])
    expect(first.out).toContain('local local-model SUCCEEDED, 2000 input / 100 output tokens, ≈ $0.02')
    // The estimate before the call (≈ prompt size) fits under $0.02; the actual $0.02 then fills the month.
    const ledger = JSON.parse(readFileSync(join(dir, 'state', 'usage.json'), 'utf8')) as { months: Record<string, { runs: number; costUsd: number }> }
    expect(Object.values(ledger.months)).toEqual([expect.objectContaining({ runs: 1, costUsd: 0.02 })])

    const second = await cli(['review', 'octo/app#9', '--json'])
    const report = JSON.parse(second.out)
    expect(report.layers.find((l: { layer: string }) => l.layer === 'AI_REVIEW')).toMatchObject({ status: 'SKIPPED', reason: 'COST_CEILING' })
    expect(report.ai.partial).toBe(true)
    expect(report.overallStatus).toBe('PASSED_WITH_WARNINGS')
  })
})
