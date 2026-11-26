import type { Finding, Report } from '@pr-reviewer/core'
import { describe, expect, it } from 'vitest'
import { teamSummary, type TeamRun } from './team.js'

const f = (severity: Finding['severity'], over: Partial<Finding> = {}) => ({ severity, category: 'CORRECTNESS', scope: 'NEW', ...over }) as Finding
const run = (login: string, pr: string, findings: Finding[], published?: string): TeamRun => ({ login, pr, startedAt: '2026-11-26T00:00:00Z', overallStatus: findings.length ? 'PASSED_WITH_WARNINGS' : 'PASSED', ...(published ? { published } : {}), report: { findings, run: { repo: { fullName: pr.split('#')[0] } } } as unknown as Report })

describe('team dashboard (roadmap item 14)', () => {
  it('adds up reviews, PRs, new findings and posts by repository and person', () => {
    const s = teamSummary(
      [
        run('ann', 'o/api#1', [f('MAJOR'), f('CRITICAL', { category: 'SECURITY' }), f('MINOR', { scope: 'PRE_EXISTING' })], 'https://x'),
        run('ann', 'o/api#1', [f('MAJOR', { dismissed: { by: 'ann', byPrAuthor: true } })]),
        run('bob', 'o/web#7', []),
      ],
      30,
    )
    expect(s).toMatchObject({ days: 30, reviews: 3, prs: 2, posted: 1, findings: 3, dismissed: 1, bySeverity: { MAJOR: 2, CRITICAL: 1 }, byCategory: { CORRECTNESS: 2, SECURITY: 1 }, outcomes: { PASSED_WITH_WARNINGS: 2, PASSED: 1 } })
    expect(s.repos).toEqual([
      { repo: 'o/api', reviews: 2, prs: 1, findings: 3, blockers: 1, posted: 1 },
      { repo: 'o/web', reviews: 1, prs: 1, findings: 0, blockers: 0, posted: 0 },
    ])
    expect(s.people.map((p) => [p.login, p.reviews, p.prs])).toEqual([
      ['ann', 2, 1],
      ['bob', 1, 1],
    ])
  })
})
