import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error -- plain ESM script without type declarations
import { checkBoundaries } from './check-boundaries.mjs'

const dirs: string[] = []

function workspace(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'boundaries-'))
  dirs.push(root)
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return root
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('checkBoundaries', () => {
  it('passes the real workspace', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    expect(checkBoundaries(root)).toEqual([])
  })

  it('flags Node built-ins, fetch, process, eval and new Function in core (AD-1)', () => {
    const root = workspace({
      'packages/core/src/a.ts': "import { readFileSync } from 'node:fs'\nimport path from 'path'\n",
      'packages/core/src/b.ts': 'export const x = () => fetch("https://example.com")\n',
      'packages/core/src/c.ts': 'export const env = process.env\n',
      'packages/core/src/d.ts': 'export const f = new Function("return 1")\nexport const g = eval("1")\n',
    })
    const v = checkBoundaries(root).join('\n')
    expect(v).toContain("Node built-in 'node:fs'")
    expect(v).toContain("Node built-in 'path'")
    expect(v).toContain('calls fetch')
    expect(v).toContain('reads process')
    expect(v).toContain('uses new Function')
    expect(v).toContain('uses eval')
  })

  it('ignores forbidden words in comments and allows Node built-ins in test files', () => {
    const root = workspace({
      'packages/core/src/a.ts': '// fetch( and process.env are mentioned only here\n/* eval( */\nexport const a = 1\n',
      'packages/core/src/a.test.ts': "import { readFileSync } from 'node:fs'\n",
    })
    expect(checkBoundaries(root)).toEqual([])
  })

  it('flags an adapter importing another adapter, in code and in package.json (AD-2)', () => {
    const root = workspace({
      'packages/github/src/a.ts': "import { x } from '@pr-reviewer/providers'\nimport { y } from '@pr-reviewer/core'\n",
      'packages/github/package.json': JSON.stringify({ dependencies: { '@pr-reviewer/providers': 'workspace:*' } }),
    })
    const v = checkBoundaries(root)
    expect(v).toHaveLength(2)
    expect(v.join('\n')).toContain("adapter 'github' imports '@pr-reviewer/providers'")
  })

  it('lets Channels import adapters only in src/compose.ts (composition root)', () => {
    const bad = workspace({ 'packages/cli/src/main.ts': "import { a } from '@pr-reviewer/github'\n" })
    expect(checkBoundaries(bad).join('\n')).toContain("outside src/compose.ts")
    const root = workspace({
      'packages/cli/src/compose.ts': "import { a } from '@pr-reviewer/github'\nimport { readFileSync } from 'node:fs'\n",
      'packages/cli/package.json': JSON.stringify({ dependencies: { '@pr-reviewer/github': 'workspace:*' } }),
    })
    expect(checkBoundaries(root)).toEqual([])
  })

  it('flags hardcoded repositories in product code but not in tests (FR-1)', () => {
    const root = workspace({
      'packages/cli/src/a.ts': "export const DEFAULT = 'https://github.com/some-org/some-repo'\n",
      'packages/cli/src/a.test.ts': "const fixture = 'https://github.com/octo/app/pull/1'\n",
      'packages/github/src/b.ts': "export const api = 'https://api.github.com'\nexport const web = 'github.com'\n",
    })
    const v = checkBoundaries(root)
    expect(v).toHaveLength(1)
    expect(v[0]).toContain("hardcoded repository 'github.com/some-org/some-repo'")
  })

  it('flags core depending on any internal package', () => {
    const root = workspace({
      'packages/core/src/a.ts': "export { a } from '@pr-reviewer/github'\n",
    })
    expect(checkBoundaries(root).join('\n')).toContain("core imports internal package '@pr-reviewer/github'")
  })
})
