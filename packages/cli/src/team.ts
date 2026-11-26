// The team dashboard (roadmap item 14): what the Web App's reviews found across people and repositories.
import type { Report } from '@pr-reviewer/core'

export interface TeamRun {
  login: string
  pr: string
  startedAt: string
  overallStatus: string
  published?: string | undefined
  report: Report
}

export interface TeamSummary {
  days: number
  reviews: number
  prs: number
  posted: number
  findings: number
  dismissed: number
  bySeverity: Record<string, number>
  byCategory: Record<string, number>
  outcomes: Record<string, number>
  repos: Array<{ repo: string; reviews: number; prs: number; findings: number; blockers: number; posted: number }>
  people: Array<{ login: string; reviews: number; prs: number; findings: number; posted: number }>
}

/** Sums up stored runs: only new findings count (pre-existing ones were there before the PR). */
export function teamSummary(runs: readonly TeamRun[], days: number): TeamSummary {
  const bySeverity: Record<string, number> = {}
  const byCategory: Record<string, number> = {}
  const outcomes: Record<string, number> = {}
  const repos = new Map<string, { reviews: number; prs: Set<string>; findings: number; blockers: number; posted: number }>()
  const people = new Map<string, { reviews: number; prs: Set<string>; findings: number; posted: number }>()
  let findings = 0
  let dismissed = 0
  for (const r of runs) {
    const fresh = r.report.findings.filter((f) => f.scope !== 'PRE_EXISTING')
    findings += fresh.length
    dismissed += fresh.filter((f) => f.dismissed).length
    for (const f of fresh) {
      bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1
      byCategory[f.category] = (byCategory[f.category] ?? 0) + 1
    }
    outcomes[r.overallStatus] = (outcomes[r.overallStatus] ?? 0) + 1
    const repo = r.report.run.repo.fullName
    const rr = repos.get(repo) ?? { reviews: 0, prs: new Set<string>(), findings: 0, blockers: 0, posted: 0 }
    rr.reviews++
    rr.prs.add(r.pr)
    rr.findings += fresh.length
    rr.blockers += fresh.filter((f) => f.severity === 'BLOCKER' || f.severity === 'CRITICAL').length
    if (r.published) rr.posted++
    repos.set(repo, rr)
    const p = people.get(r.login) ?? { reviews: 0, prs: new Set<string>(), findings: 0, posted: 0 }
    p.reviews++
    p.prs.add(r.pr)
    p.findings += fresh.length
    if (r.published) p.posted++
    people.set(r.login, p)
  }
  return {
    days,
    reviews: runs.length,
    prs: new Set(runs.map((r) => r.pr)).size,
    posted: runs.filter((r) => r.published).length,
    findings,
    dismissed,
    bySeverity,
    byCategory,
    outcomes,
    repos: [...repos].map(([repo, v]) => ({ repo, reviews: v.reviews, prs: v.prs.size, findings: v.findings, blockers: v.blockers, posted: v.posted })).sort((a, b) => b.reviews - a.reviews),
    people: [...people].map(([login, v]) => ({ login, reviews: v.reviews, prs: v.prs.size, findings: v.findings, posted: v.posted })).sort((a, b) => b.reviews - a.reviews),
  }
}
