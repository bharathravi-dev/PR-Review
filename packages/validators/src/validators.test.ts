import type { ChangedFile, FileAccessor, PrContext, ProjectInfo, SandboxStepResult, ValidatorContext } from '@pr-reviewer/core'
import { describe, expect, it } from 'vitest'
import { ciResultsValidator, layerForCheck } from './ci.js'
import { configChangesValidator } from './config-changes.js'
import { dependencyAuditValidator, lockedPackages } from './dependencies.js'
import { angularValidator, reactValidator } from './framework.js'
import { DEFAULT_RULESETS, eslintValidator, installSteps, parseTsc, tscValidator, tslintValidator } from './sandbox-tools.js'

/** A changed file whose whole head text is new (every line added). */
function added(path: string, text: string, extra: Partial<ChangedFile> = {}): ChangedFile {
  const lines = text.split('\n')
  return { path, status: 'added', additions: lines.length, deletions: 0, binary: false, patchTruncated: false, patch: `@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join('\n')}`, head: { text }, ...extra }
}

function project(over: Partial<ProjectInfo> = {}): ProjectInfo {
  return { path: '', language: 'TypeScript', support: 'supported', frameworks: [], packageManager: 'npm', lockfile: 'package-lock.json', configs: { tsconfig: 'tsconfig.json' }, dependencies: ['typescript'], changedFiles: [], ...over }
}

const NO_FILES: FileAccessor = { list: async () => [], treeSha: async () => 't', read: async () => undefined, notes: () => [] }

function ctx(files: ChangedFile[], projects: ProjectInfo[], over: Partial<ValidatorContext> = {}): ValidatorContext {
  const pr = { schemaVersion: 1, ref: { host: 'github.com', owner: 'o', repo: 'r', number: 1 }, title: 't', body: '', author: 'a', state: 'open', draft: false, baseRef: 'main', headRef: 'f', baseSha: 'b', headSha: 'h', mergeBaseSha: 'm', fromFork: false, files, reviews: [], reviewComments: [], issueComments: [], truncated: [] } as PrContext
  return { pr, files: NO_FILES, projects: projects.map((p) => ({ ...p, changedFiles: p.changedFiles.length ? p.changedFiles : files.map((f) => f.path) })), checks: [], repoSettings: {}, sandbox: new Map(), ...over }
}
const ports = { now: () => 0 }
const angular = (version: string) => ({ name: 'Angular', checks: true, version, declared: `~${version}`, confidence: 'HIGH' as const, evidence: [] })
const react = (version: string) => ({ name: 'React', checks: true, version, declared: `^${version}`, confidence: 'HIGH' as const, evidence: [] })

describe('Angular checks (Story 4.7)', () => {
  const template = '<li *ngFor="let u of users">{{ fullName(u) }} {{ u.created | date:\'short\' }}</li>\n<button (click)="save()">Save</button>'
  const component = "export class UsersComponent {\n  ngOnInit() {\n    this.store.users$.subscribe((u) => (this.users = u))\n    this.http.get('/x').subscribe()\n  }\n}"

  it('reports template calls, *ngFor without trackBy, and unmanaged subscriptions with version-appropriate advice', async () => {
    const c = ctx([added('src/app/users.component.html', template), added('src/app/users.component.ts', component)], [project({ frameworks: [angular('12.2.16')] })])
    const r = await angularValidator.run(c, ports)
    expect(r.findings.map((f) => [f.ruleId, f.location.startLine])).toEqual([
      ['angular/template-call', 1],
      ['angular/ngfor-trackby', 1],
      ['angular/unmanaged-subscription', 3],
    ])
    expect(r.findings[0]!.title).toBe('Function call in a template binding: fullName()')
    // Angular 12 must not be told about @for (17+) or takeUntilDestroyed (16+).
    expect(r.findings[1]!.recommendation).not.toContain('@for')
    expect(r.findings[2]!.recommendation).not.toContain('takeUntilDestroyed')
    expect(r.layers).toEqual([{ layer: 'FRAMEWORK', status: 'WARNING', detail: 'Angular checks on 2 changed file(s).' }])
  })

  it('uses newer guidance for newer Angular and softens template calls that may be signals', async () => {
    const c = ctx([added('a.component.html', template), added('a.component.ts', component)], [project({ frameworks: [angular('17.3.0')] })])
    const r = await angularValidator.run(c, ports)
    expect(r.findings[0]).toMatchObject({ severity: 'INFO', confidence: 'LOW' })
    expect(r.findings[1]!.recommendation).toContain('@for (item of items; track item.id)')
    expect(r.findings[2]!.recommendation).toContain('takeUntilDestroyed()')
  })

  it('is not applicable below Angular 12 or without Angular', () => {
    expect(angularValidator.supports(ctx([], [project({ frameworks: [angular('11.2.0')] })]))).toMatchObject({ applicable: false, detail: expect.stringContaining('unsupported version') })
    expect(angularValidator.supports(ctx([], [project()]))).toMatchObject({ applicable: false })
  })

  it('accepts files that manage their subscriptions', async () => {
    const managed = component.replace('.subscribe((u)', '.pipe(takeUntil(this.destroy$)).subscribe((u)')
    const r = await angularValidator.run(ctx([added('a.component.ts', managed)], [project({ frameworks: [angular('12.0.0')] })]), ports)
    expect(r.findings).toEqual([])
  })
})

describe('React checks (Story 4.7)', () => {
  const code = `import { memo, useState, useEffect } from 'react'
export function List({ items, show }) {
  if (show) {
    const [x] = useState(0)
  }
  for (const i of items) useEffect(() => {})
  useEffect(() => { const [y] = useState(1) })
  return <ul>{items.map((i) => <li>{i.name}</li>)}{items.map((i) => <li key={i.id}>{i.name}</li>)}</ul>
}
export const Row = memo(function Row() { const [z] = useState(0); return <div>{z}</div> })`

  it('reports hooks in conditions, loops, and callbacks, and list items without keys', async () => {
    const r = await reactValidator.run(ctx([added('src/List.jsx', code)], [project({ frameworks: [react('18.3.1')] })]), ports)
    expect(r.findings.map((f) => [f.ruleId, f.location.startLine, f.title])).toEqual([
      ['react/rules-of-hooks', 4, 'useState() is called inside a condition'],
      ['react/rules-of-hooks', 6, 'useEffect() is called inside a loop'],
      ['react/rules-of-hooks', 7, 'useState() is called inside a callback'],
      ['react/jsx-key', 8, 'List item without a key'],
    ])
  })

  it('skips the hooks check before React 16.8', async () => {
    const r = await reactValidator.run(ctx([added('src/List.jsx', code)], [project({ frameworks: [react('16.4.0')] })]), ports)
    expect(r.findings.map((f) => f.ruleId)).toEqual(['react/jsx-key'])
  })
})

describe('CI results (Story 4.3)', () => {
  it('maps head-commit checks to layers with source links and skips its own status', async () => {
    const c = ctx([], [], {
      checks: [
        { kind: 'check_run', name: 'SonarCloud Code Analysis', conclusion: 'failure', summary: 'Quality Gate failed', url: 'https://sonar.example/1' },
        { kind: 'check_run', name: 'unit tests', conclusion: 'success' },
        { kind: 'status', name: 'ci/build', conclusion: 'pending' },
        { kind: 'status', name: 'pr-reviewer', conclusion: 'success' },
      ],
    })
    const r = await ciResultsValidator.run(c, ports)
    expect(r.layers).toEqual([
      { layer: 'STATIC_ANALYSIS', validator: 'ci:SonarCloud Code Analysis', status: 'FAILED', detail: 'Quality Gate failed (failure) https://sonar.example/1' },
      { layer: 'TESTS', validator: 'ci:unit tests', status: 'PASSED' },
      { layer: 'COMPILE', validator: 'ci:ci/build', status: 'SKIPPED', reason: 'UNKNOWN', detail: '(still running when the review started)' },
    ])
    expect(layerForCheck('lint (eslint)')).toBe('LINT')
    expect(ciResultsValidator.supports(ctx([], [], { checks: [{ kind: 'status', name: 'pr-reviewer', conclusion: 'success' }] }))).toMatchObject({ applicable: false })
  })
})

describe('build, tool, and CI configuration changes (Story 4.5)', () => {
  it('flags workflows, install scripts, and tool configs, and explains repo-settings edits', async () => {
    const pkg = (scripts: Record<string, string>) => JSON.stringify({ name: 'x', scripts })
    const r = await configChangesValidator.run(
      ctx(
        [
          added('.github/workflows/ci.yml', 'on: push'),
          { ...added('package.json', pkg({ build: 'tsc', postinstall: 'node x.js' })), status: 'modified', base: { text: pkg({ build: 'tsc' }) } },
          added('tsconfig.json', '{}'),
          added('.github/pr-reviewer.yml', 'version: 1'),
          added('src/a.ts', 'x'),
        ],
        [],
      ),
      ports,
    )
    expect(r.findings.map((f) => [f.ruleId, f.severity, f.location.path])).toEqual([
      ['repo/ci-config-changed', 'MINOR', '.github/workflows/ci.yml'],
      ['repo/package-scripts-changed', 'MAJOR', 'package.json'],
      ['repo/tool-config-changed', 'INFO', 'tsconfig.json'],
      ['repo/pr-reviewer-settings-changed', 'INFO', '.github/pr-reviewer.yml'],
    ])
    expect(r.findings[1]!.title).toBe('PR changes package scripts: postinstall')
    expect(r.layers[0]).toMatchObject({ layer: 'SECURITY', status: 'WARNING' })
  })
})

describe('dependency audit (Story 4.8)', () => {
  const lock = (deps: Record<string, string>) => JSON.stringify({ lockfileVersion: 3, packages: { '': {}, ...Object.fromEntries(Object.entries(deps).map(([n, v]) => [`node_modules/${n}`, { version: v }])) } })

  it('parses npm, yarn, and pnpm lockfiles', () => {
    expect([...lockedPackages('package-lock.json', lock({ lodash: '4.17.20', '@a/b': '1.0.0' }))]).toEqual([['lodash', new Set(['4.17.20'])], ['@a/b', new Set(['1.0.0'])]])
    expect(lockedPackages('yarn.lock', 'lodash@^4.17.0:\n  version "4.17.21"\n  resolved "x"\n\n"@a/b@^1.0.0":\n  version "1.2.0"\n').get('@a/b')).toEqual(new Set(['1.2.0']))
    expect(lockedPackages('pnpm-lock.yaml', 'packages:\n  /lodash@4.17.21:\n    resolution: x\n  /@a/b@1.2.0:\n    resolution: y\n').get('lodash')).toEqual(new Set(['4.17.21']))
  })

  it('checks only added or upgraded versions and labels reachability unknown', async () => {
    const base = lock({ lodash: '4.17.21', left: '1.0.0' })
    const head = lock({ lodash: '4.17.20', left: '1.0.0', minimist: '1.2.5' })
    const files: FileAccessor = { ...NO_FILES, read: async (_p, side) => (side === 'HEAD' ? head : base) }
    const queried: string[] = []
    const advisories = {
      source: 'test-db',
      query: async (pkgs: Array<{ name: string; version: string }>) => {
        queried.push(...pkgs.map((p) => `${p.name}@${p.version}`))
        return { ok: true as const, value: pkgs.map((p) => ({ ...p, advisories: p.name === 'lodash' ? [{ id: 'GHSA-1', summary: 'Prototype pollution', severity: 'CRITICAL', aliases: ['CVE-2021-1'], fixedIn: '4.17.21' }] : [] })) }
      },
    }
    const c = ctx([{ ...added('package-lock.json', head), status: 'modified' }], [project()], { files })
    const r = await dependencyAuditValidator.run(c, { now: () => 0, advisories })
    expect(queried).toEqual(['lodash@4.17.20', 'minimist@1.2.5'])
    expect(r.findings).toEqual([expect.objectContaining({ ruleId: 'deps/GHSA-1', severity: 'CRITICAL', category: 'DEPENDENCY', recommendation: 'Upgrade lodash to 4.17.21 or later.' })])
    expect(r.findings[0]!.description).toContain('Reachability unknown')
    expect(r.layers[0]).toMatchObject({ status: 'WARNING', detail: expect.stringContaining('2 added or upgraded') })
  })
})

describe('Sandbox tools (Story 4.6)', () => {
  const step = (id: string, over: Partial<SandboxStepResult> = {}): [string, SandboxStepResult] => [id, { id, exitCode: 0, stdout: '', stderr: '', timedOut: false, durationMs: 1, ...over }]

  it('plans one install per lockfile directory, tsc per TS project, and the default ruleset only without lint config', () => {
    const c = ctx([added('src/a.ts', 'x')], [project()])
    expect(installSteps(c).map((s) => [s.id, s.cmd.slice(0, 2).join(' ')])).toEqual([['install:.', 'npm ci'], ['install:tools', 'sh -c']])
    expect(installSteps(c)[1]!.cmd[2]).toContain(DEFAULT_RULESETS.modern.packages.join(' '))
    expect(tscValidator.sandboxSteps!(c)[0]).toMatchObject({ id: 'ts.tsc:.', phase: 'ANALYZE', cwd: '' })
    expect(eslintValidator.sandboxSteps!(c)[0]!.cmd).toEqual(expect.arrayContaining(['-c', '/scratch/tools/eslint.config.mjs', 'src/a.ts']))
    // Node 14 projects get the legacy ruleset that still runs there; TSLint projects get TSLint, not ESLint.
    const old = ctx([added('src/a.ts', 'x')], [project({ nodeMajor: 14, configs: { tsconfig: 'tsconfig.json', tslint: 'tslint.json' } })])
    expect(installSteps(old).map((s) => s.id)).toEqual(['install:.'])
    expect(eslintValidator.supports(old)).toMatchObject({ applicable: false })
    expect(tslintValidator.sandboxSteps!(old)[0]!.cmd.slice(-5)).toEqual(['-c', 'tslint.json', '-p', 'tsconfig.json', 'src/a.ts'])
  })

  it('parses tsc output, counts errors outside changed files as pre-existing, and reports install failures', async () => {
    expect(parseTsc('src/a.ts(3,5): error TS2322: Type "x" is not assignable.\n  More detail.\n../lib/b.ts(1,1): error TS1005: ";" expected.', 'app')).toEqual([
      { path: 'app/src/a.ts', line: 3, code: 'TS2322', message: 'Type "x" is not assignable.\nMore detail.' },
      { path: 'lib/b.ts', line: 1, code: 'TS1005', message: '";" expected.' },
    ])
    const c = ctx([added('src/a.ts', 'x')], [project()], {
      sandbox: new Map([step('install:.'), step('ts.tsc:.', { exitCode: 2, stdout: 'src/a.ts(1,1): error TS2304: Cannot find name "y".\nsrc/old.ts(9,1): error TS2304: Cannot find name "z".' })]),
    })
    const r = await tscValidator.run(c, ports)
    expect(r.findings).toEqual([expect.objectContaining({ ruleId: 'tsc/TS2304', severity: 'CRITICAL', location: { anchorKind: 'LINE', path: 'src/a.ts', startLine: 1, endLine: 1 } })])
    expect(r.layers[0]).toEqual({ layer: 'COMPILE', status: 'FAILED', detail: 'root: 1 error(s) in changed files; 1 more in unchanged files (pre-existing, not counted).' })

    const broken = await tscValidator.run(ctx([added('src/a.ts', 'x')], [project()], { sandbox: new Map([step('install:.', { exitCode: 1, stderr: 'npm ERR! ETARGET' })]) }), ports)
    expect(broken.layers[0]).toMatchObject({ status: 'ERROR', reason: 'TOOL_CRASHED', detail: expect.stringContaining('npm ERR! ETARGET') })
  })

  it('parses ESLint and TSLint JSON and names the default ruleset', async () => {
    const eslintOut = JSON.stringify([{ filePath: '/work/src/a.ts', messages: [{ ruleId: 'no-unused-vars', severity: 2, message: "'x' is defined but never used.", line: 2, endLine: 2 }] }])
    const c = ctx([added('src/a.ts', 'x')], [project()], { sandbox: new Map([step('install:.'), step('install:tools'), step('lint.eslint:.', { exitCode: 1, stdout: eslintOut })]) })
    const r = await eslintValidator.run(c, ports)
    expect(r.findings).toEqual([expect.objectContaining({ ruleId: 'eslint/no-unused-vars', severity: 'MAJOR', location: { anchorKind: 'LINE', path: 'src/a.ts', startLine: 2, endLine: 2 } })])
    expect(r.layers[0]!.detail).toContain(DEFAULT_RULESETS.modern.name)
    expect(r.layers[0]!.detail).toContain('the repository was not modified')

    const tslintOut = JSON.stringify([{ name: '/work/src/a.ts', ruleName: 'no-console', ruleSeverity: 'ERROR', failure: 'Calls to console.log are not allowed.', startPosition: { line: 4 }, endPosition: { line: 4 } }])
    const t = ctx([added('src/a.ts', 'x')], [project({ configs: { tsconfig: 'tsconfig.json', tslint: 'tslint.json' } })], { sandbox: new Map([step('install:.'), step('lint.tslint:.', { exitCode: 2, stdout: tslintOut })]) })
    const tr = await tslintValidator.run(t, ports)
    expect(tr.findings).toEqual([expect.objectContaining({ ruleId: 'tslint/no-console', location: { anchorKind: 'LINE', path: 'src/a.ts', startLine: 5, endLine: 5 } })])
    const junk = await tslintValidator.run({ ...t, sandbox: new Map([step('install:.'), step('lint.tslint:.', { exitCode: 2, stdout: 'not json' })]) }, ports)
    expect(junk.layers[0]).toMatchObject({ status: 'ERROR', reason: 'SANDBOX_OUTPUT_INVALID' })
  })
})
