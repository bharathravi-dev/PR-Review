// Review operations shared by the CLI commands and the local review page (AD-16: one engine path per Channel).
import {
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
  type PrContext,
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
import { apiUrlForHost, createAnthropicProvider, createGitHub, secretScanner } from './compose.js'
import { userConfigPath } from './config-file.js'
import type { CliDeps } from './deps.js'
import { loadReviewRules } from './rules-loader.js'
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
  const conn: GitHubConnection = { reader, writer, ...(token.ok ? {} : { tokenError: token.error.message }) }
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

/** Chooses the AI Provider from flags and Configuration. Only Anthropic is wired in this release (Epic 3 adds the rest). */
export async function buildProvider(
  config: ResolvedConfig,
  providerFlag: string | undefined,
  modelFlag: string | undefined,
  deps: CliDeps,
  secrets: Secret[],
): Promise<Result<ReviewProvider>> {
  const name = providerName(config, providerFlag)
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
  /** Called once the run is about to start (after configuration is loaded). */
  beforeRun?: () => void
  onLayer?: (layer: LayerResult) => void
  onEvent?: EventSink
}

/** Runs the Review Engine for one PR exactly as the `review` command does. */
export async function executeReview(o: ExecuteReviewOptions): Promise<{ report: Report; context?: PrContext }> {
  const provider = await buildProvider(o.config, o.provider, o.model, o.deps, o.secrets)
  const name = providerName(o.config, o.provider)
  const rules = await loadReviewRules(o.config.settings.reviewRules ?? [], { configPath: userConfigPath(o.deps), homedir: o.deps.homedir, fetch: o.deps.fetch })
  for (const w of rules.warnings) o.onWarning?.(w)
  o.beforeRun?.()
  return runReviewWithContext(
    {
      ref: o.ref,
      engineVersion: VERSION,
      channel: 'CLI',
      review: {
        provider: name === 'anthropic' ? undefined : name,
        model: o.model ?? o.config.settings.providers?.[name]?.model,
        rules: rules.rules,
      },
      reviewerId: o.github.viewer?.id,
      configSources: o.config.sources,
      limitations: rules.warnings,
      runId: o.runId,
      onLayer: o.onLayer,
      onEvent: o.onEvent,
    },
    {
      github: o.github.reader,
      scanSecrets: secretScanner,
      provider: provider.ok ? provider.value : undefined,
      providerUnavailableReason: provider.ok ? undefined : provider.error.message,
      now: () => Date.now(),
    },
  )
}

export interface PublishChoice {
  event: PublishPlan['event']
  include?: readonly string[] | undefined
  unattended: boolean
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
    maxInline: settings.maxInlineComments,
    extraLinkPrefixes: settings.linkPrefixes,
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
