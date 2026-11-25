import * as z from 'zod'

/**
 * Auto-Review settings (AD-14, FR-26..FR-29a). They live in `.pr-reviewer/config.yml` of the user's private
 * automation repository, written by setup; they never hold secrets.
 */
export const WatchScope = z.strictObject({
  /** PRs where the user's review is requested. */
  reviewRequested: z.boolean().optional(),
  /** PRs the user opened. */
  authored: z.boolean().optional(),
  /** PRs in repositories the user owns. */
  ownedRepos: z.boolean().optional(),
  /** Extra repositories, owner/repo. */
  repos: z.array(z.string().regex(/^[\w.-]+\/[\w.-]+$/)).optional(),
  /** Organisations: off until listed here (FR-27). */
  orgs: z.array(z.string().regex(/^[\w.-]+$/)).optional(),
  /** Repositories never reviewed, owner/repo. */
  exclude: z.array(z.string().regex(/^[\w.-]+\/[\w.-]+$/)).optional(),
  includeDrafts: z.boolean().optional(),
  /** PRs in owned repositories from authors without write access (off by default: they could spend your AI budget). */
  outsideContributors: z.boolean().optional(),
})
export type WatchScope = z.infer<typeof WatchScope>

export const AutoReviewSettings = z.strictObject({
  watch: WatchScope.optional(),
  /** Leave a pending (draft) review where the user's review is requested (FR-20a). Default true. */
  pendingForReviewRequests: z.boolean().optional(),
  /** Run repository tools in a separate secret-less Sandbox job (AD-14). Default false. */
  sandbox: z.boolean().optional(),
  /** Most PRs dispatched per discovery run. */
  maxPerRun: z.number().int().positive().max(50).optional(),
  intervalMinutes: z.union([z.literal(30), z.literal(60), z.literal(120)]).optional(),
  /** Explicit opt-in to using a subscription CLI (Claude Code, Codex) in Auto-Review (FR-10). */
  subscriptionOptIn: z.boolean().optional(),
})
export type AutoReviewSettings = z.infer<typeof AutoReviewSettings>

export const DEFAULT_WATCH: Required<Pick<WatchScope, 'reviewRequested' | 'authored' | 'ownedRepos' | 'includeDrafts' | 'outsideContributors'>> = {
  reviewRequested: true,
  authored: false,
  ownedRepos: true,
  includeDrafts: false,
  outsideContributors: false,
}

/** GitHub search queries for a Watch Scope (FR-27). */
export function discoveryQueries(watch: WatchScope | undefined, login: string): string[] {
  const w = { ...DEFAULT_WATCH, ...watch }
  const base = `is:pr is:open archived:false${w.includeDrafts ? '' : ' draft:false'}`
  return [
    ...(w.reviewRequested ? [`${base} review-requested:${login}`] : []),
    ...(w.authored ? [`${base} author:${login}`] : []),
    ...(w.ownedRepos ? [`${base} user:${login}`] : []),
    ...(w.repos ?? []).map((r) => `${base} repo:${r}`),
    ...(w.orgs ?? []).map((o) => `${base} org:${o}`),
  ]
}

export interface Candidate {
  repo: string
  number: number
  headSha: string
  author: string
  /** GitHub author_association: OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, FIRST_TIME_CONTRIBUTOR, NONE, … */
  association: string
  draft: boolean
  /** The user's review is requested. */
  reviewRequested: boolean
}

export type SkipReason = 'EXCLUDED' | 'OPTED_OUT' | 'DRAFT' | 'OUTSIDE_CONTRIBUTOR' | 'ALREADY_REVIEWED' | 'OVER_LIMIT'

const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR'])

/**
 * Chooses which PRs to dispatch (FR-27, FR-28): each PR once, skipping excluded and opted-out repositories, drafts,
 * outside contributors in the user's own repositories, and Head Commits the user already reviewed.
 */
export function selectForReview(
  candidates: readonly Candidate[],
  opts: { login: string; watch?: WatchScope | undefined; optedOut: ReadonlySet<string>; reviewed: ReadonlySet<string>; maxPerRun?: number | undefined },
): { dispatch: Candidate[]; skipped: Record<SkipReason, number> } {
  const w = { ...DEFAULT_WATCH, ...opts.watch }
  const exclude = new Set((w.exclude ?? []).map((r) => r.toLowerCase()))
  const skipped: Record<SkipReason, number> = { EXCLUDED: 0, OPTED_OUT: 0, DRAFT: 0, OUTSIDE_CONTRIBUTOR: 0, ALREADY_REVIEWED: 0, OVER_LIMIT: 0 }
  const seen = new Set<string>()
  const dispatch: Candidate[] = []
  for (const c of candidates) {
    const key = `${c.repo.toLowerCase()}#${c.number}`
    if (seen.has(key)) continue
    seen.add(key)
    const owner = c.repo.split('/')[0]!.toLowerCase()
    if (exclude.has(c.repo.toLowerCase())) skipped.EXCLUDED++
    else if (opts.optedOut.has(c.repo.toLowerCase())) skipped.OPTED_OUT++
    else if (c.draft && !w.includeDrafts) skipped.DRAFT++
    else if (owner === opts.login.toLowerCase() && !c.reviewRequested && !TRUSTED.has(c.association) && !w.outsideContributors) skipped.OUTSIDE_CONTRIBUTOR++
    else if (opts.reviewed.has(`${key}@${c.headSha}`)) skipped.ALREADY_REVIEWED++
    else if (dispatch.length >= (opts.maxPerRun ?? 10)) skipped.OVER_LIMIT++
    else dispatch.push(c)
  }
  return { dispatch, skipped }
}

/** Monthly GitHub Actions minutes for a schedule (AD-14 budget); every job rounds up to a whole minute. */
export function estimateMonthlyMinutes(o: { intervalMinutes: number; discoverMinutes: number; prsPerMonth: number; minutesPerPr: number }): number {
  const runs = Math.ceil((30 * 24 * 60) / o.intervalMinutes)
  return runs * Math.ceil(o.discoverMinutes) + o.prsPerMonth * Math.ceil(o.minutesPerPr)
}

/** The shortest interval in {30, 60, 120} whose estimate is at most 60% of the free allowance, or undefined. */
export function chooseInterval(o: { allowanceMinutes: number; discoverMinutes: number; prsPerMonth: number; minutesPerPr: number; requested?: 30 | 60 | 120 | undefined }): { intervalMinutes: 30 | 60 | 120; estimate: number; share: number } | undefined {
  const options = o.requested ? [o.requested] : ([30, 60, 120] as const)
  for (const intervalMinutes of options) {
    const estimate = estimateMonthlyMinutes({ ...o, intervalMinutes })
    const share = estimate / o.allowanceMinutes
    if (share <= 0.6) return { intervalMinutes, estimate, share }
  }
  return undefined
}

/** Causes of Auto-Review trouble, one health issue each (FR-29). */
export const HealthCause = z.enum(['TOKEN_INVALID', 'TOKEN_SSO', 'TOKEN_SCOPE', 'RATE_LIMITED', 'AI_CREDENTIAL', 'AI_QUOTA', 'SANDBOX_FAILED'])
export type HealthCause = z.infer<typeof HealthCause>

export const HEALTH_TEXT: Record<HealthCause, { title: string; fix: string }> = {
  TOKEN_INVALID: { title: 'The GitHub token expired or was revoked', fix: 'Create a new token and run `pr-reviewer auto token` (or update the REVIEW_TOKEN secret).' },
  TOKEN_SSO: { title: 'The GitHub token is not authorised for an organisation that uses SSO', fix: 'On GitHub, open the token and choose "Configure SSO" for that organisation.' },
  TOKEN_SCOPE: { title: 'The GitHub token cannot read or comment on some PRs', fix: 'Give the token "Pull requests: write" and "Contents: read" on the repositories you watch.' },
  RATE_LIMITED: { title: 'GitHub rate limit reached', fix: 'Nothing to do if it is occasional; otherwise review fewer repositories or lower maxPerRun.' },
  AI_CREDENTIAL: { title: 'The AI provider rejected the credential', fix: 'Update the AI secret (ANTHROPIC_API_KEY, OPENAI_API_KEY, or CLAUDE_CODE_OAUTH_TOKEN) in this repository.' },
  AI_QUOTA: { title: 'The AI provider quota or rate limit was reached', fix: 'Wait for the quota to reset, raise it, or add a fallback provider.' },
  SANDBOX_FAILED: { title: 'The Sandbox job failed', fix: 'Open the failed run for the job status (no PR content is logged); turn the sandbox off with autoReview.sandbox: false if it keeps failing.' },
}

/** Hidden marker identifying a health issue (AD-14); issue bodies never contain PR content. */
export const healthMarker = (cause: HealthCause) => `<!-- pr-reviewer health cause=${cause} -->`
export const parseHealthMarker = (body: string): HealthCause | undefined => {
  const m = /<!-- pr-reviewer health cause=([A-Z_]+) -->/.exec(body)
  const c = HealthCause.safeParse(m?.[1])
  return c.success ? c.data : undefined
}

/** Maps an error code and message to a health cause, if it is one. */
export function healthCauseFor(code: string, message: string): HealthCause | undefined {
  if (code === 'github_unauthorized') return 'TOKEN_INVALID'
  if (/saml|sso/i.test(message)) return 'TOKEN_SSO'
  if (code === 'github_rate_limited') return 'RATE_LIMITED'
  if (code === 'github_no_access' || code === 'github_no_write_access') return 'TOKEN_SCOPE'
  if (code === 'ai_unauthorized' || code === 'ai_forbidden' || code === 'provider_credential_missing' || code === 'cli_logged_out') return 'AI_CREDENTIAL'
  if (code === 'ai_rate_limited') return 'AI_QUOTA'
  return undefined
}
