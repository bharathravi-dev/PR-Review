// Opt-in Sandbox unit test execution (AD-5, AD-7): runs Node/JS/TS tests and Go tests inside the locked-down Sandbox.
import type { Finding, LayerOutcome, ProjectInfo, SandboxStep, Validator, ValidatorContext } from '@pr-reviewer/core'
import { finding, joinPath, normalizePosix, stepProblem, tail } from './util.js'

const TEST_TIMEOUT = 10 * 60_000
const INSTALL_TIMEOUT = 20 * 60_000
const SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/
const key = (dir: string) => dir || '.'
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

export interface ParsedTestFailure {
  name: string
  path?: string | undefined
  line?: number | undefined
  detail: string
}

/** Parses common Vitest, Jest, Node test runner, and Mocha failure lines from stdout/stderr. */
export function parseNodeTestFailures(output: string, projectDir: string): ParsedTestFailure[] {
  const out: ParsedTestFailure[] = []
  const seen = new Set<string>()
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim()
    const vitestOrJest = /^(?:FAIL|×|✕|✖)\s+([^\s]+\.(?:test|spec)\.[a-z0-9]+)(?::(\d+))?(?::\d+)?(?:\s+>\s+(.+))?$/.exec(line)
    const stackLoc = /at\s+.*?\(?(\S+\.(?:test|spec)\.[a-z0-9]+):(\d+):\d+\)?/.exec(line)
    if (vitestOrJest) {
      const p = normalizePosix(joinPath(projectDir, vitestOrJest[1]!.replace(/^\/work\/?/, '')))
      const ln = vitestOrJest[2] ? Number(vitestOrJest[2]) : undefined
      const name = vitestOrJest[3]?.trim() || p
      const k = `${p}:${ln ?? 0}:${name}`
      if (!seen.has(k)) {
        seen.add(k)
        out.push({ name, path: p, ...(ln ? { line: ln } : {}), detail: line })
      }
    } else if (stackLoc && out.length > 0 && out[out.length - 1]!.line === undefined) {
      const prev = out[out.length - 1]!
      prev.line = Number(stackLoc[2])
    }
  }
  return out
}

/** Parses `go test ./...` failure blocks into structured file/line failures. */
export function parseGoTestFailures(output: string, projectDir: string): ParsedTestFailure[] {
  const out: ParsedTestFailure[] = []
  const seen = new Set<string>()
  let activeTest: string | undefined
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim()
    const testFail = /^---\s+FAIL:\s+(\S+)/.exec(line)
    if (testFail) {
      activeTest = testFail[1]!
      continue
    }
    const loc = /^(\S+_test\.go):(\d+):\s*(.+)$/.exec(line)
    if (loc) {
      const p = normalizePosix(joinPath(projectDir, loc[1]!.replace(/^\/work\/?/, '')))
      const ln = Number(loc[2])
      const k = `${p}:${ln}:${loc[3]}`
      if (!seen.has(k)) {
        seen.add(k)
        out.push({ name: activeTest ?? p, path: p, line: ln, detail: loc[3]!.trim() })
      }
    }
  }
  return out
}

function nodeProjects(ctx: ValidatorContext): ProjectInfo[] {
  return ctx.projects.filter(
    (p) =>
      p.support === 'supported' &&
      (p.language === 'TypeScript' || p.language === 'JavaScript') &&
      p.changedFiles.some((f) => SOURCE.test(f) && ctx.pr.files.find((c) => c.path === f)?.status !== 'removed'),
  )
}

function nodeTestCommand(pm: string | undefined): string[] {
  if (pm === 'pnpm') return ['sh', '-c', 'CI=true pnpm test']
  if (pm === 'yarn') return ['sh', '-c', 'CI=true yarn test']
  return ['sh', '-c', 'CI=true npm test --if-present']
}

/** Opt-in sandboxed test suite runner for Node/TS/JS projects (`validators.enable: ['tests.sandbox']`). */
export const sandboxTestsValidator: Validator = {
  id: 'tests.sandbox',
  version: '1',
  layers: ['TESTS'],
  needsSandbox: true,
  optional: true,
  baseline: false,
  hermetic: false,
  cacheable: true,
  supports: (ctx) =>
    nodeProjects(ctx).length > 0
      ? { applicable: true }
      : { applicable: false, reason: 'NOT_SUPPORTED', detail: 'No changed Node/TypeScript project with package.json.' },
  sandboxSteps(ctx) {
    return nodeProjects(ctx).map((project) => ({
      id: `tests.sandbox:run:${key(project.path)}`,
      phase: 'ANALYZE',
      cmd: nodeTestCommand(project.packageManager),
      cwd: project.path,
      timeoutMs: TEST_TIMEOUT,
    }))
  },
  async run(ctx) {
    const layers: LayerOutcome[] = []
    const findings: Finding[] = []
    for (const project of nodeProjects(ctx)) {
      const k = key(project.path)
      const label = project.path || 'root'
      const installDir = project.lockfile ? dirOf(project.lockfile) : project.path
      const inst = ctx.sandbox.get(`install:${key(installDir)}`)
      if (!inst || inst.skipped || inst.timedOut || inst.exitCode !== 0) {
        layers.push({ layer: 'TESTS', status: 'SKIPPED', reason: 'TOOL_CRASHED', detail: `${label}: dependency install did not succeed before tests.` })
        continue
      }
      const r = ctx.sandbox.get(`tests.sandbox:run:${k}`)
      const problem = stepProblem(r, [0, 1])
      if (problem) {
        layers.push({ layer: 'TESTS', status: r?.timedOut ? 'TIMEOUT' : 'ERROR', reason: r?.timedOut ? 'TIME_LIMIT' : 'TOOL_CRASHED', detail: `${label}: unit tests did not complete: ${problem}` })
        continue
      }
      const combined = `${r!.stdout}\n${r!.stderr}`
      if (/no test specified/i.test(combined)) {
        layers.push({ layer: 'TESTS', status: 'NOT_APPLICABLE', reason: 'NOT_SUPPORTED', detail: `${label}: placeholder test script only.` })
        continue
      }
      const failures = parseNodeTestFailures(combined, project.path)
      const prPaths = new Set(ctx.pr.files.filter((f) => f.status !== 'removed').map((f) => f.path))
      for (const f of failures) {
        const anchoredPath = f.path && prPaths.has(f.path) ? f.path : project.changedFiles[0]
        findings.push(
          finding({
            ruleId: 'tests/unit-test-failed',
            category: 'TESTS',
            severity: 'CRITICAL',
            confidence: 'HIGH',
            title: `Unit test failed: ${f.name}`,
            description: f.detail,
            recommendation: 'Fix the regression or update the failing unit test.',
            location:
              anchoredPath && f.path === anchoredPath && f.line
                ? { anchorKind: 'LINE', path: anchoredPath, startLine: f.line, endLine: f.line }
                : anchoredPath
                  ? { anchorKind: 'FILE', path: anchoredPath }
                  : { anchorKind: 'PR' },
            provenance: { validator: 'tests.sandbox', tool: project.packageManager ?? 'npm' },
          }),
        )
      }
      if (r!.exitCode !== 0 && failures.length === 0) {
        findings.push(
          finding({
            ruleId: 'tests/unit-test-failed',
            category: 'TESTS',
            severity: 'CRITICAL',
            confidence: 'HIGH',
            title: `${label}: test command exited with code ${r!.exitCode}`,
            description: tail(r!.stderr || r!.stdout) || 'Test runner exited non-zero.',
            recommendation: 'Inspect failing test output and fix the test failure.',
            location: project.changedFiles[0] ? { anchorKind: 'FILE', path: project.changedFiles[0] } : { anchorKind: 'PR' },
            provenance: { validator: 'tests.sandbox', tool: project.packageManager ?? 'npm' },
          }),
        )
      }
      layers.push({
        layer: 'TESTS',
        status: r!.exitCode === 0 ? 'PASSED' : 'FAILED',
        detail: r!.exitCode === 0 ? `${label}: sandbox unit tests passed.` : `${label}: unit tests failed (exit ${r!.exitCode}${failures.length ? `, ${failures.length} failure(s)` : ''}).`,
      })
    }
    return { layers, findings }
  },
}

function goTestProjects(ctx: ValidatorContext): ProjectInfo[] {
  return ctx.projects.filter(
    (p) => p.support === 'supported' && p.language === 'Go' && p.configs.gomod && p.changedFiles.some((f) => /\.go$/.test(f)),
  )
}

/** Opt-in sandboxed `go test ./...` runner (`validators.enable: ['tests.go']`). */
export const goTestsValidator: Validator = {
  id: 'tests.go',
  version: '1',
  layers: ['TESTS'],
  needsSandbox: true,
  optional: true,
  runtime: 'go',
  baseline: false,
  hermetic: false,
  cacheable: true,
  supports: (ctx) =>
    goTestProjects(ctx).length > 0 ? { applicable: true } : { applicable: false, reason: 'NOT_SUPPORTED', detail: 'No changed Go module files.' },
  sandboxSteps(ctx) {
    const steps: SandboxStep[] = []
    for (const project of goTestProjects(ctx)) {
      const k = key(project.path)
      steps.push(
        { id: `tests.go:install:${k}`, phase: 'INSTALL', cmd: ['go', 'mod', 'download'], cwd: project.path, timeoutMs: INSTALL_TIMEOUT },
        { id: `tests.go:run:${k}`, phase: 'ANALYZE', cmd: ['go', 'test', './...'], cwd: project.path, timeoutMs: TEST_TIMEOUT },
      )
    }
    return steps
  },
  async run(ctx) {
    const layers: LayerOutcome[] = []
    const findings: Finding[] = []
    for (const project of goTestProjects(ctx)) {
      const k = key(project.path)
      const label = project.path || 'root'
      const r = ctx.sandbox.get(`tests.go:run:${k}`)
      const problem = stepProblem(r, [0, 1])
      if (problem) {
        layers.push({ layer: 'TESTS', status: r?.timedOut ? 'TIMEOUT' : 'ERROR', reason: r?.timedOut ? 'TIME_LIMIT' : 'TOOL_CRASHED', detail: `${label}: go test did not complete: ${problem}` })
        continue
      }
      const failures = parseGoTestFailures(`${r!.stdout}\n${r!.stderr}`, project.path)
      const prPaths = new Set(ctx.pr.files.filter((f) => f.status !== 'removed').map((f) => f.path))
      for (const f of failures) {
        findings.push(
          finding({
            ruleId: 'tests/go-test-failed',
            category: 'TESTS',
            severity: 'CRITICAL',
            confidence: 'HIGH',
            title: `Go test failed: ${f.name}`,
            description: f.detail,
            recommendation: 'Fix the failing Go test.',
            location: f.path && prPaths.has(f.path) && f.line ? { anchorKind: 'LINE', path: f.path, startLine: f.line, endLine: f.line } : { anchorKind: 'PR' },
            provenance: { validator: 'tests.go', tool: 'go test' },
          }),
        )
      }
      layers.push({
        layer: 'TESTS',
        status: r!.exitCode === 0 ? 'PASSED' : 'FAILED',
        detail: r!.exitCode === 0 ? `${label}: go test ./... passed.` : `${label}: go test ./... failed.`,
      })
    }
    return { layers, findings }
  },
}
