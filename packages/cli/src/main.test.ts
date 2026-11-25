import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { main } from './main.js'

const pkgUrl = new URL('../package.json', import.meta.url)
const pkg = JSON.parse(readFileSync(pkgUrl, 'utf8')) as { version: string; engines: { node: string } }

function run(argv: string[]) {
  let out = ''
  let err = ''
  const code = main(argv, { stdout: (t) => (out += t), stderr: (t) => (err += t) })
  return code.then((c) => ({ code: c, out, err }))
}

describe('pr-reviewer CLI', () => {
  it('prints the package version and exits 0', async () => {
    for (const flag of ['--version', '-v']) {
      const r = await run([flag])
      expect(r).toEqual({ code: 0, out: `${pkg.version}\n`, err: '' })
    }
  })

  it('prints help with the documented commands and exits 0', async () => {
    for (const argv of [['--help'], ['-h'], ['help'], []]) {
      const r = await run(argv)
      expect(r.code).toBe(0)
      expect(r.out).toContain('Usage: pr-reviewer <command> [options]')
      expect(r.out).toContain('--version')
      expect(r.err).toBe('')
    }
  })

  it('rejects an unknown command with exit 64 and usage on stderr', async () => {
    const r = await run(['frobnicate'])
    expect(r.code).toBe(64)
    expect(r.out).toBe('')
    expect(r.err).toContain('Unknown command: frobnicate')
    expect(r.err).toContain('Usage:')
  })

  it('rejects an unknown option and extra arguments with exit 64', async () => {
    expect((await run(['--frob'])).code).toBe(64)
    expect((await run(['--version', 'extra'])).code).toBe(64)
  })

  it('declares Node >= 22 in engines', () => {
    expect(pkg.engines.node).toBe('>=22')
  })

  const bin = fileURLToPath(new URL('../bin/pr-reviewer.js', import.meta.url))
  const built = existsSync(fileURLToPath(new URL('../dist/index.js', import.meta.url)))

  it.skipIf(!built)('runs as an installed binary', () => {
    expect(execFileSync(process.execPath, [bin, '--version'], { encoding: 'utf8' })).toBe(`${pkg.version}\n`)
    const unknown = spawnSync(process.execPath, [bin, 'nope'], { encoding: 'utf8' })
    expect(unknown.status).toBe(64)
  })
})
