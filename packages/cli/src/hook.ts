// `pr-reviewer hook <install|uninstall|status>`: installs a managed git pre-push hook running `pr-reviewer review --local`.
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { EXIT_CODES } from '@pr-reviewer/core'
import { runProcess } from './compose.js'
import type { CliDeps, CliIo } from './deps.js'

export const HOOK_MARKER = '# pr-reviewer managed pre-push hook'

type Run = NonNullable<CliDeps['run']>

async function gitHookPath(run: Run, cwd: string, env: CliDeps['env']): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const res = await run('git', ['rev-parse', '--git-path', 'hooks/pre-push'], {
    cwd,
    env: { PATH: env.PATH ?? '', HOME: env.HOME ?? '' },
    stdin: '',
    timeoutMs: 10_000,
  })
  if (res.code !== 0 || res.spawnError || !res.stdout.trim()) {
    return { ok: false, error: 'Run inside a git repository to manage its pre-push hook.' }
  }
  return { ok: true, path: resolve(cwd, res.stdout.trim()) }
}

export function buildHookScript(opts: { allowLocalTools?: boolean | undefined; warningsOk?: boolean | undefined }): string {
  const flags = [
    '--local',
    opts.allowLocalTools ? '--allow-local-tools' : '--no-local-tools',
    ...(opts.warningsOk !== false ? ['--warnings-ok'] : []),
  ]
  return [
    '#!/usr/bin/env sh',
    HOOK_MARKER,
    '# Runs pr-reviewer on local changes before pushing. Remove with: pr-reviewer hook uninstall',
    `pr-reviewer review ${flags.join(' ')}`,
    '',
  ].join('\n')
}

export async function hookCommand(args: string[], io: CliIo, deps: CliDeps, usage: (m: string) => number): Promise<number> {
  const [sub, ...rest] = args
  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
    io.stdout(
      [
        'Usage: pr-reviewer hook <install|uninstall|status> [options]',
        '',
        'Install options:',
        '  --force              Replace an existing unmanaged pre-push hook',
        '  --allow-local-tools  Run repo compile/lint tools locally if Docker is unavailable',
        '  --no-warnings-ok     Block push on PASSED_WITH_WARNINGS as well as FAILED',
        '',
      ].join('\n'),
    )
    return EXIT_CODES.passed
  }
  if (!['install', 'uninstall', 'status'].includes(sub)) return usage(`Unknown hook subcommand: ${sub}`)

  let parsed
  try {
    parsed = parseArgs({
      args: rest,
      allowPositionals: false,
      options: {
        force: { type: 'boolean' },
        'allow-local-tools': { type: 'boolean' },
        'no-warnings-ok': { type: 'boolean' },
      },
    })
  } catch (e) {
    return usage((e as Error).message)
  }

  const cwd = deps.cwd ?? process.cwd()
  const run: Run = deps.run ?? runProcess
  const loc = await gitHookPath(run, cwd, deps.env)
  if (!loc.ok) {
    io.stderr(`${loc.error}\n`)
    return EXIT_CODES.error
  }

  const hookPath = loc.path
  const exists = existsSync(hookPath)
  const current = exists ? readFileSync(hookPath, 'utf8') : ''
  const managed = exists && current.includes(HOOK_MARKER)

  if (sub === 'status') {
    if (!exists) io.stdout(`Not installed (${hookPath}).\n`)
    else if (managed) io.stdout(`Installed (managed by pr-reviewer at ${hookPath}).\n`)
    else io.stdout(`Existing custom pre-push hook found at ${hookPath} (not managed by pr-reviewer).\n`)
    return EXIT_CODES.passed
  }

  if (sub === 'uninstall') {
    if (!exists) {
      io.stdout('No pre-push hook is installed.\n')
      return EXIT_CODES.passed
    }
    if (!managed) {
      io.stderr(`Refusing to remove ${hookPath}: it was not created by pr-reviewer.\n`)
      return EXIT_CODES.error
    }
    unlinkSync(hookPath)
    io.stdout(`Removed ${hookPath}.\n`)
    return EXIT_CODES.passed
  }

  if (exists && !managed && !parsed.values.force) {
    io.stderr(`A pre-push hook already exists at ${hookPath}. Re-run with --force to replace it.\n`)
    return EXIT_CODES.error
  }

  mkdirSync(dirname(hookPath), { recursive: true })
  const script = buildHookScript({
    allowLocalTools: parsed.values['allow-local-tools'] === true,
    warningsOk: parsed.values['no-warnings-ok'] !== true,
  })
  writeFileSync(hookPath, script, 'utf8')
  chmodSync(hookPath, 0o755)
  io.stdout(`Installed pre-push hook at ${hookPath}.\n`)
  return EXIT_CODES.passed
}
