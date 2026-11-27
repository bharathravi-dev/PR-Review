import { executeValidators, type FileAccessor, type PrContext, type ProjectInfo, type SandboxStepResult, type ValidatorContext } from '@pr-reviewer/core'
import { describe, expect, it } from 'vitest'
import { goTestsValidator, parseGoTestFailures, parseNodeTestFailures, sandboxTestsValidator } from './sandbox-tests.js'

const pr = (files: string[]): PrContext => ({
  schemaVersion: 1,
  ref: { host: 'github.com', owner: 'o', repo: 'r', number: 1 },
  title: 'PR',
  body: '',
  author: 'dev',
  state: 'open',
  draft: false,
  baseRef: 'main',
  headRef: 'feat',
  baseSha: 'b',
  headSha: 'h',
  mergeBaseSha: 'm',
  fromFork: false,
  files: files.map((path) => ({ path, status: 'modified', additions: 5, deletions: 1, binary: false, patchTruncated: false })),
  reviews: [],
  reviewComments: [],
  issueComments: [],
  truncated: [],
})

const files: FileAccessor = { read: async () => undefined, list: async () => undefined, exists: async () => false, notes: () => [] }

describe('parseNodeTestFailures & parseGoTestFailures', () => {
  it('extracts Vitest/Jest and Go test failure locations', () => {
    const vitest = ' FAIL  src/math.test.ts:14:5 > adds two numbers\n ❯ src/math.test.ts:14:5'
    expect(parseNodeTestFailures(vitest, '')).toEqual([
      { name: 'adds two numbers', path: 'src/math.test.ts', line: 14, detail: 'FAIL  src/math.test.ts:14:5 > adds two numbers' },
    ])

    const goOut = '--- FAIL: TestPool (0.01s)\n    pool_test.go:28: expected 2, got 1\nFAIL'
    expect(parseGoTestFailures(goOut, 'svc')).toEqual([
      { name: 'TestPool', path: 'svc/pool_test.go', line: 28, detail: 'expected 2, got 1' },
    ])
  })
})

describe('sandboxTestsValidator & goTestsValidator', () => {
  it('stays skipped unless explicitly opted in via validators.enable', async () => {
    const project: ProjectInfo = { path: '', language: 'TypeScript', support: 'supported', frameworks: [], changedFiles: ['src/a.ts'], configs: {}, packageManager: 'pnpm' }
    const ctx: ValidatorContext = { pr: pr(['src/a.ts']), files, projects: [project], checks: [], repoSettings: {}, sandbox: new Map() }
    const skipped = await executeValidators([sandboxTestsValidator], ctx, { now: () => 0 })
    expect(skipped.layers).toEqual([])
  })

  it('reports CRITICAL TESTS finding when sandbox tests fail', async () => {
    const project: ProjectInfo = { path: '', language: 'TypeScript', support: 'supported', frameworks: [], changedFiles: ['src/math.test.ts'], configs: {}, packageManager: 'pnpm' }
    const sandbox = new Map<string, SandboxStepResult>([
      ['install:.', { id: 'install:.', exitCode: 0, stdout: '', stderr: '', timedOut: false, durationMs: 1 }],
      ['tests.sandbox:run:.', { id: 'tests.sandbox:run:.', exitCode: 1, stdout: 'FAIL  src/math.test.ts:9:3 > fails cleanly', stderr: '', timedOut: false, durationMs: 1 }],
    ])
    const ctx: ValidatorContext = { pr: pr(['src/math.test.ts']), files, projects: [project], checks: [], repoSettings: {}, sandbox }
    const out = await sandboxTestsValidator.run(ctx, { now: () => 0 })
    expect(out.layers[0]).toMatchObject({ layer: 'TESTS', status: 'FAILED' })
    expect(out.findings[0]).toMatchObject({ ruleId: 'tests/unit-test-failed', severity: 'CRITICAL', location: { anchorKind: 'LINE', path: 'src/math.test.ts', startLine: 9 } })
    expect(goTestsValidator.supports(ctx).applicable).toBe(false)
  })
})
