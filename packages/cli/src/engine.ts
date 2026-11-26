// Review operations shared by the CLI commands and the local review page (AD-16: one engine path per Channel).
import {
  decideApproval,
  err,
  hunksFromContext,
  ok,
  planPublish,
  publish,
  readPrior,
  renderPublish,
  reviewedState,
  runReviewWithContext,
  setCommitStatus,
  type CommitStatusOutcome,
  type EventSink,
  type GitHubReader,
  type GitHubWriter,
  type LayerResult,
  type Channel,
  type PrContext,
  type ProviderCandidate,
  type SandboxPort,
  type ProviderSettings,
  type PrRef,
  type PublishPlan,
  type PublishPreview,
  type PublishRecord,
  type PullSummary,
  type Report,
  type ResolvedConfig,
  type Result,
  type ReviewedState,
  type ReviewProvider,
  type Secret,
} from '@pr-reviewer/core'
import {
  apiUrlForHost,
  createAdvisories,
  createAnthropicProvider,
  createSandbox,
  installSteps,
  validators,
  createClaudeCodeProvider,
  createCodexProvider,
  createGitHub,
  createOllamaProvider,
  createOpenAiProvider,
  findClaudeCode,
  findCodex,
  secretScanner,
} from './compose.js'
import { userConfigPath } from './config-file.js'
import type { CliDeps } from './deps.js'
import { loadReviewRules } from './rules-loader.js'
import { cacheDir, fileCache, fileLedger, firstTime, stateDir } from './state.js'
import { ENGINE_MAJOR, USER_AGENT, VERSION } from './version.js'

export interface GitHubConnection {
  reader: GitHubReader
  writer: GitHubWriter
  /** Why no GitHub token is available, when none is. */
  tokenError?: string | undefined
  /** The Reviewer Identity, when a token is available and GitHub accepted it. */
  viewer?: { id: number; login: string } | undefined
  /** Why the Reviewer Identity could not be read, when a token exists. */
  viewerError?: string | undefined
  /** The token itself, for the Auto-Review Channel's own GitHub calls (never printed; redacted from output). */
  token?: string | undefined
}

/** Opens GitHub for `host` with the user's Credential (AD-10) and, unless told not to, reads the Reviewer Identity. */
export async function connectGitHub(
  config: ResolvedConfig,
  deps: CliDeps,
  secrets: Secret[],
  host: string,
  opts: { viewer?: boolean } = {},
): Promise<GitHubConnection> {
  const gh = config.settings.github ?? {}
  const token = await deps.credentials.resolve(gh.credential ?? 'github', { host })
  if (token.ok) secrets.push(token.value)
  const sameHost = host === (gh.host ?? 'github.com')
  const { reader, writer } = createGitHub({
    apiUrl: (sameHost ? gh.apiUrl : undefined) ?? apiUrlForHost(host),
    token: token.ok ? token.value.reveal() : undefined,
    fetch: deps.fetch,
    userAgent: USER_AGENT,
  })
  const conn: GitHubConnection = { reader, writer, ...(token.ok ? { token: token.value.reveal() } : { tokenError: token.error.message }) }
  if (token.ok && opts.viewer !== false) {
    const viewer = await reader.viewer()
    if (viewer.ok) conn.viewer = { id: viewer.value.id, login: viewer.value.login }
    else conn.viewerError = viewer.error.message
  }
  return conn
}

/** The AI Provider name a run uses: the flag, else the configured default, else Anthropic. */
export function providerName(config: ResolvedConfig, flag?: string): string {
  return flag ?? config.settings.defaultProvider ?? 'anthropic'
}

/** Providers usable by name without any configuration. */
const BUILT_IN: Record<string, ProviderSettings> = {
  anthropic: { type: 'anthropic' },
  openai: { type: 'openai-compatible', credential: 'provider:openai' },
  'claude-code': { type: 'claude-code' },
  codex: { type: 'codex' },
  ollama: { type: 'ollama' },
}

/** The configured (or built-in) settings for a provider name. */
export function providerEntry(config: ResolvedConfig, name: string): ProviderSettings | undefined {
  return config.settings.providers?.[name] ?? BUILT_IN[name]
}

/** Builds one AI Provider from Configuration (FR-9, FR-9a, FR-10). Credentials are resolved, never stored. */
export async function buildProvider(
  config: ResolvedConfig,
  providerFlag: string | undefined,
  modelFlag: string | undefined,
  deps: CliDeps,
  secrets: Secret[],
): Promise<Result<ReviewProvider>> {
  const name = providerName(config, providerFlag)
  const entry = providerEntry(config, name)
  if (!entry) return err('provider_unknown', `AI provider "${name}" is not defined in the user config (providers.${name}).`)
  const model = modelFlag ?? entry.model
  switch (entry.type) {
    case 'anthropic':
    case 'anthropic-compatible': {
      const key = await deps.credentials.resolve(entry.credential ?? (entry.type === 'anthropic' ? 'provider:anthropic' : `provider:${name}`))
      if (!key.ok) return err('provider_credential_missing', key.error.message)
      secrets.push(key.value)
      return ok(createAnthropicProvider({ name, apiKey: key.value, model, baseUrl: entry.baseUrl, timeoutMs: entry.timeoutMs, fetch: deps.fetch }))
    }
    case 'openai-compatible': {
      if (!model) return err('provider_model_missing', `Set the model for "${name}" (providers.${name}.model in the user config, or --model).`)
      const ref = entry.credential ?? `provider:${name}`
      const key = await deps.credentials.resolve(ref)
      // A local endpoint (e.g. Ollama) may need no key; a configured credential must resolve.
      if (!key.ok && (entry.credential || !entry.baseUrl)) return err('provider_credential_missing', key.error.message)
      if (key.ok) secrets.push(key.value)
      return ok(
        createOpenAiProvider({
          name,
          apiKey: key.ok ? key.value : undefined,
          model,
          baseUrl: entry.baseUrl,
          apiKeyHeader: entry.apiKeyHeader,
          responseFormat: entry.responseFormat,
          timeoutMs: entry.timeoutMs,
          fetch: deps.fetch,
        }),
      )
    }
    case 'ollama': {
      // A local model: no key, nothing leaves this machine for the AI step.
      if (!model) return err('provider_model_missing', `Set the Ollama model (providers.${name}.model, or --model qwen3:8b); \`ollama list\` shows what is installed.`)
      return ok(createOllamaProvider({ model, baseUrl: entry.baseUrl, contextLength: entry.contextLength, timeoutMs: entry.timeoutMs, fetch: deps.fetch }))
    }
    case 'claude-code': {
      const command = entry.command ?? findClaudeCode(deps.env, deps.homedir, deps.platform)
      if (!command) return err('cli_missing', 'Claude Code was not found. Install it (https://claude.com/claude-code) and log in, or set providers.claude-code.command to its path.')
      // Auto-Review may use the subscription only after the explicit opt-in, with exactly its CI token (AD-8, FR-10).
      const optIn = config.settings.autoReview?.subscriptionOptIn === true
      return ok(
        createClaudeCodeProvider({
          name,
          command,
          model,
          env: deps.env,
          timeoutMs: entry.timeoutMs,
          ...(optIn ? { channels: ['CLI', 'AUTO_REVIEW'] as const, passEnv: ['CLAUDE_CODE_OAUTH_TOKEN'] } : {}),
        }),
      )
    }
    case 'codex': {
      const command = entry.command ?? findCodex(deps.env, deps.platform)
      if (!command) return err('cli_missing', 'Codex was not found. Install the Codex CLI and run "codex login", or set providers.codex.command to its path.')
      return ok(createCodexProvider({ name, command, model, env: deps.env, homedir: deps.homedir, timeoutMs: entry.timeoutMs }))
    }
  }
}

/** The provider order for a run (AD-8, FR-11): the chosen provider, then the configured fallbacks. */
export async function buildProviderChain(
  config: ResolvedConfig,
  providerFlag: string | undefined,
  modelFlag: string | undefined,
  deps: CliDeps,
  secrets: Secret[],
): Promise<ProviderCandidate[]> {
  const primary = providerName(config, providerFlag)
  const names = [primary, ...(config.settings.fallback ?? []).filter((n) => n !== primary)].filter((n, i, all) => all.indexOf(n) === i)
  const out: ProviderCandidate[] = []
  for (const name of names) {
    const model = name === primary ? modelFlag : undefined
    const built = await buildProvider(config, name, model, deps, secrets)
    const entry = providerEntry(config, name)
    out.push({
      name,
      ...(built.ok ? { provider: built.value } : { unavailableReason: built.error.message }),
      model: model ?? entry?.model,
      pricing: entry?.pricing,
    })
  }
  return out
}

export interface ExecuteReviewOptions {
  config: ResolvedConfig
  deps: CliDeps
  secrets: Secret[]
  ref: PrRef
  github: GitHubConnection
  provider?: string | undefined
  model?: string | undefined
  runId?: string | undefined
  /** Notes about Review Rules that could not be read. */
  onWarning?: (text: string) => void
  /** One-time notices (e.g. that a subscription is used). */
  onNotice?: (text: string) => void
  /** Called once the run is about to start (after configuration is loaded). */
  beforeRun?: () => void
  onLayer?: (layer: LayerResult) => void
  onEvent?: EventSink
  /** Default CLI. */
  channel?: Channel | undefined
  /** Replaces the container Sandbox (Auto-Review splits it into its own job); null means none. */
  sandbox?: SandboxPort | null | undefined
  /** `review --effort`: light, standard, deep, or adaptive (the default). */
  effort?: 'adaptive' | 'light' | 'standard' | 'deep' | undefined
  /** Re-check every file with the AI, even after an earlier review (`review --full`). */
  full?: boolean | undefined
  /** Skip the AI step (Auto-Review `prepare` only plans the Sandbox). */
  noAi?: boolean | undefined
}

/** Runs the Review Engine for one PR exactly as the `review` command does. */
export async function executeReview(o: ExecuteReviewOptions): Promise<{ report: Report; context?: PrContext }> {
  const chain = o.noAi ? [] : await buildProviderChain(o.config, o.provider, o.model, o.deps, o.secrets)
  const name = providerName(o.config, o.provider)
  const dir = stateDir(o.deps)
  for (const c of chain) {
    const type = providerEntry(o.config, c.name)?.type
    if (c.provider?.billing !== 'PLAN' || (type !== 'claude-code' && type !== 'codex')) continue
    if (firstTime(dir, `plan-usage:${type}`)) {
      const via = type === 'codex' ? 'Codex login (ChatGPT plan)' : 'Claude Code login (Claude plan)'
      o.onNotice?.(
        `Note: "${c.name}" reviews through your own ${via}. Each review uses your plan's usage allowance, like any other request you make with it. It runs with no tools, in an empty folder, without your GitHub or API keys. (Shown once.)`,
      )
    }
  }
  const settings = o.config.settings
  // Usage is recorded locally only when it matters: pricing or limits are configured (FR-12).
  const tracked = o.config.settings.limits !== undefined || chain.some((c) => c.pricing)
  const rules = await loadReviewRules(o.config.settings.reviewRules ?? [], { configPath: userConfigPath(o.deps), homedir: o.deps.homedir, fetch: o.deps.fetch })
  for (const w of rules.warnings) o.onWarning?.(w)
  o.beforeRun?.()
  return runReviewWithContext(
    {
      ref: o.ref,
      engineVersion: VERSION,
      channel: o.channel ?? 'CLI',
      review: {
        provider: name === 'anthropic' ? undefined : name,
        model: o.model ?? o.config.settings.providers?.[name]?.model,
        rules: rules.rules,
        toolResults: o.config.settings.ai?.toolResults,
        verify: o.config.settings.ai?.verify,
        learn: o.config.settings.ai?.learn,
        relatedFiles: o.config.settings.ai?.relatedFiles,
        styleFindings: o.config.settings.ai?.styleFindings,
        incremental: o.full ? false : o.config.settings.ai?.incremental,
        effort: o.effort ?? o.config.settings.ai?.effort,
      },
      reviewerId: o.github.viewer?.id,
      costLimits: o.config.settings.limits,
      disabledValidators: o.config.settings.validators?.disable,
      sandboxRegistries: o.config.settings.sandbox?.registries,
      configSources: o.config.sources,
      limitations: rules.warnings,
      runId: o.runId,
      onLayer: o.onLayer,
      onEvent: o.onEvent,
    },
    {
      github: o.github.reader,
      scanSecrets: secretScanner,
      providers: chain,
      ledger: tracked ? fileLedger(dir) : undefined,
      validators,
      installSteps,
      sandbox: o.sandbox !== undefined ? (o.sandbox ?? undefined) : settings.sandbox?.enabled === false ? undefined : createSandbox({ runtime: settings.sandbox?.runtime }),
      advisories: settings.advisories?.enabled === false ? undefined : createAdvisories({ url: settings.advisories?.url, fetch: o.deps.fetch }),
      cache: settings.cache?.enabled === false ? undefined : fileCache(cacheDir(o.deps), settings.cache?.maxMB),
      now: () => Date.now(),
    },
  )
}

export interface PublishChoice {
  event: PublishPlan['event']
  include?: readonly string[] | undefined
  unattended: boolean
  /** Leave a pending (draft) review (Auto-Review on review requests, FR-20a). */
  pending?: boolean | undefined
}

/**
 * Plans and renders a publish (AD-23). Prior publication is read from GitHub each time, so the preview is exact.
 * Needs the Reviewer Identity.
 */
export async function preparePublish(
  report: Report,
  context: PrContext,
  ref: PrRef,
  github: GitHubConnection,
  config: ResolvedConfig,
  choice: PublishChoice,
): Promise<Result<{ plan: PublishPlan; preview: PublishPreview }>> {
  if (!github.viewer) return err('no_reviewer_identity', github.tokenError ?? github.viewerError ?? 'The GitHub identity is unknown.')
  const published = await github.reader.listPublished(ref)
  if (!published.ok) return err(published.error.code, published.error.message)
  const settings = config.settings.publish ?? {}
  const plan = planPublish(report, {
    prior: readPrior(published.value, github.viewer.id, report.run.fpv),
    hunks: hunksFromContext(context),
    rid: github.viewer.id,
    engineMajor: ENGINE_MAJOR,
    productVersion: VERSION,
    unattended: choice.unattended,
    event: choice.event,
    include: choice.include,
    pending: choice.pending,
    maxInline: minDefined(settings.maxInlineComments, repoMaxInline(report)),
    minInlineSeverity: stricterSeverity(settings.minInlineSeverity, repoSetting(report, 'minInlineSeverity')),
    extraLinkPrefixes: settings.linkPrefixes,
    // Opt-in approval: only with publish.approve.enabled, and only when every condition holds.
    ...(settings.approve?.enabled ? { approval: decideApproval(report, settings.approve, { draft: context.draft, ownPr: context.author.toLowerCase() === github.viewer.login.toLowerCase() }) } : {}),
  })
  return ok({ plan, preview: renderPublish(report, plan) })
}

export interface PublishOutcome {
  record: PublishRecord
  commitStatus?: { outcome: CommitStatusOutcome; reason?: string | undefined }
}

/** Publishes a planned review and, when configured, sets the commit status (FR-21). */
export async function performPublish(
  report: Report,
  plan: PublishPlan,
  preview: PublishPreview,
  ref: PrRef,
  github: GitHubConnection,
  config: ResolvedConfig,
): Promise<PublishOutcome> {
  const record = await publish(report, plan, preview, ref, { reader: github.reader, writer: github.writer, now: () => Date.now() })
  if (!config.settings.publish?.commitStatus || (record.status !== 'PUBLISHED' && record.status !== 'SKIPPED_DUPLICATE')) return { record }
  return { record, commitStatus: await setCommitStatus(report, ref, github.writer, record.summaryUrl) }
}

export type ReviewedLabel = ReviewedState | 'UNKNOWN'

/** Open PRs with whether the Reviewer reviewed their latest commit (FR-25); UNKNOWN without an identity. */
export async function listPullsWithState(
  reader: GitHubReader,
  repo: { host: string; owner: string; repo: string },
  limit: number,
  rid: number | undefined,
): Promise<Result<Array<PullSummary & { reviewed: ReviewedLabel }>>> {
  const pulls = await reader.listOpenPulls(repo, limit)
  if (!pulls.ok) return pulls
  const states: ReviewedLabel[] = pulls.value.map(() => 'UNKNOWN')
  if (rid !== undefined) {
    let next = 0
    const worker = async () => {
      while (next < pulls.value.length) {
        const i = next++
        const p = pulls.value[i]!
        const items = await reader.listPublished({ ...repo, number: p.number })
        states[i] = items.ok ? reviewedState(items.value, rid, p.headSha) : 'UNKNOWN'
      }
    }
    await Promise.all(Array.from({ length: Math.min(5, pulls.value.length) }, worker))
  }
  return ok(pulls.value.map((p, i) => ({ ...p, reviewed: states[i]! })))
}

const SEVERITY_ORDER = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO'] as const
type SeverityName = (typeof SEVERITY_ORDER)[number]

function repoSetting(report: Report, key: string): unknown {
  return (report.audit.repoConfig?.settings as { publish?: Record<string, unknown> } | undefined)?.publish?.[key]
}

/** The higher of two inline severity floors: a repository can only reduce noise, never add it (AD-13). */
function stricterSeverity(user: SeverityName | undefined, repo: unknown): SeverityName | undefined {
  const r = SEVERITY_ORDER.includes(repo as SeverityName) ? (repo as SeverityName) : undefined
  if (!user) return r
  if (!r) return user
  return SEVERITY_ORDER.indexOf(r) < SEVERITY_ORDER.indexOf(user) ? r : user
}

/** The lowest severity posted as an inline comment for this review: the stricter of the user's and the repository's floor. */
export function inlineSeverityFloor(report: Report, config: ResolvedConfig): SeverityName {
  return stricterSeverity(config.settings.publish?.minInlineSeverity, repoSetting(report, 'minInlineSeverity')) ?? 'MINOR'
}

/** A repository's comment limit may only lower the user's (AD-13). */
function repoMaxInline(report: Report): number | undefined {
  const v = (report.audit.repoConfig?.settings as { publish?: { maxInlineComments?: unknown } } | undefined)?.publish?.maxInlineComments
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined
}

function minDefined(...values: Array<number | undefined>): number | undefined {
  const xs = values.filter((v): v is number => v !== undefined)
  return xs.length ? Math.min(...xs) : undefined
}
