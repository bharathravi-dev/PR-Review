import { isInHunk, parsePatch, type Hunk } from './diff.js'
import type { Finding } from './findings.js'
import { formatMarker, MARKER_VERSION, ownMarker, type MarkerFields } from './marker.js'
import type { PrRef } from './pr-ref.js'
import type { GitHubReader, GitHubWriter, InlineComment, PublishedItem, PublishedItems } from './ports.js'
import type { Report } from './report.js'
import type { Result } from './result.js'
import { sanitizeText } from './sanitize.js'
import type { PrContext } from './schemas.js'

export const DEFAULT_MAX_INLINE = 30

/** What this reviewer already published on the PR, read only from own markers (AD-11). */
export interface PriorPublication {
  /** Inline comments still on the PR, by fingerprint. */
  inline: Array<{ fingerprint: string; title: string; url?: string | undefined }>
  /** 16-hex fingerprint prefixes from the latest own summary (Findings listed only there). */
  summaryPrefixes: string[]
}

export const NO_PRIOR: PriorPublication = { inline: [], summaryPrefixes: [] }

/**
 * Reads prior publication state from own markers only (AD-11): inline comments and the latest summary authored by
 * `rid` with a matching marker rid and the same fingerprint version. Everything else is ignored.
 */
export function readPrior(items: PublishedItems, rid: number, fpv: number): PriorPublication {
  const inline: PriorPublication['inline'] = []
  for (const c of items.reviewComments) {
    const m = ownMarker(c, rid)
    if (!m || m.kind !== 'inline' || m.fpv !== fpv || m.fp === '-') continue
    const first = c.body.split('\n')[0] ?? ''
    const title = first.replace(/^\*\*[^*]*\*\*\s*—\s*/, '').trim() || 'Earlier finding'
    if (!inline.some((x) => x.fingerprint === m.fp)) inline.push({ fingerprint: m.fp, title, ...(c.url ? { url: c.url } : {}) })
  }
  const summaries = items.issueComments
    .map((c) => ({ c, m: ownMarker(c, rid) }))
    .filter((x) => x.m?.kind === 'summary' && x.m.fpv === fpv)
    .sort((a, b) => a.c.id - b.c.id)
  const latest = summaries[summaries.length - 1]?.m
  return { inline, summaryPrefixes: latest?.fps ?? [] }
}

/** What to publish (AD-23). Pure data; the preview and the post are both rendered from it. */
export interface PublishPlan {
  event: 'COMMENT' | 'REQUEST_CHANGES'
  /** Pending (draft) reviews are an Auto-Review mode (FR-20a, Epic 5). */
  pending: boolean
  maxInline: number
  /** Fingerprints of Findings the user chose to include; undefined means all eligible. */
  include?: readonly string[] | undefined
  /** Right-side diff hunks per changed file, for inline anchoring (AD-9). */
  hunks: Record<string, Hunk[]>
  /** Link prefixes the sanitiser keeps (the PR's own repository plus user-configured prefixes). */
  allowedLinkPrefixes: string[]
  /** Reviewer Identity's numeric id (marker `rid`). */
  rid: number
  engineMajor: number
  productVersion: string
  unattended: boolean
  /** What was already published; inline comments are not repeated for unchanged Findings (FR-19). */
  prior: PriorPublication
}

export interface PlannedInline extends InlineComment {
  fingerprint: string
}

/** Exactly what `publish` will post (AD-23). */
export interface PublishPreview {
  event: PublishPlan['event']
  pending: boolean
  reviewBody: string
  summaryBody: string
  inline: PlannedInline[]
  /** Findings shown only in the summary (no valid inline anchor, over the cap, advisory, or pre-existing). */
  summaryOnly: Finding[]
  /** Findings left out by the plan (deselected or dismissed). */
  withheld: number
  /** Findings already posted inline on an earlier head and unchanged (not re-posted). */
  stillOpen: Array<{ finding: Finding; url?: string | undefined }>
  /** Earlier Findings no longer present. */
  resolved: Array<{ fingerprint: string; title: string; url?: string | undefined }>
}

export type PublishStatus = 'PUBLISHED' | 'SKIPPED_DUPLICATE' | 'CANCELLED' | 'SKIPPED_NEWER_ENGINE' | 'BLOCKED_PENDING_DRAFT' | 'FAILED'

export interface PublishRecord {
  status: PublishStatus
  reason?: string | undefined
  reviewUrl?: string | undefined
  summaryUrl?: string | undefined
  pending: boolean
  commentCount: number
  at: string
}

/** Builds the right-side hunk map the planner needs from the PR context. */
export function hunksFromContext(ctx: PrContext): Record<string, Hunk[]> {
  const out: Record<string, Hunk[]> = {}
  for (const f of ctx.files) if (f.patch && f.status !== 'removed') out[f.path] = parsePatch(f.patch).hunks
  return out
}

export function planPublish(
  report: Report,
  opts: Omit<PublishPlan, 'event' | 'pending' | 'maxInline' | 'allowedLinkPrefixes' | 'prior'> & {
    prior?: PriorPublication | undefined
    event?: PublishPlan['event'] | undefined
    maxInline?: number | undefined
    extraLinkPrefixes?: readonly string[] | undefined
  },
): PublishPlan {
  const repoUrl = `https://${report.run.host}/${report.run.repo.fullName}`
  return {
    event: opts.event ?? 'COMMENT',
    pending: false,
    maxInline: opts.maxInline ?? DEFAULT_MAX_INLINE,
    include: opts.include,
    hunks: opts.hunks,
    allowedLinkPrefixes: [repoUrl, ...(opts.extraLinkPrefixes ?? [])],
    rid: opts.rid,
    engineMajor: opts.engineMajor,
    productVersion: opts.productVersion,
    unattended: opts.unattended,
    prior: opts.prior ?? NO_PRIOR,
  }
}

/** A single hunk containing every line of the range, or undefined. */
function anchorRange(hunks: readonly Hunk[] | undefined, start: number, end: number): boolean {
  if (!hunks) return false
  return hunks.some((h) => isInHunk([h], start) && isInHunk([h], end))
}

function usage(report: Report): string {
  const a = report.ai?.attempts ?? []
  const input = a.reduce((n, x) => n + (x.usage?.input ?? 0), 0)
  const output = a.reduce((n, x) => n + (x.usage?.output ?? 0), 0)
  return `${input}/${output}/0`
}

function markerFor(report: Report, plan: PublishPlan, kind: MarkerFields['kind'], fp = '-', fps?: string[]): string {
  return formatMarker({
    mv: MARKER_VERSION,
    kind,
    rid: plan.rid,
    head: report.run.headSha ?? '-',
    cfg: report.run.configHash,
    eng: plan.engineMajor,
    fpv: report.run.fpv,
    key: report.run.idempotencyKey ?? '-',
    fp,
    u: usage(report),
    ...(fps ? { fps } : {}),
  })
}

function title(f: Finding): string {
  return `**${f.severity} · ${f.category.replace(/_/g, ' ').toLowerCase()}** — ${f.title}`
}

function source(f: Finding): string {
  const who = f.sourceFamily === 'AI' ? `AI${f.provenance.model ? ` (${f.provenance.model})` : ''}` : f.provenance.tool ?? f.provenance.validator
  return `<sub>Source: ${who} · confidence ${f.confidence.toLowerCase()} · rule \`${f.ruleId}\`</sub>`
}

/** Renders exactly what will be posted (AD-23): untrusted text sanitised, then the marker appended. */
export function renderPublish(report: Report, plan: PublishPlan): PublishPreview {
  // Text that came from the PR, tools, or the model is untrusted; our own template is not.
  const clean = (t: string) => sanitizeText(t, { allowedLinkPrefixes: plan.allowedLinkPrefixes })
  const cleanPath = (p: string) => p.replace(/[`\n\r]/g, '')
  const safe = (f: Finding): Finding => ({
    ...f,
    title: clean(f.title).replace(/\n+/g, ' '),
    description: clean(f.description),
    ...(f.impact !== undefined ? { impact: clean(f.impact) } : {}),
    ...(f.recommendation !== undefined ? { recommendation: clean(f.recommendation) } : {}),
    location: { ...f.location, ...(f.location.path !== undefined ? { path: cleanPath(f.location.path) } : {}) },
  })
  const chosen = plan.include ? new Set(plan.include) : undefined
  const selected = report.findings.filter((f) => !chosen || (f.fingerprint !== undefined && chosen.has(f.fingerprint))).map(safe)
  const visible = selected.filter((f) => !f.dismissed)
  const withheld = report.findings.length - visible.length

  const inline: PlannedInline[] = []
  const summaryOnly: Finding[] = []
  const stillOpen: PublishPreview['stillOpen'] = []
  const priorByFp = new Map(plan.prior.inline.map((p) => [p.fingerprint, p]))
  const fpsOf = (f: Finding) => f.fingerprints ?? (f.fingerprint ? [f.fingerprint] : [])
  for (const f of visible) {
    const loc = f.location
    const eligible =
      f.fingerprint !== undefined &&
      f.disposition !== 'ADVISORY' &&
      f.scope !== 'PRE_EXISTING' &&
      loc.anchorKind === 'LINE' &&
      loc.path !== undefined &&
      loc.startLine !== undefined &&
      anchorRange(plan.hunks[loc.path], loc.startLine, loc.endLine ?? loc.startLine)
    const earlier = fpsOf(f).map((fp) => priorByFp.get(fp)).find((p) => p !== undefined)
    if (earlier) {
      // Already posted inline on an earlier head and unchanged: never repeat it (FR-19).
      stillOpen.push({ finding: f, url: earlier.url })
      continue
    }
    if (!eligible || inline.length >= plan.maxInline) {
      summaryOnly.push(f)
      continue
    }
    const end = loc.endLine ?? loc.startLine!
    const body = [
      title(f),
      '',
      f.description,
      ...(f.impact ? ['', `**Why it matters:** ${f.impact}`] : []),
      ...(f.recommendation ? ['', `**Recommendation:** ${f.recommendation}`] : []),
      '',
      source(f),
    ].join('\n')
    inline.push({
      path: loc.path!,
      line: end,
      ...(end !== loc.startLine ? { startLine: loc.startLine } : {}),
      side: 'RIGHT',
      fingerprint: f.fingerprint!,
      body: `${body}\n\n${markerFor(report, plan, 'inline', f.fingerprint!)}`,
    })
  }

  const currentFps = report.findings.flatMap(fpsOf)
  const resolved: PublishPreview['resolved'] = [
    ...plan.prior.inline.filter((p) => !currentFps.includes(p.fingerprint)).map((p) => ({ fingerprint: p.fingerprint, title: clean(p.title), url: p.url })),
    ...plan.prior.summaryPrefixes
      .filter((prefix) => !currentFps.some((fp) => fp.startsWith(prefix)))
      .map((prefix) => ({ fingerprint: prefix, title: 'An earlier summary-only finding' })),
  ]

  const counts = (['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO'] as const)
    .map((s) => [s, visible.filter((f) => f.severity === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${s.toLowerCase()}`)
  const providers = (report.ai?.attempts ?? []).filter((a) => a.outcome === 'SUCCEEDED').map((a) => `${a.provider} ${a.model}`)
  const summaryLines = [
    `### PR Reviewer: ${report.overallStatus.replace(/_/g, ' ')}`,
    '',
    `Head \`${report.run.headSha?.slice(0, 7) ?? '?'}\` · ${visible.length} finding(s)${counts.length ? ` (${counts.join(', ')})` : ''} · ${inline.length} new inline${stillOpen.length ? ` · ${stillOpen.length} still open` : ''}${resolved.length ? ` · ${resolved.length} resolved` : ''}`,
    '',
    report.coverage.headline,
    ...(report.gate.failedRules.length ? ['', '**Gate:**', ...report.gate.failedRules.map((r) => `- ${clean(r)}`)] : []),
    ...(summaryOnly.length
      ? [
          '',
          '**Findings not shown inline:**',
          ...summaryOnly.map(
            (f) =>
              `- ${title(f)}${f.location.path ? ` — \`${f.location.path}${f.location.startLine ? `:${f.location.startLine}` : ''}\`` : ''}${f.disposition === 'ADVISORY' ? ' _(advisory)_' : ''}${f.scope === 'PRE_EXISTING' ? ' _(pre-existing)_' : ''}`,
          ),
        ]
      : []),
    ...(stillOpen.length
      ? ['', '**Still open from earlier reviews:**', ...stillOpen.map(({ finding: f, url }) => `- ${title(f)}${url ? ` ([comment](${url}))` : ''}`)]
      : []),
    ...(resolved.length ? ['', '**Resolved since the last review:**', ...resolved.map((r) => `- ~~${r.title}~~${r.url ? ` ([comment](${r.url}))` : ''}`)] : []),
    ...(withheld ? ['', `_${withheld} finding(s) withheld from this post (deselected or dismissed); the overall result above is unchanged._`] : []),
    ...(report.limitations.length ? ['', '**Limitations:**', ...report.limitations.map((l) => `- ${clean(l)}`)] : []),
    '',
    `<sub>Generated by PR Reviewer ${plan.productVersion} · AI: ${providers.length ? providers.join(', ') : 'none'} · ${plan.unattended ? 'published automatically' : 'published by the reviewer'}. Findings are suggestions; the reviewer decides.</sub>`,
  ]
  const fps = summaryOnly.flatMap((f) => (f.fingerprint ? [f.fingerprint.slice(0, 16)] : []))
  const summaryBody = `${summaryLines.join('\n')}\n\n${markerFor(report, plan, 'summary', '-', fps)}`
  const reviewBody = `PR Reviewer: ${inline.length} inline comment(s) for \`${report.run.headSha?.slice(0, 7) ?? '?'}\`. The summary is in the conversation below.\n\n${markerFor(report, plan, 'review')}`
  return { event: plan.event, pending: plan.pending, reviewBody, summaryBody, inline, summaryOnly, withheld, stillOpen, resolved }
}

export interface PublishPorts {
  reader: GitHubReader
  writer: GitHubWriter
  now: () => number
}

/**
 * Posts a PublishPreview (AD-23). Re-reads the head and own markers first; one atomic review per Head Commit,
 * then one summary comment per reviewer and PR, edited in place. Never approves, merges, or submits a draft.
 */
export async function publish(report: Report, plan: PublishPlan, preview: PublishPreview, ref: PrRef, ports: PublishPorts): Promise<PublishRecord> {
  const at = () => new Date(ports.now()).toISOString()
  const record = (status: PublishStatus, extra: Partial<PublishRecord> = {}): PublishRecord => ({ status, pending: plan.pending, commentCount: 0, at: at(), ...extra })

  if (plan.pending) return record('FAILED', { reason: 'Pending reviews are not available in this release.' })
  if (!report.run.headSha || !report.run.idempotencyKey) return record('FAILED', { reason: 'The Report has no head commit or idempotency key; it cannot be published.' })

  const head = await ports.reader.getHeadSha(ref)
  if (!head.ok) return record('FAILED', { reason: head.error.message })
  if (head.value !== report.run.headSha) return record('CANCELLED', { reason: `SUPERSEDED: the PR head moved to ${head.value.slice(0, 7)}.` })

  const listed = await ports.reader.listPublished(ref)
  if (!listed.ok) return record('FAILED', { reason: listed.error.message })
  const own = (items: PublishedItem[]) => items.flatMap((i) => {
    const m = ownMarker(i, plan.rid)
    return m ? [{ item: i, marker: m }] : []
  })
  const ownReviews = own(listed.value.reviews)
  const ownSummaries = own(listed.value.issueComments).filter((x) => x.marker.kind === 'summary')

  if (ownSummaries.some((s) => s.marker.eng > plan.engineMajor) || ownReviews.some((r) => r.marker.eng > plan.engineMajor)) {
    return record('SKIPPED_NEWER_ENGINE', { reason: 'A newer PR Reviewer version already reviewed this PR; update to publish.' })
  }

  let status: PublishStatus = 'PUBLISHED'
  let reviewUrl: string | undefined
  let commentCount = 0
  let summaryBody = preview.summaryBody
  if (ownReviews.some((r) => r.marker.kind === 'review' && r.marker.key === report.run.idempotencyKey)) {
    status = 'SKIPPED_DUPLICATE'
  } else {
    const review = { commitId: report.run.headSha, event: plan.event, body: preview.reviewBody }
    let res = await ports.writer.createReview(ref, { ...review, comments: preview.inline.map(({ fingerprint: _f, ...c }) => c) })
    if (!res.ok && res.error.code === 'github_unprocessable' && preview.inline.length > 0) {
      // One bad anchor never fails the whole review (AD-9): retry with every comment moved to the summary.
      res = await ports.writer.createReview(ref, { ...review, comments: [] })
      if (res.ok) {
        const moved = preview.inline.map((c) => `- \`${c.path}:${c.line}\` — ${c.body.split('\n')[0]}`).join('\n')
        summaryBody = summaryBody.replace(/\n\n<sub>Generated by/, `\n\n**Could not be attached inline:**\n${moved}\n\n<sub>Generated by`)
      }
    } else if (res.ok) {
      commentCount = preview.inline.length
    }
    if (!res.ok) return record('FAILED', { reason: res.error.message })
    reviewUrl = res.value.url
  }

  // Summary: one live issue comment per (rid, repo, pr), edited in place; extra copies removed (oldest kept).
  const sorted = [...ownSummaries].sort((a, b) => a.item.id - b.item.id)
  let summary: Result<{ id: number; url: string }>
  if (sorted.length > 0) {
    summary = await ports.writer.updateIssueComment(ref, sorted[0]!.item.id, summaryBody)
    for (const extra of sorted.slice(1)) await ports.writer.deleteIssueComment(ref, extra.item.id)
  } else {
    summary = await ports.writer.createIssueComment(ref, summaryBody)
  }
  if (!summary.ok) return record('FAILED', { reason: summary.error.message, reviewUrl, commentCount })
  return record(status, { reviewUrl, summaryUrl: summary.value.url, commentCount })
}

