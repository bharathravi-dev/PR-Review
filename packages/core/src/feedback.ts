import type { Finding, Severity } from './findings.js'
import { ownMarker } from './marker.js'
import type { PublishedItems } from './ports.js'

export interface Dismissal {
  /** Login of the first person who dismissed it. */
  by: string
  /** True when every dismissal came from the PR's author. */
  byPrAuthor: boolean
}

const DISMISS_REPLY = /^\s*(?:\/dismiss|(?:@|\/)pr-reviewer\s+(?:dismiss|ignore))\b/i

export type FindingSource = 'AI' | 'TOOL' | 'UNKNOWN'

export interface OwnInlineComment {
  id: number
  fingerprint: string
  outdated: boolean
  /** Read back from the comment's heading ("**MAJOR · correctness** — …"); undefined for older formats. */
  severity?: Severity | undefined
  /** Read back from the comment's heading category ("correctness", "security", etc.). */
  category?: string | undefined
  /** Read back from the comment's footer ("rule `id`"). */
  ruleId?: string | undefined
  /** Read back from the comment's "Source:" line. */
  source: FindingSource
}

const HEADING = /^\*\*(BLOCKER|CRITICAL|MAJOR|MINOR|INFO) · ([^*\n]+?)\*\*/
const RULE_TAG = /rule `([^`\n]+)`/
const SOURCE = /<sub>Source: (AI\b)?/

/** Own inline comments (AD-11) with the fingerprint their marker carries, and the severity, category, rule, and source they show. */
export function ownInlineComments(items: PublishedItems, rid: number, fpv: number): OwnInlineComment[] {
  return items.reviewComments.flatMap((c) => {
    const m = ownMarker(c, rid)
    if (!m || m.kind !== 'inline' || m.fpv !== fpv || m.fp === '-') return []
    const src = SOURCE.exec(c.body)
    const h = HEADING.exec(c.body)
    const ruleId = RULE_TAG.exec(c.body)?.[1]?.trim()
    return [
      {
        id: c.id,
        fingerprint: m.fp,
        outdated: c.outdated === true,
        severity: h?.[1] as Severity | undefined,
        category: h?.[2]?.trim().toLowerCase(),
        ...(ruleId ? { ruleId } : {}),
        source: src ? (src[1] ? 'AI' : 'TOOL') : 'UNKNOWN',
      },
    ]
  })
}

/**
 * Reads Finding feedback (FR-20b, AD-11): a 👎 reaction, or a reply whose first word is `/dismiss`, on an own
 * inline comment dismisses that comment's fingerprint. `thumbsDown` maps comment id → logins that reacted 👎.
 */
export function readDismissals(
  items: PublishedItems,
  rid: number,
  fpv: number,
  prAuthor: string,
  thumbsDown: ReadonlyMap<number, readonly string[]>,
): Map<string, Dismissal> {
  const out = new Map<string, Dismissal>()
  for (const own of ownInlineComments(items, rid, fpv)) {
    const who = [
      ...(thumbsDown.get(own.id) ?? []),
      ...items.reviewComments.filter((r) => r.inReplyTo === own.id && DISMISS_REPLY.test(r.body)).map((r) => r.authorLogin ?? 'unknown'),
    ]
    if (who.length === 0) continue
    const prev = out.get(own.fingerprint)
    const all = [...(prev ? [prev.by] : []), ...who]
    out.set(own.fingerprint, { by: all[0]!, byPrAuthor: (prev?.byPrAuthor ?? true) && who.every((w) => w === prAuthor) })
  }
  return out
}

const PROTECTED = new Set<Finding['severity']>(['BLOCKER', 'CRITICAL'])

/**
 * Marks dismissed Findings (stage `dedupe`, AD-11). Dismissals never change the gate, and a dismissal by the PR
 * author alone never suppresses a BLOCKER or CRITICAL Finding.
 */
export function applyDismissals(findings: readonly Finding[], dismissals: ReadonlyMap<string, Dismissal>): Finding[] {
  if (dismissals.size === 0) return [...findings]
  return findings.map((f) => {
    const hit = (f.fingerprints ?? (f.fingerprint ? [f.fingerprint] : [])).map((fp) => dismissals.get(fp)).find((d) => d !== undefined)
    if (!hit || (hit.byPrAuthor && PROTECTED.has(f.severity))) return f
    return { ...f, dismissed: { by: hit.by, byPrAuthor: hit.byPrAuthor } }
  })
}

/** What happened to posted inline Findings. Addressed rate = resolved / posted. */
export interface Outcomes {
  posted: number
  resolved: number
  dismissed: number
  open: number
}

export interface FeedbackStats extends Outcomes {
  /** Outcomes by the severity shown on the comment (UNRATED for older comments). */
  bySeverity: Record<string, Outcomes>
  /** Outcomes by where the finding came from: the AI review or a deterministic tool. */
  bySource: Record<string, Outcomes>
  /** Outcomes grouped by finding category (`correctness`, `security`, etc.). */
  byCategory?: Record<string, Outcomes> | undefined
  /** Outcomes grouped by rule id (`ai/correctness`, `secret/aws`, etc.). */
  byRule?: Record<string, Outcomes> | undefined
  /** Inline Findings posted by the reviewer. */
  posted: number
  /** Posted Findings whose code changed afterwards (GitHub marks the comment outdated). */
  resolved: number
  /** Posted Findings dismissed by 👎 or `/dismiss`. */
  dismissed: number
  /** Posted Findings neither resolved nor dismissed. */
  open: number
  /** Findings listed only in the latest summary (tracked as a count). */
  summaryOnly: number
}

/** Per-PR feedback counts from GitHub data only (FR-25a); no telemetry. */
export function feedbackStats(
  items: PublishedItems,
  rid: number,
  fpv: number,
  prAuthor: string,
  thumbsDown: ReadonlyMap<number, readonly string[]>,
): FeedbackStats {
  const inline = ownInlineComments(items, rid, fpv)
  const dismissals = readDismissals(items, rid, fpv, prAuthor, thumbsDown)
  const seen = new Set<string>()
  const total = none()
  const bySeverity: Record<string, Outcomes> = {}
  const bySource: Record<string, Outcomes> = {}
  const byCategory: Record<string, Outcomes> = {}
  const byRule: Record<string, Outcomes> = {}
  for (const c of inline) {
    if (seen.has(c.fingerprint)) continue
    seen.add(c.fingerprint)
    const outcome: keyof Outcomes = dismissals.has(c.fingerprint) ? 'dismissed' : c.outdated ? 'resolved' : 'open'
    const buckets: Outcomes[] = [total, (bySeverity[c.severity ?? 'UNRATED'] ??= none()), (bySource[c.source] ??= none())]
    if (c.category) buckets.push((byCategory[c.category] ??= none()))
    if (c.ruleId) buckets.push((byRule[c.ruleId] ??= none()))
    for (const o of buckets) {
      o.posted++
      o[outcome]++
    }
  }
  const summaries = items.issueComments
    .map((c) => ({ c, m: ownMarker(c, rid) }))
    .filter((x) => x.m?.kind === 'summary' && x.m.fpv === fpv)
    .sort((a, b) => a.c.id - b.c.id)
  return { ...total, bySeverity, bySource, byCategory, byRule, summaryOnly: summaries[summaries.length - 1]?.m?.fps?.length ?? 0 }
}

const none = (): Outcomes => ({ posted: 0, resolved: 0, dismissed: 0, open: 0 })

function add(into: Outcomes, o: Outcomes): void {
  into.posted += o.posted
  into.resolved += o.resolved
  into.dismissed += o.dismissed
  into.open += o.open
}

/** Adds up per-PR feedback (for `stats` and the Web App). */
export function combineFeedback(all: readonly FeedbackStats[]): FeedbackStats {
  const out: FeedbackStats = { ...none(), bySeverity: {}, bySource: {}, byCategory: {}, byRule: {}, summaryOnly: 0 }
  for (const s of all) {
    add(out, s)
    out.summaryOnly += s.summaryOnly
    for (const [k, o] of Object.entries(s.bySeverity)) add((out.bySeverity[k] ??= none()), o)
    for (const [k, o] of Object.entries(s.bySource)) add((out.bySource[k] ??= none()), o)
    for (const [k, o] of Object.entries(s.byCategory ?? {})) add((out.byCategory![k] ??= none()), o)
    for (const [k, o] of Object.entries(s.byRule ?? {})) add((out.byRule![k] ??= none()), o)
  }
  return out
}
