import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

export type Env = Readonly<Record<string, string | undefined>>

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  /** Set when the process could not start (e.g. ENOENT). */
  spawnError?: NodeJS.ErrnoException | undefined
  timedOut: boolean
}

/** Runs a process without a shell, writes `stdin`, and collects its output. Injected in tests. */
export type ProcessRunner = (command: string, args: readonly string[], opts: { cwd: string; env: Record<string, string>; stdin: string; timeoutMs: number }) => Promise<RunResult>

const MAX_OUTPUT = 32 * 1024 * 1024

export const runProcess: ProcessRunner = (command, args, opts) =>
  new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const done = (r: Omit<RunResult, 'stdout' | 'stderr' | 'timedOut'>) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ...r, stdout, stderr, timedOut })
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, args, { cwd: opts.cwd, env: opts.env, stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true })
    } catch (e) {
      resolve({ code: null, stdout: '', stderr: '', spawnError: e as NodeJS.ErrnoException, timedOut: false })
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
    child.on('error', (e) => done({ code: null, spawnError: e }))
    child.on('close', (code) => done({ code }))
    child.stdin!.on('error', () => undefined)
    child.stdin!.end(opts.stdin)
  })

/**
 * Variables a vendor CLI may see (AD-8): enough to find its own login and reach the network, nothing else.
 * GitHub tokens, API keys, and every other variable are left out.
 */
const PASS_THROUGH = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TZ',
  'TMPDIR', 'TEMP', 'TMP',
  'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME', 'XDG_RUNTIME_DIR',
  'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'PATHEXT', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
]

export function minimalEnv(env: Env, extra: Record<string, string> = {}, vendorVars: readonly string[] = []): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of [...PASS_THROUGH, ...vendorVars]) {
    const v = env[k]
    if (v !== undefined && v !== '') out[k] = v
  }
  return { ...out, ...extra }
}

/** A fresh, empty directory outside any repository, removed afterwards (AD-8). */
export async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>, base = tmpdir()): Promise<T> {
  const dir = mkdtempSync(join(base, `${prefix}-`))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Finds an executable on PATH (no shell). */
export function findOnPath(name: string, env: Env, platform: string = process.platform): string | undefined {
  const exts = platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase()) : ['']
  for (const dir of (env.PATH ?? '').split(platform === 'win32' ? ';' : delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = join(dir, `${name}${ext}`)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

/** Highest-versioned directory matching `<prefix><version>...` in `dir`. */
export function newestVersionDir(dir: string, prefix: string): string | undefined {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return undefined
  }
  const parse = (name: string) => (/^(\d+)\.(\d+)\.(\d+)/.exec(name.slice(prefix.length)) ?? []).slice(1).map(Number)
  const matches = entries.filter((e) => e.startsWith(prefix) && parse(e).length === 3)
  matches.sort((a, b) => {
    const [x, y] = [parse(a), parse(b)]
    return y[0]! - x[0]! || y[1]! - x[1]! || y[2]! - x[2]!
  })
  return matches[0] ? join(dir, matches[0]) : undefined
}

/** Last `max` characters of process output, for error messages. */
export function tail(text: string, max = 400): string {
  const t = text.trim()
  return t.length > max ? `…${t.slice(-max)}` : t
}
