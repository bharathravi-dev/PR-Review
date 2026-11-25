import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  DEFAULT_CONTEXT_LIMITS,
  EXIT_CODES,
  err,
  fetchContext,
  ok,
  hunksFromContext,
  planPublish,
  publish,
  renderMarkdown,
  renderPublish,
  runReviewWithContext,
  formatPrRef,
  parsePrRef,
  redactText,
  resolveSettings,
  type CredentialResolver,
  type OverallStatus,
  type PrContext,
  type PublishPreview,
  type ResolvedConfig,
  type Result,
  type ReviewProvider,
  type Secret,
} from '@pr-reviewer/core'
import { apiUrlForHost, createAnthropicProvider, createCredentialResolver, createGitHub, secretScanner } from './compose.js'
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
  /** Whether stdin is an interactive terminal (confirmation prompts need one). */
  isTTY: boolean
  /** Asks a question on the terminal and resolves with the answer. */
  prompt: (question: string) => Promise<string>
}

/** Exit code for configuration errors (sysexits EX_CONFIG; in the 64+ usage range). */
const EXIT_CONFIG = 78

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string
}

const USAGE = `Usage: pr-reviewer <command> [options]

Review GitHub pull requests with deterministic checks and the AI provider of your choice.

Commands:
  review <pr>        Review a PR and print the Report (<pr> is a URL or owner/repo#number)
  context <pr>       Load a PR's context from GitHub
  config show        Print the resolved configuration and where each value came from
  config path        Print the user config file location
  help               Show this help

Options:
  -h, --help         Show this help
  -v, --version      Print the version
  --profile <name>   Use a named profile from the user config

review options:
  --out <dir>        Also write report.md and report.json to <dir>
  --json             Print the Report as JSON instead of Markdown
  --provider <name>  AI provider from the user config (default: anthropic)
  --model <id>       Model override
  --warnings-ok      Exit 0 instead of 1 for PASSED_WITH_WARNINGS
  --post             Post the review to the PR (shows a preview and asks first)
  --yes              Post without asking (required when not in an interactive terminal)
  --event <e>        COMMENT (default) or REQUEST_CHANGES (needs publish.allowRequestChanges)

Exit codes: 0 PASSED, 1 PASSED_WITH_WARNINGS, 2 FAILED, 3 INCOMPLETE, 4 ERROR, 5 CANCELLED,
6 post failed or blocked, 64 usage, 78 config.

context options:
  --json             Print the full context as JSON
  --api-url <url>    GitHub API base URL (overrides config)
  --host <host>      Host for owner/repo#number references (overrides config)

Config file: $XDG_CONFIG_HOME/pr-reviewer/config.yml (or ~/.config/..., %APPDATA%\\... on Windows),
or the path in $PR_REVIEWER_CONFIG. GitHub token: GITHUB_TOKEN, GH_TOKEN, the OS keychain, or gh.
Anthropic key: ANTHROPIC_API_KEY or the OS keychain.
`

/** Runs the CLI with the given arguments (without the node/script prefix) and returns the exit code. */
export async function main(argv: readonly string[], rawIo: CliIo, deps: Partial<CliDeps> = {}): Promise<number> {
  const env = deps.env ?? {}
  const full: CliDeps = {
    env,
    fetch: deps.fetch ?? globalThis.fetch,
    platform: deps.platform ?? process.platform,
    homedir: deps.homedir ?? homedir(),
    credentials: deps.credentials ?? createCredentialResolver(env),
    isTTY: deps.isTTY ?? false,
    prompt: deps.prompt ?? (async () => ''),
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
  if (first === 'review') return reviewCommand(rest, io, deps, secrets)
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
  const { reader } = createGitHub({
    apiUrl: (sameHost ? gh.apiUrl : undefined) ?? apiUrlForHost(ref.value.host),
    token: token.ok ? token.value.reveal() : undefined,
    fetch: deps.fetch,
    userAgent: `pr-reviewer/${pkg.version}`,
  })
  const res = await fetchContext(reader, ref.value, DEFAULT_CONTEXT_LIMITS)
  if (!res.ok) {
    io.stderr(`Could not load ${formatPrRef(ref.value)}: ${res.error.message}\n`)
    return EXIT_CODES.error
  }
  io.stdout(parsed.values.json ? `${JSON.stringify(res.value, null, 2)}\n` : summarize(res.value))
  return EXIT_CODES.passed
}

const STATUS_EXIT: Record<OverallStatus, number> = {
  PASSED: EXIT_CODES.passed,
  PASSED_WITH_WARNINGS: EXIT_CODES.passedWithWarnings,
  FAILED: EXIT_CODES.failed,
  INCOMPLETE: EXIT_CODES.incomplete,
  ERROR: EXIT_CODES.error,
  CANCELLED: EXIT_CODES.cancelled,
}

async function reviewCommand(args: string[], io: CliIo, deps: CliDeps, secrets: Secret[]): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        json: { type: 'boolean' },
        out: { type: 'string' },
        provider: { type: 'string' },
        model: { type: 'string' },
        'warnings-ok': { type: 'boolean' },
        'api-url': { type: 'string' },
        host: { type: 'string' },
        profile: { type: 'string' },
        post: { type: 'boolean' },
        yes: { type: 'boolean' },
        event: { type: 'string' },
      },
    })
  } catch (e) {
    return usageError(io, (e as Error).message)
  }
  const [input, ...extra] = parsed.positionals
  if (!input || extra.length > 0) return usageError(io, 'review needs exactly one PR reference')

  const config = resolveConfig(io, deps, parsed.values.profile, { host: parsed.values.host, apiUrl: parsed.values['api-url'] })
  if (typeof config === 'number') return config
  const publishSettings = config.settings.publish ?? {}

  const post = parsed.values.post === true
  const event = (parsed.values.event ?? 'COMMENT').toUpperCase()
  if (event !== 'COMMENT' && event !== 'REQUEST_CHANGES') return usageError(io, '--event must be COMMENT or REQUEST_CHANGES (approving is never possible)')
  if (event === 'REQUEST_CHANGES' && !publishSettings.allowRequestChanges) {
    return usageError(io, '--event REQUEST_CHANGES is off by default; set publish.allowRequestChanges: true in your user config to enable it')
  }
  if (!post && (parsed.values.yes || parsed.values.event)) return usageError(io, '--yes and --event only apply with --post')
  if (post && !parsed.values.yes && !deps.isTTY) {
    return usageError(io, 'Refusing to post without confirmation in a non-interactive terminal; pass --yes to post anyway')
  }

  const gh = config.settings.github ?? {}
  const ref = parsePrRef(input, gh.host ?? 'github.com')
  if (!ref.ok) return usageError(io, ref.error.message)

  const token = await deps.credentials.resolve(gh.credential ?? 'github', { host: ref.value.host })
  if (token.ok) secrets.push(token.value)
  const sameHost = ref.value.host === (gh.host ?? 'github.com')
  const github = createGitHub({
    apiUrl: (sameHost ? gh.apiUrl : undefined) ?? apiUrlForHost(ref.value.host),
    token: token.ok ? token.value.reveal() : undefined,
    fetch: deps.fetch,
    userAgent: `pr-reviewer/${pkg.version}`,
  })

  // Posting needs the Reviewer Identity up front: it is part of the idempotency key (AD-11).
  let reviewerId: number | undefined
  if (post) {
    if (!token.ok) {
      io.stderr(`Cannot post: ${token.error.message}\n`)
      return EXIT_CODES.error
    }
    const viewer = await github.reader.viewer()
    if (!viewer.ok) {
      io.stderr(`Cannot post: ${viewer.error.message}\n`)
      return EXIT_CODES.error
    }
    reviewerId = viewer.value.id
  }

  const provider = await buildProvider(config, parsed.values.provider, parsed.values.model, deps, secrets)
  const providerName = parsed.values.provider ?? config.settings.defaultProvider ?? 'anthropic'
  io.stderr(`Reviewing ${formatPrRef(ref.value)}…\n`)
  const { report, context } = await runReviewWithContext(
    {
      ref: ref.value,
      engineVersion: pkg.version,
      channel: 'CLI',
      review: {
        provider: providerName === 'anthropic' ? undefined : providerName,
        model: parsed.values.model ?? config.settings.providers?.[providerName]?.model,
        rules: config.settings.reviewRules ?? [],
      },
      reviewerId,
      configSources: config.sources,
      onLayer: (l) => io.stderr(`  ${l.status.padEnd(14)} ${l.layer} (${l.validator})${l.reason ? ` ${l.reason}` : ''}\n`),
    },
    {
      github: github.reader,
      scanSecrets: secretScanner,
      provider: provider.ok ? provider.value : undefined,
      providerUnavailableReason: provider.ok ? undefined : provider.error.message,
      now: () => Date.now(),
    },
  )

  const markdown = renderMarkdown(report)
  if (parsed.values.out) {
    mkdirSync(parsed.values.out, { recursive: true })
    writeFileSync(join(parsed.values.out, 'report.md'), redactText(markdown, secrets))
    writeFileSync(join(parsed.values.out, 'report.json'), redactText(`${JSON.stringify(report, null, 2)}\n`, secrets))
    io.stderr(`Saved ${join(parsed.values.out, 'report.md')} and report.json\n`)
  }
  io.stdout(parsed.values.json ? `${JSON.stringify(report, null, 2)}\n` : markdown)

  const code = STATUS_EXIT[report.overallStatus]
  const reviewCode = code === EXIT_CODES.passedWithWarnings && parsed.values['warnings-ok'] ? EXIT_CODES.passed : code
  if (!post) return reviewCode

  if (!context || reviewerId === undefined) {
    io.stderr('Nothing was posted: the PR could not be loaded.\n')
    return EXIT_CODES.publishFailed
  }
  const plan = planPublish(report, {
    hunks: hunksFromContext(context),
    rid: reviewerId,
    engineMajor: Number(pkg.version.split('.')[0]) || 0,
    productVersion: pkg.version,
    unattended: parsed.values.yes === true && !deps.isTTY,
    event,
    maxInline: publishSettings.maxInlineComments,
    extraLinkPrefixes: publishSettings.linkPrefixes,
  })
  const preview = renderPublish(report, plan)
  io.stderr(formatPreview(formatPrRef(ref.value), preview))

  if (!parsed.values.yes) {
    const answer = (await deps.prompt(`Post this ${event === 'COMMENT' ? 'review' : 'review requesting changes'} to ${formatPrRef(ref.value)}? [y/N] `)).trim().toLowerCase()
    if (answer !== 'y' && answer !== 'yes') {
      io.stderr('Not posted.\n')
      return reviewCode
    }
  }

  const record = await publish(report, plan, preview, ref.value, { reader: github.reader, writer: github.writer, now: () => Date.now() })
  const where = [record.reviewUrl && `review: ${record.reviewUrl}`, record.summaryUrl && `summary: ${record.summaryUrl}`].filter(Boolean).join('\n  ')
  if (record.status === 'PUBLISHED') {
    io.stderr(`Posted ${record.commentCount} inline comment(s) and the summary.\n  ${where}\n`)
    return reviewCode
  }
  if (record.status === 'SKIPPED_DUPLICATE') {
    io.stderr(`This head commit was already reviewed with the same settings; no new review was created. Summary updated.\n  ${where}\n`)
    return reviewCode
  }
  io.stderr(`Not posted (${record.status}): ${record.reason ?? 'unknown reason'}\n`)
  return EXIT_CODES.publishFailed
}

function formatPreview(pr: string, preview: PublishPreview): string {
  const strip = (t: string) => t.replace(/\n*<!-- pr-reviewer [^>]* -->\s*$/, '')
  const lines = [
    '',
    `──── Preview: what will be posted to ${pr} (${preview.event}) ────`,
    strip(preview.summaryBody),
    '',
    `Inline comments (${preview.inline.length}):`,
    ...preview.inline.map((c) => `  ${c.path}:${c.startLine ? `${c.startLine}-` : ''}${c.line}  ${c.body.split('\n')[0]}`),
    '────',
    '',
  ]
  return `${lines.join('\n')}\n`
}

/** Chooses the AI Provider from flags and Configuration. Only Anthropic is wired in this release (Epic 3 adds the rest). */
async function buildProvider(
  config: ResolvedConfig,
  providerFlag: string | undefined,
  modelFlag: string | undefined,
  deps: CliDeps,
  secrets: Secret[],
): Promise<Result<ReviewProvider>> {
  const name = providerFlag ?? config.settings.defaultProvider ?? 'anthropic'
  const entry = config.settings.providers?.[name] ?? (name === 'anthropic' ? { type: 'anthropic' as const } : undefined)
  if (!entry) return err('provider_unknown', `AI provider "${name}" is not defined in the user config.`)
  if (entry.type !== 'anthropic' && entry.type !== 'anthropic-compatible') {
    return err('provider_unsupported', `AI provider type "${entry.type}" is not available in this release yet.`)
  }
  const key = await deps.credentials.resolve(entry.credential ?? 'provider:anthropic')
  if (!key.ok) return err('provider_credential_missing', key.error.message)
  secrets.push(key.value)
  return ok(createAnthropicProvider({ apiKey: key.value, model: modelFlag ?? entry.model, baseUrl: entry.baseUrl, fetch: deps.fetch }))
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
