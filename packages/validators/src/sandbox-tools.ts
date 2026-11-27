// Repository tools run in the Sandbox (AD-5, AD-7, Story 4.6): install, tsc, ESLint, TSLint. These Validators only
// declare commands; the output is parsed here, on the host, as untrusted input.
import type { Finding, LayerOutcome, ProjectInfo, SandboxStep, SandboxStepResult, Validator, ValidatorContext } from '@pr-reviewer/core'
import { isStylisticRule } from './lint-style.js'
import { finding, joinPath, relTo } from './util.js'

const SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/
const MAX_FILES = 500
const INSTALL_TIMEOUT = 20 * 60_000
const ANALYZE_TIMEOUT = 10 * 60_000
/** Where the default ruleset's tools live in the Sandbox (scratch, never the repository). */
const TOOLS = '/scratch/tools'
/** Package managers installed through npm in the Sandbox (pinned, AD-21). */
const YARN = 'yarn@1.22.22'
/** Printed by the install step when it fell back from a frozen lockfile. */
const LOCKFILE_RELAXED = 'pr-reviewer: LOCKFILE_RELAXED the lockfile is out of date with package.json; installed without freezing it'
const PNPM = 'pnpm@9.15.9'

/**
 * Runs a binary from the nearest node_modules/.bin, walking up from the step's directory to the checkout root.
 * Product-written; used as `sh -c RUN_BIN run-bin <bin> <args...>`.
 */
const RUN_BIN =
  'bin="$1"; shift; d="$PWD"; while :; do if [ -x "$d/node_modules/.bin/$bin" ]; then exec "$d/node_modules/.bin/$bin" "$@"; fi; [ "$d" = "/work" ] || [ "$d" = "/" ] && break; d=$(dirname "$d"); done; echo "pr-reviewer: $bin is not installed in this project" >&2; exit 127'

/** Named default lint rulesets, used only when a repository has no lint config (AD-7). */
export const DEFAULT_RULESETS = {
  modern: {
    name: 'pr-reviewer default (ESLint 10 recommended + typescript-eslint 8 recommended)',
    packages: ['eslint@10.15.0', '@eslint/js@10.0.1', 'typescript-eslint@8.74.0', 'typescript@5.9.3'],
    configFile: `${TOOLS}/eslint.config.mjs`,
    config: `import js from '@eslint/js'
import tseslint from 'typescript-eslint'
const all = ['**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}']
export default [
  { files: all, ...js.configs.recommended },
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ['**/*.{ts,mts,cts,tsx}'] })),
  { files: all, languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } }, rules: { 'no-undef': 'off' } },
]
`,
    args: ['-c', `${TOOLS}/eslint.config.mjs`],
  },
  legacy: {
    name: 'pr-reviewer default (ESLint 8.57 recommended + @typescript-eslint 5.62 recommended)',
    packages: ['eslint@8.57.1', '@typescript-eslint/parser@5.62.0', '@typescript-eslint/eslint-plugin@5.62.0', 'typescript@4.9.5'],
    configFile: `${TOOLS}/eslintrc.json`,
    config: JSON.stringify({
      root: true,
      parser: '@typescript-eslint/parser',
      plugins: ['@typescript-eslint'],
      extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
      env: { browser: true, node: true, es2022: true },
      rules: { 'no-undef': 'off' },
    }),
    args: ['--no-eslintrc', '-c', `${TOOLS}/eslintrc.json`, '--resolve-plugins-relative-to', TOOLS],
  },
} as const

/** The Node major the Sandbox will use (matches the engine's choice: the project's request, else the newest). */
const sandboxNode = (ctx: ValidatorContext) => ctx.projects.find((p) => p.nodeMajor !== undefined)?.nodeMajor ?? 24
const ruleset = (ctx: ValidatorContext) => (sandboxNode(ctx) >= 20 ? DEFAULT_RULESETS.modern : DEFAULT_RULESETS.legacy)

/** Supported projects with changed source files: the ones Sandbox tools look at. */
function sourceProjects(ctx: ValidatorContext): Array<{ project: ProjectInfo; files: string[] }> {
  return ctx.projects.flatMap((project) => {
    if (project.support !== 'supported') return []
    const files = project.changedFiles.filter((f) => SOURCE.test(f) && ctx.pr.files.find((c) => c.path === f)?.status !== 'removed')
    return files.length ? [{ project, files: files.slice(0, MAX_FILES) }] : []
  })
}

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const key = (dir: string) => dir || '.'

/** One dependency install per lockfile directory, plus the default lint tools when a project has no lint config. */
export function installSteps(ctx: ValidatorContext): SandboxStep[] {
  const steps = new Map<string, SandboxStep>()
  for (const { project } of sourceProjects(ctx)) {
    const dir = project.lockfile ? dirOf(project.lockfile) : project.path
    if (steps.has(dir)) continue
    const lock = project.lockfile?.slice(project.lockfile.lastIndexOf('/') + 1)
    // Package scripts never run: compile and lint don't need them, and skipping them is safer and avoids native
    // builds. Yarn and pnpm are installed with npm (which honours the registry proxy), not Corepack (which does not).
    // A lockfile out of date with package.json fails a strict install; the review then retries once without freezing
    // it (still registry-only, nothing written back) and says so (LOCKFILE_RELAXED).
    const relaxed = (strict: string, loose: string) => `${strict} || { echo "${LOCKFILE_RELAXED}" >&2; ${loose}; }`
    const yarn = '/scratch/pm/node_modules/.bin/yarn install --ignore-scripts --non-interactive --network-timeout 600000'
    const pnpm = '/scratch/pm/node_modules/.bin/pnpm install --ignore-scripts'
    const cmd =
      project.packageManager === 'pnpm'
        ? ['sh', '-c', `npm install --prefix /scratch/pm ${PNPM} --no-audit --no-fund --loglevel=error && ${relaxed(`${pnpm} --frozen-lockfile`, `${pnpm} --no-frozen-lockfile`)}`]
        : project.packageManager === 'yarn'
          ? ['sh', '-c', `npm install --prefix /scratch/pm ${YARN} --no-audit --no-fund --loglevel=error && ${relaxed(`${yarn} --frozen-lockfile`, `${yarn} --pure-lockfile`)}`]
          : lock === 'package-lock.json' || lock === 'npm-shrinkwrap.json'
            ? ['sh', '-c', relaxed('npm ci --ignore-scripts --no-audit --no-fund --loglevel=error', 'npm install --ignore-scripts --no-audit --no-fund --no-save --loglevel=error')]
            : ['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', '--loglevel=error']
    steps.set(dir, { id: `install:${key(dir)}`, phase: 'INSTALL', cmd, cwd: dir, timeoutMs: INSTALL_TIMEOUT })
  }
  if (sourceProjects(ctx).some(({ project }) => !project.configs.eslint && !project.configs.tslint)) {
    const r = ruleset(ctx)
    const script = `mkdir -p ${TOOLS} && cd ${TOOLS} && npm init -y >/dev/null && npm install --no-audit --no-fund --loglevel=error ${r.packages.join(' ')} && cat > ${r.configFile} <<'PRR_EOF'\n${r.config}\nPRR_EOF`
    steps.set('\u0000tools', { id: 'install:tools', phase: 'INSTALL', cmd: ['sh', '-c', script], cwd: '', timeoutMs: INSTALL_TIMEOUT })
  }
  return [...steps.values()]
}

/** The install result covering a project, if its install failed (validators report it as ERROR). */
function installFailure(ctx: ValidatorContext, project: ProjectInfo): string | undefined {
  const dir = project.lockfile ? dirOf(project.lockfile) : project.path
  const r = ctx.sandbox.get(`install:${key(dir)}`)
  if (!r) return 'the dependency install did not run'
  if (r.skipped) return r.skipped
  if (r.timedOut) return 'the dependency install timed out'
  if (r.exitCode !== 0) return `the dependency install failed (exit ${r.exitCode}): ${tail(r.stderr || r.stdout)}`
  return undefined
}

/** A note when the project's install had to relax its out-of-date lockfile. */
function installNote(ctx: ValidatorContext, project: ProjectInfo): string {
  const dir = project.lockfile ? dirOf(project.lockfile) : project.path
  const r = ctx.sandbox.get(`install:${key(dir)}`)
  return r && r.stderr.includes('LOCKFILE_RELAXED') ? ' The lockfile is out of date with package.json, so dependencies were installed without freezing it; results may differ from a fresh install.' : ''
}

function tail(text: string, max = 300): string {
  const t = text.trim()
  return t.length > max ? `…${t.slice(-max)}` : t
}

/** POSIX path normalisation (resolves ./ and ../). */
function normalize(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

/** Turns a step result into a crash outcome, or undefined when the tool produced usable output. */
function stepProblem(r: SandboxStepResult | undefined, okCodes: readonly number[]): string | undefined {
  if (!r) return 'the step did not run'
  if (r.skipped) return r.skipped
  if (r.timedOut) return 'it timed out'
  if (r.exitCode === 127) return tail(r.stderr) || 'the tool is not installed'
  if (r.exitCode === null || !okCodes.includes(r.exitCode)) return `exit ${r.exitCode}: ${tail(r.stderr || r.stdout)}`
  return undefined
}

// ── tsc ─────────────────────────────────────────────────────────────────

function tsProjects(ctx: ValidatorContext) {
  return sourceProjects(ctx).filter(({ project }) => project.configs.tsconfig && (project.dependencies.includes('typescript') || project.typescript !== undefined))
}

export const tscValidator: Validator = {
  id: 'ts.tsc',
  version: '1',
  layers: ['COMPILE'],
  needsSandbox: true,
  baseline: false,
  hermetic: false,
  cacheable: true,
  supports(ctx) {
    return tsProjects(ctx).length
      ? { applicable: true }
      : { applicable: false, reason: 'NOT_SUPPORTED', detail: 'No changed TypeScript project with a tsconfig and a typescript dependency.' }
  },
  sandboxSteps: (ctx) =>
    tsProjects(ctx).map(({ project }) => ({
      id: `ts.tsc:${key(project.path)}`,
      phase: 'ANALYZE' as const,
      cmd: ['sh', '-c', RUN_BIN, 'run-bin', 'tsc', '--noEmit', '--pretty', 'false', '-p', relTo(project.path, project.configs.tsconfig!)],
      cwd: project.path,
      timeoutMs: ANALYZE_TIMEOUT,
    })),
  async run(ctx) {
    const layers: LayerOutcome[] = []
    const findings: Finding[] = []
    for (const { project } of tsProjects(ctx)) {
      const label = project.path || 'root'
      const broken = installFailure(ctx, project)
      if (broken) {
        layers.push({ layer: 'COMPILE', status: 'ERROR', reason: 'TOOL_CRASHED', detail: `${label}: not compiled because ${broken}` })
        continue
      }
      const r = ctx.sandbox.get(`ts.tsc:${key(project.path)}`)
      const problem = stepProblem(r, [0, 1, 2])
      if (problem) {
        layers.push({ layer: 'COMPILE', status: r?.timedOut ? 'TIMEOUT' : 'ERROR', reason: r?.timedOut ? 'TIME_LIMIT' : 'TOOL_CRASHED', detail: `${label}: tsc did not complete: ${problem}` })
        continue
      }
      const changed = new Set(project.changedFiles)
      let elsewhere = 0
      const errors = parseTsc(r!.stdout, project.path)
      for (const e of errors) {
        if (!changed.has(e.path)) {
          elsewhere++
          continue
        }
        findings.push(
          finding({
            ruleId: `tsc/${e.code}`,
            category: 'BUILD',
            severity: 'CRITICAL',
            confidence: 'HIGH',
            title: `${e.code}: ${e.message.split('\n')[0]}`,
            description: `The TypeScript compiler reports: ${e.message}`,
            recommendation: 'Fix the type error; the project does not compile with it.',
            location: { anchorKind: 'LINE', path: e.path, startLine: e.line, endLine: e.line },
            provenance: { validator: 'ts.tsc', tool: 'tsc' },
          }),
        )
      }
      const mine = errors.length - elsewhere
      layers.push({
        layer: 'COMPILE',
        status: mine > 0 ? 'FAILED' : 'PASSED',
        detail: `${label}: ${mine} error(s) in changed files${elsewhere ? `; ${elsewhere} more in unchanged files (pre-existing, not counted)` : ''}.${installNote(ctx, project)}`,
      })
    }
    return { layers, findings, tool: 'tsc' }
  },
}

/** Parses `tsc --pretty false` output into errors with repo-relative paths. */
export function parseTsc(stdout: string, projectDir: string): Array<{ path: string; line: number; code: string; message: string }> {
  const out: Array<{ path: string; line: number; code: string; message: string }> = []
  for (const line of stdout.split('\n')) {
    const m = /^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/.exec(line)
    if (m) out.push({ path: normalize(joinPath(projectDir, m[1]!)), line: Number(m[2]), code: m[3]!, message: m[4]! })
    else if (/^\s+\S/.test(line) && out.length) out[out.length - 1]!.message += `\n${line.trim()}`
  }
  return out
}

// ── ESLint ──────────────────────────────────────────────────────────────

/** ESLint runs where the repo uses ESLint, or (default ruleset) where it has no lint config at all. */
function eslintProjects(ctx: ValidatorContext): Array<{ project: ProjectInfo; files: string[]; mode: 'repo' | 'default' }> {
  return sourceProjects(ctx).flatMap(({ project, files }): Array<{ project: ProjectInfo; files: string[]; mode: 'repo' | 'default' }> => {
    if (project.configs.eslint) return [{ project, files, mode: 'repo' }]
    if (!project.configs.tslint) return [{ project, files, mode: 'default' }]
    return []
  })
}

export const eslintValidator: Validator = {
  id: 'lint.eslint',
  version: '1',
  layers: ['LINT'],
  needsSandbox: true,
  baseline: false,
  hermetic: false,
  cacheable: true,
  supports(ctx) {
    return eslintProjects(ctx).length ? { applicable: true } : { applicable: false, reason: 'SUPERSEDED_BY_VALIDATOR', detail: 'The changed projects use TSLint.' }
  },
  sandboxSteps(ctx) {
    const r = ruleset(ctx)
    return eslintProjects(ctx).map(({ project, files, mode }) => ({
      id: `lint.eslint:${key(project.path)}`,
      phase: 'ANALYZE' as const,
      cmd:
        mode === 'repo'
          ? ['sh', '-c', RUN_BIN, 'run-bin', 'eslint', '-f', 'json', '--no-error-on-unmatched-pattern', '--', ...files.map((f) => relTo(project.path, f))]
          : [`${TOOLS}/node_modules/.bin/eslint`, '-f', 'json', '--no-error-on-unmatched-pattern', ...r.args, '--', ...files.map((f) => relTo(project.path, f))],
      cwd: project.path,
      timeoutMs: ANALYZE_TIMEOUT,
    }))
  },
  async run(ctx) {
    const layers: LayerOutcome[] = []
    const findings: Finding[] = []
    const r = ruleset(ctx)
    for (const { project, mode } of eslintProjects(ctx)) {
      const label = project.path || 'root'
      const broken = installFailure(ctx, project) ?? (mode === 'default' ? toolsFailure(ctx) : undefined)
      if (broken) {
        layers.push({ layer: 'LINT', status: 'ERROR', reason: 'TOOL_CRASHED', detail: `${label}: ESLint not run because ${broken}` })
        continue
      }
      const res = ctx.sandbox.get(`lint.eslint:${key(project.path)}`)
      const problem = stepProblem(res, [0, 1])
      if (problem) {
        layers.push({ layer: 'LINT', status: res?.timedOut ? 'TIMEOUT' : 'ERROR', reason: res?.timedOut ? 'TIME_LIMIT' : 'TOOL_CRASHED', detail: `${label}: ESLint did not complete: ${problem}` })
        continue
      }
      let report: Array<{ filePath: string; messages: Array<{ ruleId: string | null; severity: number; message: string; line?: number; endLine?: number; fatal?: boolean }> }>
      try {
        report = JSON.parse(res!.stdout) as typeof report
        if (!Array.isArray(report)) throw new Error('not an array')
      } catch {
        layers.push({ layer: 'LINT', status: 'ERROR', reason: 'SANDBOX_OUTPUT_INVALID', detail: `${label}: ESLint output was not valid JSON.` })
        continue
      }
      let count = 0
      for (const file of report) {
        const path = normalize(file.filePath.replace(/^\/work\/?/, ''))
        for (const m of file.messages ?? []) {
          count++
          const line = m.line && m.line > 0 ? m.line : undefined
          findings.push(
            finding({
              ruleId: m.fatal || !m.ruleId ? 'eslint/parse-error' : `eslint/${m.ruleId}`,
              category: m.fatal ? 'BUILD' : 'STYLE',
              severity: m.severity === 2 && !(m.ruleId && isStylisticRule('eslint', m.ruleId)) ? 'MAJOR' : 'MINOR',
              confidence: 'HIGH',
              title: m.ruleId ? `${m.message} (${m.ruleId})` : m.message,
              description: `ESLint${mode === 'default' ? ` (${r.name})` : ''} reports: ${m.message}`,
              location: line ? { anchorKind: 'LINE', path, startLine: line, endLine: Math.max(line, m.endLine ?? line) } : { anchorKind: 'FILE', path },
              provenance: { validator: 'lint.eslint', tool: 'eslint' },
            }),
          )
        }
      }
      const via = mode === 'default' ? ` Ran with ${r.name}, because the repository has no ESLint or TSLint config; the repository was not modified.` : " Ran with the repository's own ESLint config."
      layers.push({ layer: 'LINT', status: count ? 'WARNING' : 'PASSED', detail: `${label}: ${count} problem(s) in changed files.${via}` })
    }
    return { layers, findings, tool: 'eslint' }
  },
}

function toolsFailure(ctx: ValidatorContext): string | undefined {
  const r = ctx.sandbox.get('install:tools')
  if (!r) return 'the default lint tools were not installed'
  if (r.timedOut || r.exitCode !== 0) return `the default lint tools could not be installed: ${tail(r.stderr || r.stdout)}`
  return undefined
}

// ── TSLint ──────────────────────────────────────────────────────────────

function tslintProjects(ctx: ValidatorContext) {
  return sourceProjects(ctx).flatMap(({ project, files }) => {
    const ts = files.filter((f) => /\.tsx?$/.test(f))
    return project.configs.tslint && ts.length ? [{ project, files: ts }] : []
  })
}

export const tslintValidator: Validator = {
  id: 'lint.tslint',
  version: '1',
  layers: ['LINT'],
  needsSandbox: true,
  baseline: false,
  hermetic: false,
  cacheable: true,
  supports(ctx) {
    return tslintProjects(ctx).length ? { applicable: true } : { applicable: false, reason: 'NOT_SUPPORTED', detail: 'No changed project uses TSLint.' }
  },
  sandboxSteps: (ctx) =>
    tslintProjects(ctx).map(({ project, files }) => ({
      id: `lint.tslint:${key(project.path)}`,
      phase: 'ANALYZE' as const,
      cmd: [
        'sh', '-c', RUN_BIN, 'run-bin', 'tslint', '--format', 'json', '-c', relTo(project.path, project.configs.tslint!),
        ...(project.configs.tsconfig ? ['-p', relTo(project.path, project.configs.tsconfig)] : []),
        '--',
        ...files.map((f) => relTo(project.path, f)),
      ],
      cwd: project.path,
      timeoutMs: ANALYZE_TIMEOUT,
    })),
  async run(ctx) {
    const layers: LayerOutcome[] = []
    const findings: Finding[] = []
    for (const { project } of tslintProjects(ctx)) {
      const label = project.path || 'root'
      const broken = installFailure(ctx, project)
      if (broken) {
        layers.push({ layer: 'LINT', status: 'ERROR', reason: 'TOOL_CRASHED', detail: `${label}: TSLint not run because ${broken}` })
        continue
      }
      const res = ctx.sandbox.get(`lint.tslint:${key(project.path)}`)
      // TSLint exits 2 when it finds problems, 1 on invalid usage.
      const problem = stepProblem(res, [0, 2])
      if (problem) {
        layers.push({ layer: 'LINT', status: res?.timedOut ? 'TIMEOUT' : 'ERROR', reason: res?.timedOut ? 'TIME_LIMIT' : 'TOOL_CRASHED', detail: `${label}: TSLint did not complete: ${problem}` })
        continue
      }
      let report: Array<{ name: string; ruleName: string; ruleSeverity?: string; failure: string; startPosition: { line: number }; endPosition?: { line: number } }>
      try {
        report = JSON.parse(res!.stdout.trim() || '[]') as typeof report
        if (!Array.isArray(report)) throw new Error('not an array')
      } catch {
        layers.push({ layer: 'LINT', status: 'ERROR', reason: 'SANDBOX_OUTPUT_INVALID', detail: `${label}: TSLint output was not valid JSON.` })
        continue
      }
      for (const m of report) {
        const path = normalize(m.name.startsWith('/work/') ? m.name.slice(6) : joinPath(project.path, m.name))
        const line = m.startPosition.line + 1
        findings.push(
          finding({
            ruleId: `tslint/${m.ruleName}`,
            category: 'STYLE',
            severity: (m.ruleSeverity ?? 'error').toLowerCase() === 'error' && !isStylisticRule('tslint', m.ruleName) ? 'MAJOR' : 'MINOR',
            confidence: 'HIGH',
            title: `${m.failure} (${m.ruleName})`,
            description: `TSLint reports: ${m.failure}`,
            location: { anchorKind: 'LINE', path, startLine: line, endLine: Math.max(line, (m.endPosition?.line ?? m.startPosition.line) + 1) },
            provenance: { validator: 'lint.tslint', tool: 'tslint' },
          }),
        )
      }
      layers.push({ layer: 'LINT', status: report.length ? 'WARNING' : 'PASSED', detail: `${label}: ${report.length} problem(s) in changed files, with the repository's own tslint.json.${installNote(ctx, project)}` })
    }
    return { layers, findings, tool: 'tslint' }
  },
}
