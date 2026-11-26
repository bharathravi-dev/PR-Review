import { describe, expect, it } from 'vitest'
import type { FileAccessor } from './files.js'
import { changedIdentifiers, excerpt, findRelatedFiles, parseImports, resolveImport, testsFor } from './related.js'

function accessor(files: Record<string, string>): FileAccessor & { reads: string[] } {
  const reads: string[] = []
  return {
    reads,
    list: async () => Object.keys(files).map((path, i) => ({ path, type: 'blob' as const, sha: `s${i}` })),
    treeSha: async () => 't',
    read: async (path) => {
      reads.push(path)
      return files[path]
    },
    notes: () => [],
  }
}

describe('related files: reading imports', () => {
  it('understands JavaScript/TypeScript and Python imports', () => {
    const js = [
      "import { fetchJson, type Opts, retry as again } from './net.js'",
      "import Default, * as ns from '../lib'",
      "export { thing } from './things'",
      "import './side-effect'",
      "const { a, b } = require('./cjs')",
      "const lazy = await import('./lazy')",
      'export function f() { return 1 }',
      "const s = 'x from y'",
    ].join('\n')
    expect(parseImports(js, 'js')).toEqual([
      { spec: './net.js', names: ['fetchJson', 'Opts', 'again'] },
      { spec: '../lib', names: ['Default', 'ns'] },
      { spec: './things', names: ['thing'] },
      { spec: './side-effect', names: [] },
      { spec: './cjs', names: ['a', 'b'] },
      { spec: './lazy', names: [] },
    ])
    const py = 'from .models import User, Group as G\nfrom app.db import (session)\nimport os, app.util\n'
    expect(parseImports(py, 'py')).toEqual([
      { spec: '.models', names: ['User', 'Group'] },
      { spec: 'app.db', names: ['session'] },
      { spec: 'os', names: [] },
      { spec: 'app.util', names: [] },
    ])
  })

  it('resolves local modules against the tree and ignores packages', () => {
    const paths = new Set(['src/net.ts', 'src/lib/index.ts', 'app/models.py', 'app/db/__init__.py', 'src/app/util.py'])
    expect(resolveImport('src/retry.ts', './net.js', 'js', paths)).toBe('src/net.ts')
    expect(resolveImport('src/a/b.ts', '../lib', 'js', paths)).toBe('src/lib/index.ts')
    expect(resolveImport('src/retry.ts', 'react', 'js', paths)).toBeUndefined()
    expect(resolveImport('src/retry.ts', '../../../x', 'js', paths)).toBeUndefined()
    expect(resolveImport('app/views.py', '.models', 'py', paths)).toBe('app/models.py')
    expect(resolveImport('app/views.py', 'app.db', 'py', paths)).toBe('app/db/__init__.py')
    expect(resolveImport('src/app/main.py', 'app.util', 'py', paths)).toBe('src/app/util.py')
    expect(resolveImport('app/views.py', 'os', 'py', paths)).toBeUndefined()
  })

  it('finds tests named after a file, and the names a patch touches', () => {
    const paths = ['src/retry.test.ts', 'src/__tests__/retry.ts', 'other/retry.spec.ts', 'tests/test_models.py', 'src/retryable.test.ts']
    expect(testsFor('src/retry.ts', paths)).toEqual(['src/retry.test.ts', 'src/__tests__/retry.ts'])
    expect(testsFor('app/models.py', paths)).toEqual(['tests/test_models.py'])
    expect([...changedIdentifiers('@@ -1 +1 @@\n-export const retries = 2\n+export const retries = maxRetries(env)\n same')]).toEqual(['retries', 'maxRetries', 'env'])
  })

  it('shows small files whole and big files as excerpts around the relevant names', () => {
    expect(excerpt('a\nb', ['x'], 100)).toEqual({ text: '1: a\n2: b', excerpt: false })
    const big = [...Array.from({ length: 200 }, (_, i) => `const filler${i} = ${i}`), 'export function fetchJson(url) {', '  return get(url)', '}'].join('\n')
    const shown = excerpt(big, ['fetchJson'], 2000, true)
    expect(shown.excerpt).toBe(true)
    expect(shown.text).toContain('201: export function fetchJson(url) {')
    expect(shown.text).not.toContain('1: const filler0')
  })
})

describe('related files: choosing them', () => {
  const files = {
    'src/retry.ts': "import { fetchJson, unusedHelper } from './net.js'\nexport const retries = 3\nexport const go = () => fetchJson('/x')\n",
    'src/net.ts': 'export async function fetchJson(url) { return url }\nexport function unusedHelper() {}\n',
    'src/client.ts': "import { retries } from './retry.js'\nexport const n = retries * 2\n",
    'src/quiet.ts': "import { other } from './retry.js'\nexport const q = other\n",
    'src/retry.test.ts': "import { retries } from './retry.js'\ntest('x', () => expect(retries).toBe(3))\n",
    'node_modules/pkg/index.js': "const { retries } = require('../../src/retry.js')\n",
    'README.md': 'retries',
  }
  const changed = [{ path: 'src/retry.ts', status: 'modified', patch: "@@ -1,2 +1,3 @@\n import x\n-export const retries = 2\n+export const retries = 3\n+export const go = () => fetchJson('/x')", headText: files['src/retry.ts'] }]

  it('picks the imported module the change uses, a caller that uses changed names, and the tests', async () => {
    const fa = accessor(files)
    const { related } = await findRelatedFiles(fa, changed)
    expect(related.map((r) => [r.path, r.relation])).toEqual([
      ['src/net.ts', 'imported by src/retry.ts'],
      ['src/client.ts', 'imports src/retry.ts'],
      ['src/retry.test.ts', 'tests for src/retry.ts'],
    ])
    expect(related[0]!.text).toBe('1: export async function fetchJson(url) { return url }\n2: export function unusedHelper() {}\n3: ')
    expect(fa.reads).not.toContain('node_modules/pkg/index.js')
  })

  it('stays within the file, size, and read limits', async () => {
    const fa = accessor(files)
    const one = await findRelatedFiles(fa, changed, { maxFiles: 1, maxTotalChars: 40_000, maxFileChars: 6_000, maxCallerReads: 1 })
    expect(one.related.map((r) => r.path)).toEqual(['src/net.ts'])
    expect(one.notes[0]).toContain('nearest of')
    expect((await findRelatedFiles(accessor(files), [{ ...changed[0]!, status: 'removed' }])).related).toEqual([])
  })
})
