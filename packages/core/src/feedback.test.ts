import { describe, expect, it } from 'vitest'
import { applyDismissals, feedbackStats, readDismissals } from './feedback.js'
import type { Finding } from './findings.js'
import { formatMarker } from './marker.js'
import type { PublishedItem, PublishedItems } from './ports.js'

const RID = 10
const fp = (c: string) => c.repeat(64)
const inline = (id: number, f: string, over: Partial<PublishedItem> = {}): PublishedItem => ({
  id,
  authorId: RID,
  authorLogin: 'me',
  body: `**MAJOR · correctness** — x\n\n${formatMarker({ mv: 1, kind: 'inline', rid: RID, head: 'h', cfg: 'c', eng: 0, fpv: 1, key: 'k', fp: f, u: '0/0/0' })}`,
  ...over,
})
const reply = (id: number, to: number, login: string, body: string): PublishedItem => ({ id, authorId: 99, authorLogin: login, body, inReplyTo: to })
const items = (over: Partial<PublishedItems>): PublishedItems => ({ reviews: [], reviewComments: [], issueComments: [], ...over })

const finding = (f: string, severity: Finding['severity'] = 'MAJOR'): Finding => ({
  fingerprint: f,
  fingerprints: [f],
  ruleId: 'ai/correctness',
  category: 'CORRECTNESS',
  severity,
  confidence: 'HIGH',
  scope: 'NEW',
  sourceFamily: 'AI',
  title: 't',
  description: 'd',
  location: { anchorKind: 'PR' },
  provenance: { validator: 'ai.review' },
})

describe('readDismissals', () => {
  it('reads 👎 reactions and /dismiss replies on own inline comments only', () => {
    const published = items({
      reviewComments: [
        inline(1, fp('a')),
        inline(2, fp('b')),
        inline(3, fp('c'), { authorId: 77 }), // not ours
        reply(4, 2, 'dev', '/dismiss false positive, retries are bounded'),
        reply(5, 1, 'dev', 'I will /dismiss this later'), // not at the start
        reply(6, 3, 'dev', '/dismiss'),
      ],
    })
    const d = readDismissals(published, RID, 1, 'author', new Map([[1, ['alice']], [3, ['bob']]]))
    expect([...d.entries()]).toEqual([
      [fp('a'), { by: 'alice', byPrAuthor: false }],
      [fp('b'), { by: 'dev', byPrAuthor: false }],
    ])
  })

  it('records when only the PR author dismissed', () => {
    const d = readDismissals(items({ reviewComments: [inline(1, fp('a'))] }), RID, 1, 'author', new Map([[1, ['author']]]))
    expect(d.get(fp('a'))).toEqual({ by: 'author', byPrAuthor: true })
  })
})

describe('applyDismissals', () => {
  it('marks dismissed Findings but never lets the PR author alone suppress a BLOCKER or CRITICAL', () => {
    const dismissals = new Map([
      [fp('a'), { by: 'author', byPrAuthor: true }],
      [fp('b'), { by: 'author', byPrAuthor: true }],
      [fp('c'), { by: 'reviewer2', byPrAuthor: false }],
    ])
    const out = applyDismissals([finding(fp('a'), 'CRITICAL'), finding(fp('b'), 'MINOR'), finding(fp('c'), 'BLOCKER'), finding(fp('d'))], dismissals)
    expect(out.map((f) => f.dismissed ?? null)).toEqual([null, { by: 'author', byPrAuthor: true }, { by: 'reviewer2', byPrAuthor: false }, null])
  })
})

describe('feedbackStats', () => {
  it('counts posted inline findings as resolved, dismissed, or open', () => {
    const published = items({
      reviewComments: [inline(1, fp('a'), { outdated: true }), inline(2, fp('b')), inline(3, fp('c')), inline(4, fp('c')), reply(5, 2, 'dev', '/dismiss')],
      issueComments: [{ id: 9, authorId: RID, body: formatMarker({ mv: 1, kind: 'summary', rid: RID, head: 'h', cfg: 'c', eng: 0, fpv: 1, key: 'k', fp: '-', u: '0/0/0', fps: ['p1', 'p2'] }) }],
    })
    expect(feedbackStats(published, RID, 1, 'author', new Map())).toEqual({ posted: 3, resolved: 1, dismissed: 1, open: 1, summaryOnly: 2 })
  })
})
