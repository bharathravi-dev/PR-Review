import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  DEFAULT_CONTEXT_LIMITS,
  EXIT_CODES,
  fetchContext,
  parseRepoRef,
  renderMarkdown,
  formatPrRef,
  parsePrRef,
  redactText,
  resolveSettings,
  type OverallStatus,
  type PrContext,
  type PublishPreview,
  type ResolvedConfig,
  type Secret,
} from '@pr-reviewer/core'
import { createCredentialResolver } from './compose.js'
import { loadUserConfig, userConfigPath } from './config-file.js'
import type { CliDeps, CliIo } from './deps.js'
import { connectGitHub, executeReview, listPullsWithState, performPublish, preparePublish } from './engine.js'
import { autoCommand } from './auto.js'
import { benchCommand } from './bench.js'
import { fixCommand } from './fix.js'
import { shipCommand } from './ship.js'
import { learningsCommand } from './learnings.js'
import { mcpCommand } from './mcp.js'
import { collectStats, formatStats } from './stats.js'
import { initCommand } from './init.js'
import { startServer } from './serve.js'
import { formatPairCode, PAIRED_PORT, readPairings, unpairAll } from './pairing.js'
import { stateDir } from './state.js'
import { startWeb, webConfigProblems } from './web.js'
import { VERSION } from './version.js'

export type { CliDeps, CliIo } from './deps.js'

/** Exit code for configuration errors (sysexits EX_CONFIG; in the 64+ usage range). */
const EXIT_CONFIG = 78

const USAGE = `Usage: pr-reviewer <command> [options]

Review GitHub pull requests with deterministic checks and the AI provider of your choice.

Commands:
  init               Find your GitHub login and AI (Claude Code, Codex, API keys) and write your config
  review <pr>        Review a PR and print the Report (<pr> is a URL or owner/repo#number)
  list <repo>        List open PRs and whether you reviewed their latest commit, then pick one
  stats              How your posted findings fared: resolved, dismissed, still open
  serve              Open a review page in your browser, served only on this machine (--ui v2|classic)
  bench <dataset>    Measure review quality on PRs with known issues (precision, recall, F1)
  fix <PR>           Have your Claude Code or Codex fix your open findings in this checkout
  ship <PR>          Review, fix with your coding agent, push, wait for CI, and repeat until ready (never merges)
  learnings <repo>   What reviews learned from feedback on earlier comments (👎, /dismiss, /remember)
  mcp                Run as an MCP server on stdio for coding agents (review_pr, open_findings; never posts)
  web                Run the self-hosted Web App for a team (configured by environment variables; see the README)
  auto <command>     Automatic reviews of PRs in your account (pr-reviewer auto help)
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
  --provider <name>  AI provider: a name from the user config, or anthropic, openai, claude-code, codex
  --model <id>       Model override for that provider
  --warnings-ok      Exit 0 instead of 1 for PASSED_WITH_WARNINGS
  --post             Post the review to the PR (shows a preview and asks first)
  --yes              Post without asking (required when not in an interactive terminal)
  --event <e>        COMMENT (default) or REQUEST_CHANGES (needs publish.allowRequestChanges)

Exit codes: 0 PASSED, 1 PASSED_WITH_WARNINGS, 2 FAILED, 3 INCOMPLETE, 4 ERROR, 5 CANCELLED,
6 post failed or blocked, 64 usage, 78 config.

list options:
  --limit <n>        How many open PRs to show (default 30)
  --json             Print the list as JSON (no prompt)

fix options:
  --agent <name>     claude-code or codex (default: your configured provider's kind)
  --only <n,n>       Only these findings, by the numbers fix lists
  --print            Print the prompt for any agent instead of running one
  --model <model>    Model for the agent
  --allow-dirty      Allow uncommitted changes in the checkout
  --any-head         Allow a checkout that is not at the PR's current head

ship options (run in a clean checkout of the PR's head; commits and pushes the fixes, never merges):
  --rounds <n>       Review-and-fix rounds at most (default 3)
  --min-severity <s> Fix findings at this severity or above (default MAJOR)
  --agent <name>     claude-code or codex (default: your configured provider's kind)
  --no-push          Commit the fixes but don't push (one round)
  --no-ci            Don't wait for CI between rounds
  --post             Post the final review and set the pr-reviewer/ship commit status

stats options:
  --since <date>     Count PRs updated since this date, YYYY-MM-DD (default: 30 days ago)
  --repo <repo>      Only this repository (owner/repo)
  --json             Print the numbers as JSON

Dismiss a finding by reacting 👎 to its comment or replying "/dismiss"; it won't be posted again.

init options:
  --yes              Don't ask; use what works (subscriptions first, then API keys)
  --force            Replace an existing config (kept as config.yml.bak)
  --skip-test        Don't make a test call to each AI provider

serve options:
  --port <n>         Port on 127.0.0.1 (default: any free port; 4747 once the extension is paired)
  --open             Open the page in your default browser
  --pair             Print a code that pairs the pr-reviewer browser extension with this computer
  --unpair           Remove every paired browser extension and exit

context options:
  --json             Print the full context as JSON
  --api-url <url>    GitHub API base URL (overrides config)
  --host <host>      Host for owner/repo#number references (overrides config)

Config file: $XDG_CONFIG_HOME/pr-reviewer/config.yml (or ~/.config/..., %APPDATA%\\... on Windows),
or the path in $PR_REVIEWER_CONFIG. GitHub token: GITHUB_TOKEN, GH_TOKEN, the OS keychain, or gh.
AI: your Claude Code or Codex login (no key needed), or ANTHROPIC_API_KEY / OPENAI_API_KEY / the OS keychain.
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
    openUrl: deps.openUrl ?? openInBrowser,
    untilStopped: deps.untilStopped ?? untilSignal,
    runGh: deps.runGh ?? runGh,
    cwd: deps.cwd,
    run: deps.run,
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
    io.stdout(`${VERSION}\n`)
    return EXIT_CODES.passed
  }
  if (first === 'context') return contextCommand(rest, io, deps, secrets)
  if (first === 'review') return reviewCommand(rest, io, deps, secrets)
  if (first === 'list') return listCommand(rest, io, deps, secrets)
  if (first === 'stats') return statsCommand(rest, io, deps, secrets)
  if (first === 'config') return configCommand(rest, io, deps)
  if (first === 'serve') return serveCommand(rest, io, deps, secrets)
  if (first === 'web') return webCommand(rest, io, deps)
  if (first === 'learnings') return learningsCommand(rest, io, deps, secrets, (profile) => resolveConfig(io, deps, profile, {}), (m) => usageError(io, m))
  if (first === 'mcp') return mcpCommand(io, deps, secrets, () => resolveConfig(io, deps, undefined, {}))
  if (first === 'ship') return shipCommand(rest, io, deps, secrets, (profile) => resolveConfig(io, deps, profile, {}), (m) => usageError(io, m))
  if (first === 'fix') return fixCommand(rest, io, deps, secrets, (profile) => resolveConfig(io, deps, profile, {}), (m) => usageError(io, m))
  if (first === 'bench') return benchCommand(rest, io, deps, secrets, (profile) => resolveConfig(io, deps, profile, {}), (m) => usageError(io, m))
  if (first === 'init') return initCommand(rest, io, deps, secrets, (m) => usageError(io, m))
  if (first === 'auto') return autoCommand(rest, io, deps, secrets, (profile) => resolveConfig(io, deps, profile, {}), (m) => usageError(io, m))

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

  const { reader } = await connectGitHub(config, deps, secrets, ref.value.host, { viewer: false })
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

  // The Reviewer Identity is part of the idempotency key (AD-11) and lets the review honour Finding feedback.
  // Posting requires it; plain reviews use it when a token is available.
  const github = await connectGitHub(config, deps, secrets, ref.value.host)
  if (post && !github.viewer) {
    io.stderr(`Cannot post: ${github.tokenError ?? github.viewerError}\n`)
    return EXIT_CODES.error
  }

  const { report, context } = await executeReview({
    config,
    deps,
    secrets,
    ref: ref.value,
    github,
    provider: parsed.values.provider,
    model: parsed.values.model,
    onWarning: (w) => io.stderr(`warning: ${w}\n`),
    onNotice: (t) => io.stderr(`${t}\n`),
    beforeRun: () => io.stderr(`Reviewing ${formatPrRef(ref.value)}…\n`),
    onLayer: (l) => io.stderr(`  ${l.status.padEnd(14)} ${l.layer} (${l.validator})${l.reason ? ` ${l.reason}` : ''}\n`),
  })

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

  if (!context) {
    io.stderr('Nothing was posted: the PR could not be loaded.\n')
    return EXIT_CODES.publishFailed
  }
  // What was already published comes only from own markers (AD-11), read before rendering so the preview is exact.
  const prepared = await preparePublish(report, context, ref.value, github, config, {
    event,
    unattended: parsed.values.yes === true && !deps.isTTY,
  })
  if (!prepared.ok) {
    io.stderr(`Nothing was posted: ${prepared.error.message}\n`)
    return EXIT_CODES.publishFailed
  }
  const { plan, preview } = prepared.value
  io.stderr(formatPreview(formatPrRef(ref.value), preview))

  if (!parsed.values.yes) {
    const answer = (await deps.prompt(`Post this ${event === 'COMMENT' ? 'review' : 'review requesting changes'} to ${formatPrRef(ref.value)}? [y/N] `)).trim().toLowerCase()
    if (answer !== 'y' && answer !== 'yes') {
      io.stderr('Not posted.\n')
      return reviewCode
    }
  }

  const { record, commitStatus: status } = await performPublish(report, plan, preview, ref.value, github, config)
  if (status?.outcome === 'SET') io.stderr(`Set the "pr-reviewer" commit status on ${report.run.headSha?.slice(0, 7)}.\n`)
  else if (status?.outcome === 'SKIPPED_NO_PERMISSION') io.stderr('Commit status skipped: the token cannot set statuses on this repository.\n')
  else if (status?.outcome === 'FAILED') io.stderr(`Commit status not set: ${status.reason}\n`)
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

  // Reviewed state needs the Reviewer Identity; without a token the column shows "?".
  const github = await connectGitHub(config, deps, secrets, repo.value.host)
  const rid = github.viewer?.id
  const pulls = await listPullsWithState(github.reader, repo.value, limit, rid)
  if (!pulls.ok) {
    io.stderr(`Could not list PRs for ${repo.value.owner}/${repo.value.repo}: ${pulls.error.message}\n`)
    return EXIT_CODES.error
  }

  if (parsed.values.json) {
    io.stdout(`${JSON.stringify(pulls.value, null, 2)}\n`)
    return EXIT_CODES.passed
  }
  if (pulls.value.length === 0) {
    io.stdout(`No open PRs in ${repo.value.owner}/${repo.value.repo}.\n`)
    return EXIT_CODES.passed
  }
  const rows = pulls.value.map((p) => [
    `#${p.number}`,
    STATE_LABEL[p.reviewed],
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

  const { reader, tokenError, viewer: me, viewerError } = await connectGitHub(config, deps, secrets, host)
  if (tokenError) {
    io.stderr(`stats needs a GitHub token: ${tokenError}\n`)
    return EXIT_CODES.error
  }
  if (!me) {
    io.stderr(`Could not identify you on GitHub: ${viewerError}\n`)
    return EXIT_CODES.error
  }
  const result = await collectStats(reader, me, host, sinceText, repo?.ok ? repo.value : undefined)
  if (!result.ok) {
    io.stderr(`${result.message}\n`)
    return EXIT_CODES.error
  }
  io.stdout(parsed.values.json ? `${JSON.stringify(result.value, null, 2)}\n` : formatStats(result.value))
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

async function serveCommand(args: string[], io: CliIo, deps: CliDeps, secrets: Secret[]): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({ args, allowPositionals: false, options: { port: { type: 'string' }, open: { type: 'boolean' }, profile: { type: 'string' }, ui: { type: 'string' }, pair: { type: 'boolean' }, unpair: { type: 'boolean' } } })
  } catch (e) {
    return usageError(io, (e as Error).message)
  }
  const dir = stateDir(deps)
  if (parsed.values.unpair) {
    if (parsed.values.pair) return usageError(io, '--pair and --unpair cannot be used together')
    const n = unpairAll(dir)
    io.stdout(n === 0 ? 'No browser extension was paired.\n' : `Removed ${n} paired browser extension${n === 1 ? '' : 's'}. Pair again with: pr-reviewer serve --pair\n`)
    return EXIT_CODES.passed
  }
  const paired = readPairings(dir).length > 0
  const pairing = Boolean(parsed.values.pair)
  const port = parsed.values.port === undefined ? (pairing || paired ? PAIRED_PORT : 0) : Number(parsed.values.port)
  if (!Number.isInteger(port) || port < 0 || port > 65535) return usageError(io, '--port must be a whole number from 0 to 65535')
  const ui = parsed.values.ui
  if (ui !== undefined && ui !== 'classic' && ui !== 'v2') return usageError(io, '--ui must be classic or v2')
  const config = resolveConfig(io, deps, parsed.values.profile, {})
  if (typeof config === 'number') return config

  let server
  try {
    server = await startServer({ deps, config, secrets, port, ...(ui ? { ui } : {}), log: (t) => io.stderr(t), pairing: { dir, open: pairing, computer: hostname() } })
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    io.stderr(code === 'EADDRINUSE' ? `Port ${port} is in use; pick another with --port, or leave it out to use any free port.\n` : `Could not start the page: ${(e as Error).message}\n`)
    return EXIT_CODES.error
  }
  io.stdout(
    [
      'PR Reviewer page is running on this machine only.',
      `  Open: ${server.pageUrl}`,
      'The link carries a one-time key; anyone with it can use your GitHub and AI access while this runs. Do not share it.',
      ...(server.pairCode
        ? [
            '',
            `Pairing code for the browser extension: ${formatPairCode(server.pairCode)}`,
            `  In the extension choose "This computer", keep port ${new URL(server.url).port}, and type the code. It works once, for 10 minutes.`,
            `  This computer will show as "${hostname()}".`,
          ]
        : paired
          ? ['', 'The paired browser extension can use this page. Remove it with: pr-reviewer serve --unpair']
          : []),
      '',
      'Press Ctrl+C to stop.',
      '',
    ].join('\n'),
  )
  if (parsed.values.open) deps.openUrl(server.pageUrl)
  await deps.untilStopped()
  await server.close()
  io.stderr('Stopped.\n')
  return EXIT_CODES.passed
}

/** `pr-reviewer web`: the self-hosted Web App, configured by environment variables (container-friendly). */
async function webCommand(args: string[], io: CliIo, deps: CliDeps): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({ args, allowPositionals: false, options: { port: { type: 'string' }, host: { type: 'string' } } })
  } catch (e) {
    return usageError(io, (e as Error).message)
  }
  const e = deps.env
  const list = (v: string | undefined) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  const opts = {
    publicUrl: e.PR_REVIEWER_PUBLIC_URL ?? '',
    clientId: e.PR_REVIEWER_GITHUB_CLIENT_ID ?? '',
    clientSecret: e.PR_REVIEWER_GITHUB_CLIENT_SECRET ?? '',
    secret: e.PR_REVIEWER_WEB_SECRET ?? '',
    dataDir: e.PR_REVIEWER_DATA_DIR ?? join(deps.homedir, '.local', 'share', 'pr-reviewer-web'),
    allowUsers: list(e.PR_REVIEWER_ALLOW_USERS),
    allowOrgs: list(e.PR_REVIEWER_ALLOW_ORGS),
    githubHost: e.PR_REVIEWER_GITHUB_HOST,
    scope: e.PR_REVIEWER_OAUTH_SCOPE,
    allowedEndpoints: list(e.PR_REVIEWER_ALLOWED_ENDPOINTS),
    sandbox: e.PR_REVIEWER_SANDBOX === 'on',
    ui: e.PR_REVIEWER_DEFAULT_UI === 'classic' ? ('classic' as const) : ('v2' as const),
    extensionIds: list(e.PR_REVIEWER_EXTENSION_IDS),
    fetch: deps.fetch,
    port: Number(parsed.values.port ?? e.PORT ?? 8080),
    host: parsed.values.host ?? '0.0.0.0',
    log: (t: string) => io.stderr(t),
  }
  const problems = webConfigProblems(opts)
  if (problems.length) {
    io.stderr(`The Web App is not configured:\n${problems.map((p) => `  - ${p}`).join('\n')}\n`)
    return EXIT_CONFIG
  }
  const web = await startWeb(opts)
  io.stdout(`PR Reviewer Web App listening on ${web.url} (public URL ${opts.publicUrl}); ${opts.allowUsers.length} user(s) and ${opts.allowOrgs.length} org(s) allowed.\n`)
  await deps.untilStopped()
  await web.close()
  return EXIT_CODES.passed
}

/** Opens a URL with the platform's default handler, without a shell. */
function openInBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]]
  try {
    spawn(cmd as string, args as string[], { stdio: 'ignore', detached: true }).on('error', () => undefined).unref()
  } catch {
    // The URL is printed; opening it is a convenience.
  }
}

/** Runs the GitHub CLI without a shell, writing `stdin` to it. */
function runGh(args: readonly string[], stdin?: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    const child = spawn('gh', args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false })
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d))
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d))
    child.on('error', (e) => resolve({ code: null, stdout, stderr: e.message }))
    child.on('close', (code) => resolve({ code, stdout, stderr }))
    child.stdin.on('error', () => undefined)
    child.stdin.end(stdin ?? '')
  })
}

function untilSignal(): Promise<void> {
  return new Promise((resolve) => {
    process.once('SIGINT', () => resolve())
    process.once('SIGTERM', () => resolve())
  })
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
