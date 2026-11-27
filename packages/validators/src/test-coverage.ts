import type { Finding, Validator } from '@pr-reviewer/core'
import { finding } from './util.js'

const SOURCE_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|java|kt|py|go)$/i
const TEST_FILE = /(^|\/)(__tests__|tests?|spec|e2e|fixtures?)\/|\.(test|spec)\.[a-z0-9]+$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$|Tests?\.java$|Spec\.(java|kt)$|IT\.java$|Test\.kt$/i
const IGNORED_SOURCE = /\.d\.ts$|(^|\/)(index|main|mod|types|constants|vite\.config|vitest\.config|jest\.config|eslint\.config|webpack\.config|rollup\.config)\.[a-z0-9]+$|\.config\.[a-z0-9]+$/i
const MIN_ADDED_LINES_FOR_TEST_CHECK = 5

const stripExt = (path: string): { dir: string; base: string; ext: string } => {
  const slash = path.lastIndexOf('/')
  const dir = slash >= 0 ? path.slice(0, slash) : ''
  const file = slash >= 0 ? path.slice(slash + 1) : path
  const dot = file.lastIndexOf('.')
  return { dir, base: dot >= 0 ? file.slice(0, dot) : file, ext: dot >= 0 ? file.slice(dot + 1).toLowerCase() : '' }
}

/** Checks if `candidatePath` is a plausible unit test file for `sourcePath`. */
export function matchesTestForSource(sourcePath: string, candidatePath: string): boolean {
  if (!TEST_FILE.test(candidatePath)) return false
  const src = stripExt(sourcePath)
  const cand = stripExt(candidatePath)
  const srcStem = src.base.toLowerCase()
  const candBase = cand.base.toLowerCase()

  if (src.ext === 'go') {
    return cand.dir === src.dir && candBase === `${srcStem}_test`
  }
  if (src.ext === 'py') {
    return candBase === `test_${srcStem}` || candBase === `${srcStem}_test`
  }
  if (src.ext === 'java' || src.ext === 'kt') {
    return candBase === `${srcStem}test` || candBase === `${srcStem}tests` || candBase === `${srcStem}it` || candBase === `${srcStem}spec`
  }
  // JS/TS: foo.test.ts, foo.spec.tsx, __tests__/foo.test.ts, tests/.../foo.ts (strip at most one test/spec suffix)
  const normalizedCand = candBase.replace(/(?:\.|-)(?:test|spec)$/, '')
  return normalizedCand === srcStem
}

/** Maps changed code files against existing and updated unit tests in the PR and repository HEAD. */
export const localTestsValidator: Validator = {
  id: 'tests.local',
  version: '1',
  layers: ['TESTS'],
  needsSandbox: false,
  baseline: true,
  hermetic: true,
  supports(ctx) {
    const candidates = ctx.pr.files.filter(
      (f) => f.status !== 'removed' && SOURCE_FILE.test(f.path) && !TEST_FILE.test(f.path) && !IGNORED_SOURCE.test(f.path) && f.additions >= MIN_ADDED_LINES_FOR_TEST_CHECK,
    )
    return candidates.length > 0
      ? { applicable: true }
      : { applicable: false, reason: 'NOT_SUPPORTED', detail: 'No non-trivial source files (5+ added lines) changed.' }
  },
  async run(ctx) {
    const sources = ctx.pr.files.filter(
      (f) => f.status !== 'removed' && SOURCE_FILE.test(f.path) && !TEST_FILE.test(f.path) && !IGNORED_SOURCE.test(f.path) && f.additions >= MIN_ADDED_LINES_FOR_TEST_CHECK,
    )
    const changedTests = ctx.pr.files.filter((f) => f.status !== 'removed' && TEST_FILE.test(f.path)).map((f) => f.path)
    const headList = await ctx.files.list('HEAD')
    const headPaths = headList ? headList.map((e) => e.path).filter((p) => TEST_FILE.test(p)) : undefined

    const findings: Finding[] = []
    let updatedInPr = 0
    let existingInRepo = 0
    let missingInRepo = 0
    let unverifiedNoTree = 0

    for (const s of sources) {
      if (changedTests.some((t) => matchesTestForSource(s.path, t))) {
        updatedInPr++
        continue
      }
      if (headPaths) {
        const match = headPaths.find((t) => matchesTestForSource(s.path, t))
        if (match) {
          existingInRepo++
          continue
        }
        missingInRepo++
        findings.push(
          finding({
            ruleId: 'tests/missing-unit-test',
            category: 'TESTS',
            severity: 'MINOR',
            confidence: 'MEDIUM',
            title: `No unit test file found for ${s.path}`,
            description: `${s.path} (+${s.additions} line(s)) has no matching unit test file in the repository HEAD tree or this PR.`,
            recommendation: 'Add a corresponding unit test file covering the added or modified behavior.',
            location: { anchorKind: 'FILE', path: s.path },
            provenance: { validator: 'tests.local', tool: 'test-mapper' },
          }),
        )
      } else {
        unverifiedNoTree++
      }
    }

    const parts = [
      `${sources.length} source file(s) checked`,
      updatedInPr ? `${updatedInPr} with updated tests in PR` : '',
      existingInRepo ? `${existingInRepo} covered by existing repo test(s) not edited here` : '',
      missingInRepo ? `${missingInRepo} without any matching unit test file` : '',
      unverifiedNoTree ? `${unverifiedNoTree} unchecked (HEAD file tree unavailable)` : '',
    ].filter(Boolean)

    return {
      layers: [
        {
          layer: 'TESTS',
          status: missingInRepo > 0 ? 'WARNING' : 'PASSED',
          detail: `${parts.join('; ')}.`,
        },
      ],
      findings,
    }
  },
}
