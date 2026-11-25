import { describe, expect, it } from 'vitest'
import type { Finding } from './findings.js'
import { formatMarker, parseMarker } from './marker.js'
import type { GitHubReader, GitHubWriter, InlineComment, PublishedItem } from './ports.js'
import type { PrRef } from './pr-ref.js'
import { planPublish, publish, renderPublish, type PublishPlan } from './publish.js'
import { Report } from './report.js'
import { err, ok } from './result.js'

const REF: PrRef = { host: 'github.com', owner: 'octo', repo: 'app', number: 7 }
const RID = 1001

const finding = (n: number, over: Partial<Finding> = {}): Finding => ({
  id: `fp${n}`,
  fingerprint: `fp${n}`.padEnd(64, '0'),
  fingerprints: [`fp${n}`.padEnd(64, '0')],
  ruleId: 'ai/correctness',
  category: 'CORRECTNESS',
  severity: 'MAJOR',
  confidence: 'HIGH',
  scope: 'NEW',
  sourceFamily: 'AI',
  disposition: 'GATING',
  title: `Problem ${n}`,
  description: `Details ${n} for @someone`,
  location: { anchorKind: 'LINE', path: 'src/a.ts', side: 'HEAD', startLine: 2, endLine: 2 },
  provenance: { validator: 'ai.review', provider: 'anthropic', model: 'claude-opus-5-5' },
  ...over,
})

function report(findings: Finding[], over: Record<string, unknown> = {}): Report {
  return Report.parse({
    schemaVersion: 1,
    run: {
      id: 'run-1',
      idempotencyKey: 'key-1',
      host: 'github.com',
      repo: { id: 99, fullName: 'octo/app' },
      pr: 7,
      baseSha: 'base',
      headSha: 'head1',
      mergeBaseSha: 'mb',
      configHash: 'cfg1',
      engineVersion: '0.1.0',
      fpv: 1,
      channel: 'CLI',
      startedAt: '2026-11-25T00:00:00.000Z',
      finishedAt: '2026-11-25T00:00:01.000Z',
    },
    overallStatus: 'PASSED_WITH_WARNINGS',
    layers: [],
    layerSummary: [],
    coverage: { ran: ['CONTEXT', 'SECRETS', 'AI_REVIEW'], notRun: [], headline: 'Checks run: CONTEXT, SECRETS, AI_REVIEW.' },
    findings,
    resolvedFingerprints: [],
    limitations: [],
    gate: { result: 'PASSED_WITH_WARNINGS', failedRules: [] },
    ai: { attempts: [{ provider: 'anthropic', model: 'claude-opus-5-5', outcome: 'SUCCEEDED', usage: { input: 900, output: 40 } }], droppedFindings: { schema: 0, grounding: 0 }, partial: false },
    rulesChecklist: [],
    audit: { configSources: {}, foreignMarkers: 0, redactions: 0 },
    ...over,
  })
}

/** In-memory GitHub holding reviews and issue comments, recording every write. */
function fakeGitHub(opts: { head?: string; failInlineOnce?: boolean } = {}) {
  const reviews: PublishedItem[] = []
  const comments: PublishedItem[] = []
  const writes: string[] = []
  const reviewComments: InlineComment[][] = []
  let next = 1
  let failInline = opts.failInlineOnce ?? false
  const reader: GitHubReader = {
    getPrContext: async () => err('unused', 'unused'),
    viewer: async () => ok({ id: RID, login: 'me' }),
    getHeadSha: async () => ok(opts.head ?? 'head1'),
    listPublished: async () => ok({ reviews: [...reviews], reviewComments: [], issueComments: [...comments] }),
  }
  const writer: GitHubWriter = {
    createReview: async (_ref, r) => {
      if (failInline && r.comments.length > 0) {
        failInline = false
        writes.push('createReview:422')
        return err('github_unprocessable', 'GitHub rejected the request (422): Line could not be resolved')
      }
      const id = next++
      reviews.push({ id, authorId: RID, body: r.body, state: 'COMMENTED' })
      reviewComments.push([...r.comments])
      writes.push(`createReview:${r.event}:${r.comments.length}`)
      return ok({ id, url: `https://github.com/octo/app/pull/7#pullrequestreview-${id}` })
    },
    createIssueComment: async (_ref, body) => {
      const id = next++
      comments.push({ id, authorId: RID, body })
      writes.push(`createIssueComment:${id}`)
      return ok({ id, url: `https://github.com/octo/app/pull/7#issuecomment-${id}` })
    },
    updateIssueComment: async (_ref, id, body) => {
      const c = comments.find((x) => x.id === id)!
      c.body = body
      writes.push(`updateIssueComment:${id}`)
      return ok({ id, url: `https://github.com/octo/app/pull/7#issuecomment-${id}` })
    },
    deleteIssueComment: async (_ref, id) => {
      comments.splice(comments.findIndex((x) => x.id === id), 1)
      writes.push(`deleteIssueComment:${id}`)
      return ok(undefined)
    },
  }
  return { reader, writer, reviews, comments, writes, reviewComments }
}

const HUNKS = { 'src/a.ts': [{ newStart: 1, newLines: 5 }] }

function plan(r: Report, over: Partial<PublishPlan> = {}): PublishPlan {
  return { ...planPublish(r, { hunks: HUNKS, rid: RID, engineMajor: 0, productVersion: '0.1.0', unattended: false }), ...over }
}

describe('renderPublish', () => {
  it('puts anchorable new findings inline and everything else in the summary', () => {
    const r = report([
      finding(1),
      finding(2, { location: { anchorKind: 'LINE', path: 'src/a.ts', startLine: 40, endLine: 40 } }),
      finding(3, { scope: 'PRE_EXISTING' }),
      finding(4, { disposition: 'ADVISORY', confidence: 'LOW' }),
      finding(5, { location: { anchorKind: 'PR' } }),
      finding(6, { dismissed: { by: 'dev', byPrAuthor: true } }),
      finding(7, { location: { anchorKind: 'LINE', path: 'src/a.ts', startLine: 2, endLine: 4 } }),
    ])
    const p = renderPublish(r, plan(r))
    expect(p.inline.map((c) => [c.path, c.startLine, c.line])).toEqual([
      ['src/a.ts', undefined, 2],
      ['src/a.ts', 2, 4],
    ])
    expect(p.summaryOnly.map((f) => f.title)).toEqual(['Problem 2', 'Problem 3', 'Problem 4', 'Problem 5'])
    expect(p.withheld).toBe(1)
    expect(p.summaryBody).toContain('_1 finding(s) withheld from this post')
    expect(p.summaryBody).toContain('Generated by PR Reviewer 0.1.0 · AI: anthropic claude-opus-5-5 · published by the reviewer')
    expect(p.inline[0]!.body).toContain('`@someone`')
    expect(parseMarker(p.inline[0]!.body)).toMatchObject({ kind: 'inline', rid: RID, fp: r.findings[0]!.fingerprint, key: 'key-1' })
    expect(parseMarker(p.summaryBody)).toMatchObject({ kind: 'summary', fps: r.findings.slice(1, 5).map((f) => f.fingerprint!.slice(0, 16)), u: '900/40/0' })
    expect(parseMarker(p.reviewBody)).toMatchObject({ kind: 'review', key: 'key-1' })
  })

  it('caps inline comments and honours a selection', () => {
    const r = report([finding(1), finding(2), finding(3)])
    expect(renderPublish(r, plan(r, { maxInline: 2 })).inline).toHaveLength(2)
    const picked = renderPublish(r, plan(r, { include: [r.findings[1]!.fingerprint!] }))
    expect(picked.inline.map((c) => c.fingerprint)).toEqual([r.findings[1]!.fingerprint])
    expect(picked.withheld).toBe(2)
  })
})

describe('publish', () => {
  it('creates one review with inline comments, then the summary comment', async () => {
    const gh = fakeGitHub()
    const r = report([finding(1), finding(2, { location: { anchorKind: 'PR' } })])
    const p = plan(r)
    const rec = await publish(r, p, renderPublish(r, p), REF, { ...gh, now: () => 0 })
    expect(rec).toMatchObject({ status: 'PUBLISHED', commentCount: 1, pending: false })
    expect(gh.writes).toEqual(['createReview:COMMENT:1', 'createIssueComment:2'])
    expect(rec.reviewUrl).toContain('pullrequestreview-1')
    expect(rec.summaryUrl).toContain('issuecomment-2')
  })

  it('never duplicates: same head and settings skips the review and edits the summary in place', async () => {
    const gh = fakeGitHub()
    const r = report([finding(1)])
    const p = plan(r)
    await publish(r, p, renderPublish(r, p), REF, { ...gh, now: () => 0 })
    const again = await publish(r, p, renderPublish(r, p), REF, { ...gh, now: () => 0 })
    expect(again.status).toBe('SKIPPED_DUPLICATE')
    expect(gh.writes).toEqual(['createReview:COMMENT:1', 'createIssueComment:2', 'updateIssueComment:2'])
    expect(gh.reviews).toHaveLength(1)
    expect(gh.comments).toHaveLength(1)
  })

  it('posts a new review for a new head commit but keeps one summary', async () => {
    const gh = fakeGitHub()
    const r1 = report([finding(1)])
    await publish(r1, plan(r1), renderPublish(r1, plan(r1)), REF, { ...gh, now: () => 0 })
    const r2 = report([finding(1)], { run: { ...r1.run, headSha: 'head1', idempotencyKey: 'key-2' } })
    const rec = await publish(r2, plan(r2), renderPublish(r2, plan(r2)), REF, { ...gh, now: () => 0 })
    expect(rec.status).toBe('PUBLISHED')
    expect(gh.reviews).toHaveLength(2)
    expect(gh.comments).toHaveLength(1)
  })

  it('writes nothing when the PR head moved (CANCELLED, SUPERSEDED)', async () => {
    const gh = fakeGitHub({ head: 'head2' })
    const r = report([finding(1)])
    const rec = await publish(r, plan(r), renderPublish(r, plan(r)), REF, { ...gh, now: () => 0 })
    expect(rec.status).toBe('CANCELLED')
    expect(rec.reason).toContain('SUPERSEDED')
    expect(gh.writes).toEqual([])
  })

  it('ignores markers on other people\'s comments, even a copied key', async () => {
    const gh = fakeGitHub()
    const r = report([finding(1)])
    const forged = formatMarker({ mv: 1, kind: 'review', rid: RID, head: 'head1', cfg: 'cfg1', eng: 0, fpv: 1, key: 'key-1', fp: '-', u: '0/0/0' })
    gh.reviews.push({ id: 500, authorId: 666, body: forged })
    gh.comments.push({ id: 501, authorId: 666, body: forged.replace('kind=review', 'kind=summary').replace(' -->', ' fps=- -->') })
    const rec = await publish(r, plan(r), renderPublish(r, plan(r)), REF, { ...gh, now: () => 0 })
    expect(rec.status).toBe('PUBLISHED')
    expect(gh.writes).toEqual(['createReview:COMMENT:1', 'createIssueComment:2'])
    expect(gh.comments.find((c) => c.id === 501)?.body).toBe(forged.replace('kind=review', 'kind=summary').replace(' -->', ' fps=- -->'))
  })

  it('stops when a newer engine already reviewed the PR', async () => {
    const gh = fakeGitHub()
    gh.comments.push({ id: 9, authorId: RID, body: formatMarker({ mv: 1, kind: 'summary', rid: RID, head: 'h', cfg: 'c', eng: 3, fpv: 1, key: 'k', fp: '-', u: '0/0/0', fps: [] }) })
    const r = report([finding(1)])
    const rec = await publish(r, plan(r), renderPublish(r, plan(r)), REF, { ...gh, now: () => 0 })
    expect(rec.status).toBe('SKIPPED_NEWER_ENGINE')
    expect(gh.writes).toEqual([])
  })

  it('falls back to the summary when GitHub rejects an inline anchor (422)', async () => {
    const gh = fakeGitHub({ failInlineOnce: true })
    const r = report([finding(1)])
    const rec = await publish(r, plan(r), renderPublish(r, plan(r)), REF, { ...gh, now: () => 0 })
    expect(rec.status).toBe('PUBLISHED')
    expect(gh.writes).toEqual(['createReview:422', 'createReview:COMMENT:0', 'createIssueComment:2'])
    expect(gh.comments[0]!.body).toContain('**Could not be attached inline:**')
  })

  it('keeps the oldest own summary and removes extra copies', async () => {
    const gh = fakeGitHub()
    const summary = (id: number) => ({ id, authorId: RID, body: formatMarker({ mv: 1, kind: 'summary', rid: RID, head: 'h', cfg: 'c', eng: 0, fpv: 1, key: 'k', fp: '-', u: '0/0/0', fps: [] }) })
    gh.comments.push(summary(20), summary(30))
    const r = report([finding(1)])
    await publish(r, plan(r), renderPublish(r, plan(r)), REF, { ...gh, now: () => 0 })
    expect(gh.writes).toEqual(['createReview:COMMENT:1', 'updateIssueComment:20', 'deleteIssueComment:30'])
  })

  it('refuses REQUEST_CHANGES nowhere in core but never approves: only COMMENT or REQUEST_CHANGES reach the writer', async () => {
    const gh = fakeGitHub()
    const r = report([finding(1)])
    const p = plan(r, { event: 'REQUEST_CHANGES' })
    await publish(r, p, renderPublish(r, p), REF, { ...gh, now: () => 0 })
    expect(gh.writes[0]).toBe('createReview:REQUEST_CHANGES:1')
  })
})
