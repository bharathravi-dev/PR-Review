import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DefaultCredentialResolver } from '@pr-reviewer/credentials'
import { afterEach, describe, expect, it } from 'vitest'
import { main } from './main.js'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('hallucination regression benchmark', () => {
  it('filters fabricated files, lines, quotes, and keeps 100% grounded precision in bench output', async () => {
    const GH = 'https://api.github.com/repos/octo/trap'
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const req = new Request(input, init)
      const url = req.url
      if (url.startsWith('https://api.anthropic.com/')) {
        const body = await req.text()
        if (body.includes('You verify code review findings')) {
          return Response.json({
            id: 'v',
            type: 'message',
            role: 'assistant',
            model: 'claude-opus-5-5',
            content: [{ type: 'text', text: JSON.stringify({ verdicts: [{ id: 0, verdict: 'KEEP', severity: null, reason: 'verified bug' }] }) }],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 15, output_tokens: 6 },
          })
        }
        return Response.json({
          id: 'm',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5-5',
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                summary: 'Fixes token check. All unit tests pass and TypeScript compiles cleanly.',
                files: [
                  { path: 'src/auth.ts', change: 'Token check' },
                  { path: 'src/hallucinated.ts', change: 'Invented' },
                ],
                effort: 2,
                issues: [],
                findings: [
                  // 1. Real bug, valid line + matching evidenceQuote + valid TS fix
                  {
                    category: 'SECURITY',
                    severity: 'CRITICAL',
                    confidence: 'HIGH',
                    title: 'Timing attack on raw secret comparison',
                    description: 'Uses === on secret token comparison.',
                    impact: null,
                    recommendation: 'Use constant-time comparison.',
                    path: 'src/auth.ts',
                    startLine: 2,
                    endLine: 2,
                    evidenceQuote: 'token === expected',
                    suggestion: '  return timingSafeEqual(Buffer.from(token), Buffer.from(expected))',
                  },
                  // 2. Hallucinated file path
                  {
                    category: 'CORRECTNESS',
                    severity: 'MAJOR',
                    confidence: 'HIGH',
                    title: 'Ghost file bug',
                    description: 'd',
                    impact: null,
                    recommendation: null,
                    path: 'src/ghost.ts',
                    startLine: 1,
                    endLine: 1,
                    evidenceQuote: null,
                    suggestion: null,
                  },
                  // 3. Fabricated quote on real file line
                  {
                    category: 'CORRECTNESS',
                    severity: 'MAJOR',
                    confidence: 'HIGH',
                    title: 'Hallucinated call',
                    description: 'Calls nonexistent helper.',
                    impact: null,
                    recommendation: null,
                    path: 'src/auth.ts',
                    startLine: 2,
                    endLine: 2,
                    evidenceQuote: 'nonExistentHelperCall()',
                    suggestion: null,
                  },
                ],
              }),
            },
          ],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 30, output_tokens: 12 },
        })
      }
      if (url === 'https://api.github.com/user') return Response.json({ id: 1, login: 'me' })
      if (url === `${GH}/pulls/7`) return Response.json({ title: 'Auth tweak', body: '', user: { login: 'dev', id: 7 }, state: 'open', draft: false, base: { ref: 'main', sha: 'b1', repo: { id: 9, full_name: 'octo/trap' } }, head: { ref: 'auth', sha: 'h1', repo: { id: 9, full_name: 'octo/trap' } } })
      if (url.startsWith(`${GH}/compare/`)) return Response.json({ merge_base_commit: { sha: 'mb' } })
      if (url === `${GH}/pulls/7/files?per_page=100`) {
        return Response.json([{ filename: 'src/auth.ts', status: 'modified', additions: 2, deletions: 0, changes: 2, patch: '@@ -1,2 +1,3 @@\n export function ok(token: string, expected: string) {\n+  return token === expected\n }' }])
      }
      if (/\/(pulls|issues)\/7\/(reviews|comments)\?/.test(url)) return Response.json([])
      if (url.startsWith(`${GH}/contents/src/auth.ts?ref=`)) {
        return new Response('export function ok(token: string, expected: string) {\n  return token === expected\n}')
      }
      if (/\/commits\/.+\/(check-runs|status)/.test(url)) return Response.json({ check_runs: [], statuses: [] })
      return new Response('{}', { status: 404 })
    }) as typeof globalThis.fetch

    const dir = mkdtempSync(join(tmpdir(), 'prr-halluc-'))
    dirs.push(dir)
    const outJson = join(dir, 'hallucination-bench.json')
    writeFileSync(join(dir, 'dataset.yml'), 'name: hallucination-traps\nversion: "1"\ncases:\n  - pr: octo/trap#7\n    issues:\n      - { path: src/auth.ts, line: 2, description: constant-time token comparison, severity: CRITICAL }\n')
    writeFileSync(join(dir, 'config.yml'), 'version: 1\nsandbox: { enabled: false }\n')
    const env = { GITHUB_TOKEN: 'gh-0000', ANTHROPIC_API_KEY: 'sk-ant-test-0000000000000000000', PR_REVIEWER_CONFIG: join(dir, 'config.yml'), PR_REVIEWER_CACHE_DIR: join(dir, 'cache'), PR_REVIEWER_STATE_DIR: join(dir, 'state') }
    let out = ''
    const code = await main(['bench', join(dir, 'dataset.yml'), '--effort', 'standard', '--out', outJson], { stdout: (t) => (out += t), stderr: () => undefined }, {
      env,
      fetch,
      homedir: dir,
      credentials: new DefaultCredentialResolver({ env, keychain: async () => undefined, ghToken: async () => undefined }),
    })
    expect(code).toBe(0)
    expect(out).toContain('precision 100.0%')
    expect(out).toContain('guard drops: 2 grounding, 0 verification')
    const parsed = JSON.parse(readFileSync(outJson, 'utf8'))
    expect(parsed).toMatchObject({ groundedDropsTotal: 2, verificationDropsTotal: 0, precision: { mean: 1 }, recall: { mean: 1 }, f1: { mean: 1 } })
  })
})
