// Host fallback Sandbox: used ONLY when no container runtime (Docker/Podman) is available AND the user explicitly
// grants permission (`sandbox.localFallback: allow` or interactive TTY confirmation). Never active silently.
import { spawn } from 'node:child_process'
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, realpathSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { err, ok, type Result, type SandboxPlan, type SandboxPort, type SandboxRunResult, type SandboxStep, type SandboxStepResult } from '@pr-reviewer/core'
import type { CommandResult } from './docker.js'

export type HostRunner = (
  command: string,
  args: readonly string[],
  opts: { cwd?: string | undefined; env?: NodeJS.ProcessEnv | undefined; timeoutMs: number; stdin?: Uint8Array | undefined },
) => Promise<CommandResult>

const MAX_OUTPUT = 10 * 1024 * 1024

export const runHostCommand: HostRunner = (command, args, opts) =>
  new Promise((resolvePromise) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, args, {
        ...(opts.cwd ? { cwd: opts.cwd } : {}),
        ...(opts.env ? { env: opts.env } : {}),
        stdio: [opts.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      })
    } catch (e) {
      resolvePromise({ code: null, stdout, stderr, timedOut, spawnError: (e as Error).message })
      return
    }
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, opts.timeoutMs)
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      if (stdout.length < MAX_OUTPUT) stdout += d
    })
    child.stderr!.setEncoding('utf8').on('data', (d: string) => {
      if (stderr.length < MAX_OUTPUT) stderr += d
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolvePromise({ code: null, stdout, stderr, timedOut, spawnError: e.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolvePromise({ code, stdout, stderr, timedOut })
    })
    if (opts.stdin) {
      child.stdin!.on('error', () => undefined)
      child.stdin!.end(opts.stdin)
    }
  })

function minimalHostEnv(scratch: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: join(scratch, 'home'),
    CI: 'true',
    TMPDIR: join(scratch, 'tmp'),
    npm_config_cache: join(scratch, 'npm-cache'),
    npm_config_update_notifier: 'false',
    npm_config_userconfig: '/dev/null',
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    ...(process.env.SYSTEMROOT ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}),
    ...(process.env.COMSPEC ? { COMSPEC: process.env.COMSPEC } : {}),
  }
}

/** Strips any symlink inside `dir` whose resolved target leaves `rootReal` (prevents host file leaks). */
function stripEscapingSymlinks(dir: string, rootReal: string): void {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    const st = lstatSync(p)
    if (st.isSymbolicLink()) {
      const target = resolve(dir, readlinkSync(p))
      if (target !== rootReal && !target.startsWith(`${rootReal}/`)) unlinkSync(p)
    } else if (st.isDirectory()) {
      stripEscapingSymlinks(p, rootReal)
    }
  }
}

/** Rewrites container-only `/work` and `/scratch` paths inside step commands to quoted temporary host paths. */
export function rewriteStepCmd(cmd: readonly string[], workDir: string, scratchDir: string): string[] {
  const safeScratch = scratchDir.replace(/['\\]/g, '')
  const safeWork = workDir.replace(/['\\]/g, '')
  return cmd.map((part) => part.replaceAll('/scratch', safeScratch).replaceAll('"/work"', `"${safeWork}"`))
}

/**
 * Runs sandbox steps directly on the host inside an isolated, stripped-env ephemeral temp directory when approved by the user.
 */
export class HostFallbackSandbox implements SandboxPort {
  readonly #run: HostRunner
  readonly #nodeMajor: number

  constructor(opts: { run?: HostRunner | undefined; nodeMajor?: number | undefined } = {}) {
    this.#run = opts.run ?? runHostCommand
    this.#nodeMajor = opts.nodeMajor ?? (Number(process.versions.node.split('.')[0]) || 24)
  }

  async probe(): Promise<Result<{ runtime: string; nodeMajors: number[]; egressControl: boolean; hostFallback: boolean }>> {
    const node = await this.#run('node', ['--version'], {
      timeoutMs: 5_000,
      env: { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin' },
    })
    if (node.code !== 0) return err('host_node_missing', 'Node.js is not available on PATH for local fallback.')
    return ok({ runtime: `local-host (Node ${node.stdout.trim()})`, nodeMajors: [this.#nodeMajor], egressControl: false, hostFallback: true })
  }

  async run(plan: SandboxPlan, planHash: string, source: { headSha: string; archive: Uint8Array }): Promise<Result<SandboxRunResult>> {
    const base = mkdtempSync(join(tmpdir(), 'prr-local-'))
    const work = join(base, 'work')
    const scratch = join(base, 'scratch')
    mkdirSync(work, { recursive: true })
    mkdirSync(join(scratch, 'home'), { recursive: true })
    mkdirSync(join(scratch, 'tmp'), { recursive: true })
    const cleanup = () => {
      try {
        rmSync(base, { recursive: true, force: true })
      } catch {
        // best-effort cleanup
      }
    }
    const onSignal = () => cleanup()
    process.once('SIGINT', onSignal)
    process.once('SIGTERM', onSignal)
    try {
      const extract = await this.#run('tar', ['-xzf', '-', '-C', work, '--strip-components=1', '--no-same-owner', '--no-same-permissions'], {
        timeoutMs: 120_000,
        stdin: source.archive,
        env: minimalHostEnv(scratch),
      })
      if (extract.code !== 0) {
        return err('host_extract_failed', `Could not unpack PR archive locally: ${(extract.stderr || extract.spawnError || '').trim()}`)
      }
      const workReal = realpathSync(work)
      stripEscapingSymlinks(work, workReal)
      const env = minimalHostEnv(scratch)
      const results: SandboxStepResult[] = []
      for (const step of plan.steps) {
        results.push(await this.#execStep(step, work, workReal, scratch, env))
      }
      return ok({ planHash, headSha: source.headSha, imageDigest: 'local-host-user-approved', results })
    } finally {
      process.off('SIGINT', onSignal)
      process.off('SIGTERM', onSignal)
      cleanup()
    }
  }

  async #execStep(step: SandboxStep, work: string, workReal: string, scratch: string, env: NodeJS.ProcessEnv): Promise<SandboxStepResult> {
    const rel = step.cwd.replace(/^\/+|\/+$/g, '')
    const cwd = rel ? resolve(work, rel) : work
    if (cwd !== work && !cwd.startsWith(`${work}/`)) {
      return { id: step.id, exitCode: 1, stdout: '', stderr: 'Invalid step working directory.', timedOut: false, durationMs: 0 }
    }
    const [cmd, ...args] = rewriteStepCmd(step.cmd, work, scratch)
    const started = Date.now()
    const r = await this.#run(cmd!, args, { cwd, env, timeoutMs: step.timeoutMs })
    const normalizeOut = (s: string) => s.replaceAll(workReal, '/work').replaceAll(work, '/work')
    return {
      id: step.id,
      exitCode: r.code,
      stdout: normalizeOut(r.stdout),
      stderr: normalizeOut(r.stderr),
      timedOut: r.timedOut,
      durationMs: Date.now() - started,
      ...(r.spawnError ? { skipped: `local tool failed to start: ${r.spawnError}` } : {}),
    }
  }
}

/**
 * Tries the primary container Sandbox first; ONLY when no container runtime is found does it ask permission before falling back to HostFallbackSandbox.
 */
export class FallbackSandbox implements SandboxPort {
  readonly #primary: SandboxPort
  readonly #fallback: SandboxPort
  readonly #allowFallback: (reason: string) => Promise<boolean>
  #active: SandboxPort | undefined

  constructor(opts: { primary: SandboxPort; fallback?: SandboxPort; allowFallback: (reason: string) => Promise<boolean> }) {
    this.#primary = opts.primary
    this.#fallback = opts.fallback ?? new HostFallbackSandbox()
    this.#allowFallback = opts.allowFallback
  }

  async probe(): Promise<Result<{ runtime: string; nodeMajors: number[]; egressControl: boolean; hostFallback?: boolean | undefined }>> {
    const p = await this.#primary.probe()
    // Never downgrade a working container runtime (even without egressControl) to unsandboxed host execution.
    if (p.ok) {
      this.#active = this.#primary
      return p
    }
    if (await this.#allowFallback(p.error.message)) {
      const fb = await this.#fallback.probe()
      this.#active = fb.ok ? this.#fallback : this.#primary
      return fb
    }
    this.#active = this.#primary
    return p
  }

  async run(plan: SandboxPlan, planHash: string, source: { headSha: string; archive: Uint8Array }): Promise<Result<SandboxRunResult>> {
    return (this.#active ?? this.#primary).run(plan, planHash, source)
  }
}
