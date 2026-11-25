import { describe, expect, it } from 'vitest'
import { chooseInterval, discoveryQueries, estimateMonthlyMinutes, healthCauseFor, healthMarker, parseHealthMarker, selectForReview, type Candidate } from './auto-review.js'
import { parseUserConfig } from './config.js'

const c = (repo: string, number: number, over: Partial<Candidate> = {}): Candidate => ({ repo, number, headSha: `sha${number}`, author: 'dev', association: 'COLLABORATOR', draft: false, reviewRequested: false, ...over })

describe('Watch Scope (Story 5.2)', () => {
  it('searches review requests and owned repositories by default; organisations only when listed', () => {
    expect(discoveryQueries(undefined, 'me')).toEqual(['is:pr is:open archived:false draft:false review-requested:me', 'is:pr is:open archived:false draft:false user:me'])
    expect(discoveryQueries({ orgs: ['acme'], authored: true, ownedRepos: false, reviewRequested: false, includeDrafts: true }, 'me')).toEqual([
      'is:pr is:open archived:false author:me',
      'is:pr is:open archived:false org:acme',
    ])
  })

  it('reviews each PR once per head commit and honours exclusions, opt-outs, drafts, outside contributors, and the limit', () => {
    const candidates = [
      c('me/app', 1),
      c('me/app', 1),
      c('me/app', 2, { association: 'NONE' }),
      c('me/app', 3, { association: 'FIRST_TIME_CONTRIBUTOR', reviewRequested: true }),
      c('me/app', 4, { draft: true }),
      c('me/skip', 5),
      c('acme/quiet', 6),
      c('acme/web', 7),
      c('acme/web', 8),
      c('acme/web', 9),
    ]
    const out = selectForReview(candidates, {
      login: 'me',
      watch: { exclude: ['me/skip'] },
      optedOut: new Set(['acme/quiet']),
      reviewed: new Set(['acme/web#7@sha7']),
      maxPerRun: 3,
    })
    expect(out.dispatch.map((x) => `${x.repo}#${x.number}`)).toEqual(['me/app#1', 'me/app#3', 'acme/web#8'])
    expect(out.skipped).toEqual({ EXCLUDED: 1, OPTED_OUT: 1, DRAFT: 1, OUTSIDE_CONTRIBUTOR: 1, ALREADY_REVIEWED: 1, OVER_LIMIT: 1 })
  })

  it('is part of the user config schema, with no room for secrets', () => {
    expect(parseUserConfig({ version: 1, autoReview: { watch: { orgs: ['acme'] }, intervalMinutes: 60, sandbox: true } }).ok).toBe(true)
    expect(parseUserConfig({ version: 1, autoReview: { token: 'ghp_x' } }).ok).toBe(false)
    expect(parseUserConfig({ version: 1, autoReview: { intervalMinutes: 15 } }).ok).toBe(false)
  })
})

describe('budget (Story 5.1)', () => {
  it('rounds every job up to a minute and picks the shortest interval within 60% of the free allowance', () => {
    expect(estimateMonthlyMinutes({ intervalMinutes: 60, discoverMinutes: 0.4, prsPerMonth: 60, minutesPerPr: 2.5 })).toBe(720 + 180)
    expect(chooseInterval({ allowanceMinutes: 2000, discoverMinutes: 1, prsPerMonth: 60, minutesPerPr: 3 })).toEqual({ intervalMinutes: 60, estimate: 900, share: 0.45 })
    expect(chooseInterval({ allowanceMinutes: 2000, discoverMinutes: 2, prsPerMonth: 60, minutesPerPr: 4 })).toMatchObject({ intervalMinutes: 120 })
    expect(chooseInterval({ allowanceMinutes: 2000, discoverMinutes: 1, prsPerMonth: 60, minutesPerPr: 3, requested: 30 })).toBeUndefined()
    expect(chooseInterval({ allowanceMinutes: 500, discoverMinutes: 2, prsPerMonth: 100, minutesPerPr: 10 })).toBeUndefined()
  })
})

describe('health causes (Story 5.4)', () => {
  it('maps errors to one cause each and round-trips the issue marker', () => {
    expect(healthCauseFor('github_unauthorized', 'GitHub rejected the token')).toBe('TOKEN_INVALID')
    expect(healthCauseFor('github_no_access', 'Resource protected by organization SAML enforcement')).toBe('TOKEN_SSO')
    expect(healthCauseFor('github_rate_limited', '')).toBe('RATE_LIMITED')
    expect(healthCauseFor('ai_unauthorized', '')).toBe('AI_CREDENTIAL')
    expect(healthCauseFor('ai_rate_limited', '')).toBe('AI_QUOTA')
    expect(healthCauseFor('ai_bad_request', '')).toBeUndefined()
    expect(parseHealthMarker(`text\n${healthMarker('TOKEN_SSO')}`)).toBe('TOKEN_SSO')
    expect(parseHealthMarker('<!-- pr-reviewer health cause=MADE_UP -->')).toBeUndefined()
  })
})
