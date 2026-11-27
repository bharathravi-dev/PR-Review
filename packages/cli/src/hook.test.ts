import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { hookCommand, HOOK_MARKER } from './hook.js'
import type { CliDeps } from './deps.js'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function makeDeps(cwd: string): CliDeps {
  return {
    env: {},
    fetch: globalThis.fetch,
    platform: process.platform,
    homedir: cwd,
    credentials: { resolve: async () => ({ ok: false as const, error: { code: 'missing', message: 'none', retryable: false } }) },
    isTTY: false,
    prompt: async () => '',
    openUrl: () => undefined,
    untilStopped: async () => undefined,
    runGh: async () => ({ code: 1, stdout: '', stderr: '' }),
    cwd,
    run: async (_cmd, args) => {
      if (args[0] === 'rev-parse') return { code: 0, stdout: '.git/hooks/pre-push\n', stderr: '', timedOut: false }
      return { code: 1, stdout: '', stderr: '', timedOut: false }
    },
  }
}

describe('pr-reviewer hook command', () => {
  it('installs, inspects status, refuses clobbering unmanaged hook, and uninstalls safely', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prr-hook-'))
    dirs.push(dir)
    const hookFile = join(dir, '.git/hooks/pre-push')
    let out = ''
    let err = ''
    const io = { stdout: (t: string) => (out += t), stderr: (t: string) => (err += t) }
    const deps = makeDeps(dir)

    expect(await hookCommand(['install', '--no-warnings-ok'], io, deps, () => 64)).toBe(0)
    expect(existsSync(hookFile)).toBe(true)
    const script = readFileSync(hookFile, 'utf8')
    expect(script).toContain(HOOK_MARKER)
    expect(script).toContain('pr-reviewer review --local --no-local-tools')
    expect(script).not.toContain('--warnings-ok')

    out = ''
    expect(await hookCommand(['status'], io, deps, () => 64)).toBe(0)
    expect(out).toContain('Installed (managed by pr-reviewer')

    expect(await hookCommand(['uninstall'], io, deps, () => 64)).toBe(0)
    expect(existsSync(hookFile)).toBe(false)

    // Refuses removing or overwriting an unmanaged user hook without --force.
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(dir, '.git/hooks'), { recursive: true })
    writeFileSync(hookFile, '#!/bin/sh\necho custom\n')
    expect(await hookCommand(['install'], io, deps, () => 64)).toBe(4)
    expect(await hookCommand(['uninstall'], io, deps, () => 64)).toBe(4)
    expect(readFileSync(hookFile, 'utf8')).toContain('custom')
    expect(err).toContain('--force')
  })
})
