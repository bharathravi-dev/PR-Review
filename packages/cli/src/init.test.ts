import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DefaultCredentialResolver } from '@pr-reviewer/credentials'
import { CLAUDE_CODE_REQUIRED_FLAGS } from '@pr-reviewer/providers-cli'
import { describe, expect, it } from 'vitest'
import { main } from './main.js'

/** A fake `claude` on PATH that answers the test call. */
function fakeClaudeOnPath(dir: string, ok = true): string {
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  const help = CLAUDE_CODE_REQUIRED_FLAGS.map((f) => `  ${f} <x>`).join('\\n')
  const answer = ok
    ? JSON.stringify({ type: 'result', subtype: 'success', is_error: false, structured_output: { findings: [] }, usage: { input_tokens: 5, output_tokens: 5 }, modelUsage: { 'claude-opus-5-5': {} } })
    : JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: 'Not logged in · Please run /login' })
  writeFileSync(
    join(bin, 'claude'),
    `#!${process.execPath}\nconst a = process.argv[2]\nif (a === '--help') { console.log('Usage\\n${help}'); process.exit(0) }\nif (a === '--version') { console.log('9.9.9 (Claude Code)'); process.exit(0) }\nprocess.stdin.resume(); process.stdin.on('end', () => console.log(${JSON.stringify(answer)}))\n`,
  )
  chmodSync(join(bin, 'claude'), 0o755)
  return bin
}

const anthropic401 = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new Request(input, init).url
  if (url === 'https://api.github.com/user') return Response.json({ id: 1, login: 'me' })
  if (url.startsWith('https://api.anthropic.com/')) return Response.json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, { status: 401 })
  return new Response('{}', { status: 404 })
}) as typeof fetch

function setup(env: Record<string, string>, claudeOk = true, withClaude = true) {
  const dir = mkdtempSync(join(tmpdir(), 'prr-init-'))
  const bin = withClaude ? fakeClaudeOnPath(dir, claudeOk) : join(dir, 'empty')
  const configPath = join(dir, 'config', 'config.yml')
  const fullEnv = { PATH: bin, HOME: dir, PR_REVIEWER_CONFIG: configPath, PR_REVIEWER_STATE_DIR: join(dir, 'state'), ...env }
  const run = async (argv: string[], answers: string[] = [], isTTY = false) => {
    let err = ''
    const code = await main(argv, { stdout: () => undefined, stderr: (t) => (err += t) }, {
      env: fullEnv,
      fetch: anthropic401,
      homedir: dir,
      isTTY,
      prompt: async () => answers.shift() ?? '',
      credentials: new DefaultCredentialResolver({ env: fullEnv, keychain: async () => undefined, ghToken: async () => undefined }),
    })
    return { code, err }
  }
  return { run, configPath }
}

describe('pr-reviewer init (Story 3.6)', () => {
  it('finds Claude Code and keys, tests each, reports a bad key, and writes references only', async () => {
    const { run, configPath } = setup({ GITHUB_TOKEN: 'gh-token-0000', ANTHROPIC_API_KEY: 'sk-ant-bad-key-0000' })
    const r = await run(['init'])
    expect(r.code).toBe(0)
    expect(r.err).toContain('✓ GitHub: signed in as @me')
    expect(r.err).toContain('✓ Claude Code (your Claude plan)')
    expect(r.err).toContain('✗ Anthropic API key: The Anthropic API key was rejected.')
    const text = readFileSync(configPath, 'utf8')
    expect(text).toContain('defaultProvider: claude-code')
    expect(text).toContain('type: claude-code')
    expect(text).not.toContain('anthropic:')
    expect(text).not.toContain('sk-ant')
    expect(text).not.toContain('gh-token')
    expect(text).not.toContain('command:')

    // An existing config is kept unless --force; with --force the old one is backed up.
    expect((await run(['init'])).code).toBe(64)
    expect((await run(['init', '--force'])).code).toBe(0)
    expect(existsSync(`${configPath}.bak`)).toBe(true)
  })

  it('asks which provider is the default and makes the rest fallbacks', async () => {
    const good = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new Request(input, init).url
      if (url.startsWith('https://api.anthropic.com/')) {
        return Response.json({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: '{"findings":[]}' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } })
      }
      return anthropic401(input, init)
    }) as typeof fetch
    const dir = mkdtempSync(join(tmpdir(), 'prr-init-'))
    const bin = fakeClaudeOnPath(dir)
    const configPath = join(dir, 'config.yml')
    const env = { PATH: bin, HOME: dir, PR_REVIEWER_CONFIG: configPath, ANTHROPIC_API_KEY: 'sk-ant-good-0000' }
    const answers = ['2']
    const code = await main(['init'], { stdout: () => undefined, stderr: () => undefined }, {
      env,
      fetch: good,
      homedir: dir,
      isTTY: true,
      prompt: async () => answers.shift() ?? '',
      credentials: new DefaultCredentialResolver({ env, keychain: async () => undefined, ghToken: async () => undefined }),
    })
    expect(code).toBe(0)
    const text = readFileSync(configPath, 'utf8')
    expect(text).toContain('defaultProvider: anthropic')
    expect(text).toMatch(/fallback:\n {2}- claude-code/)
  })

  it('explains the options and writes nothing when no AI works', async () => {
    const { run, configPath } = setup({}, false)
    const r = await run(['init'])
    expect(r.code).toBe(78)
    expect(r.err).toContain('✗ Claude Code (your Claude plan)')
    expect(r.err).toContain('is not logged in')
    expect(r.err).toContain('No working AI provider was found')
    expect(existsSync(configPath)).toBe(false)
  })
})
