import type { AdvisoryEcosystem, FileAccessor, PrContext, ValidatorContext } from '@pr-reviewer/core'
import { describe, expect, it } from 'vitest'
import { dependencyAuditValidator, parsedDependencies } from './dependencies.js'
import { localStandardsValidator } from './local-standards.js'
import { securityPatternsValidator } from './security-patterns.js'
import { localSyntaxValidator, preservesValidSyntax } from './syntax-local.js'

function fileWith(path: string, headText: string, patch?: string) {
  const lines = headText.split('\n')
  const computedPatch = patch ?? `@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join('\n')}`
  return {
    path,
    status: 'added' as const,
    additions: lines.length,
    deletions: 0,
    binary: false,
    patchTruncated: false,
    patch: computedPatch,
    head: { text: headText },
  }
}

function makeCtx(files: PrContext['files'], over: Partial<ValidatorContext> = {}): ValidatorContext {
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
  const noFiles: FileAccessor = { read: async () => undefined, list: async () => undefined, exists: async () => false, notes: () => [] }
  return { pr, files: noFiles, projects: [], checks: [], repoSettings: {}, sandbox: new Map(), ...over }
}

describe('localSyntaxValidator (no sandbox)', () => {
  it('catches TS syntax errors, invalid JSON, invalid YAML, and duplicate .properties keys', async () => {
    const c = makeCtx([
      fileWith('src/broken.ts', 'export const x = (\n'),
      fileWith('config.json', '{ "a": 1, }\n'),
      fileWith('.github/workflows/ci.yml', 'on:\n  - push\n  bad: [1, 2\n'),
      fileWith('application.properties', 'app.port=8080\napp.name=demo\napp.port=9090\n'),
    ])
    const out = await localSyntaxValidator.run(c, { now: () => 0 })
    const rules = out.findings.map((f) => f.ruleId)
    expect(rules).toContain('syntax/ts-js-parse')
    expect(rules).toContain('syntax/json-parse')
    expect(rules).toContain('syntax/yaml-parse')
    expect(rules).toContain('syntax/properties-duplicate-key')
    expect(out.layers[0]).toMatchObject({ layer: 'SYNTAX', status: 'WARNING' })
  })

  it('passes valid TS, tsconfig JSONC, YAML, and properties files', async () => {
    const c = makeCtx([
      fileWith('src/ok.ts', 'export const x: number = 1\n'),
      fileWith('tsconfig.json', '{\n  // comment allowed in tsconfig\n  "compilerOptions": { "strict": true }\n}\n'),
      fileWith('compose.yaml', 'services:\n  app:\n    image: node:24\n'),
      fileWith('application.properties', 'app.port=8080\napp.name=demo\n'),
    ])
    const out = await localSyntaxValidator.run(c, { now: () => 0 })
    expect(out.findings).toEqual([])
    expect(out.layers[0]).toMatchObject({ layer: 'SYNTAX', status: 'PASSED' })
  })
})

describe('localStandardsValidator (no sandbox)', () => {
  it('detects JS/TS AST issues (debugger, empty catch, unreachable code, duplicate key, self-assign)', async () => {
    const code = [
      'export function f(x: number) {',
      '  debugger;',
      '  const obj = { a: 1, a: 2 };',
      '  x = x;',
      '  try { return obj.a; } catch (e) {}',
      '  return 1;',
      '  const dead = 2;',
      '}',
    ].join('\n')
    const out = await localStandardsValidator.run(makeCtx([fileWith('src/bad.ts', code)]), { now: () => 0 })
    const ids = out.findings.map((f) => f.ruleId)
    expect(ids).toEqual(
      expect.arrayContaining(['standards/no-debugger', 'standards/duplicate-key', 'standards/self-assignment', 'standards/empty-catch', 'standards/unreachable-code']),
    )
    expect(out.layers[0]).toMatchObject({ layer: 'STATIC_ANALYSIS', status: 'WARNING' })
  })

  it('detects Java, Python, and Go standards issues and skips test files', async () => {
    const java = [
      '@Service',
      'public class DemoService {',
      '  @Autowired private Repo repo;',
      '  @Autowired',
      '  public DemoService(Repo r) {}',
      '  private final SimpleDateFormat fmt = new SimpleDateFormat("yyyy-MM-dd");',
      '  void run() {',
      '    try { System.out.println("hi"); } catch (Exception e) {}',
      '  }',
      '}',
    ].join('\n')
    const py = ['from math import *', 'def add(x=[]):', '  try:', '    return x == None', '  except:', '    pass'].join('\n')
    const go = ['package svc', 'func f() {', '  _ = f.Close()', '  panic("boom")', '}'].join('\n')
    const c = makeCtx([
      fileWith('src/DemoService.java', java),
      fileWith('src/Latest.java', 'public class Latest { void f() { System.out.println("ok"); } }'),
      fileWith('src/DemoServiceTest.java', 'System.out.println("ok in tests");'),
      fileWith('app.py', py),
      fileWith('svc.go', go),
    ])
    const out = await localStandardsValidator.run(c, { now: () => 0 })
    const ids = out.findings.map((f) => f.ruleId)
    expect(ids).toEqual(
      expect.arrayContaining([
        'standards/java-field-injection',
        'standards/java-simple-date-format',
        'standards/java-stdout',
        'standards/java-empty-catch',
        'standards/py-wildcard-import',
        'standards/py-mutable-default',
        'standards/py-none-equality',
        'standards/py-bare-except',
        'standards/go-ignored-error',
        'standards/go-panic',
      ]),
    )
    // Constructor @Autowired should not be flagged as field injection; Latest.java is NOT skipped as a test file.
    expect(out.findings.filter((f) => f.ruleId === 'standards/java-field-injection')).toHaveLength(1)
    expect(out.findings.some((f) => f.location.path === 'src/Latest.java')).toBe(true)
    expect(out.findings.some((f) => f.location.path === 'src/DemoServiceTest.java')).toBe(false)
  })
})

describe('expanded securityPatternsValidator rules', () => {
  it('flags Java weak cipher, XXE factory, Spring CSRF disable, and insecure Random for tokens', async () => {
    const java = [
      'Cipher c = Cipher.getInstance("AES/ECB/PKCS5Padding");',
      'DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();',
      'http.csrf(csrf -> csrf.disable());',
      'int otp = new Random().nextInt();',
    ].join('\n')
    const out = await securityPatternsValidator.run(makeCtx([fileWith('src/Sec.java', java)]), { now: () => 0 })
    const ids = out.findings.map((f) => f.ruleId)
    expect(ids).toEqual(expect.arrayContaining(['security/weak-cipher', 'security/xxe-parser', 'security/spring-csrf-disabled', 'security/insecure-random-java-py']))
  })
})

describe('multi-ecosystem dependency CVE audit', () => {
  it('parses Maven pom.xml, Python requirements.txt, and Go go.mod', () => {
    const pom = '<dependencies><dependency><groupId>org.apache.logging.log4j</groupId><artifactId>log4j-core</artifactId><version>2.14.1</version></dependency><dependency><groupId>a</groupId><artifactId>b</artifactId><version>${project.version}</version></dependency></dependencies>'
    expect(parsedDependencies('pom.xml', pom)).toEqual({
      ecosystem: 'Maven',
      packages: new Map([['org.apache.logging.log4j:log4j-core', new Set(['2.14.1'])]]),
    })
    expect(parsedDependencies('requirements.txt', '# c\nRequests[security]==2.19.1\nflask>=2.0\n')).toEqual({
      ecosystem: 'PyPI',
      packages: new Map([['requests', new Set(['2.19.1'])]]),
    })
    expect(parsedDependencies('go.mod', 'module x\nrequire (\n  golang.org/x/text v0.3.7\n)\n')).toEqual({
      ecosystem: 'Go',
      packages: new Map([['golang.org/x/text', new Set(['0.3.7'])]]),
    })
  })

  it('queries Maven ecosystem advisories for added pom.xml dependencies', async () => {
    const basePom = '<dependencies></dependencies>'
    const headPom = '<dependencies><dependency><groupId>org.apache.logging.log4j</groupId><artifactId>log4j-core</artifactId><version>2.14.1</version></dependency></dependencies>'
    const queries: Array<{ ecosystem: AdvisoryEcosystem; name: string; version: string }> = []
    const files: FileAccessor = { read: async (_p, side) => (side === 'HEAD' ? headPom : basePom), list: async () => undefined, exists: async () => true, notes: () => [] }
    const advisories = {
      source: 'OSV (osv.dev)',
      query: async (pkgs: Array<{ ecosystem: AdvisoryEcosystem; name: string; version: string }>) => {
        queries.push(...pkgs)
        return {
          ok: true as const,
          value: pkgs.map((p) => ({
            ...p,
            advisories: [{ id: 'GHSA-jfh8-c2jp-5v3q', summary: 'Log4Shell RCE', severity: 'CRITICAL', aliases: ['CVE-2021-44228'], fixedIn: '2.15.0' }],
          })),
        }
      },
    }
    const r = await dependencyAuditValidator.run(makeCtx([{ ...fileWith('pom.xml', headPom), status: 'modified' }], { files }), { now: () => 0, advisories })
    expect(queries).toEqual([{ ecosystem: 'Maven', name: 'org.apache.logging.log4j:log4j-core', version: '2.14.1' }])
    expect(r.findings[0]).toMatchObject({ ruleId: 'deps/GHSA-jfh8-c2jp-5v3q', severity: 'CRITICAL', category: 'DEPENDENCY' })
  })
})

describe('preservesValidSyntax', () => {
  it('detects newly introduced TypeScript syntax errors while tolerating pre-existing ones outside the patch', () => {
    const clean = 'const x = 1\nconst y = 2\n'
    expect(preservesValidSyntax('src/a.ts', 'const x = 1\nconst y = 3\n', clean)).toBe(true)
    expect(preservesValidSyntax('src/a.ts', 'const x = 1\nconst y = (;\n', clean)).toBe(false)
    const alreadyBroken = 'const x = (;\nconst y = 2\n'
    expect(preservesValidSyntax('src/a.ts', 'const x = (;\nconst y = 3\n', alreadyBroken)).toBe(true)
  })
})
