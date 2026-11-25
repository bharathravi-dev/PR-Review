// `pr-reviewer init` (FR-16): find what the user already has, check each with a test call, write the user config.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseArgs } from 'node:util'
import { AI_REVIEW_JSON_SCHEMA, AiReviewResponse, EXIT_CODES, resolveSettings, type ProviderSettings, type Secret } from '@pr-reviewer/core'
import { stringify } from 'yaml'
import { findClaudeCode, findCodex } from './compose.js'
import { userConfigPath } from './config-file.js'
import type { CliDeps, CliIo } from './deps.js'
import { buildProvider, connectGitHub } from './engine.js'

const EXIT_CONFIG = 78

interface Option {
  name: string
  label: string
  entry: ProviderSettings
}

/** A minimal structured request: proves login, model access, and structured output in one small call. */
const TEST_REQUEST = {
  system: 'You are checking that structured output works. Return an empty findings list.',
  prompt: 'Return {"findings": []}.',
  schema: AI_REVIEW_JSON_SCHEMA,
  promptVersion: 1,
}

export async function initCommand(args: string[], io: CliIo, deps: CliDeps, secrets: Secret[], usage: (m: string) => number): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({ args, allowPositionals: false, options: { yes: { type: 'boolean' }, force: { type: 'boolean' }, 'skip-test': { type: 'boolean' } } })
  } catch (e) {
    return usage((e as Error).message)
  }
  const path = userConfigPath(deps)
  if (existsSync(path) && !parsed.values.force) {
    io.stderr(`A user config already exists at ${path}.\nRun "pr-reviewer init --force" to replace it (the current file is kept as ${path}.bak).\n`)
    return EXIT_CODES.usage
  }
  const interactive = deps.isTTY && !parsed.values.yes
  const ask = async (q: string) => (interactive ? (await deps.prompt(q)).trim() : '')
  const base = resolveSettings({})
  if (!base.ok) throw new Error(base.error.message)

  io.stderr('Looking for what you already have…\n\n')
  const gh = await connectGitHub(base.value, deps, secrets, 'github.com')
  if (gh.viewer) io.stderr(`  ✓ GitHub: signed in as @${gh.viewer.login}\n`)
  else io.stderr(`  ✗ GitHub: ${gh.tokenError ?? gh.viewerError}\n    Run "gh auth login", or set GITHUB_TOKEN. Reviews of public PRs still work without it; posting needs it.\n`)

  // Subscriptions first (no per-token billing), then API keys.
  const options: Option[] = []
  const claude = findClaudeCode(deps.env, deps.homedir, deps.platform)
  if (claude) options.push({ name: 'claude-code', label: `Claude Code (your Claude plan) at ${claude}`, entry: { type: 'claude-code' } })
  const codex = findCodex(deps.env, deps.platform)
  if (codex) options.push({ name: 'codex', label: `Codex (your ChatGPT plan) at ${codex}`, entry: { type: 'codex' } })
  if ((await deps.credentials.resolve('provider:anthropic')).ok) options.push({ name: 'anthropic', label: 'Anthropic API key', entry: { type: 'anthropic' } })
  if ((await deps.credentials.resolve('provider:openai')).ok) {
    const model = await ask('  OpenAI API key found. Which model should it use (e.g. the model id from your OpenAI account)? Press Enter to skip: ')
    if (model) options.push({ name: 'openai', label: `OpenAI API key (${model})`, entry: { type: 'openai-compatible', credential: 'provider:openai', model } })
    else io.stderr('  - OpenAI API key found but skipped: it needs a model (set providers.openai.model later).\n')
  }

  const working: Option[] = []
  for (const o of options) {
    const config = resolveSettings({ user: { version: 1, providers: { [o.name]: o.entry } } })
    if (!config.ok) continue
    const provider = await buildProvider(config.value, o.name, undefined, deps, secrets)
    if (!provider.ok) {
      io.stderr(`  ✗ ${o.label}: ${provider.error.message}\n`)
      continue
    }
    if (parsed.values['skip-test']) {
      io.stderr(`  ? ${o.label}: found (not tested)\n`)
      working.push(o)
      continue
    }
    io.stderr(`  … ${o.label}: making a small test call\n`)
    const res = await provider.value.complete(TEST_REQUEST)
    if (!res.ok) {
      io.stderr(`  ✗ ${o.label}: ${res.error.message}\n`)
      continue
    }
    if (!AiReviewResponse.safeParse(res.value.output).success) {
      io.stderr(`  ✗ ${o.label}: answered, but not in the required structured format.\n`)
      continue
    }
    io.stderr(`  ✓ ${o.label}: works (${res.value.model})\n`)
    working.push(o)
  }

  if (working.length === 0) {
    io.stderr(
      [
        '',
        'No working AI provider was found. Any one of these is enough:',
        '  • Claude plan: install Claude Code (https://claude.com/claude-code), run "claude" once and log in',
        '  • ChatGPT plan: install the Codex CLI and run "codex login"',
        '  • API key: set ANTHROPIC_API_KEY, or OPENAI_API_KEY',
        'Then run "pr-reviewer init" again. Nothing was written.',
        '',
      ].join('\n'),
    )
    return EXIT_CONFIG
  }

  let primary = working[0]!
  if (interactive && working.length > 1) {
    io.stderr(`\nWhich should review by default? The others become fallbacks, in this order.\n${working.map((o, i) => `  ${i + 1}. ${o.label}`).join('\n')}\n`)
    const answer = await ask(`Choose 1-${working.length} [1]: `)
    const pick = Number(answer || '1')
    if (Number.isInteger(pick) && pick >= 1 && pick <= working.length) primary = working[pick - 1]!
  }
  const fallback = working.filter((o) => o !== primary).map((o) => o.name)

  const config = {
    version: 1,
    defaultProvider: primary.name,
    ...(fallback.length ? { fallback } : {}),
    providers: Object.fromEntries(working.map((o) => [o.name, o.entry])),
  }
  const text = [
    `# pr-reviewer user config, written by "pr-reviewer init" on ${new Date().toISOString().slice(0, 10)}.`,
    '# No keys or tokens are stored here: they come from environment variables, the OS keychain, gh, or the',
    '# vendor CLI\'s own login. See "Configuration" in the README for every setting.',
    stringify(config),
  ].join('\n')
  mkdirSync(dirname(path), { recursive: true })
  if (existsSync(path)) copyFileSync(path, `${path}.bak`)
  writeFileSync(path, text, { mode: 0o600 })
  io.stderr(`\nSaved ${path}\n  default: ${primary.name}${fallback.length ? `, then ${fallback.join(', ')}` : ''}\n\nTry it:  pr-reviewer review <PR link>    or    pr-reviewer serve --open\n`)
  return EXIT_CODES.passed
}
