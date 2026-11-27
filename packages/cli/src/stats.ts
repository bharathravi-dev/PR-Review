// How posted findings fared, read from GitHub only (FR-25a): resolved (the code at the comment changed), dismissed
// (👎 or /dismiss), or still open. Shared by `pr-reviewer stats`, the local page, and the Web App.
import { combineFeedback, feedbackStats, FPV, ownInlineComments, type FeedbackStats, type GitHubReader, type Outcomes } from '@pr-reviewer/core'

export interface StatsResult {
  since: string
  reviewer: string
  prs: Array<{ pr: string; title: string } & FeedbackStats>
  total: FeedbackStats
  /** resolved / posted, or null when nothing was posted. */
  addressedRate: number | null
}

export const addressed = (o: Outcomes): number | null => (o.posted ? o.resolved / o.posted : null)

/** Collects feedback on the reviewer's own inline comments in PRs they commented on since `since` (YYYY-MM-DD). */
export async function collectStats(
  reader: GitHubReader,
  me: { id: number; login: string },
  host: string,
  since: string,
  repo?: { owner: string; repo: string },
): Promise<{ ok: true; value: StatsResult } | { ok: false; message: string }> {
  const pulls = await reader.searchCommentedPulls(me.login, since, repo)
  if (!pulls.ok) return { ok: false, message: `Could not search PRs: ${pulls.error.message}` }
  const prs: StatsResult['prs'] = []
  for (const p of pulls.value) {
    const ref = { host, owner: p.owner, repo: p.repo, number: p.number }
    const published = await reader.listPublished(ref)
    if (!published.ok) continue
    const thumbs = new Map<number, string[]>()
    for (const c of ownInlineComments(published.value, me.id, FPV)) {
      const t = await reader.listThumbsDown(ref, c.id)
      if (t.ok) thumbs.set(c.id, t.value)
    }
    const st = feedbackStats(published.value, me.id, FPV, p.author, thumbs)
    if (st.posted + st.summaryOnly > 0) prs.push({ pr: `${p.owner}/${p.repo}#${p.number}`, title: p.title, ...st })
  }
  const total = combineFeedback(prs)
  return { ok: true, value: { since, reviewer: me.login, prs, total, addressedRate: addressed(total) } }
}

const SEVERITY_ORDER = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO', 'UNRATED']
const SOURCE_LABEL: Record<string, string> = { AI: 'AI review', TOOL: 'tools', UNKNOWN: 'older comments' }

/** Plain-text report for the terminal. */
export function formatStats(s: StatsResult): string {
  if (s.prs.length === 0) return `No PRs reviewed with pr-reviewer since ${s.since}.\n`
  const t = s.total
  const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : '–')
  const line = (label: string, o: Outcomes) => `  ${label.padEnd(16)} ${String(o.posted).padStart(4)} posted   addressed ${pct(o.resolved, o.posted).padStart(4)}   dismissed ${pct(o.dismissed, o.posted).padStart(4)}   open ${o.open}`
  const lines = [
    `Reviews by ${s.reviewer} since ${s.since}: ${s.prs.length} PR(s)`,
    '',
    ...s.prs.map((r) => `  ${r.pr.padEnd(36)} posted ${String(r.posted).padStart(3)}  resolved ${String(r.resolved).padStart(3)}  dismissed ${String(r.dismissed).padStart(3)}  open ${String(r.open).padStart(3)}  summary-only ${r.summaryOnly}`),
    '',
    `Inline findings posted: ${t.posted} — resolved ${t.resolved}${t.posted ? ` (${pct(t.resolved, t.posted)})` : ''}, dismissed ${t.dismissed}${t.posted ? ` (${pct(t.dismissed, t.posted)})` : ''}, still open ${t.open}${t.posted ? ` (${pct(t.open, t.posted)})` : ''}.`,
    `Summary-only findings in latest summaries: ${t.summaryOnly}.`,
  ]
  if (t.posted) {
    lines.push('', 'Addressed rate by severity and source:')
    for (const k of SEVERITY_ORDER) if (t.bySeverity[k]) lines.push(line(k.toLowerCase(), t.bySeverity[k]))
    for (const [k, o] of Object.entries(t.bySource)) lines.push(line(SOURCE_LABEL[k] ?? k, o))
    const rules = Object.entries(t.byRule ?? {}).sort((a, b) => b[1].posted - a[1].posted)
    if (rules.length) {
      lines.push('', 'Addressed rate by rule:')
      for (const [k, o] of rules.slice(0, 15)) lines.push(line(k.length > 28 ? `${k.slice(0, 27)}…` : k, o))
    }
  }
  lines.push('', 'Addressed (resolved) means the code at the comment changed afterwards; PRs still in progress lower it. Computed from GitHub only; nothing is sent anywhere.')
  return `${lines.join('\n')}\n`
}
