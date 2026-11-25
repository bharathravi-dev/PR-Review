import { describe, expect, it } from 'vitest'
import { detectProjects, lockedVersion, minVersion } from './detect.js'
import type { FileAccessor } from './files.js'
import { globToRegExp } from './files.js'
import type { Finding } from './findings.js'
import type { PrContext } from './schemas.js'
import { filterPaths, parseRepoConfig } from './repo-config.js'
import { evaluateGate } from './report.js'
import { err, ok } from './result.js'
import { executeValidators, type CachePort, type SandboxPort, type Validator, type ValidatorContext } from './validator.js'

function accessor(files: Record<string, string>): FileAccessor {
  return {
    list: async () => Object.keys(files).map((path, i) => ({ path, type: 'blob' as const, sha: `sha${i}` })),
    treeSha: async () => 'tree1',
    read: async (path) => files[path],
    notes: () => [],
  }
}

describe('detectProjects (Story 4.1)', () => {
  it('maps changed files to the deepest project and reads versions from the lockfile', async () => {
    const files = accessor({
      'package.json': JSON.stringify({ name: 'root', devDependencies: { typescript: '~4.3.5' } }),
      'package-lock.json': JSON.stringify({ packages: { 'node_modules/@angular/core': { version: '12.2.16' }, 'node_modules/typescript': { version: '4.3.5' } } }),
      'apps/web/package.json': JSON.stringify({ name: 'web', dependencies: { '@angular/core': '~12.2.0' }, devDependencies: { typescript: '~4.3.5' }, engines: { node: '>=14.17' } }),
      'apps/web/angular.json': '{}',
      'apps/web/tsconfig.json': '{}',
      'apps/web/tsconfig.app.json': '{}',
      'apps/web/tslint.json': '{}',
      'apps/ui/package.json': JSON.stringify({ name: 'ui', dependencies: { react: '^18.2.0' } }),
      'apps/ui/.nvmrc': 'v20.11.0\n',
    })
    const { projects } = await detectProjects(files, ['apps/web/src/app.component.ts', 'apps/ui/src/App.jsx', 'README.md', 'scripts/deploy.py'])
    const web = projects.find((p) => p.path === 'apps/web')!
    expect(web).toMatchObject({
      name: 'web',
      language: 'TypeScript',
      packageManager: 'npm',
      lockfile: 'package-lock.json',
      nodeMajor: 14,
      configs: { tsconfig: 'apps/web/tsconfig.json', tslint: 'apps/web/tslint.json', angularJson: 'apps/web/angular.json' },
      changedFiles: ['apps/web/src/app.component.ts'],
    })
    expect(web.frameworks[0]).toMatchObject({ name: 'Angular', version: '12.2.16', declared: '~12.2.0', confidence: 'HIGH' })
    const ui = projects.find((p) => p.path === 'apps/ui')!
    expect(ui).toMatchObject({ language: 'JavaScript', nodeMajor: 20 })
    // A range with no lockfile entry gives the lowest allowed version at medium confidence.
    expect(ui.frameworks[0]).toMatchObject({ name: 'React', version: '18.2.0', confidence: 'MEDIUM' })
    expect(projects.find((p) => p.path === '')).toMatchObject({ name: 'root', changedFiles: ['README.md', 'scripts/deploy.py'] })
  })

  it('labels a repository with no recognised stack best-effort, never a guessed framework', async () => {
    const { projects, notes } = await detectProjects(accessor({ 'app.py': 'print(1)', 'requirements.txt': 'flask' }), ['app.py'])
    expect(projects).toEqual([expect.objectContaining({ path: '', language: 'unknown', support: 'best-effort', frameworks: [], changedFiles: ['app.py'] })])
    expect(notes[0]).toContain('best-effort review (unsupported technology)')
  })

  it('reads versions from yarn and pnpm lockfiles and ranges', () => {
    expect(lockedVersion('yarn.lock', '"@angular/core@~13.0.0":\n  version "13.0.3"\n', '@angular/core')).toBe('13.0.3')
    expect(lockedVersion('pnpm-lock.yaml', "  /react@18.3.1:\n    resolution: x\n", 'react')).toBe('18.3.1')
    expect([minVersion('^16.8'), minVersion('>=14.17'), minVersion('latest')]).toEqual(['16.8.0', '14.17.0', undefined])
  })
})

describe('repository settings (Story 4.4)', () => {
  it('applies only the allow-list and reports everything else', () => {
    const r = parseRepoConfig(`version: 1
reviewRules: [Use OnPush change detection]
paths: { exclude: ['**/*.spec.ts'], other: 1 }
thresholds: { failOn: MAJOR }
publish: { maxInlineComments: 5, event: APPROVE }
defaultProvider: evil
providers: { x: { baseUrl: https://evil.example } }
github: { apiUrl: https://evil.example }
sandbox: { registries: [evil.example] }
mandatoryLayers: []
`)
    expect(r.settings).toEqual({ reviewRules: ['Use OnPush change detection'], paths: { exclude: ['**/*.spec.ts'] }, thresholds: { failOn: 'MAJOR' }, publish: { maxInlineComments: 5 } })
    expect(r.ignored.sort()).toEqual(['defaultProvider', 'github', 'mandatoryLayers', 'paths.other', 'providers', 'publish.event', 'sandbox'])
  })

  it('treats unreadable, unknown-version, and invalid values safely', () => {
    expect(parseRepoConfig('version: [').warnings[0]).toContain('could not be parsed')
    expect(parseRepoConfig('version: 2\nreviewRules: [x]').settings).toEqual({})
    const bad = parseRepoConfig('thresholds: { failOn: SOMETIMES }\nreviewRules: [ok]')
    expect(bad.settings).toEqual({ reviewRules: ['ok'] })
    expect(bad.ignored).toEqual(['thresholds'])
  })

  it('filters paths with include and exclude globs', () => {
    expect(filterPaths(['src/a.ts', 'src/a.spec.ts', 'docs/x.md'], { include: ['src/**'], exclude: ['**/*.spec.ts'] })).toEqual(['src/a.ts'])
    expect(globToRegExp('**/*.ts').test('a.ts')).toBe(true)
  })
})

const pr = { headSha: 'h1', files: [] } as unknown as PrContext
const vctx = (over: Partial<ValidatorContext> = {}): ValidatorContext => ({ pr, files: accessor({ 'a.ts': 'x' }), projects: [], checks: [], repoSettings: {}, sandbox: new Map(), ...over })

function validator(id: string, over: Partial<Validator> = {}): Validator {
  return { id, version: '1', layers: ['LINT'], needsSandbox: false, baseline: false, hermetic: false, supports: () => ({ applicable: true }), run: async () => ({ layers: [{ layer: 'LINT', status: 'PASSED' }], findings: [] }), ...over }
}

describe('executeValidators (Story 4.2)', () => {
  it('gives every layer an honest status; crashes, timeouts, and bad output never stop the others', async () => {
    const out = await executeValidators(
      [
        validator('ok'),
        validator('na', { supports: () => ({ applicable: false, reason: 'NOT_SUPPORTED', detail: 'nothing to check' }) }),
        validator('boom', { run: async () => { throw new Error('kaput') } }),
        validator('slow', { run: () => new Promise(() => undefined) }),
        validator('junk', { run: async () => ({ layers: 'nope' }) as never }),
        validator('off'),
      ],
      vctx(),
      { now: () => 0 },
      { timeoutMs: 50, disabled: ['off'] },
    )
    expect(out.layers.map((l) => [l.validator, l.status, l.reason ?? null])).toEqual(
      expect.arrayContaining([
        ['ok', 'PASSED', null],
        ['na', 'NOT_APPLICABLE', 'NOT_SUPPORTED'],
        ['boom', 'ERROR', 'TOOL_CRASHED'],
        ['slow', 'TIMEOUT', 'TIME_LIMIT'],
        ['junk', 'ERROR', 'SCHEMA_INVALID'],
        ['off', 'SKIPPED', 'DISABLED_BY_CONFIG'],
      ]),
    )
    expect(out.layers).toHaveLength(6)
  })

  it('skips Sandbox Validators without calling them when there is no Sandbox, and says why', async () => {
    let called = false
    const v = validator('ts.tsc', { layers: ['COMPILE'], needsSandbox: true, sandboxSteps: () => [{ id: 'ts.tsc:.', phase: 'ANALYZE', cmd: ['tsc'], cwd: '', timeoutMs: 1 }], run: async () => ((called = true), { layers: [], findings: [] }) })
    const none = await executeValidators([v], vctx(), { now: () => 0 })
    expect(called).toBe(false)
    expect(none.layers[0]).toMatchObject({ layer: 'COMPILE', status: 'SKIPPED', reason: 'NO_SANDBOX' })
    const noEgress: SandboxPort = { probe: async () => ok({ runtime: 'docker', nodeMajors: [20], egressControl: false }), run: async () => err('x', 'unused') }
    expect((await executeValidators([v], vctx(), { now: () => 0 }, { sandbox: noEgress })).layers[0]).toMatchObject({ reason: 'NO_EGRESS_CONTROL' })
    const oldNode: SandboxPort = { ...noEgress, probe: async () => ok({ runtime: 'docker', nodeMajors: [20, 22], egressControl: true }) }
    const ctx12 = vctx({ projects: [{ path: '', language: 'TypeScript', support: 'supported', frameworks: [], packageManager: 'npm', nodeMajor: 12, configs: {}, dependencies: [], changedFiles: [] }] })
    expect((await executeValidators([v], ctx12, { now: () => 0 }, { sandbox: oldNode })).layers[0]).toMatchObject({ reason: 'UNSUPPORTED_RUNTIME' })
  })

  it('runs one Sandbox session, routes step results, rejects mismatched results, and caches', async () => {
    const plans: unknown[] = []
    const sandbox = (headSha = 'h1'): SandboxPort => ({
      probe: async () => ok({ runtime: 'docker', nodeMajors: [22], egressControl: true }),
      run: async (plan, planHash) => {
        plans.push(plan)
        return ok({ planHash, headSha, imageDigest: 'sha256:x', results: plan.steps.map((s) => ({ id: s.id, exitCode: 0, stdout: `out of ${s.id}`, stderr: '', timedOut: false, durationMs: 1 })) })
      },
    })
    const seen: string[] = []
    const v = validator('ts.tsc', {
      needsSandbox: true,
      cacheable: true,
      sandboxSteps: () => [{ id: 'ts.tsc:.', phase: 'ANALYZE', cmd: ['tsc'], cwd: '', timeoutMs: 1 }],
      run: async (c) => {
        seen.push(...[...c.sandbox.keys()])
        return { layers: [{ layer: 'COMPILE', status: 'PASSED' }], findings: [] }
      },
    })
    const store = new Map<string, unknown>()
    const cache: CachePort = { get: async (k) => store.get(k), set: async (k, val) => void store.set(k, val) }
    const opts = { sandbox: sandbox(), cache, cacheNamespace: 'ns', archive: async () => ok(new Uint8Array([1])), installSteps: () => [{ id: 'install:.', phase: 'INSTALL' as const, cmd: ['npm', 'ci'], cwd: '', timeoutMs: 1 }] }
    const first = await executeValidators([v], vctx(), { now: () => 0 }, opts)
    expect(seen).toEqual(['install:.', 'ts.tsc:.'])
    expect(plans).toHaveLength(1)
    expect(first.sandbox).toMatchObject({ imageDigest: 'sha256:x', ran: true })

    const second = await executeValidators([v], vctx(), { now: () => 0 }, opts)
    expect(plans).toHaveLength(1)
    expect(second.layers[0]!.detail).toBe('(cached from an earlier run)')

    const moved = await executeValidators([v], vctx(), { now: () => 0 }, { ...opts, cache: undefined, sandbox: sandbox('other-head') })
    expect(moved.layers[0]).toMatchObject({ status: 'SKIPPED', reason: 'SANDBOX_OUTPUT_INVALID' })
  })
})

describe('gate with repository thresholds', () => {
  const f = (severity: Finding['severity']): Finding => ({ ruleId: 'eslint/x', category: 'STYLE', severity, confidence: 'HIGH', scope: 'NEW', sourceFamily: 'DETERMINISTIC', title: 't', description: 'd', location: { anchorKind: 'PR' }, provenance: { validator: 'lint.eslint' } })
  const layers = [
    { layer: 'CONTEXT' as const, validator: 'c', status: 'PASSED' as const, durationMs: 0 },
    { layer: 'SECRETS' as const, validator: 's', status: 'PASSED' as const, durationMs: 0 },
    { layer: 'COMPILE' as const, validator: 'ts.tsc', status: 'SKIPPED' as const, reason: 'NO_SANDBOX' as const, durationMs: 0 },
  ]
  it('lets a repository make the gate stricter but never looser, and says when build checks did not run', () => {
    expect(evaluateGate(layers, [f('MAJOR')]).result).toBe('PASSED_WITH_WARNINGS')
    expect(evaluateGate(layers, [f('MAJOR')], { failOn: 'MAJOR' }).result).toBe('FAILED')
    expect(evaluateGate(layers, [f('CRITICAL')], { failOn: 'BLOCKER' }).result).toBe('FAILED')
    expect(evaluateGate(layers, []).coverage.headline).toContain('Build, compile, and lint were not run: no Sandbox (Docker or Podman).')
  })
})
