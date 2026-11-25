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
  feedbackStats,
  FPV,
  ownInlineComments,
  parseRepoRef,
  planPublish,
  publish,
  readPrior,
  reviewedState,
  setCommitStatus,
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
import { loadReviewRules } from './rules-loader.js'

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
  list <repo>        List open PRs and whether you reviewed their latest commit, then pick one
  stats              How your posted findings fared: resolved, dismissed, still open
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

list options:
  --limit <n>        How many open PRs to show (default 30)
  --json             Print the list as JSON (no prompt)

stats options:
  --since <date>     Count PRs updated since this date, YYYY-MM-DD (default: 30 days ago)
  --repo <repo>      Only this repository (owner/repo)
  --json             Print the numbers as JSON

Dismiss a finding by reacting 👎 to its comment or replying "/dismiss"; it won't be posted again.

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
  if (first === 'list') return listCommand(rest, io, deps, secrets)
  if (first === 'stats') return statsCommand(rest, io, deps, secrets)
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

  // The Reviewer Identity is part of the idempotency key (AD-11) and lets the review honour Finding feedback.
  // Posting requires it; plain reviews use it when a token is available.
  let reviewerId: number | undefined
  if (post && !token.ok) {
    io.stderr(`Cannot post: ${token.error.message}\n`)
    return EXIT_CODES.error
  }
  if (token.ok) {
    const viewer = await github.reader.viewer()
    if (viewer.ok) reviewerId = viewer.value.id
    else if (post) {
      io.stderr(`Cannot post: ${viewer.error.message}\n`)
      return EXIT_CODES.error
    }
  }

  const provider = await buildProvider(config, parsed.values.provider, parsed.values.model, deps, secrets)
  const providerName = parsed.values.provider ?? config.settings.defaultProvider ?? 'anthropic'
  const rules = await loadReviewRules(config.settings.reviewRules ?? [], { configPath: userConfigPath(deps), homedir: deps.homedir, fetch: deps.fetch })
  for (const w of rules.warnings) io.stderr(`warning: ${w}\n`)
  io.stderr(`Reviewing ${formatPrRef(ref.value)}…\n`)
  const { report, context } = await runReviewWithContext(
    {
      ref: ref.value,
      engineVersion: pkg.version,
      channel: 'CLI',
      review: {
        provider: providerName === 'anthropic' ? undefined : providerName,
        model: parsed.values.model ?? config.settings.providers?.[providerName]?.model,
        rules: rules.rules,
      },
      reviewerId,
      configSources: config.sources,
      limitations: rules.warnings,
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
  // What was already published comes only from own markers (AD-11), read before rendering so the preview is exact.
  const published = await github.reader.listPublished(ref.value)
  if (!published.ok) {
    io.stderr(`Nothing was posted: ${published.error.message}\n`)
    return EXIT_CODES.publishFailed
  }
  const plan = planPublish(report, {
    prior: readPrior(published.value, reviewerId, report.run.fpv),
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
  if (publishSettings.commitStatus && (record.status === 'PUBLISHED' || record.status === 'SKIPPED_DUPLICATE')) {
    const status = await setCommitStatus(report, ref.value, github.writer, record.summaryUrl)
    if (status.outcome === 'SET') io.stderr(`Set the "pr-reviewer" commit status on ${report.run.headSha?.slice(0, 7)}.\n`)
    else if (status.outcome === 'SKIPPED_NO_PERMISSION') io.stderr('Commit status skipped: the token cannot set statuses on this repository.\n')
    else if (status.outcome === 'FAILED') io.stderr(`Commit status not set: ${status.reason}\n`)
  }
  const where = [record.reviewUrl && `review: ${record.reviewUrl}`, record.summaryUrl && `summary: ${record.summaryUrl}`].filter(Boolean).join('\n  ')
  if (record.status === 'PUBLISHED') {
    const extra = [preview.stillOpen.length && `${preview.stillOpen.length} still open`, preview.resolved.length && `${preview.resolved.length} resolved`].filter(Boolean).join(', ')
    io.stderr(`Posted ${record.commentCount} new inline comment(s) and the summary${extra ? ` (${extra})` : ''}.\n  ${where}\n`)
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
    `New inline comments (${preview.inline.length}):`,
    ...preview.inline.map((c) => `  ${c.path}:${c.startLine ? `${c.startLine}-` : ''}${c.line}  ${c.body.split('\n')[0]}`),
    ...(preview.stillOpen.length ? [`Still open from earlier reviews, not re-posted: ${preview.stillOpen.length}`] : []),
    ...(preview.resolved.length ? [`Resolved since the last review: ${preview.resolved.length}`] : []),
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

const STATE_LABEL = { CURRENT: 'reviewed', OUTDATED: 'outdated', NONE: '-', UNKNOWN: '?' } as const

async function listCommand(args: string[], io: CliIo, deps: CliDeps, secrets: Secret[]): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: { json: { type: 'boolean' }, limit: { type: 'string' }, host: { type: 'string' }, 'api-url': { type: 'string' }, profile: { type: 'string' } },
    })
  } catch (e) {
    return usageError(io, (e as Error).message)
  }
  const [input, ...extra] = parsed.positionals
  if (!input || extra.length > 0) return usageError(io, 'list needs exactly one repository (owner/repo or URL)')
  const limit = parsed.values.limit === undefined ? 30 : Number(parsed.values.limit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 300) return usageError(io, '--limit must be a whole number from 1 to 300')

  const config = resolveConfig(io, deps, parsed.values.profile, { host: parsed.values.host, apiUrl: parsed.values['api-url'] })
  if (typeof config === 'number') return config
  const gh = config.settings.github ?? {}
  const repo = parseRepoRef(input, gh.host ?? 'github.com')
  if (!repo.ok) return usageError(io, repo.error.message)

  const token = await deps.credentials.resolve(gh.credential ?? 'github', { host: repo.value.host })
  if (token.ok) secrets.push(token.value)
  const sameHost = repo.value.host === (gh.host ?? 'github.com')
  const { reader } = createGitHub({
    apiUrl: (sameHost ? gh.apiUrl : undefined) ?? apiUrlForHost(repo.value.host),
    token: token.ok ? token.value.reveal() : undefined,
    fetch: deps.fetch,
    userAgent: `pr-reviewer/${pkg.version}`,
  })

  const pulls = await reader.listOpenPulls(repo.value, limit)
  if (!pulls.ok) {
    io.stderr(`Could not list PRs for ${repo.value.owner}/${repo.value.repo}: ${pulls.error.message}\n`)
    return EXIT_CODES.error
  }
  // Reviewed state needs the Reviewer Identity; without a token the column shows "?".
  const viewer = token.ok ? await reader.viewer() : undefined
  const rid = viewer?.ok ? viewer.value.id : undefined
  const states: Array<keyof typeof STATE_LABEL> = pulls.value.map(() => 'UNKNOWN')
  if (rid !== undefined) {
    let nextIndex = 0
    const worker = async () => {
      while (nextIndex < pulls.value.length) {
        const i = nextIndex++
        const p = pulls.value[i]!
        const items = await reader.listPublished({ ...repo.value, number: p.number })
        states[i] = items.ok ? reviewedState(items.value, rid, p.headSha) : 'UNKNOWN'
      }
    }
    await Promise.all(Array.from({ length: Math.min(5, pulls.value.length) }, worker))
  }

  if (parsed.values.json) {
    io.stdout(`${JSON.stringify(pulls.value.map((p, i) => ({ ...p, reviewed: states[i] })), null, 2)}\n`)
    return EXIT_CODES.passed
  }
  if (pulls.value.length === 0) {
    io.stdout(`No open PRs in ${repo.value.owner}/${repo.value.repo}.\n`)
    return EXIT_CODES.passed
  }
  const rows = pulls.value.map((p, i) => [
    `#${p.number}`,
    STATE_LABEL[states[i]!],
    p.headSha.slice(0, 7),
    p.author,
    `${p.draft ? '[draft] ' : ''}${p.title.replace(/\s+/g, ' ')}`,
  ])
  const widths = [0, 1, 2, 3].map((c) => Math.max(...rows.map((r) => r[c]!.length), ['PR', 'REVIEWED', 'HEAD', 'AUTHOR'][c]!.length))
  const line = (r: string[]) => `${r.slice(0, 4).map((v, c) => v.padEnd(widths[c]!)).join('  ')}  ${r[4]}`
  io.stdout(`${[line(['PR', 'REVIEWED', 'HEAD', 'AUTHOR', 'TITLE']), ...rows.map(line)].join('\n')}\n`)
  if (rid === undefined) io.stderr('Reviewed state needs a GitHub token (GITHUB_TOKEN, GH_TOKEN, or gh auth login).\n')

  if (!deps.isTTY) return EXIT_CODES.passed
  const answer = (await deps.prompt('Review which PR? Enter its number, or press Enter to quit: ')).trim().replace(/^#/, '')
  if (answer === '') return EXIT_CODES.passed
  const chosen = pulls.value.find((p) => String(p.number) === answer)
  if (!chosen) {
    io.stderr(`#${answer} is not in the list.\n`)
    return EXIT_CODES.usage
  }
  const passthrough = parsed.values.profile ? ['--profile', parsed.values.profile] : []
  return reviewCommand([`${repo.value.owner}/${repo.value.repo}#${chosen.number}`, ...(repo.value.host !== (gh.host ?? 'github.com') ? ['--host', repo.value.host] : []), ...passthrough], io, deps, secrets)
}

async function statsCommand(args: string[], io: CliIo, deps: CliDeps, secrets: Secret[]): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args,
      allowPositionals: false,
      options: { since: { type: 'string' }, repo: { type: 'string' }, json: { type: 'boolean' }, host: { type: 'string' }, 'api-url': { type: 'string' }, profile: { type: 'string' } },
    })
  } catch (e) {
    return usageError(io, (e as Error).message)
  }
  const sinceText = parsed.values.since ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sinceText) || Number.isNaN(Date.parse(sinceText))) return usageError(io, '--since must be a date like 2026-11-01')

  const config = resolveConfig(io, deps, parsed.values.profile, { host: parsed.values.host, apiUrl: parsed.values['api-url'] })
  if (typeof config === 'number') return config
  const gh = config.settings.github ?? {}
  const host = gh.host ?? 'github.com'
  const repo = parsed.values.repo ? parseRepoRef(parsed.values.repo, host) : undefined
  if (repo && !repo.ok) return usageError(io, repo.error.message)

  const token = await deps.credentials.resolve(gh.credential ?? 'github', { host })
  if (!token.ok) {
    io.stderr(`stats needs a GitHub token: ${token.error.message}\n`)
    return EXIT_CODES.error
  }
  secrets.push(token.value)
  const { reader } = createGitHub({ apiUrl: gh.apiUrl ?? apiUrlForHost(host), token: token.value.reveal(), fetch: deps.fetch, userAgent: `pr-reviewer/${pkg.version}` })
  const viewer = await reader.viewer()
  if (!viewer.ok) {
    io.stderr(`Could not identify you on GitHub: ${viewer.error.message}\n`)
    return EXIT_CODES.error
  }
  const pulls = await reader.searchCommentedPulls(viewer.value.login, sinceText, repo?.ok ? repo.value : undefined)
  if (!pulls.ok) {
    io.stderr(`Could not search PRs: ${pulls.error.message}\n`)
    return EXIT_CODES.error
  }

  const rows: Array<{ pr: string; title: string } & ReturnType<typeof feedbackStats>> = []
  for (const p of pulls.value) {
    const ref = { host, owner: p.owner, repo: p.repo, number: p.number }
    const published = await reader.listPublished(ref)
    if (!published.ok) continue
    const own = ownInlineComments(published.value, viewer.value.id, FPV)
    const thumbs = new Map<number, string[]>()
    for (const c of own) {
      const t = await reader.listThumbsDown(ref, c.id)
      if (t.ok) thumbs.set(c.id, t.value)
    }
    const st = feedbackStats(published.value, viewer.value.id, FPV, p.author, thumbs)
    if (st.posted + st.summaryOnly > 0) rows.push({ pr: `${p.owner}/${p.repo}#${p.number}`, title: p.title, ...st })
  }
  const total = rows.reduce(
    (t, r) => ({ posted: t.posted + r.posted, resolved: t.resolved + r.resolved, dismissed: t.dismissed + r.dismissed, open: t.open + r.open, summaryOnly: t.summaryOnly + r.summaryOnly }),
    { posted: 0, resolved: 0, dismissed: 0, open: 0, summaryOnly: 0 },
  )
  if (parsed.values.json) {
    io.stdout(`${JSON.stringify({ since: sinceText, reviewer: viewer.value.login, prs: rows, total }, null, 2)}\n`)
    return EXIT_CODES.passed
  }
  if (rows.length === 0) {
    io.stdout(`No PRs reviewed with pr-reviewer since ${sinceText}.\n`)
    return EXIT_CODES.passed
  }
  const pct = (n: number) => (total.posted ? ` (${Math.round((100 * n) / total.posted)}%)` : '')
  const lines = [
    `Reviews by ${viewer.value.login} since ${sinceText}: ${rows.length} PR(s)`,
    '',
    ...rows.map((r) => `  ${r.pr.padEnd(36)} posted ${String(r.posted).padStart(3)}  resolved ${String(r.resolved).padStart(3)}  dismissed ${String(r.dismissed).padStart(3)}  open ${String(r.open).padStart(3)}  summary-only ${r.summaryOnly}`),
    '',
    `Inline findings posted: ${total.posted} — resolved ${total.resolved}${pct(total.resolved)}, dismissed ${total.dismissed}${pct(total.dismissed)}, still open ${total.open}${pct(total.open)}.`,
    `Summary-only findings in latest summaries: ${total.summaryOnly}.`,
    'Resolved means the code at the comment changed afterwards. Computed from GitHub only; nothing is sent anywhere.',
  ]
  io.stdout(`${lines.join('\n')}\n`)
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
