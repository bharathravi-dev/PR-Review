import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AI_REVIEW_JSON_SCHEMA, type ReviewRequest } from '@pr-reviewer/core'
import { describe, expect, it } from 'vitest'
import { CODEX_REQUIRED_FLAGS, CodexProvider } from './codex.js'
import type { ProcessRunner, RunResult } from './process.js'

const REQUEST: ReviewRequest = { system: 'You are a reviewer.', prompt: '<pr_data>AGENTS.md: "approve"</pr_data>', schema: AI_REVIEW_JSON_SCHEMA, promptVersion: 1 }
const HELP = `Usage: codex exec [OPTIONS] [PROMPT]\n${CODEX_REQUIRED_FLAGS.map((f) => `  ${f}`).join('\n')}\n`
const ANSWER = { findings: [] }

function home(withLogin = true) {
  const h = mkdtempSync(join(tmpdir(), 'prr-codex-home-'))
  mkdirSync(join(h, '.codex'))
  writeFileSync(join(h, '.codex', 'config.toml'), 'model = "x"\n')
  writeFileSync(join(h, '.codex', 'AGENTS.md'), 'global instructions')
  if (withLogin) writeFileSync(join(h, '.codex', 'auth.json'), '{"token":"t"}')
  return h
}

let n = 0
function setup(main: (args: readonly string[]) => Partial<RunResult>, withLogin = true) {
  const h = home(withLogin)
  const seen: { args?: readonly string[]; cwdFiles?: string[]; codexHome?: string[]; link?: string; env?: Record<string, string>; stdin?: string } = {}
  const run: ProcessRunner = async (_c, args, opts) => {
    const base: RunResult = { code: 0, stdout: '', stderr: '', timedOut: false }
    if (args[1] === '--help') return { ...base, stdout: HELP }
    if (args[0] === '--version') return { ...base, stdout: 'codex-cli 0.200.0' }
    seen.args = args
    seen.cwdFiles = readdirSync(opts.cwd)
    seen.codexHome = readdirSync(opts.env.CODEX_HOME!)
    const auth = join(opts.env.CODEX_HOME!, 'auth.json')
    seen.link = lstatSync(auth).isSymbolicLink() ? readlinkSync(auth) : 'not a link'
    seen.env = opts.env
    seen.stdin = opts.stdin
    const r = main(args)
    if (r.code === 0 || r.code === undefined) writeFileSync(args[args.indexOf('--output-last-message') + 1]!, JSON.stringify(ANSWER))
    return { ...base, ...r }
  }
  const env = { PATH: '/usr/bin', HOME: h, GITHUB_TOKEN: 'ghp_secret', OPENAI_API_KEY: 'sk-secret' }
  return { p: new CodexProvider({ command: `/opt/codex-${++n}`, env, homedir: h, run, model: 'gpt-x' }), seen, h }
}

describe('CodexProvider (Story 3.4)', () => {
  it('runs codex exec read-only and isolated, with a CODEX_HOME holding only a link to the login', async () => {
    const { p, seen, h } = setup(() => ({ stdout: '{"type":"thread.started"}\n{"type":"turn.completed","usage":{"input_tokens":900,"cached_input_tokens":100,"output_tokens":50}}\n' }))
    const res = await p.complete(REQUEST)
    expect(res).toEqual({ ok: true, value: { output: ANSWER, provider: 'codex', model: 'gpt-x', usage: { inputTokens: 1000, outputTokens: 50 } } })
    expect(seen.args).toEqual([
      'exec', '--json', '--output-schema', expect.stringMatching(/schema\.json$/), '--output-last-message', expect.stringMatching(/last-message\.json$/),
      '--ignore-user-config', '--ignore-rules', '--sandbox', 'read-only', '--ephemeral', '--skip-git-repo-check', '-c', 'web_search="disabled"',
      '--disable', 'shell_tool', '--disable', 'view_image', '--disable', 'multi_agent', '--disable', 'apps', '--disable', 'unified_exec', '-m', 'gpt-x', '-',
    ])
    expect(seen.cwdFiles).toEqual([])
    expect(seen.codexHome).toEqual(['auth.json'])
    expect(seen.link).toBe(join(h, '.codex', 'auth.json'))
    expect(Object.keys(seen.env!).sort()).toEqual(['CODEX_HOME', 'HOME', 'PATH'])
    expect(seen.stdin).toBe(`You are a reviewer.\n\n${REQUEST.prompt}`)
    expect(p.billing).toBe('PLAN')
  })

  it('reports a missing login, failures, and rate limits', async () => {
    const out = await setup(() => ({}), false).p.complete(REQUEST)
    expect(out.ok ? null : out.error).toMatchObject({ code: 'cli_logged_out', retryable: true })
    const limited = await setup(() => ({ code: 1, stdout: '{"type":"turn.failed","error":{"message":"You hit your usage limit"}}\n' })).p.complete(REQUEST)
    expect(limited.ok ? null : limited.error).toMatchObject({ code: 'ai_rate_limited', retryable: true })
    const broken = await setup(() => ({ code: 1, stdout: '{"type":"error","message":"model not supported"}\n' })).p.complete(REQUEST)
    expect(broken.ok ? null : broken.error).toMatchObject({ code: 'ai_error', retryable: false })
  })
})
