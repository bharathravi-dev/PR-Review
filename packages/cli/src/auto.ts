// `pr-reviewer auto …`: the Auto-Review Channel (AD-14, FR-26..FR-29a). In GitHub Actions these commands print only
// statuses and counts, never PR content.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  chooseInterval,
  discoveryQueries,
  EXIT_CODES,
  formatPrRef,
  HEALTH_TEXT,
  healthCauseFor,
  healthMarker,
  parsePrRef,
  parseHealthMarker,
  parseRepoConfig,
  reviewedState,
  selectForReview,
  SandboxRunResultSchema,
  type Candidate,
  type HealthCause,
  type ResolvedConfig,
  type Result,
  type SandboxPlan,
  type SandboxPort,
  type Secret,
} from '@pr-reviewer/core'
import { stringify } from 'yaml'
import { automationReadme, CLAUDE_CODE_VERSION, discoverWorkflow, reviewWorkflow, type CliSource } from './auto-workflows.js'
import { apiUrlForHost, createAutomation, createSandbox, envNamesFor, SANDBOX_NODE_MAJORS, type AutomationClient } from './compose.js'
import type { CliDeps, CliIo } from './deps.js'
import { connectGitHub, executeReview, performPublish, preparePublish, providerEntry, providerName } from './engine.js'
import { USER_AGENT, VERSION } from './version.js'

type Resolve = (profile?: string) => ResolvedConfig | number

const DEFAULT_REPO = 'pr-reviewer-automation'
/** Causes that a successful discovery proves are gone. */
const CLEARED_BY_DISCOVERY: readonly HealthCause[] = ['TOKEN_INVALID', 'TOKEN_SSO', 'RATE_LIMITED']

const AUTO_USAGE = `Usage: pr-reviewer auto <command> [options]

Automatic reviews of PRs in your Watch Scope, run by GitHub Actions in a private repository in your account.

Commands:
  enable      Create (or update) the automation repository, its workflows, and secrets
  status      Show the automation repository, schedule, and open problems
  discover    Find PRs to review and start one review per new head commit (run by the schedule)
  review      Review one PR at one head commit (run by the review workflow)
  prepare     Plan the Sandbox job for one PR (review workflow, sandbox mode)
  sandbox     Run a prepared Sandbox plan; no credentials needed (review workflow, sandbox mode)

enable options:
  --repo <name>              Automation repository name (default ${DEFAULT_REPO})
  --provider <name>          AI provider for automatic reviews (default: your default provider)
  --interval <30|60|120>     Discovery interval in minutes (default: the shortest that fits the budget)
  --prs-per-month <n>        Expected PRs to review per month, for the budget (default 60)
  --minutes <n>              Free GitHub Actions minutes per month (default 2000, GitHub Free)
  --cli-version <v>          Install this npm version of pr-reviewer in the workflows (default ${VERSION})
  --cli-repo <owner/repo> --cli-ref <commit sha>
                             Build pr-reviewer from this repository and commit instead of npm
  --sandbox                  Also run compile and lint in a separate secret-less Sandbox job
  --orgs <a,b>               Also watch PRs in these organisations (off by default)
  --subscription-opt-in      Allow a Claude Code subscription in automatic reviews (see the warning)
  --yes                      Don't ask for confirmation
  --no-first-run             Don't start a first discovery

The review token is read from PR_REVIEWER_REVIEW_TOKEN (a fine-grained token; enable explains how to make one).
`

export async function autoCommand(args: string[], io: CliIo, deps: CliDeps, secrets: Secret[], resolve: Resolve, usage: (m: string) => number): Promise<number> {
  const [sub, ...rest] = args
  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
    io.stdout(AUTO_USAGE)
    return EXIT_CODES.passed
  }
  if (sub === 'enable') return enable(rest, io, deps, secrets, resolve, usage)
  if (sub === 'discover') return discover(rest, io, deps, secrets, resolve, usage)
  if (sub === 'review') return review(rest, io, deps, secrets, resolve, usage, 'review')
  if (sub === 'prepare') return review(rest, io, deps, secrets, resolve, usage, 'prepare')
  if (sub === 'sandbox') return sandboxJob(rest, io, usage)
  if (sub === 'status') return status(rest, io, deps, secrets, resolve, usage)
  return usage(`Unknown auto command: ${sub}`)
}

const inActions = (deps: CliDeps) => deps.env.GITHUB_ACTIONS === 'true'

function splitRepo(full: string | undefined): { owner: string; repo: string } | undefined {
  const m = /^([\w.-]+)\/([\w.-]+)$/.exec(full ?? '')
  return m ? { owner: m[1]!, repo: m[2]! } : undefined
}

function automation(config: ResolvedConfig, deps: CliDeps, token: string | undefined): AutomationClient {
  const gh = config.settings.github ?? {}
  return createAutomation({ apiUrl: gh.apiUrl ?? apiUrlForHost(gh.host ?? 'github.com'), token, fetch: deps.fetch, userAgent: USER_AGENT })
}

// ── enable (Stories 5.1, 5.5) ─────────────────────────────────────────

async function enable(args: string[], io: CliIo, deps: CliDeps, secrets: Secret[], resolve: Resolve, usage: (m: string) => number): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args,
      allowPositionals: false,
      options: {
        repo: { type: 'string' },
        provider: { type: 'string' },
        interval: { type: 'string' },
        'prs-per-month': { type: 'string' },
        minutes: { type: 'string' },
        'cli-version': { type: 'string' },
        'cli-repo': { type: 'string' },
        'cli-ref': { type: 'string' },
        sandbox: { type: 'boolean' },
        orgs: { type: 'string' },
        'subscription-opt-in': { type: 'boolean' },
        yes: { type: 'boolean' },
        'no-first-run': { type: 'boolean' },
        profile: { type: 'string' },
      },
    })
  } catch (e) {
    return usage((e as Error).message)
  }
  const v = parsed.values
  const config = resolve(v.profile)
  if (typeof config === 'number') return config
  const repoName = v.repo ?? DEFAULT_REPO
  if (!/^[\w.-]+$/.test(repoName)) return usage('--repo must be a repository name (letters, digits, ., -, _)')
  const interval = v.interval === undefined ? undefined : Number(v.interval)
  if (interval !== undefined && interval !== 30 && interval !== 60 && interval !== 120) return usage('--interval must be 30, 60, or 120')
  const prsPerMonth = Number(v['prs-per-month'] ?? 60)
  const allowance = Number(v.minutes ?? 2000)
  if (!Number.isInteger(prsPerMonth) || prsPerMonth < 0 || !Number.isInteger(allowance) || allowance <= 0) return usage('--prs-per-month and --minutes must be whole numbers')

  // Where the workflows get pr-reviewer from: a pinned npm version, or a pinned commit of a repository.
  let cli: CliSource
  if (v['cli-repo'] || v['cli-ref']) {
    if (!splitRepo(v['cli-repo']) || !/^[0-9a-f]{40}$/.test(v['cli-ref'] ?? '')) return usage('--cli-repo needs owner/repo and --cli-ref a full 40-character commit SHA')
    cli = { kind: 'git', repo: v['cli-repo']!, ref: v['cli-ref']! }
  } else {
    const version = v['cli-version'] ?? VERSION
    const published = await deps.fetch(`https://registry.npmjs.org/${encodeURIComponent('@pr-reviewer/cli')}/${encodeURIComponent(version)}`).then((r) => r.ok, () => false)
    if (!published) {
      io.stderr(`@pr-reviewer/cli@${version} is not on npm yet, so the workflows can't install it from there.\nUse --cli-repo <owner/repo> --cli-ref <commit sha> to build it from a repository you can read.\n`)
      return 78
    }
    cli = { kind: 'npm', version }
  }

  // AI provider for automatic reviews; subscriptions need an explicit, informed opt-in (FR-10).
  const name = providerName(config, v.provider)
  const entry = providerEntry(config, name)
  if (!entry) return usage(`AI provider "${name}" is not defined in your user config.`)
  let aiSecret: string | undefined
  let aiEnv: string | undefined
  let aiValue: string | undefined
  if (entry.type === 'codex') {
    io.stderr('Codex cannot be used for automatic reviews in this release; choose an API-key provider or claude-code.\n')
    return 78
  }
  if (entry.type === 'claude-code') {
    io.stderr(
      [
        '',
        'Warning: using your Claude subscription for automatic reviews.',
        '  Headless, scheduled use of a consumer subscription may not be what its terms intend, and every automatic',
        '  review counts against your plan. Reviewing with an API key (ANTHROPIC_API_KEY) avoids both.',
        '  The workflow passes Claude Code exactly one secret, CLAUDE_CODE_OAUTH_TOKEN (from "claude setup-token"),',
        '  and runs it with no tools, in an empty folder.',
        '',
      ].join('\n'),
    )
    if (!v['subscription-opt-in']) {
      io.stderr('Re-run with --subscription-opt-in to accept this, or pick an API-key provider with --provider.\n')
      return 78
    }
    if (!v.yes && deps.isTTY) {
      const answer = (await deps.prompt('Type "yes" to use your Claude subscription for automatic reviews: ')).trim().toLowerCase()
      if (answer !== 'yes') {
        io.stderr('Not enabled.\n')
        return EXIT_CODES.passed
      }
    }
    aiSecret = 'CLAUDE_CODE_OAUTH_TOKEN'
    aiEnv = 'CLAUDE_CODE_OAUTH_TOKEN'
    aiValue = deps.env.CLAUDE_CODE_OAUTH_TOKEN
    if (!aiValue) {
      io.stderr('Set CLAUDE_CODE_OAUTH_TOKEN first: run "claude setup-token" and export the token it prints.\n')
      return 78
    }
  } else {
    const ref = entry.credential ?? (entry.type === 'anthropic' ? 'provider:anthropic' : `provider:${name}`)
    aiEnv = envNamesFor(ref)[0]!
    aiSecret = aiEnv
    const key = await deps.credentials.resolve(ref)
    if (!key.ok && entry.type !== 'openai-compatible') {
      io.stderr(`No key for "${name}": ${key.error.message}\n`)
      return 78
    }
    if (key.ok) {
      secrets.push(key.value)
      aiValue = key.value.reveal()
    } else aiSecret = undefined
  }

  // The token reviews run as: least privilege, expiring, supplied by the user (it cannot be created for them).
  const reviewToken = deps.env.PR_REVIEWER_REVIEW_TOKEN?.trim()
  if (!reviewToken) {
    io.stderr(
      [
        'Automatic reviews need their own GitHub token. Create a fine-grained token:',
        `  https://${config.settings.github?.host ?? 'github.com'}/settings/personal-access-tokens/new`,
        '  - Expiration: 90 days or less (you will get a health issue before it expires stops reviews)',
        '  - Repository access: the repositories you want reviewed (or All repositories)',
        '  - Permissions: Pull requests: Read and write; Contents: Read-only; Metadata: Read-only',
        '    (add Commit statuses: Read and write only if you use publish.commitStatus)',
        'Then: export PR_REVIEWER_REVIEW_TOKEN=<token> and run this command again. Nothing was created.',
        '',
      ].join('\n'),
    )
    return 78
  }

  const setup = await connectGitHub(config, deps, secrets, config.settings.github?.host ?? 'github.com')
  if (!setup.viewer) {
    io.stderr(`Setup needs your GitHub login (gh auth login): ${setup.tokenError ?? setup.viewerError}\n`)
    return EXIT_CODES.error
  }
  const login = setup.viewer.login
  const probe = automation(config, deps, reviewToken)
  const who = await probe.whoAmI()
  if (!who.ok || who.value.toLowerCase() !== login.toLowerCase()) {
    io.stderr(`PR_REVIEWER_REVIEW_TOKEN must belong to @${login}${who.ok ? `, not @${who.value}` : `: ${who.error.message}`}.\n`)
    return 78
  }

  const sandbox = v.sandbox === true
  const installMinutes = cli.kind === 'npm' ? 1 : 2
  const minutesPerPr = installMinutes + 2 + (sandbox ? installMinutes + 1 + (installMinutes + 6) : 0)
  const budget = chooseInterval({ allowanceMinutes: allowance, discoverMinutes: installMinutes, prsPerMonth, minutesPerPr, requested: interval as 30 | 60 | 120 | undefined })
  if (!budget) {
    io.stderr(`No schedule fits within 60% of ${allowance} free minutes a month for ${prsPerMonth} PRs. Lower --prs-per-month, drop --sandbox, or raise --minutes if your plan has more.\n`)
    return 78
  }

  const orgs = (v.orgs ?? '').split(',').map((o) => o.trim()).filter(Boolean)
  const autoConfig = {
    version: 1,
    defaultProvider: name,
    providers: { [name]: entry },
    autoReview: {
      watch: { reviewRequested: true, ownedRepos: true, authored: false, ...(orgs.length ? { orgs } : {}) },
      pendingForReviewRequests: true,
      sandbox,
      maxPerRun: 10,
      intervalMinutes: budget.intervalMinutes,
      ...(entry.type === 'claude-code' ? { subscriptionOptIn: true } : {}),
    },
    ...(config.settings.reviewRules?.length ? {} : {}),
  }

  io.stderr(
    [
      '',
      `Automatic reviews for @${login}`,
      `  repository:   ${login}/${repoName} (private)`,
      `  reviews:      PRs where your review is requested (as a pending draft only you see), and PRs in repositories you own${orgs.length ? `, plus organisations ${orgs.join(', ')}` : ''}`,
      `  AI:           ${name} (${entry.type})${entry.type === 'claude-code' ? `, Claude Code ${CLAUDE_CODE_VERSION}` : ''}`,
      `  schedule:     every ${budget.intervalMinutes} minutes${sandbox ? '; compile and lint in a separate secret-less job' : ''}`,
      `  CI use:       about ${budget.estimate} GitHub Actions minutes a month (${Math.round(budget.share * 100)}% of ${allowance} free minutes; private repository minutes count)`,
      `  pr-reviewer:  ${cli.kind === 'npm' ? `npm @pr-reviewer/cli@${cli.version}` : `${cli.repo} at ${cli.ref.slice(0, 12)}`}`,
      '',
    ].join('\n'),
  )
  if (!v.yes) {
    if (!deps.isTTY) return usage('Refusing to create the automation repository without confirmation; pass --yes')
    const answer = (await deps.prompt('Create it? [y/N] ')).trim().toLowerCase()
    if (answer !== 'y' && answer !== 'yes') {
      io.stderr('Nothing was created.\n')
      return EXIT_CODES.passed
    }
  }

  const client = automation(config, deps, setup.token)
  const existing = await client.repoExists(login, repoName)
  if (!existing.ok) return fail(io, `Could not check ${login}/${repoName}: ${existing.error.message}`)
  let branch = existing.value.defaultBranch ?? 'main'
  if (existing.value.exists && existing.value.private === false) return fail(io, `${login}/${repoName} exists and is public; automation must be private. Choose another --repo.`)
  if (!existing.value.exists) {
    const made = await client.createPrivateRepo(repoName, 'pr-reviewer Auto-Review (private; no PR content is stored here)')
    if (!made.ok) return fail(io, `Could not create ${login}/${repoName}: ${made.error.message}`)
    branch = made.value.defaultBranch
    io.stderr(`Created ${made.value.url}\n`)
  }
  const wf = { cli, intervalMinutes: budget.intervalMinutes, providerType: entry.type, aiSecret, aiEnv, sandbox }
  const files: Array<[string, string]> = [
    ['.pr-reviewer/config.yml', `# Auto-Review settings, written by pr-reviewer auto enable. No secrets.\n${stringify(autoConfig)}`],
    ['.github/workflows/discover.yml', discoverWorkflow(wf)],
    ['.github/workflows/review-pr.yml', reviewWorkflow(wf)],
    ['README.md', automationReadme({ login, intervalMinutes: budget.intervalMinutes, estimate: budget.estimate, allowance })],
  ]
  for (const [path, content] of files) {
    const put = await client.putFile(login, repoName, path, content, `pr-reviewer: update ${path}`, branch)
    if (!put.ok) return fail(io, `Could not write ${path}: ${put.error.message}`)
  }

  // Secrets go through gh, which encrypts them for the repository; values never touch disk or logs.
  const toSet: Array<[string, string]> = [['REVIEW_TOKEN', reviewToken], ...(aiSecret && aiValue ? ([[aiSecret, aiValue]] as Array<[string, string]>) : [])]
  for (const [secretName, value] of toSet) {
    const r = await deps.runGh(['secret', 'set', secretName, '--repo', `${login}/${repoName}`], value)
    if (r.code !== 0) return fail(io, `Could not store the ${secretName} secret with gh: ${r.stderr.trim() || `exit ${r.code}`}`)
  }
  io.stderr(`Stored secrets: ${toSet.map(([n]) => n).join(', ')}\n`)

  if (!v['no-first-run']) {
    let started: Result<void> | undefined
    for (let i = 0; i < 3; i++) {
      started = await client.dispatch(login, repoName, 'discover.yml', branch, {})
      if (started.ok) break
      await new Promise((r) => setTimeout(r, 2000))
    }
    io.stderr(started?.ok ? 'Started the first discovery; watch it in the Actions tab.\n' : `Could not start the first discovery (${started?.error.message}); it will run on schedule.\n`)
  }
  io.stdout(`Automatic reviews are on: https://${config.settings.github?.host ?? 'github.com'}/${login}/${repoName}\n`)
  return EXIT_CODES.passed
}

function fail(io: CliIo, message: string): number {
  io.stderr(`${message}\n`)
  return EXIT_CODES.error
}

// ── discover (Story 5.2) ──────────────────────────────────────────────

async function discover(args: string[], io: CliIo, deps: CliDeps, secrets: Secret[], resolve: Resolve, usage: (m: string) => number): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({ args, allowPositionals: false, options: { 'automation-repo': { type: 'string' }, 'dry-run': { type: 'boolean' }, profile: { type: 'string' } } })
  } catch (e) {
    return usage((e as Error).message)
  }
  const config = resolve(parsed.values.profile)
  if (typeof config === 'number') return config
  const auto = config.settings.autoReview ?? {}
  const dry = parsed.values['dry-run'] === true
  const target = splitRepo(parsed.values['automation-repo'] ?? deps.env.GITHUB_REPOSITORY)
  if (!dry && !target) return usage('discover needs --automation-repo owner/repo (or --dry-run)')
  const quiet = inActions(deps)

  const host = config.settings.github?.host ?? 'github.com'
  const github = await connectGitHub(config, deps, secrets, host)
  const dispatcher = automation(config, deps, deps.env.PR_REVIEWER_DISPATCH_TOKEN ?? github.token)
  const health = target ? new Health(dispatcher, target, io) : undefined
  if (!github.viewer) {
    const err = { code: github.tokenError ? 'github_unauthorized' : 'github_unauthorized', message: github.tokenError ?? github.viewerError ?? '' }
    await health?.raise(healthCauseFor(err.code, err.message) ?? 'TOKEN_INVALID')
    io.stderr(`Discovery needs a GitHub token (REVIEW_TOKEN): ${err.message}\n`)
    return EXIT_CODES.error
  }
  const login = github.viewer.login
  const reader = automation(config, deps, github.token)

  const candidates: Candidate[] = []
  for (const q of discoveryQueries(auto.watch, login)) {
    const found = await reader.searchPulls(q, 50, login)
    if (!found.ok) {
      const cause = healthCauseFor(found.error.code, found.error.message)
      if (cause) await health?.raise(cause)
      io.stderr(`Search failed: ${found.error.message}\n`)
      return EXIT_CODES.error
    }
    candidates.push(...found.value)
  }

  // Repository opt-out (`automatedReview: false` on the default branch), read at most once per repository per run.
  const optedOut = new Set<string>()
  for (const repo of [...new Set(candidates.map((c) => c.repo.toLowerCase()))]) {
    const [owner, name] = repo.split('/') as [string, string]
    const text = await reader.readFile(owner, name, '.github/pr-reviewer.yml')
    if (text.ok && parseRepoConfig(text.value).settings.automatedReview === false) optedOut.add(repo)
  }
  // Head Commits already reviewed, from own markers only (AD-11).
  const reviewed = new Set<string>()
  for (const c of candidates) {
    const ref = parsePrRef(`${c.repo}#${c.number}`, host)
    if (!ref.ok) continue
    const items = await github.reader.listPublished(ref.value)
    if (items.ok && reviewedState(items.value, github.viewer.id, c.headSha) === 'CURRENT') reviewed.add(`${c.repo.toLowerCase()}#${c.number}@${c.headSha}`)
  }
  const { dispatch, skipped } = selectForReview(candidates, { login, watch: auto.watch, optedOut, reviewed, maxPerRun: auto.maxPerRun })

  let started = 0
  if (!dry && target) {
    const info = await dispatcher.repoExists(target.owner, target.repo)
    const branch = info.ok ? (info.value.defaultBranch ?? 'main') : 'main'
    for (const c of dispatch) {
      const r = await dispatcher.dispatch(target.owner, target.repo, 'review-pr.yml', branch, { repo: c.repo, pr: String(c.number), head: c.headSha })
      if (r.ok) started++
      else io.stderr(`Could not start a review: ${r.error.message}\n`)
    }
    await health?.clear(CLEARED_BY_DISCOVERY)
  }
  const counts = Object.entries(skipped).filter(([, n]) => n > 0).map(([k, n]) => `${k.toLowerCase().replace(/_/g, ' ')} ${n}`).join(', ')
  io.stdout(`Found ${new Set(candidates.map((c) => `${c.repo}#${c.number}`)).size} open PR(s); ${dry ? 'would review' : 'started reviews for'} ${dry ? dispatch.length : started}${counts ? `; skipped: ${counts}` : ''}.\n`)
  if (dry && !quiet) for (const c of dispatch) io.stdout(`  ${c.repo}#${c.number} @ ${c.headSha.slice(0, 7)}${c.reviewRequested ? ' (review requested: pending draft)' : ''}\n`)
  return EXIT_CODES.passed
}

// ── review / prepare (Stories 5.3, 5.4) ───────────────────────────────

async function review(args: string[], io: CliIo, deps: CliDeps, secrets: Secret[], resolve: Resolve, usage: (m: string) => number, mode: 'review' | 'prepare'): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args,
      allowPositionals: false,
      options: { repo: { type: 'string' }, pr: { type: 'string' }, head: { type: 'string' }, 'automation-repo': { type: 'string' }, 'sandbox-results': { type: 'string' }, out: { type: 'string' }, profile: { type: 'string' } },
    })
  } catch (e) {
    return usage((e as Error).message)
  }
  const v = parsed.values
  if (!splitRepo(v.repo) || !/^\d+$/.test(v.pr ?? '') || !/^[0-9a-f]{40}$/.test(v.head ?? '')) return usage(`${mode} needs --repo owner/repo, --pr <number>, and --head <40-character SHA>`)
  if (mode === 'prepare' && !v.out) return usage('prepare needs --out <dir>')
  const config = resolve(v.profile)
  if (typeof config === 'number') return config
  const auto = config.settings.autoReview ?? {}
  const host = config.settings.github?.host ?? 'github.com'
  const ref = parsePrRef(`${v.repo}#${v.pr}`, host)
  if (!ref.ok) return usage(ref.error.message)
  const label = formatPrRef(ref.value)
  const target = splitRepo(v['automation-repo'] ?? deps.env.GITHUB_REPOSITORY)

  const github = await connectGitHub(config, deps, secrets, host)
  const health = target ? new Health(automation(config, deps, deps.env.PR_REVIEWER_DISPATCH_TOKEN ?? github.token), target, io) : undefined
  if (!github.viewer) {
    await health?.raise(healthCauseFor('github_unauthorized', github.tokenError ?? github.viewerError ?? '') ?? 'TOKEN_INVALID')
    io.stderr(`${label}: no usable GitHub token\n`)
    return EXIT_CODES.error
  }
  const head = await github.reader.getHeadSha(ref.value)
  if (!head.ok) {
    const cause = healthCauseFor(head.error.code, head.error.message)
    if (cause) await health?.raise(cause)
    io.stderr(`${label}: ${head.error.message}\n`)
    return EXIT_CODES.error
  }
  if (head.value !== v.head) {
    io.stdout(`${label}: superseded by a newer commit; the next discovery reviews it.\n`)
    return EXIT_CODES.passed
  }

  // Sandbox split across jobs (AD-14): prepare records the plan; review replays the secret-less job's results.
  let sandbox: SandboxPort | null = null
  let recorded: { plan: SandboxPlan; planHash: string; headSha: string; archive: Uint8Array } | undefined
  if (mode === 'prepare') {
    sandbox = {
      probe: async () => ({ ok: true, value: { runtime: 'deferred to the sandbox job', nodeMajors: [...SANDBOX_NODE_MAJORS], egressControl: true } }),
      run: async (plan, planHash, source) => {
        recorded = { plan, planHash, headSha: source.headSha, archive: source.archive }
        return { ok: false, error: { code: 'deferred', message: 'Runs in the sandbox job.', retryable: false } }
      },
    }
  } else if (v['sandbox-results'] && auto.sandbox) {
    sandbox = replaySandbox(v['sandbox-results'])
  }

  const { report, context } = await executeReview({ config, deps, secrets, ref: ref.value, github, channel: 'AUTO_REVIEW', sandbox, noAi: mode === 'prepare' })

  if (mode === 'prepare') {
    mkdirSync(v.out!, { recursive: true })
    if (recorded) {
      writeFileSync(join(v.out!, 'plan.json'), JSON.stringify({ plan: recorded.plan, planHash: recorded.planHash, headSha: recorded.headSha }))
      writeFileSync(join(v.out!, 'source.tgz'), recorded.archive)
      io.stdout(`${label}: Sandbox plan with ${recorded.plan.steps.length} step(s) prepared.\n`)
    } else {
      writeFileSync(join(v.out!, 'plan.json'), JSON.stringify({ plan: null }))
      io.stdout(`${label}: nothing needs the Sandbox.\n`)
    }
    return EXIT_CODES.passed
  }

  if (report.audit.repoConfig && (report.audit.repoConfig.settings as { automatedReview?: unknown }).automatedReview === false) {
    io.stdout(`${label}: the repository opted out of automatic reviews (REPO_OPTED_OUT); nothing was published.\n`)
    return EXIT_CODES.passed
  }
  const aiFailure = report.ai?.attempts.filter((a) => a.outcome === 'FAILED').at(-1)
  if (aiFailure && !report.ai?.attempts.some((a) => a.outcome === 'SUCCEEDED')) {
    const cause = /reject|unauthori|forbidden|not logged in|credential/i.test(aiFailure.reason ?? '') ? 'AI_CREDENTIAL' : /rate|quota|limit/i.test(aiFailure.reason ?? '') ? 'AI_QUOTA' : undefined
    if (cause) await health?.raise(cause)
  }
  if (!context) {
    io.stderr(`${label}: the PR could not be loaded\n`)
    return EXIT_CODES.error
  }
  const pending = auto.pendingForReviewRequests !== false && (context.requestedReviewers ?? []).some((l) => l.toLowerCase() === github.viewer!.login.toLowerCase())
  const prepared = await preparePublish(report, context, ref.value, github, config, { event: 'COMMENT', unattended: true, pending })
  if (!prepared.ok) {
    const cause = healthCauseFor(prepared.error.code, prepared.error.message)
    if (cause) await health?.raise(cause)
    io.stderr(`${label}: not published: ${prepared.error.message}\n`)
    return EXIT_CODES.publishFailed
  }
  const { record } = await performPublish(report, prepared.value.plan, prepared.value.preview, ref.value, github, config)
  if (record.status === 'FAILED') {
    const cause = healthCauseFor(record.reason?.includes('422') ? 'github_unprocessable' : 'github_no_write_access', record.reason ?? '')
    if (cause) await health?.raise(cause)
  }
  io.stdout(`${label}: ${report.overallStatus}, ${report.findings.length} finding(s); ${pending ? 'pending review' : 'review'} ${record.status.toLowerCase().replace(/_/g, ' ')}${record.commentCount ? `, ${record.commentCount} inline` : ''}.\n`)
  return record.status === 'PUBLISHED' || record.status === 'SKIPPED_DUPLICATE' || record.status === 'CANCELLED' || record.status === 'BLOCKED_PENDING_DRAFT' ? EXIT_CODES.passed : EXIT_CODES.publishFailed
}

/** Reads the secret-less job's results; the engine rejects any whose plan hash or head commit differ (AD-14). */
function replaySandbox(path: string): SandboxPort {
  return {
    probe: async () => ({ ok: true, value: { runtime: 'results from the sandbox job', nodeMajors: [...SANDBOX_NODE_MAJORS], egressControl: true } }),
    run: async () => {
      let raw: unknown
      try {
        raw = JSON.parse(readFileSync(path, 'utf8'))
      } catch (e) {
        return { ok: false, error: { code: 'sandbox_results_missing', message: `No Sandbox results: ${(e as Error).message}`, retryable: false } }
      }
      const parsed = SandboxRunResultSchema.safeParse(raw)
      if (!parsed.success) return { ok: false, error: { code: 'sandbox_results_invalid', message: 'The Sandbox results are not in the expected shape.', retryable: false } }
      return { ok: true, value: parsed.data }
    },
  }
}

// ── sandbox job (Story 5.4): no credentials, no GitHub access ────────

async function sandboxJob(args: string[], io: CliIo, usage: (m: string) => number): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({ args, allowPositionals: false, options: { in: { type: 'string' }, out: { type: 'string' } } })
  } catch (e) {
    return usage((e as Error).message)
  }
  const { in: input, out } = parsed.values
  if (!input || !out) return usage('sandbox needs --in <dir> and --out <dir>')
  mkdirSync(out, { recursive: true })
  const meta = JSON.parse(readFileSync(join(input, 'plan.json'), 'utf8')) as { plan: SandboxPlan | null; planHash?: string; headSha?: string }
  if (!meta.plan) {
    writeFileSync(join(out, 'results.json'), JSON.stringify(null))
    io.stdout('Nothing to run.\n')
    return EXIT_CODES.passed
  }
  const sb = createSandbox({})
  const probe = await sb.probe()
  if (!probe.ok) {
    io.stderr(`No container runtime: ${probe.error.message}\n`)
    return EXIT_CODES.error
  }
  const res = await sb.run(meta.plan, meta.planHash!, { headSha: meta.headSha!, archive: readFileSync(join(input, 'source.tgz')) })
  if (!res.ok) {
    io.stderr(`Sandbox failed: ${res.error.code}\n`)
    return EXIT_CODES.error
  }
  writeFileSync(join(out, 'results.json'), JSON.stringify(res.value))
  // Only step ids and exit codes; tool output stays in the results file, never the log.
  for (const r of res.value.results) io.stdout(`  ${r.id}: ${r.timedOut ? 'timed out' : `exit ${r.exitCode}`}\n`)
  return EXIT_CODES.passed
}

// ── status ────────────────────────────────────────────────────────────

async function status(args: string[], io: CliIo, deps: CliDeps, secrets: Secret[], resolve: Resolve, usage: (m: string) => number): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({ args, allowPositionals: false, options: { repo: { type: 'string' }, profile: { type: 'string' } } })
  } catch (e) {
    return usage((e as Error).message)
  }
  const config = resolve(parsed.values.profile)
  if (typeof config === 'number') return config
  const github = await connectGitHub(config, deps, secrets, config.settings.github?.host ?? 'github.com')
  if (!github.viewer) return fail(io, `Needs your GitHub login: ${github.tokenError ?? github.viewerError}`)
  const name = parsed.values.repo ?? DEFAULT_REPO
  const client = automation(config, deps, github.token)
  const info = await client.repoExists(github.viewer.login, name)
  if (!info.ok) return fail(io, info.error.message)
  if (!info.value.exists) {
    io.stdout(`Automatic reviews are off (no ${github.viewer.login}/${name}). Turn them on with: pr-reviewer auto enable\n`)
    return EXIT_CODES.passed
  }
  const lines = [`Automation repository: ${github.viewer.login}/${name}${info.value.private ? ' (private)' : ' (PUBLIC: make it private)'}`]
  const text = await client.readFile(github.viewer.login, name, '.pr-reviewer/config.yml')
  if (text.ok && text.value) lines.push(...text.value.split('\n').filter((l) => /intervalMinutes|defaultProvider|sandbox|subscriptionOptIn/.test(l)).map((l) => `  ${l.trim()}`))
  const secretNames = await client.secretNames(github.viewer.login, name)
  if (secretNames.ok) lines.push(`Secrets: ${secretNames.value.join(', ') || 'none'}`)
  const issues = await client.openIssues(github.viewer.login, name)
  const problems = issues.ok ? issues.value.filter((i) => parseHealthMarker(i.body)) : []
  lines.push(problems.length ? `Problems (${problems.length}):` : 'No open problems.', ...problems.map((p) => `  ${HEALTH_TEXT[parseHealthMarker(p.body)!].title}: ${p.url}`))
  io.stdout(`${lines.join('\n')}\n`)
  return EXIT_CODES.passed
}

// ── health issues (FR-29) ─────────────────────────────────────────────

/** One issue per cause in the automation repository, closed when the cause clears. Bodies hold no PR content. */
class Health {
  #open: Promise<Map<HealthCause, number>> | undefined
  constructor(
    private readonly client: AutomationClient,
    private readonly repo: { owner: string; repo: string },
    private readonly io: CliIo,
  ) {}

  #issues(): Promise<Map<HealthCause, number>> {
    this.#open ??= this.client.openIssues(this.repo.owner, this.repo.repo).then((r) => {
      const map = new Map<HealthCause, number>()
      if (r.ok) for (const i of r.value) {
        const cause = parseHealthMarker(i.body)
        if (cause) map.set(cause, i.number)
      }
      return map
    })
    return this.#open
  }

  async raise(cause: HealthCause): Promise<void> {
    const open = await this.#issues()
    if (open.has(cause)) return
    const t = HEALTH_TEXT[cause]
    const made = await this.client.createIssue(this.repo.owner, this.repo.repo, `pr-reviewer: ${t.title}`, `${t.title}.\n\n**What to do:** ${t.fix}\n\nThis issue closes by itself once the problem is gone.\n\n${healthMarker(cause)}`)
    if (made.ok) open.set(cause, made.value.number)
    else this.io.stderr(`Could not open a health issue: ${made.error.message}\n`)
  }

  async clear(causes: readonly HealthCause[]): Promise<void> {
    const open = await this.#issues()
    for (const cause of causes) {
      const n = open.get(cause)
      if (n === undefined) continue
      const r = await this.client.closeIssue(this.repo.owner, this.repo.repo, n, 'The last run worked; closing.')
      if (r.ok) open.delete(cause)
    }
  }
}
