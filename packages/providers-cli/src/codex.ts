import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { err, ok, type Channel, type Result, type ReviewProvider, type ReviewRequest, type ReviewResponse } from '@pr-reviewer/core'
import { findOnPath, minimalEnv, runProcess, tail, withTempDir, type Env, type ProcessRunner } from './process.js'

/** `codex exec` flags the adapter relies on for isolation (AD-8); a Codex without any of them is refused. */
export const CODEX_REQUIRED_FLAGS = ['--json', '--output-schema', '--output-last-message', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--skip-git-repo-check', '--sandbox', '--disable'] as const

const API_KEY_HINT = 'Or review with an API key instead: set OPENAI_API_KEY and configure an "openai-compatible" provider.'

/** Optional Codex tools switched off for a review (AD-8). */
const DISABLED_FEATURES = ['shell_tool', 'view_image', 'multi_agent', 'apps', 'unified_exec']

export interface CodexOptions {
  name?: string | undefined
  /** Path to the `codex` executable. */
  command: string
  model?: string | undefined
  timeoutMs?: number | undefined
  env: Env
  homedir: string
  run?: ProcessRunner | undefined
  tmpBase?: string | undefined
}

const checked = new Map<string, Promise<Result<string>>>()

export function checkCodex(command: string, env: Env, run: ProcessRunner = runProcess): Promise<Result<string>> {
  let p = checked.get(command)
  if (!p) {
    p = withTempDir('pr-reviewer-codex', async (cwd) => {
      const e = minimalEnv(env)
      const help = await run(command, ['exec', '--help'], { cwd, env: e, stdin: '', timeoutMs: 30_000 })
      if (help.spawnError) return err('cli_missing', `Codex was not found at "${command}". Install the Codex CLI and run "codex login". ${API_KEY_HINT}`, true)
      const missing = CODEX_REQUIRED_FLAGS.filter((f) => !help.stdout.includes(f))
      const version = (await run(command, ['--version'], { cwd, env: e, stdin: '', timeoutMs: 30_000 })).stdout.trim().split(/\s/).pop() || 'unknown'
      if (missing.length > 0) return err('cli_unsupported', `Codex ${version} lacks ${missing.join(', ')}, which pr-reviewer needs to run it safely. Update Codex. ${API_KEY_HINT}`, true)
      return ok(version)
    })
    checked.set(command, p)
    void p.then((r) => {
      if (!r.ok) checked.delete(command)
    })
  }
  return p
}

/**
 * Uses the user's own logged-in Codex CLI (ChatGPT subscription) for one structured review (FR-10, AD-8).
 * Runs `codex exec` read-only in an empty temp directory, with user config, rules, web search, shell, and optional
 * tools off, and a dedicated CODEX_HOME that holds only a link to the user's Codex login (no user AGENTS.md or
 * config). The PR reaches it only as text on stdin.
 */
export class CodexProvider implements ReviewProvider {
  readonly id: string
  readonly billing = 'PLAN' as const
  readonly channels: readonly Channel[] = ['CLI']
  readonly #o: CodexOptions

  constructor(opts: CodexOptions) {
    this.id = opts.name ?? 'codex'
    this.#o = opts
  }

  async complete(request: ReviewRequest): Promise<Result<ReviewResponse>> {
    const o = this.#o
    const run = o.run ?? runProcess
    const ready = await checkCodex(o.command, o.env, run)
    if (!ready.ok) return ready

    const login = join(o.env.CODEX_HOME ?? join(o.homedir, '.codex'), 'auth.json')
    if (!existsSync(login)) return loggedOut()

    return withTempDir(
      'pr-reviewer-codex',
      async (root) => {
        const work = join(root, 'work')
        const io = join(root, 'io')
        const home = join(root, 'home')
        for (const d of [work, io, home]) mkdirSync(d)
        // The login is linked, never read or copied by pr-reviewer.
        symlinkSync(login, join(home, 'auth.json'))
        const { $schema: _ignored, ...schema } = request.schema
        const schemaFile = join(io, 'schema.json')
        const lastFile = join(io, 'last-message.json')
        writeFileSync(schemaFile, JSON.stringify(schema))

        const args = [
          'exec',
          '--json',
          '--output-schema', schemaFile,
          '--output-last-message', lastFile,
          '--ignore-user-config',
          '--ignore-rules',
          '--sandbox', 'read-only',
          '--ephemeral',
          '--skip-git-repo-check',
          '-c', 'web_search="disabled"',
          ...DISABLED_FEATURES.flatMap((f) => ['--disable', f]),
          ...(o.model ? ['-m', o.model] : []),
          '-',
        ]
        const res = await run(o.command, args, {
          cwd: work,
          env: minimalEnv(o.env, { CODEX_HOME: home }),
          stdin: `${request.system}\n\n${request.prompt}`,
          timeoutMs: o.timeoutMs ?? 900_000,
        })
        if (res.spawnError) return err('cli_missing', `Could not start Codex: ${res.spawnError.message}. ${API_KEY_HINT}`, true)
        if (res.timedOut) return err('ai_timeout', `Codex did not finish within ${Math.round((o.timeoutMs ?? 900_000) / 60_000)} minutes.`, true)

        const events = parseEvents(res.stdout)
        const failure = events.find((e) => e.type === 'error' || e.type === 'turn.failed')
        if (failure || res.code !== 0) {
          const text = String(failure?.message ?? failure?.error?.message ?? `${res.stderr}\n${res.stdout}`)
          if (LOGGED_OUT.test(text)) return loggedOut()
          if (/rate limit|usage limit|429/i.test(text)) return err('ai_rate_limited', `Codex: ${tail(text, 300)}`, true)
          return err('ai_error', `Codex reported an error: ${tail(text, 300) || `exit code ${res.code}`}`, /5\d\d|overloaded/i.test(text))
        }
        let text: string
        try {
          text = readFileSync(lastFile, 'utf8')
        } catch {
          return err('cli_no_structured_output', 'Codex finished without a final message.')
        }
        let output: unknown
        try {
          output = JSON.parse(text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, '$1'))
        } catch {
          return err('ai_invalid_json', 'Codex did not return valid JSON.')
        }
        const usage = events.filter((e) => e.type === 'turn.completed' && e.usage).at(-1)?.usage
        return ok({
          output,
          provider: this.id,
          model: o.model ?? 'codex default',
          ...(usage ? { usage: { inputTokens: (usage.input_tokens ?? 0) + (usage.cached_input_tokens ?? 0), outputTokens: usage.output_tokens ?? 0 } } : {}),
        })
      },
      o.tmpBase,
    )
  }
}

const LOGGED_OUT = /not logged in|log ?in|logged out|unauthori[sz]ed|401|authenticat/i

function loggedOut(): Result<never> {
  return err('cli_logged_out', `Codex is not logged in. Run "codex login" with your ChatGPT account. ${API_KEY_HINT}`, true)
}

interface CodexEvent {
  type?: string
  message?: string
  error?: { message?: string }
  usage?: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number }
}

function parseEvents(stdout: string): CodexEvent[] {
  return stdout.split('\n').flatMap((line) => {
    try {
      const v = JSON.parse(line) as CodexEvent
      return v && typeof v === 'object' ? [v] : []
    } catch {
      return []
    }
  })
}

export function findCodex(env: Env, platform: string = process.platform): string | undefined {
  return findOnPath('codex', env, platform)
}
