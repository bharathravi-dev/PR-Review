// Multi-language Sandbox/host-fallback Validators (runtime: java, python, go):
// run real compiler and linter checks in isolated per-runtime sessions and parse diagnostics into Findings.
import type { Finding, LayerOutcome, ProjectInfo, SandboxStep, Validator, ValidatorContext } from '@pr-reviewer/core'
import { isStylisticRule } from './lint-style.js'
import { finding, joinPath, normalizePosix, relTo, stepProblem, tail } from './util.js'

const INSTALL_TIMEOUT = 20 * 60_000
const ANALYZE_TIMEOUT = 10 * 60_000
const PY_TOOLS = '/scratch/pytools'
const RUFF_PKG = 'ruff==0.8.6'
const MAX_FILES = 500
const key = (dir: string) => dir || '.'

function langProjects(ctx: ValidatorContext, languages: readonly string[], ext: RegExp): Array<{ project: ProjectInfo; files: string[] }> {
  return ctx.projects.flatMap((project) => {
    if (project.support !== 'supported' || !languages.includes(project.language)) return []
    const files = project.changedFiles.filter((f) => ext.test(f) && ctx.pr.files.find((c) => c.path === f)?.status !== 'removed')
    return files.length ? [{ project, files: files.slice(0, MAX_FILES) }] : []
  })
}

function stripWorkPrefix(rawPath: string, projectDir: string): string {
  const cleaned = rawPath.replace(/^file:\/\//, '').replace(/^\/work\/?/, '')
  if (!rawPath.startsWith('/work/') && !rawPath.startsWith('file:///work/')) {
    return normalizePosix(joinPath(projectDir, cleaned))
  }
  return normalizePosix(cleaned)
}

// ── Java / Kotlin (Maven & Gradle) ─────────────────────────────────────────

export interface ParsedCompilerError {
  path: string
  line: number
  message: string
}

/** Parses Maven (`[ERROR] path:[line,col] msg`), javac (`path:line: error: msg`), and kotlinc (`e: path:line:col msg`) errors. */
export function parseJavaBuildOutput(output: string, projectDir: string): ParsedCompilerError[] {
  const out: ParsedCompilerError[] = []
  const seen = new Set<string>()
  for (const raw of output.split(/\r?\n/)) {
    const lineText = raw.trim()
    const maven = /^\[ERROR\]\s+(.+?\.(?:java|kt)):\[(\d+),\d+\]\s*(.+)$/.exec(lineText)
    const kotlin = /^e:\s+(?:file:\/\/)?(.+?\.kt):(\d+):\d+\s*(.+)$/.exec(lineText)
    const javac = /^(?!\[ERROR\])(.+?\.(?:java|kt)):(\d+):(?:\d+:)?\s*error:\s*(.+)$/.exec(lineText)
    const m = maven ?? kotlin ?? javac
    if (!m) continue
    const path = stripWorkPrefix(m[1]!, projectDir)
    const line = Number(m[2])
    const message = m[3]!.trim()
    const dedupeKey = `${path}:${line}:${message}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    out.push({ path, line, message })
  }
  return out
}

function javaProjects(ctx: ValidatorContext) {
  return langProjects(ctx, ['Java', 'Kotlin'], /\.(java|kt)$/).filter(({ project }) => project.configs.maven || (project.configs.gradle && project.configs.gradleWrapper))
}

export const javaCompileValidator: Validator = {
  id: 'java.compile',
  version: '1',
  layers: ['COMPILE'],
  needsSandbox: true,
  runtime: 'java',
  baseline: false,
  hermetic: false,
  cacheable: true,
  supports(ctx) {
    return javaProjects(ctx).length
      ? { applicable: true }
      : { applicable: false, reason: 'NOT_SUPPORTED', detail: 'No changed Java/Kotlin Maven or Gradle-wrapper project.' }
  },
  sandboxSteps(ctx) {
    const steps: SandboxStep[] = []
    for (const { project } of javaProjects(ctx)) {
      const k = key(project.path)
      if (project.configs.maven) {
        steps.push(
          { id: `java.compile:install:${k}`, phase: 'INSTALL', cmd: ['mvn', '-B', '-ntp', 'dependency:go-offline', '-DskipTests'], cwd: project.path, timeoutMs: INSTALL_TIMEOUT },
          { id: `java.compile:analyze:${k}`, phase: 'ANALYZE', cmd: ['mvn', '-B', '-ntp', '-o', 'test-compile'], cwd: project.path, timeoutMs: ANALYZE_TIMEOUT },
        )
      } else if (project.configs.gradleWrapper) {
        const gw = relTo(project.path, project.configs.gradleWrapper)
        steps.push(
          { id: `java.compile:install:${k}`, phase: 'INSTALL', cmd: ['sh', gw, '--no-daemon', 'testClasses', '--dry-run'], cwd: project.path, timeoutMs: INSTALL_TIMEOUT },
          { id: `java.compile:analyze:${k}`, phase: 'ANALYZE', cmd: ['sh', gw, '--no-daemon', '--offline', 'testClasses'], cwd: project.path, timeoutMs: ANALYZE_TIMEOUT },
        )
      }
    }
    return steps
  },
  async run(ctx) {
    const layers: LayerOutcome[] = []
    const findings: Finding[] = []
    for (const { project } of javaProjects(ctx)) {
      const k = key(project.path)
      const label = project.path || 'root'
      const inst = ctx.sandbox.get(`java.compile:install:${k}`)
      if (!inst || inst.skipped || inst.timedOut || inst.exitCode !== 0) {
        const why = !inst ? 'dependency resolve did not run' : inst.skipped ?? (inst.timedOut ? 'dependency resolve timed out' : `exit ${inst.exitCode}: ${tail(inst.stderr || inst.stdout)}`)
        layers.push({ layer: 'COMPILE', status: 'ERROR', reason: inst?.timedOut ? 'TIME_LIMIT' : 'TOOL_CRASHED', detail: `${label}: Java/Kotlin dependencies could not be resolved: ${why}` })
        continue
      }
      const r = ctx.sandbox.get(`java.compile:analyze:${k}`)
      const problem = stepProblem(r, [0, 1])
      if (problem) {
        layers.push({ layer: 'COMPILE', status: r?.timedOut ? 'TIMEOUT' : 'ERROR', reason: r?.timedOut ? 'TIME_LIMIT' : 'TOOL_CRASHED', detail: `${label}: compile did not complete: ${problem}` })
        continue
      }
      const changed = new Set(project.changedFiles)
      const combined = `${r!.stdout}\n${r!.stderr}`
      const errors = parseJavaBuildOutput(combined, project.path)
      let elsewhere = 0
      for (const e of errors) {
        if (!changed.has(e.path)) {
          elsewhere++
          continue
        }
        findings.push(
          finding({
            ruleId: 'java/compile-error',
            category: 'BUILD',
            severity: 'CRITICAL',
            confidence: 'HIGH',
            title: e.message.slice(0, 120),
            description: `Compiler reports: ${e.message}`,
            recommendation: 'Fix the compilation error so the main and test sources build cleanly.',
            location: { anchorKind: 'LINE', path: e.path, startLine: e.line, endLine: e.line },
            provenance: { validator: 'java.compile', tool: project.configs.maven ? 'maven' : 'gradle' },
          }),
        )
      }
      const mine = errors.length - elsewhere
      if (r!.exitCode !== 0 && errors.length === 0) {
        layers.push({ layer: 'COMPILE', status: 'FAILED', detail: `${label}: build failed: ${tail(r!.stderr || r!.stdout)}` })
        continue
      }
      layers.push({
        layer: 'COMPILE',
        status: mine > 0 ? 'FAILED' : 'PASSED',
        detail: `${label}: ${mine} compile error(s) in changed files${elsewhere ? ` (${elsewhere} in unchanged files)` : ''}.`,
      })
    }
    return { layers, findings }
  },
}

// ── Python (Ruff compile/syntax + lint) ────────────────────────────────────

interface RuffDiagnostic {
  filename: string
  code: string | null
  message: string
  location?: { row?: number } | undefined
  end_location?: { row?: number } | undefined
}

export function parseRuffOutput(stdout: string, projectDir: string): RuffDiagnostic[] {
  const parsed = JSON.parse(stdout.trim() || '[]') as unknown
  if (!Array.isArray(parsed)) throw new Error('Ruff output is not an array')
  return (parsed as RuffDiagnostic[]).map((d) => ({ ...d, filename: stripWorkPrefix(d.filename, projectDir) }))
}

function pyProjects(ctx: ValidatorContext) {
  return langProjects(ctx, ['Python'], /\.py$/)
}

export const pythonValidator: Validator = {
  id: 'python.lint',
  version: '1',
  layers: ['LINT'],
  needsSandbox: true,
  runtime: 'python',
  baseline: false,
  hermetic: false,
  cacheable: true,
  supports(ctx) {
    return pyProjects(ctx).length ? { applicable: true } : { applicable: false, reason: 'NOT_SUPPORTED', detail: 'No changed Python project files.' }
  },
  sandboxSteps(ctx) {
    const projects = pyProjects(ctx)
    const steps: SandboxStep[] = [
      { id: 'python.lint:install', phase: 'INSTALL', cmd: ['pip', 'install', '--quiet', '--target', PY_TOOLS, RUFF_PKG], cwd: '', timeoutMs: INSTALL_TIMEOUT },
    ]
    for (const { project, files } of projects) {
      steps.push({
        id: `python.lint:analyze:${key(project.path)}`,
        phase: 'ANALYZE',
        cmd: [`${PY_TOOLS}/bin/ruff`, 'check', '--output-format', 'json', '--no-fix', '--', ...files.map((f) => relTo(project.path, f))],
        cwd: project.path,
        timeoutMs: ANALYZE_TIMEOUT,
      })
    }
    return steps
  },
  async run(ctx) {
    const inst = ctx.sandbox.get('python.lint:install')
    const layers: LayerOutcome[] = []
    const findings: Finding[] = []
    if (!inst || inst.skipped || inst.timedOut || inst.exitCode !== 0) {
      const why = !inst ? 'ruff install did not run' : inst.skipped ?? (inst.timedOut ? 'ruff install timed out' : `exit ${inst.exitCode}: ${tail(inst.stderr || inst.stdout)}`)
      return { layers: [{ layer: 'LINT', status: 'ERROR', reason: inst?.timedOut ? 'TIME_LIMIT' : 'TOOL_CRASHED', detail: `Python Ruff not run because ${why}` }], findings }
    }
    for (const { project } of pyProjects(ctx)) {
      const label = project.path || 'root'
      const r = ctx.sandbox.get(`python.lint:analyze:${key(project.path)}`)
      const problem = stepProblem(r, [0, 1])
      if (problem) {
        layers.push({ layer: 'LINT', status: r?.timedOut ? 'TIMEOUT' : 'ERROR', reason: r?.timedOut ? 'TIME_LIMIT' : 'TOOL_CRASHED', detail: `${label}: Ruff did not complete: ${problem}` })
        continue
      }
      let diagnostics: RuffDiagnostic[]
      try {
        diagnostics = parseRuffOutput(r!.stdout, project.path)
      } catch {
        layers.push({ layer: 'LINT', status: 'ERROR', reason: 'SANDBOX_OUTPUT_INVALID', detail: `${label}: Ruff output was not valid JSON.` })
        continue
      }
      for (const d of diagnostics) {
        const isSyntax = d.code === null || d.code === 'E999'
        const isStyle = d.code !== null && (d.code.startsWith('I') || d.code.startsWith('W') || isStylisticRule('eslint', d.code))
        const line = d.location?.row && d.location.row > 0 ? d.location.row : undefined
        findings.push(
          finding({
            ruleId: isSyntax ? 'python/syntax-error' : `ruff/${d.code}`,
            category: isSyntax ? 'BUILD' : isStyle ? 'STYLE' : 'CORRECTNESS',
            severity: isSyntax ? 'CRITICAL' : isStyle ? 'MINOR' : 'MAJOR',
            confidence: 'HIGH',
            title: d.code ? `${d.message} (${d.code})` : d.message,
            description: `Ruff reports: ${d.message}`,
            location: line ? { anchorKind: 'LINE', path: d.filename, startLine: line, endLine: Math.max(line, d.end_location?.row ?? line) } : { anchorKind: 'FILE', path: d.filename },
            provenance: { validator: 'python.lint', tool: 'ruff' },
          }),
        )
      }
      layers.push({
        layer: 'LINT',
        status: diagnostics.length > 0 ? 'WARNING' : 'PASSED',
        detail: `${label}: ${diagnostics.length} problem(s) in changed Python files (Ruff).`,
      })
    }
    return { layers, findings }
  },
}

// ── Go (`go vet ./...`) ────────────────────────────────────────────────────

export function parseGoVetOutput(output: string, projectDir: string): ParsedCompilerError[] {
  const out: ParsedCompilerError[] = []
  const seen = new Set<string>()
  for (const raw of output.split(/\r?\n/)) {
    const m = /^(\S+\.go):(\d+):(?:\d+:)?\s*(.+)$/.exec(raw.trim())
    if (!m) continue
    const path = stripWorkPrefix(m[1]!, projectDir)
    const line = Number(m[2])
    const message = m[3]!.trim()
    const k = `${path}:${line}:${message}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ path, line, message })
  }
  return out
}

function goProjects(ctx: ValidatorContext) {
  return langProjects(ctx, ['Go'], /\.go$/).filter(({ project }) => project.configs.gomod)
}

export const goVetValidator: Validator = {
  id: 'go.vet',
  version: '1',
  layers: ['COMPILE'],
  needsSandbox: true,
  runtime: 'go',
  baseline: false,
  hermetic: false,
  cacheable: true,
  supports(ctx) {
    return goProjects(ctx).length ? { applicable: true } : { applicable: false, reason: 'NOT_SUPPORTED', detail: 'No changed Go module files.' }
  },
  sandboxSteps(ctx) {
    const steps: SandboxStep[] = []
    for (const { project } of goProjects(ctx)) {
      const k = key(project.path)
      steps.push(
        { id: `go.vet:install:${k}`, phase: 'INSTALL', cmd: ['go', 'mod', 'download'], cwd: project.path, timeoutMs: INSTALL_TIMEOUT },
        { id: `go.vet:analyze:${k}`, phase: 'ANALYZE', cmd: ['go', 'vet', './...'], cwd: project.path, timeoutMs: ANALYZE_TIMEOUT },
      )
    }
    return steps
  },
  async run(ctx) {
    const layers: LayerOutcome[] = []
    const findings: Finding[] = []
    for (const { project } of goProjects(ctx)) {
      const k = key(project.path)
      const label = project.path || 'root'
      const inst = ctx.sandbox.get(`go.vet:install:${k}`)
      if (!inst || inst.skipped || inst.timedOut || inst.exitCode !== 0) {
        const why = !inst ? 'go mod download did not run' : inst.skipped ?? (inst.timedOut ? 'go mod download timed out' : `exit ${inst.exitCode}: ${tail(inst.stderr || inst.stdout)}`)
        layers.push({ layer: 'COMPILE', status: 'ERROR', reason: inst?.timedOut ? 'TIME_LIMIT' : 'TOOL_CRASHED', detail: `${label}: Go dependencies failed: ${why}` })
        continue
      }
      const r = ctx.sandbox.get(`go.vet:analyze:${k}`)
      const problem = stepProblem(r, [0, 1, 2])
      if (problem) {
        layers.push({ layer: 'COMPILE', status: r?.timedOut ? 'TIMEOUT' : 'ERROR', reason: r?.timedOut ? 'TIME_LIMIT' : 'TOOL_CRASHED', detail: `${label}: go vet did not complete: ${problem}` })
        continue
      }
      const changed = new Set(project.changedFiles)
      const issues = parseGoVetOutput(`${r!.stdout}\n${r!.stderr}`, project.path)
      let elsewhere = 0
      for (const e of issues) {
        if (!changed.has(e.path)) {
          elsewhere++
          continue
        }
        findings.push(
          finding({
            ruleId: 'go/vet',
            category: 'CORRECTNESS',
            severity: 'CRITICAL',
            confidence: 'HIGH',
            title: e.message.slice(0, 120),
            description: `go vet reports: ${e.message}`,
            recommendation: 'Fix the compiler or go vet issue.',
            location: { anchorKind: 'LINE', path: e.path, startLine: e.line, endLine: e.line },
            provenance: { validator: 'go.vet', tool: 'go vet' },
          }),
        )
      }
      const mine = issues.length - elsewhere
      layers.push({
        layer: 'COMPILE',
        status: mine > 0 ? 'FAILED' : r!.exitCode !== 0 && issues.length === 0 ? 'FAILED' : 'PASSED',
        detail: `${label}: ${mine} issue(s) in changed files via go vet${elsewhere ? ` (${elsewhere} in unchanged files)` : ''}.`,
      })
    }
    return { layers, findings }
  },
}
