import { describe, expect, it } from 'vitest'
import type { Finding } from './findings.js'
import { formatMarker, type MarkerFields } from './marker.js'
import type { GitHubReader, GitHubWriter, PublishedItems } from './ports.js'
import { planPublish, publish, readPrior, renderPublish } from './publish.js'
import { Report } from './report.js'
import { err, ok } from './result.js'

const RID = 77
const fp = (n: number) => `${String(n).repeat(4)}`.padEnd(64, 'a')

const marker = (over: Partial<MarkerFields>) =>
  formatMarker({ mv: 1, kind: 'inline', rid: RID, head: 'h0', cfg: 'c', eng: 0, fpv: 1, key: 'k0', fp: '-', u: '0/0/0', ...over })

const finding = (n: number, over: Partial<Finding> = {}): Finding => ({
  id: fp(n),
  fingerprint: fp(n),
  fingerprints: [fp(n)],
  ruleId: 'ai/correctness',
  category: 'CORRECTNESS',
  severity: 'MAJOR',
  confidence: 'HIGH',
  scope: 'NEW',
  sourceFamily: 'AI',
  disposition: 'GATING',
  title: `Problem ${n}`,
  description: 'd',
  location: { anchorKind: 'LINE', path: 'a.ts', side: 'HEAD', startLine: n, endLine: n },
  provenance: { validator: 'ai.review' },
  ...over,
})

function report(findings: Finding[]): Report {
  return Report.parse({
    schemaVersion: 1,
    run: { id: 'r', idempotencyKey: 'k1', host: 'github.com', repo: { id: 1, fullName: 'o/r' }, pr: 1, headSha: 'h1', configHash: 'c', engineVersion: '0.1.0', fpv: 1, channel: 'CLI', startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:00:00Z' },
    overallStatus: 'PASSED_WITH_WARNINGS',
    layers: [],
    layerSummary: [],
    coverage: { ran: [], notRun: [], headline: 'h' },
    findings,
    resolvedFingerprints: [],
    limitations: [],
    gate: { result: 'PASSED_WITH_WARNINGS', failedRules: [] },
    rulesChecklist: [],
    audit: { configSources: {}, foreignMarkers: 0, redactions: 0 },
  })
}

const published = (over: Partial<PublishedItems>): PublishedItems => ({ reviews: [], reviewComments: [], issueComments: [], ...over })

describe('readPrior', () => {
  it('reads only own markers at the same fingerprint version', () => {
    const prior = readPrior(
      published({
        reviewComments: [
          { id: 1, authorId: RID, body: `**MAJOR · correctness** — Problem 1\n\nd\n\n${marker({ fp: fp(1) })}`, url: 'https://x/c1' },
          { id: 2, authorId: 999, body: `stolen ${marker({ fp: fp(2) })}` },
          { id: 3, authorId: RID, body: `old algorithm ${marker({ fp: fp(3), fpv: 0 })}` },
          { id: 4, authorId: RID, body: 'my own note, no marker' },
        ],
        issueComments: [
          { id: 10, authorId: RID, body: marker({ kind: 'summary', fps: ['older'] }) },
          { id: 11, authorId: RID, body: marker({ kind: 'summary', fps: [fp(5).slice(0, 16), fp(6).slice(0, 16)] }) },
        ],
      }),
      RID,
      1,
    )
    expect(prior.inline).toEqual([{ fingerprint: fp(1), title: 'Problem 1', url: 'https://x/c1' }])
    expect(prior.summaryPrefixes).toEqual([fp(5).slice(0, 16), fp(6).slice(0, 16)])
  })
})

describe('renderPublish with prior publication', () => {
  const HUNKS = { 'a.ts': [{ newStart: 1, newLines: 20 }] }
  const prior = { inline: [{ fingerprint: fp(1), title: 'Problem 1', url: 'https://x/c1' }, { fingerprint: fp(2), title: 'Problem 2' }], summaryPrefixes: [fp(5).slice(0, 16), fp(6).slice(0, 16)] }

  it('posts only new Findings inline, lists unchanged ones as still open and vanished ones as resolved', () => {
    const r = report([finding(1), finding(3), finding(5, { location: { anchorKind: 'PR' } })])
    const p = renderPublish(r, planPublish(r, { hunks: HUNKS, rid: RID, engineMajor: 0, productVersion: '0.1.0', unattended: false, prior }))
    expect(p.inline.map((c) => c.fingerprint)).toEqual([fp(3)])
    expect(p.stillOpen.map((s) => [s.finding.title, s.url])).toEqual([['Problem 1', 'https://x/c1']])
    expect(p.resolved.map((x) => x.title)).toEqual(['Problem 2', 'An earlier summary-only finding'])
    expect(p.summaryBody).toContain('1 new inline · 1 still open · 2 resolved')
    expect(p.summaryBody).toContain('**Still open from earlier reviews:**')
    expect(p.summaryBody).toContain('- ~~Problem 2~~')
  })

  it('matches a merged Finding by any of its fingerprints', () => {
    const merged = finding(9, { fingerprints: [fp(9), fp(1)] })
    const r = report([merged])
    const p = renderPublish(r, planPublish(r, { hunks: HUNKS, rid: RID, engineMajor: 0, productVersion: '0.1.0', unattended: false, prior }))
    expect(p.inline).toEqual([])
    expect(p.stillOpen).toHaveLength(1)
  })
})

describe('publish never touches human comments', () => {
  it('leaves the reviewer\'s own unmarked comments alone', async () => {
    const issueComments = [{ id: 5, authorId: RID, body: 'I will look at this tomorrow.' }]
    const writes: string[] = []
    const reader: GitHubReader = {
      getPrContext: async () => err('x', 'x'),
      viewer: async () => ok({ id: RID, login: 'me' }),
      getHeadSha: async () => ok('h1'),
      listPublished: async () => ok(published({ issueComments })),
    }
    const writer: GitHubWriter = {
      createReview: async () => (writes.push('review'), ok({ id: 1, url: 'u' })),
      createIssueComment: async () => (writes.push('create'), ok({ id: 6, url: 'u' })),
      updateIssueComment: async (_r, id) => (writes.push(`update:${id}`), ok({ id, url: 'u' })),
      deleteIssueComment: async (_r, id) => (writes.push(`delete:${id}`), ok(undefined)),
    }
    const r = report([finding(1)])
    const plan = planPublish(r, { hunks: { 'a.ts': [{ newStart: 1, newLines: 5 }] }, rid: RID, engineMajor: 0, productVersion: '0.1.0', unattended: false })
    await publish(r, plan, renderPublish(r, plan), { host: 'github.com', owner: 'o', repo: 'r', number: 1 }, { reader, writer, now: () => 0 })
    expect(writes).toEqual(['review', 'create'])
    expect(issueComments[0]!.body).toBe('I will look at this tomorrow.')
  })
})
