import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { parseArgs } from 'node:util'
import {
  DEFAULT_CONTEXT_LIMITS,
  EXIT_CODES,
  fetchContext,
  formatPrRef,
  parsePrRef,
  redactText,
  resolveSettings,
  type CredentialResolver,
  type PrContext,
  type ResolvedConfig,
  type Secret,
} from '@pr-reviewer/core'
import { DefaultCredentialResolver } from '@pr-reviewer/credentials'
import { GitHubClient, GitHubPrReader, apiUrlForHost } from '@pr-reviewer/github'
import { loadUserConfig, userConfigPath } from './config-file.js'

/** Output sinks for the CLI; injected so tests don't touch the real process. */
export interface CliIo {
  stdout: (text: string) => void
  stderr: (text: string) => void
}

/** Effects the composition root needs; defaults come from the real process. */
export interface CliDeps {
  env: Readonly<Record<string, string | undefined>>
  fetch: typeof fetch
  platform: string
  homedir: string
  credentials: CredentialResolver
}

/** Exit code for configuration errors (sysexits EX_CONFIG; in the 64+ usage range). */
const EXIT_CONFIG = 78

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string
}

const USAGE = `Usage: pr-reviewer <command> [options]

Review GitHub pull requests with deterministic checks and the AI provider of your choice.

Commands:
  context <pr>       Load a PR's context from GitHub (<pr> is a URL or owner/repo#number)
  config show        Print the resolved configuration and where each value came from
  config path        Print the user config file location
  help               Show this help

Options:
  -h, --help         Show this help
  -v, --version      Print the version
  --profile <name>   Use a named profile from the user config

context options:
  --json             Print the full context as JSON
  --api-url <url>    GitHub API base URL (overrides config)
  --host <host>      Host for owner/repo#number references (overrides config)

Config file: $XDG_CONFIG_HOME/pr-reviewer/config.yml (or ~/.config/..., %APPDATA%\\... on Windows),
or the path in $PR_REVIEWER_CONFIG. GitHub token: GITHUB_TOKEN, GH_TOKEN, the OS keychain, or gh.
`

/** Runs the CLI with the given arguments (without the node/script prefix) and returns the exit code. */
export async function main(argv: readonly string[], rawIo: CliIo, deps: Partial<CliDeps> = {}): Promise<number> {
  const env = deps.env ?? {}
  const full: CliDeps = {
    env,
    fetch: deps.fetch ?? globalThis.fetch,
    platform: deps.platform ?? process.platform,
    homedir: deps.homedir ?? homedir(),
    credentials: deps.credentials ?? new DefaultCredentialResolver({ env }),
  }
  // Every byte the CLI prints passes through redaction of resolved Credentials (AD-10, NFR-2).
  const secrets: Secret[] = []
  const io: CliIo = {
    stdout: (t) => rawIo.stdout(redactText(t, secrets)),
    stderr: (t) => rawIo.stderr(redactText(t, secrets)),
  }
  try {
    return await run(argv, io, full, secrets)
  } catch (e) {
    io.stderr(`Unexpected error: ${(e as Error).message}\n`)
    return EXIT_CODES.error
  }
}

async function run(argv: readonly string[], io: CliIo, deps: CliDeps, secrets: Secret[]): Promise<number> {
  const [first, ...rest] = argv

  if (first === undefined || first === 'help' || first === '-h' || first === '--help') {
    io.stdout(USAGE)
    return EXIT_CODES.passed
  }
  if (first === '-v' || first === '--version') {
    if (rest.length > 0) return usageError(io, `Unexpected argument: ${rest[0]}`)
    io.stdout(`${pkg.version}\n`)
    return EXIT_CODES.passed
  }
  if (first === 'context') return contextCommand(rest, io, deps, secrets)
  if (first === 'config') return configCommand(rest, io, deps)

  const kind = first.startsWith('-') ? 'option' : 'command'
  return usageError(io, `Unknown ${kind}: ${first}`)
}

function usageError(io: CliIo, message: string): number {
  io.stderr(`${message}\n\n${USAGE}`)
  return EXIT_CODES.usage
}

/** Loads the user config and merges layers; prints the error and returns an exit code on failure. */
function resolveConfig(
  io: CliIo,
  deps: CliDeps,
  profile: string | undefined,
  overrides: { host?: string | undefined; apiUrl?: string | undefined },
): ResolvedConfig | number {
  const path = userConfigPath(deps)
  const user = loadUserConfig(path)
  if (!user.ok) {
    io.stderr(`${user.error.message}\n`)
    return EXIT_CONFIG
  }
  const github: Record<string, string> = {}
  if (overrides.host) github.host = overrides.host
  if (overrides.apiUrl) github.apiUrl = overrides.apiUrl
  const resolved = resolveSettings({
    user: user.value,
    profile,
    overrides: Object.keys(github).length > 0 ? { github } : undefined,
  })
  if (!resolved.ok) {
    io.stderr(`${resolved.error.message}\n`)
    return EXIT_CONFIG
  }
  return resolved.value
}

async function contextCommand(args: string[], io: CliIo, deps: CliDeps, secrets: Secret[]): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        json: { type: 'boolean' },
        'api-url': { type: 'string' },
        host: { type: 'string' },
        profile: { type: 'string' },
      },
    })
  } catch (e) {
    return usageError(io, (e as Error).message)
  }
  const [input, ...extra] = parsed.positionals
  if (!input || extra.length > 0) return usageError(io, 'context needs exactly one PR reference')

  const config = resolveConfig(io, deps, parsed.values.profile, { host: parsed.values.host, apiUrl: parsed.values['api-url'] })
  if (typeof config === 'number') return config
  const gh = config.settings.github ?? {}

  const ref = parsePrRef(input, gh.host ?? 'github.com')
  if (!ref.ok) return usageError(io, ref.error.message)

  const token = await deps.credentials.resolve(gh.credential ?? 'github', { host: ref.value.host })
  if (token.ok) secrets.push(token.value)

  const sameHost = ref.value.host === (gh.host ?? 'github.com')
  const client = new GitHubClient({
    apiUrl: (sameHost ? gh.apiUrl : undefined) ?? apiUrlForHost(ref.value.host),
    token: token.ok ? token.value.reveal() : undefined,
    fetch: deps.fetch,
    userAgent: `pr-reviewer/${pkg.version}`,
  })
  const res = await fetchContext(new GitHubPrReader(client), ref.value, DEFAULT_CONTEXT_LIMITS)
  if (!res.ok) {
    io.stderr(`Could not load ${formatPrRef(ref.value)}: ${res.error.message}\n`)
    return EXIT_CODES.error
  }
  io.stdout(parsed.values.json ? `${JSON.stringify(res.value, null, 2)}\n` : summarize(res.value))
  return EXIT_CODES.passed
}

function configCommand(args: string[], io: CliIo, deps: CliDeps): number {
  let parsed
  try {
    parsed = parseArgs({ args, allowPositionals: true, options: { profile: { type: 'string' }, json: { type: 'boolean' } } })
  } catch (e) {
    return usageError(io, (e as Error).message)
  }
  const [sub, ...extra] = parsed.positionals
  if (extra.length > 0) return usageError(io, `Unexpected argument: ${extra[0]}`)
  if (sub === 'path') {
    io.stdout(`${userConfigPath(deps)}\n`)
    return EXIT_CODES.passed
  }
  if (sub !== 'show') return usageError(io, 'config needs a subcommand: show or path')

  const config = resolveConfig(io, deps, parsed.values.profile, {})
  if (typeof config === 'number') return config
  if (parsed.values.json) {
    io.stdout(`${JSON.stringify(config, null, 2)}\n`)
    return EXIT_CODES.passed
  }
  const lines = [`# ${userConfigPath(deps)}`]
  for (const key of Object.keys(config.sources).sort()) {
    lines.push(`${key} = ${JSON.stringify(getPath(config.settings, key))}  (${config.sources[key]})`)
  }
  io.stdout(`${lines.join('\n')}\n`)
  return EXIT_CODES.passed
}

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj)
}

function summarize(ctx: PrContext): string {
  const lines = [
    `${formatPrRef(ctx.ref)}  ${ctx.title}`,
    `author ${ctx.author}  state ${ctx.state}${ctx.draft ? ' (draft)' : ''}${ctx.fromFork ? '  from fork' : ''}`,
    `base ${ctx.baseRef}@${ctx.baseSha.slice(0, 7)}  head ${ctx.headRef}@${ctx.headSha.slice(0, 7)}  merge-base ${ctx.mergeBaseSha.slice(0, 7)}`,
    `${ctx.files.length} changed file(s), ${ctx.reviews.length} review(s), ${ctx.reviewComments.length + ctx.issueComments.length} comment(s)`,
    ...ctx.files.map((f) => `  ${f.status.padEnd(8)} ${f.previousPath ? `${f.previousPath} -> ` : ''}${f.path}${f.binary ? ' (binary)' : ''}`),
    ...ctx.truncated.map((t) => `note: ${t}`),
  ]
  return `${lines.join('\n')}\n`
}
