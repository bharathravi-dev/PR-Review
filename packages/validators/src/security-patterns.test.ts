import type { ValidatorContext } from '@pr-reviewer/core'
import { describe, expect, it } from 'vitest'
import { securityPatternsValidator } from './security-patterns.js'

/** One added line per entry, in its own file. */
async function scan(lines: Array<[path: string, line: string]>) {
  const files = lines.map(([path, line]) => ({ path, status: 'modified', additions: 1, deletions: 0, binary: false, patchTruncated: false, patch: `@@ -1,1 +1,2 @@\n x\n+${line}` }))
  const out = await securityPatternsValidator.run({ pr: { files } } as unknown as ValidatorContext, {} as never)
  return out.findings.map((f) => `${f.location.path}:${f.ruleId}`)
}

describe('security patterns (roadmap item 15)', () => {
  it('flags well-known dangerous code on added lines', async () => {
    const hits = await scan([
      ['a.ts', 'db.query(`SELECT * FROM users WHERE id = ${req.params.id}`)'],
      ['b.py', 'cur.execute("SELECT * FROM t WHERE name = \'%s\'" % name)'],
      ['c.js', 'const f = new Function("a", body)'],
      ['d.ts', "exec(`git log ${branch}`)"],
      ['e.py', 'subprocess.run(cmd, shell=True)'],
      ['f.ts', 'https.request({ host, rejectUnauthorized: false })'],
      ['g.go', 'tls.Config{InsecureSkipVerify: true}'],
      ['h.tsx', '<div dangerouslySetInnerHTML={{ __html: comment }} />'],
      ['i.ts', 'el.innerHTML = userName'],
      ['j.ts', "jwt.verify(token, key, { algorithms: ['none'] })"],
      ['k.py', 'data = pickle.loads(body)'],
      ['l.py', 'cfg = yaml.load(text)'],
      ['m.ts', "app.use(cors({ origin: '*', credentials: true }))"],
      ['n.ts', "const h = createHash('md5').update(password).digest('hex')"],
      ['o.ts', 'const token = Math.random().toString(36)'],
    ])
    expect(hits).toEqual([
      'a.ts:security/sql-built-from-strings',
      'b.py:security/sql-built-from-strings',
      'c.js:security/eval',
      'd.ts:security/shell-with-interpolation',
      'e.py:security/shell-true',
      'f.ts:security/tls-verification-off',
      'g.go:security/tls-verification-off',
      'h.tsx:security/html-injection',
      'i.ts:security/html-injection',
      'j.ts:security/jwt-unverified',
      'k.py:security/unsafe-deserialization',
      'l.py:security/unsafe-deserialization',
      'm.ts:security/cors-any-origin-with-credentials',
      'n.ts:security/weak-hash',
      'o.ts:security/insecure-random',
    ])
  })

  it('stays quiet on the safe versions, comments, and tests', async () => {
    expect(
      await scan([
        ['a.ts', "db.query('SELECT * FROM users WHERE id = $1', [id])"],
        ['b.ts', "el.innerHTML = '<b>Loading</b>'"],
        ['c.ts', "execFile('git', ['log', branch])"],
        ['d.py', 'cfg = yaml.load(text, Loader=yaml.SafeLoader)'],
        ['e.ts', "app.use(cors({ origin: 'https://app.example.com', credentials: true }))"],
        ['f.ts', "const etag = createHash('md5').update(body).digest('hex')"],
        ['g.ts', 'const jitter = Math.random() * 100'],
        ['h.ts', '// never do: rejectUnauthorized: false'],
        ['src/__tests__/x.test.ts', 'eval(code)'],
        ['test_x.py', 'pickle.loads(b)'],
        ['styles.css', 'content: "eval("'],
        ['i.ts', 'const retrieval = evaluate(x)'],
      ]),
    ).toEqual([])
  })

  it('reports a warning on the security layer when it finds something, and is not applicable to non-code changes', async () => {
    const out = await securityPatternsValidator.run({ pr: { files: [{ path: 'a.ts', status: 'added', additions: 1, deletions: 0, binary: false, patchTruncated: false, patch: '@@ -0,0 +1,1 @@\n+eval(x)' }] } } as unknown as ValidatorContext, {} as never)
    expect(out.layers[0]).toMatchObject({ layer: 'SECURITY', status: 'WARNING' })
    expect(out.findings[0]).toMatchObject({ category: 'SECURITY', location: { path: 'a.ts', startLine: 1 }, recommendation: expect.stringContaining('parser') })
    expect(securityPatternsValidator.supports({ pr: { files: [{ path: 'README.md' }] } } as unknown as ValidatorContext).applicable).toBe(false)
  })
})
