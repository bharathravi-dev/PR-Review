import type { FileAccessor, PrContext, ProjectInfo, SandboxStepResult, ValidatorContext } from '@pr-reviewer/core'
import { describe, expect, it } from 'vitest'
import { goVetValidator, javaCompileValidator, parseGoVetOutput, parseJavaBuildOutput, parseRuffOutput, pythonValidator } from './polyglot-tools.js'

const noFiles: FileAccessor = { read: async () => undefined, list: async () => undefined, exists: async () => false, notes: () => [] }

function ctx(projects: ProjectInfo[], files: PrContext['files'], sandbox: ReadonlyMap<string, SandboxStepResult> = new Map()): ValidatorContext {
  const pr: PrContext = {
    host: 'github.com',
    repo: { owner: 'octo', name: 'app' },
    number: 1,
    title: 'Test',
    body: '',
    author: 'ann',
    state: 'OPEN',
    draft: false,
    baseRef: 'main',
    headRef: 'feat',
    baseSha: 'b1',
    headSha: 'h1',
    mergeBaseSha: 'b1',
    files,
    reviews: [],
    reviewComments: [],
    issueComments: [],
    commits: [{ sha: 'h1', message: 'msg' }],
    truncated: [],
  }
  return { pr, files: noFiles, projects, checks: [], repoSettings: {}, sandbox }
}

const file = (path: string) => ({ path, status: 'modified' as const, additions: 1, deletions: 0, binary: false, patchTruncated: false })
const step = (id: string, over: Partial<SandboxStepResult> = {}): [string, SandboxStepResult] => [id, { id, exitCode: 0, stdout: '', stderr: '', timedOut: false, durationMs: 1, ...over }]

describe('polyglot sandbox validators (Java, Python, Go)', () => {
  it('plans Maven install/analyze steps and maps changed-file compile errors only', async () => {
    const p: ProjectInfo = { path: 'svc', language: 'Java', support: 'supported', frameworks: [], packageManager: 'maven', configs: { maven: 'svc/pom.xml' }, dependencies: [], changedFiles: ['svc/src/Main.java'] }
    const c = ctx([p], [file('svc/src/Main.java')])
    expect(javaCompileValidator.supports(c)).toEqual({ applicable: true })
    expect(javaCompileValidator.sandboxSteps!(c).map((s) => s.id)).toEqual(['java.compile:install:svc', 'java.compile:analyze:svc'])

    const out = [
      '[ERROR] /work/svc/src/Main.java:[14,20] cannot find symbol: method foo()',
      '[ERROR] /work/svc/src/Other.java:[8,5] unchanged error',
    ].join('\n')
    const res = await javaCompileValidator.run(
      ctx([p], [file('svc/src/Main.java')], new Map([step('java.compile:install:svc'), step('java.compile:analyze:svc', { exitCode: 1, stdout: out })])),
      { now: () => 0 },
    )
    expect(res.findings).toHaveLength(1)
    expect(res.findings[0]).toMatchObject({ ruleId: 'java/compile-error', severity: 'CRITICAL', location: { path: 'svc/src/Main.java', startLine: 14 } })
    expect(res.layers[0]).toMatchObject({ layer: 'COMPILE', status: 'FAILED', detail: expect.stringContaining('(1 in unchanged files)') })
  })

  it('plans Python Ruff checks and maps syntax and lint diagnostics', async () => {
    const p: ProjectInfo = { path: '', language: 'Python', support: 'supported', frameworks: [], packageManager: 'pip', configs: { python: 'requirements.txt' }, dependencies: [], changedFiles: ['app.py'] }
    const c = ctx([p], [file('app.py')])
    expect(pythonValidator.supports(c)).toEqual({ applicable: true })
    expect(pythonValidator.sandboxSteps!(c)[1]!.cmd).toEqual(['/scratch/pytools/bin/ruff', 'check', '--output-format', 'json', '--no-fix', '--', 'app.py'])

    const ruffOut = JSON.stringify([
      { filename: '/work/app.py', code: 'F821', message: "Undefined name 'foo'", location: { row: 12 }, end_location: { row: 12 } },
      { filename: '/work/app.py', code: null, message: 'SyntaxError: expected ":"', location: { row: 3 }, end_location: { row: 3 } },
    ])
    const res = await pythonValidator.run(ctx([p], [file('app.py')], new Map([step('python.lint:install'), step('python.lint:analyze:.', { exitCode: 1, stdout: ruffOut })])), { now: () => 0 })
    expect(res.findings.map((f) => [f.ruleId, f.severity])).toEqual([
      ['ruff/F821', 'MAJOR'],
      ['python/syntax-error', 'CRITICAL'],
    ])
  })

  it('plans Go vet checks and parses go vet compiler output', async () => {
    const p: ProjectInfo = { path: 'api', language: 'Go', support: 'supported', frameworks: [], packageManager: 'go', configs: { gomod: 'api/go.mod' }, dependencies: [], changedFiles: ['api/handler.go'] }
    const c = ctx([p], [file('api/handler.go')])
    expect(goVetValidator.supports(c)).toEqual({ applicable: true })
    expect(goVetValidator.sandboxSteps!(c).map((s) => s.id)).toEqual(['go.vet:install:api', 'go.vet:analyze:api'])

    const res = await goVetValidator.run(
      ctx([p], [file('api/handler.go')], new Map([step('go.vet:install:api'), step('go.vet:analyze:api', { exitCode: 1, stderr: 'handler.go:22:5: undefined: bar' })])),
      { now: () => 0 },
    )
    expect(res.findings[0]).toMatchObject({ ruleId: 'go/vet', severity: 'CRITICAL', location: { path: 'api/handler.go', startLine: 22 } })
  })

  it('parses Maven, Kotlin/Gradle, Ruff, and Go vet diagnostics cleanly', () => {
    expect(parseJavaBuildOutput('e: file:///work/app/A.kt:9:4 Unresolved reference: x', 'app')).toEqual([{ path: 'app/A.kt', line: 9, message: 'Unresolved reference: x' }])
    expect(parseRuffOutput('[{"filename":"/work/x.py","code":"E711","message":"None comparison"}]', '')[0]!.filename).toBe('x.py')
    expect(parseGoVetOutput('./main.go:5:2: printf format error', 'svc')).toEqual([{ path: 'svc/main.go', line: 5, message: 'printf format error' }])
  })
})
