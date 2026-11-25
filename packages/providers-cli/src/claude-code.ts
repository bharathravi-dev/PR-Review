import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { err, ok, type Channel, type Result, type ReviewProvider, type ReviewRequest, type ReviewResponse } from '@pr-reviewer/core'
import { findOnPath, minimalEnv, newestVersionDir, runProcess, tail, withTempDir, type Env, type ProcessRunner } from './process.js'

/** Flags the adapter relies on for isolation (AD-8); a Claude Code without any of them is refused. */
export const CLAUDE_CODE_REQUIRED_FLAGS = [
  '--safe-mode',
  '--tools',
  '--disallowedTools',
  '--strict-mcp-config',
  '--no-session-persistence',
  '--output-format',
  '--json-schema',
  '--system-prompt',
  '--model',
] as const

const API_KEY_HINT = 'Or review with an API key instead: set ANTHROPIC_API_KEY and use the "anthropic" provider.'

export interface ClaudeCodeOptions {
  /** Name from Configuration (default "claude-code"). */
  name?: string | undefined
  /** Path to the `claude` executable. */
  command: string
  /** Model alias or id (e.g. "opus", "sonnet", "claude-opus-5-5"); default: Claude Code's own default. */
  model?: string | undefined
  timeoutMs?: number | undefined
  /** The user's environment; only an allow-list reaches Claude Code. */
  env: Env
  run?: ProcessRunner | undefined
  tmpBase?: string | undefined
  /** Channels allowed; Auto-Review only after the user's explicit opt-in (PRD FR-10). Default CLI only. */
  channels?: readonly Channel[] | undefined
  /** Extra variables passed through: only the vendor CLI's own token, for the Auto-Review opt-in (AD-8). */
  passEnv?: readonly string[] | undefined
}

const checked = new Map<string, Promise<Result<string>>>()

/** Checks once per executable that this Claude Code has every isolation flag; returns its version. */
export function checkClaudeCode(command: string, env: Env, run: ProcessRunner = runProcess): Promise<Result<string>> {
  const key = command
  let p = checked.get(key)
  if (!p) {
    p = withTempDir('pr-reviewer-cc', async (cwd) => {
      const e = minimalEnv(env, {}, ['CLAUDE_CONFIG_DIR'])
      const help = await run(command, ['--help'], { cwd, env: e, stdin: '', timeoutMs: 30_000 })
      if (help.spawnError) {
        return err('cli_missing', `Claude Code was not found at "${command}". Install it from https://claude.com/claude-code and log in. ${API_KEY_HINT}`, true)
      }
      const missing = CLAUDE_CODE_REQUIRED_FLAGS.filter((f) => !new RegExp(`${f.replace(/-/g, '\\-')}\\b`).test(help.stdout))
      const version = (await run(command, ['--version'], { cwd, env: e, stdin: '', timeoutMs: 30_000 })).stdout.trim().split(/\s/)[0] || 'unknown'
      if (missing.length > 0) {
        return err('cli_unsupported', `Claude Code ${version} lacks ${missing.join(', ')}, which pr-reviewer needs to run it safely. Update Claude Code (claude update). ${API_KEY_HINT}`, true)
      }
      return ok(version)
    })
    checked.set(key, p)
    void p.then((r) => {
      if (!r.ok) checked.delete(key)
    })
  }
  return p
}

/**
 * Uses the user's own logged-in Claude Code (Claude subscription) for one structured review (FR-10, AD-8).
 * Runs `claude -p` in an empty temp directory with no tools, no MCP servers, no project or user customisations,
 * no session saved, and an environment without GitHub or API Credentials. The PR reaches it only as text on stdin.
 */
export class ClaudeCodeProvider implements ReviewProvider {
  readonly id: string
  readonly billing = 'PLAN' as const
  /** Subscription use is a manual-Channel feature; Auto-Review needs its own opt-in (PRD FR-10). */
  readonly channels: readonly Channel[]
  readonly #o: ClaudeCodeOptions

  constructor(opts: ClaudeCodeOptions) {
    this.id = opts.name ?? 'claude-code'
    this.channels = opts.channels ?? ['CLI']
    this.#o = opts
  }

  async complete(request: ReviewRequest): Promise<Result<ReviewResponse>> {
    const o = this.#o
    const run = o.run ?? runProcess
    const ready = await checkClaudeCode(o.command, o.env, run)
    if (!ready.ok) return ready

    // Claude Code validates against draft-07; core re-validates the result against the canonical schema.
    const schema = { ...request.schema, $schema: 'http://json-schema.org/draft-07/schema#' }
    const args = [
      '-p',
      '--safe-mode',
      '--tools', '',
      '--disallowedTools', 'mcp__*',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--output-format', 'json',
      '--json-schema', JSON.stringify(schema),
      '--system-prompt', request.system,
      ...(o.model ? ['--model', o.model] : []),
    ]
    const res = await withTempDir('pr-reviewer-cc', (cwd) =>
      run(o.command, args, { cwd, env: minimalEnv(o.env, {}, ['CLAUDE_CONFIG_DIR', ...(o.passEnv ?? [])]), stdin: request.prompt, timeoutMs: o.timeoutMs ?? 900_000 }), o.tmpBase)

    if (res.spawnError) return err('cli_missing', `Could not start Claude Code: ${res.spawnError.message}. ${API_KEY_HINT}`, true)
    if (res.timedOut) return err('ai_timeout', `Claude Code did not finish within ${Math.round((o.timeoutMs ?? 900_000) / 60_000)} minutes.`, true)

    const result = parseResult(res.stdout)
    if (!result) {
      const text = `${res.stderr}\n${res.stdout}`
      if (LOGGED_OUT.test(text)) return loggedOut()
      return err('ai_error', `Claude Code exited with code ${res.code}${tail(text) ? `: ${tail(text)}` : ''}`, res.code !== 0 && /overloaded|rate limit|5\d\d/i.test(text))
    }
    if (result.is_error || result.subtype !== 'success') {
      const text = String(result.result ?? result.subtype ?? '')
      if (LOGGED_OUT.test(text)) return loggedOut()
      const status = Number(result.api_error_status ?? 0)
      if (status === 429 || /rate limit|usage limit|limit reached/i.test(text)) return err('ai_rate_limited', `Claude Code: ${tail(text, 300)}`, true)
      return err('ai_error', `Claude Code reported an error: ${tail(text, 300) || 'unknown'}`, status >= 500)
    }
    if (result.structured_output === undefined || result.structured_output === null) {
      return err('cli_no_structured_output', 'Claude Code answered without structured output; this version may not support --json-schema. Update Claude Code (claude update).')
    }

    const u = result.usage ?? {}
    const model = Object.keys(result.modelUsage ?? {})[0] ?? o.model ?? 'claude-code default'
    return ok({
      output: result.structured_output,
      provider: this.id,
      model,
      usage: {
        inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
        outputTokens: u.output_tokens ?? 0,
        ...(typeof result.total_cost_usd === 'number' ? { costUsd: result.total_cost_usd } : {}),
      },
    })
  }
}

const LOGGED_OUT = /not logged in|log ?in|logged out|\/login|authenticat|oauth token|invalid api key/i

function loggedOut(): Result<never> {
  return err('cli_logged_out', `Claude Code is not logged in. Run "claude" once and log in with your Claude account. ${API_KEY_HINT}`, true)
}

interface ClaudeResult {
  type?: string
  subtype?: string
  is_error?: boolean
  result?: unknown
  api_error_status?: number | null
  structured_output?: unknown
  total_cost_usd?: number
  usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }
  modelUsage?: Record<string, unknown>
}

function parseResult(stdout: string): ClaudeResult | undefined {
  const lines = stdout.trim().split('\n').reverse()
  for (const line of lines) {
    try {
      const v = JSON.parse(line) as ClaudeResult
      if (v && typeof v === 'object' && v.type === 'result') return v
    } catch {
      // not JSON; keep looking
    }
  }
  return undefined
}

/**
 * Finds Claude Code without asking: PATH, the native installer's locations, then the copy bundled with an
 * editor extension (VS Code, Insiders, Cursor, Windsurf, VSCodium), newest version first.
 */
export function findClaudeCode(env: Env, homedir: string, platform: string = process.platform): string | undefined {
  const exe = platform === 'win32' ? 'claude.exe' : 'claude'
  const onPath = findOnPath('claude', env, platform)
  if (onPath) return onPath
  for (const p of [join(homedir, '.claude', 'local', exe), join(homedir, '.local', 'bin', exe)]) if (existsSync(p)) return p
  for (const editor of ['.vscode', '.vscode-insiders', '.cursor', '.windsurf', '.vscode-oss']) {
    const ext = newestVersionDir(join(homedir, editor, 'extensions'), 'anthropic.claude-code-')
    const bin = ext && join(ext, 'resources', 'native-binary', exe)
    if (bin && existsSync(bin)) return bin
  }
  return undefined
}
