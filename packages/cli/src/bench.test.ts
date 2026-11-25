import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Finding } from '@pr-reviewer/core'
import { DefaultCredentialResolver } from '@pr-reviewer/credentials'
import { describe, expect, it } from 'vitest'
import { postedComments, runMetrics, scoreCase } from './bench.js'
import { main } from './main.js'

const f = (path: string, line: number, over: Partial<Finding> = {}): Finding => ({
  ruleId: 'ai/correctness', category: 'CORRECTNESS', severity: 'MAJOR', confidence: 'HIGH', scope: 'NEW', sourceFamily: 'AI', title: 't', description: 'd',
  location: { anchorKind: 'LINE', path, startLine: line, endLine: line }, provenance: { validator: 'ai.review' }, ...over,
})

describe('bench scoring', () => {
  it('matches inline findings to gold issues once each, within the line window, and the judge can veto', async () => {
    const issues = [{ path: 'a.ts', line: 10, description: 'off by one', severity: 'CRITICAL' as const }, { path: 'b.ts', line: 3, description: 'leak' }]
    const findings = [f('a.ts', 14), f('a.ts', 11), f('a.ts', 40), f('b.ts', 3, { scope: 'PRE_EXISTING' }), f('c.ts', 1, { location: { anchorKind: 'PR' } }), f('a.ts', 2, { severity: 'INFO' })]
    const comments = postedComments(findings)
    expect(comments).toHaveLength(3)
    const s = await scoreCase(comments, issues)
    expect(s).toEqual({ gold: 2, comments: 3, matchedGold: 1, matchedComments: 1, bySeverity: { CRITICAL: { gold: 1, found: 1 }, UNRATED: { gold: 1, found: 0 } } })
    const vetoed = await scoreCase(comments, issues, async () => [])
    expect(vetoed.matchedGold).toBe(0)
    expect(runMetrics([{ pr: 'x', ...s, tokens: 0, costUsd: 0, ms: 0 }])).toEqual({ precision: 1 / 3, recall: 0.5, f1: 0.4 })
  })

  it('lets the judge match issues without a location, but never a comment far from a located issue', async () => {
    const issues = [{ description: 'negative slicing on a queryset', severity: 'MAJOR' as const }, { path: 'a.ts', line: 10, description: 'leak' }]
    const comments = [f('x.py', 50), f('a.ts', 90)]
    const s = await scoreCase(comments, issues, async () => [{ issue: 0, comment: 0 }, { issue: 1, comment: 1 }, { issue: 7, comment: 0 }])
    expect(s).toMatchObject({ gold: 2, comments: 2, matchedGold: 1, matchedComments: 1 })
  })

  it('leaves comments that only match an optional issue out of both counts, and matches required issues first', async () => {
    const issues = [{ description: 'typo', optional: true }, { description: 'crash', severity: 'CRITICAL' as const }]
    const comments = [f('a.ts', 1), f('a.ts', 20), f('a.ts', 40)]
    const s = await scoreCase(comments, issues, async () => [{ issue: 0, comment: 0 }, { issue: 1, comment: 0 }, { issue: 0, comment: 1 }])
    expect(s).toEqual({ gold: 1, comments: 2, matchedGold: 1, matchedComments: 1, bySeverity: { CRITICAL: { gold: 1, found: 1 } } })
  })
})

describe('pr-reviewer bench', () => {
  it('reviews each PR in the dataset and reports precision, recall, and F1', async () => {
    const GH = 'https://api.github.com/repos/octo/app'
    let judgeCalls = 0
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new Request(input, init).url
      if (url.startsWith('https://api.anthropic.com/')) {
        if (String(init?.body ?? '').includes('known_issues')) {
          judgeCalls++
          return Response.json({ id: 'j', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: JSON.stringify({ matches: [{ issue: 0, comment: 0, reason: 'same' }] }) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } })
        }
        const findings = [{ category: 'CORRECTNESS', severity: 'MAJOR', confidence: 'HIGH', title: 'Retries without backoff', description: 'd', impact: null, recommendation: null, path: 'src/retry.ts', startLine: 2, endLine: 2, suggestion: null }]
        return Response.json({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: JSON.stringify({ summary: 's', files: [], effort: 1, findings }) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } })
      }
      if (url === 'https://api.github.com/user') return Response.json({ id: 1, login: 'me' })
      if (url === `${GH}/pulls/9`) return Response.json({ title: 'Add retry', body: '', user: { login: 'dev', id: 7 }, state: 'open', draft: false, base: { ref: 'main', sha: 'b1', repo: { id: 5, full_name: 'octo/app' } }, head: { ref: 'r', sha: 'h1', repo: { id: 5, full_name: 'octo/app' } } })
      if (url.startsWith(`${GH}/compare/`)) return Response.json({ merge_base_commit: { sha: 'mb' } })
      if (url === `${GH}/pulls/9/files?per_page=100`) return Response.json([{ filename: 'src/retry.ts', status: 'modified', additions: 2, deletions: 0, changes: 2, patch: '@@ -1,2 +1,4 @@\n a\n+b\n+c\n d' }])
      if (/\/(pulls|issues)\/9\/(reviews|comments)\?/.test(url)) return Response.json([])
      if (url.startsWith(`${GH}/contents/src/retry.ts?ref=`)) return new Response('a\nb\nc\nd\n')
      if (/\/commits\/.+\/(check-runs|status)/.test(url)) return Response.json({ check_runs: [], statuses: [] })
      return new Response('{}', { status: 404 })
    }) as typeof globalThis.fetch
    const dir = mkdtempSync(join(tmpdir(), 'prr-bench-'))
    writeFileSync(join(dir, 'set.yml'), 'name: smoke\nversion: "1"\ncases:\n  - pr: octo/app#9\n    issues:\n      - { path: src/retry.ts, line: 3, description: retries have no backoff, severity: MAJOR }\n      - { path: src/retry.ts, line: 60, description: unrelated bug }\n')
    writeFileSync(join(dir, 'config.yml'), 'version: 1\nsandbox: { enabled: false }\n')
    const env = { GITHUB_TOKEN: 'gh-0000', ANTHROPIC_API_KEY: 'sk-ant-test-0000000000000000000', PR_REVIEWER_CONFIG: join(dir, 'config.yml'), PR_REVIEWER_CACHE_DIR: join(dir, 'cache'), PR_REVIEWER_STATE_DIR: join(dir, 'state') }
    let out = ''
    const code = await main(['bench', join(dir, 'set.yml'), '--runs', '2', '--out', join(dir, 'result.json')], { stdout: (t) => (out += t), stderr: () => undefined }, {
      env, fetch, homedir: dir, credentials: new DefaultCredentialResolver({ env, keychain: async () => undefined, ghToken: async () => undefined }),
    })
    expect(code).toBe(0)
    expect(out).toContain('Benchmark smoke v1: 1 PR(s) × 2 run(s)')
    expect(out).toContain('precision 100.0% ± 0.0   recall 50.0% ± 0.0   F1 66.7% ± 0.0')
    expect(out).toContain('recall by severity: major 100%, unrated 0%')
    const result = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8'))
    expect(result).toMatchObject({ runs: 2, matching: { lineWindow: 5, judge: null }, failedCases: 0 })

    // Issues without a location need a judge; with one, a single judge call per PR does the matching.
    writeFileSync(join(dir, 'golden.json'), JSON.stringify({ name: 'golden', cases: [{ pr: 'octo/app#9', issues: [{ description: 'retries have no backoff', severity: 'MAJOR' }, { description: 'typo', optional: true }] }] }))
    expect(await main(['bench', join(dir, 'golden.json')], { stdout: () => undefined, stderr: (t) => (out += t) }, { env, fetch, homedir: dir, credentials: new DefaultCredentialResolver({ env, keychain: async () => undefined, ghToken: async () => undefined }) })).toBe(64)
    expect(out).toContain('only a judge can match: add --judge')
    out = ''
    const judged = await main(['bench', join(dir, 'golden.json'), '--judge', 'anthropic'], { stdout: (t) => (out += t), stderr: () => undefined }, {
      env, fetch, homedir: dir, credentials: new DefaultCredentialResolver({ env, keychain: async () => undefined, ghToken: async () => undefined }),
    })
    expect(judged).toBe(0)
    expect(judgeCalls).toBe(1)
    expect(out).toContain('+ judge anthropic')
    expect(out).toContain('same provider type as the reviewer')
    expect(out).toContain('precision 100.0%   recall 100.0%   F1 100.0%')
  })
})
