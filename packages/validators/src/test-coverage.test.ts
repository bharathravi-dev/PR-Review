import type { FileAccessor, PrContext, ValidatorContext } from '@pr-reviewer/core'
import { describe, expect, it } from 'vitest'
import { localTestsValidator, matchesTestForSource } from './test-coverage.js'

function makeCtx(
  files: Array<{ path: string; status?: 'added' | 'modified' | 'removed'; additions?: number }>,
  repoTree?: string[],
): ValidatorContext {
  const pr: PrContext = {
    schemaVersion: 1,
    ref: { host: 'github.com', owner: 'o', repo: 'r', number: 1 },
    title: 'Test PR',
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
    files: files.map((f) => ({
      path: f.path,
      status: f.status ?? 'added',
      additions: f.additions ?? 10,
      deletions: 0,
      binary: false,
      patchTruncated: false,
      patch: '@@ -0,0 +1,10 @@',
    })),
    reviews: [],
    reviewComments: [],
    issueComments: [],
    truncated: [],
  }
  const fileAccessor: FileAccessor = {
    read: async () => undefined,
    list: async () => repoTree?.map((path) => ({ path, kind: 'file' as const })),
    exists: async () => false,
    notes: () => [],
  }
  return { pr, files: fileAccessor, projects: [], checks: [], repoSettings: {}, sandbox: new Map() }
}

describe('matchesTestForSource', () => {
  it('matches unit test naming conventions across TS/JS, Java/Kotlin, Python, and Go', () => {
    expect(matchesTestForSource('src/auth/login.ts', 'src/auth/login.test.ts')).toBe(true)
    expect(matchesTestForSource('src/auth/login.ts', 'src/auth/__tests__/login.spec.tsx')).toBe(true)
    expect(matchesTestForSource('src/main/java/com/acme/OrderService.java', 'src/test/java/com/acme/OrderServiceTest.java')).toBe(true)
    expect(matchesTestForSource('app/billing.py', 'tests/test_billing.py')).toBe(true)
    expect(matchesTestForSource('pkg/worker/pool.go', 'pkg/worker/pool_test.go')).toBe(true)
    expect(matchesTestForSource('pkg/worker/pool.go', 'pkg/other/pool_test.go')).toBe(false)
  })
})

describe('localTestsValidator', () => {
  it('verifies updated tests, existing repo tests, and flags changed source files missing any test file', async () => {
    const ctx = makeCtx(
      [
        { path: 'src/tested-here.ts' },
        { path: 'src/tested-here.test.ts' },
        { path: 'src/existing-test.ts' },
        { path: 'src/untested.ts' },
        { path: 'src/tiny.ts', additions: 2 },
      ],
      ['src/tested-here.ts', 'src/tested-here.test.ts', 'src/existing-test.ts', 'src/existing-test.test.ts', 'src/untested.ts'],
    )
    const out = await localTestsValidator.run(ctx, { now: () => 0 })
    expect(out.layers[0]).toMatchObject({ layer: 'TESTS', status: 'WARNING' })
    expect(out.layers[0]!.detail).toContain('3 source file(s) checked')
    expect(out.layers[0]!.detail).toContain('1 with updated tests in PR')
    expect(out.layers[0]!.detail).toContain('1 covered by existing repo test(s)')
    expect(out.findings).toHaveLength(1)
    expect(out.findings[0]).toMatchObject({ ruleId: 'tests/missing-unit-test', category: 'TESTS', location: { anchorKind: 'FILE', path: 'src/untested.ts' } })
  })

  it('does not fabricate missing-test warnings when the HEAD tree could not be listed', async () => {
    const ctx = makeCtx([{ path: 'src/service.ts' }], undefined)
    const out = await localTestsValidator.run(ctx, { now: () => 0 })
    expect(out.layers[0]).toMatchObject({ layer: 'TESTS', status: 'PASSED' })
    expect(out.layers[0]!.detail).toContain('HEAD file tree unavailable')
    expect(out.findings).toEqual([])
  })
})
