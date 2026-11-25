// Runs the user's own coding agent (Claude Code or Codex, on their plan) in their local checkout to fix review
// findings (`pr-reviewer fix`). Unlike a review, the agent may edit files, but only inside that checkout: no MCP
// servers, no web access, no project or user customisations (so a PR's own agent settings or hooks never run),
// and an environment without GitHub or API credentials. pr-reviewer never commits or pushes.
import { existsSync, mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { err, ok, type Result } from '@pr-reviewer/core'
import { checkClaudeCode } from './claude-code.js'
import { checkCodex } from './codex.js'
import { minimalEnv, runProcess, tail, withTempDir, type Env, type ProcessRunner } from './process.js'

export type FixAgentKind = 'claude-code' | 'codex'

export interface FixAgentOptions {
  kind: FixAgentKind
  /** Path to the agent's executable. */
  command: string
  /** The repository checkout the agent may edit. */
  cwd: string
  prompt: string
  env: Env
  homedir: string
  model?: string | undefined
  timeoutMs?: number | undefined
  run?: ProcessRunner | undefined
}

/** Claude Code tools for fixing: read and edit files only (no shell, no web). */
export const CLAUDE_FIX_TOOLS = 'Read,Edit,Write,Glob,Grep'

/** Runs the agent once with all findings; returns its closing message. */
export async function runFixAgent(o: FixAgentOptions): Promise<Result<{ message: string }>> {
  const run = o.run ?? runProcess
  const timeoutMs = o.timeoutMs ?? 1_800_000
  if (o.kind === 'claude-code') {
    const ready = await checkClaudeCode(o.command, o.env, run)
    if (!ready.ok) return ready
    const args = [
      '-p',
      '--safe-mode',
      '--tools', CLAUDE_FIX_TOOLS,
      '--disallowedTools', 'mcp__*',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--permission-mode', 'acceptEdits',
      '--output-format', 'text',
      ...(o.model ? ['--model', o.model] : []),
    ]
    const res = await run(o.command, args, { cwd: o.cwd, env: minimalEnv(o.env, {}, ['CLAUDE_CONFIG_DIR']), stdin: o.prompt, timeoutMs })
    if (res.spawnError) return err('cli_missing', `Could not start Claude Code: ${res.spawnError.message}`)
    if (res.timedOut) return err('ai_timeout', `Claude Code did not finish within ${Math.round(timeoutMs / 60_000)} minutes.`)
    if (res.code !== 0) return err('ai_error', `Claude Code exited with code ${res.code}${tail(`${res.stderr}\n${res.stdout}`) ? `: ${tail(`${res.stderr}\n${res.stdout}`)}` : ''}`)
    return ok({ message: res.stdout.trim() })
  }

  const ready = await checkCodex(o.command, o.env, run)
  if (!ready.ok) return ready
  const login = join(o.env.CODEX_HOME ?? join(o.homedir, '.codex'), 'auth.json')
  if (!existsSync(login)) return err('cli_logged_out', 'Codex is not logged in. Run "codex login" and try again.')
  return withTempDir('pr-reviewer-fix', async (root) => {
    // A dedicated CODEX_HOME holding only a link to the login: no user config, rules, or AGENTS.md (AD-8).
    const home = join(root, 'home')
    mkdirSync(home)
    symlinkSync(login, join(home, 'auth.json'))
    const last = join(root, 'last-message.txt')
    const args = [
      'exec',
      '--ignore-user-config',
      '--ignore-rules',
      '--ephemeral',
      '--sandbox', 'workspace-write',
      '--output-last-message', last,
      '-c', 'web_search="disabled"',
      ...['view_image', 'multi_agent', 'apps'].flatMap((f) => ['--disable', f]),
      ...(o.model ? ['-m', o.model] : []),
      '-',
    ]
    const res = await run(o.command, args, { cwd: o.cwd, env: minimalEnv(o.env, { CODEX_HOME: home }), stdin: o.prompt, timeoutMs })
    if (res.spawnError) return err('cli_missing', `Could not start Codex: ${res.spawnError.message}`)
    if (res.timedOut) return err('ai_timeout', `Codex did not finish within ${Math.round(timeoutMs / 60_000)} minutes.`)
    if (res.code !== 0) return err('ai_error', `Codex exited with code ${res.code}${tail(`${res.stderr}\n${res.stdout}`) ? `: ${tail(`${res.stderr}\n${res.stdout}`)}` : ''}`)
    const { readFileSync } = await import('node:fs')
    return ok({ message: existsSync(last) ? readFileSync(last, 'utf8').trim() : tail(res.stdout, 2000) })
  })
}
