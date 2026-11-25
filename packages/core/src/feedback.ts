import type { Finding } from './findings.js'
import { ownMarker } from './marker.js'
import type { PublishedItems } from './ports.js'

export interface Dismissal {
  /** Login of the first person who dismissed it. */
  by: string
  /** True when every dismissal came from the PR's author. */
  byPrAuthor: boolean
}

const DISMISS_REPLY = /^\s*\/dismiss\b/i

/** Own inline comments (AD-11) with the fingerprint their marker carries. */
export function ownInlineComments(items: PublishedItems, rid: number, fpv: number): Array<{ id: number; fingerprint: string; outdated: boolean }> {
  return items.reviewComments.flatMap((c) => {
    const m = ownMarker(c, rid)
    return m && m.kind === 'inline' && m.fpv === fpv && m.fp !== '-' ? [{ id: c.id, fingerprint: m.fp, outdated: c.outdated === true }] : []
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

export interface FeedbackStats {
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
  let resolved = 0
  let dismissed = 0
  let open = 0
  for (const c of inline) {
    if (seen.has(c.fingerprint)) continue
    seen.add(c.fingerprint)
    if (dismissals.has(c.fingerprint)) dismissed++
    else if (c.outdated) resolved++
    else open++
  }
  const summaries = items.issueComments
    .map((c) => ({ c, m: ownMarker(c, rid) }))
    .filter((x) => x.m?.kind === 'summary' && x.m.fpv === fpv)
    .sort((a, b) => a.c.id - b.c.id)
  return { posted: seen.size, resolved, dismissed, open, summaryOnly: summaries[summaries.length - 1]?.m?.fps?.length ?? 0 }
}
