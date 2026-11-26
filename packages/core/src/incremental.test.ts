import { describe, expect, it } from 'vitest'
import type { ReviewProvider, ReviewRequest } from './ai-review.js'
import { formatMarker } from './marker.js'
import { runReviewWithContext, type EnginePorts } from './pipeline.js'
import type { GitHubReader, PublishedItems } from './ports.js'
import { lastReviewedHead, planPublish, renderPublish } from './publish.js'
import { err, ok } from './result.js'
import type { PrContext } from './schemas.js'

const RID = 77
const reviewMarker = (head: string) => formatMarker({ mv: 1, kind: 'review', rid: RID, head, cfg: 'c', eng: 0, fpv: 1, key: 'k', fp: '-', u: '0/0/0' })

const file = (path: string) => ({ path, status: 'modified' as const, additions: 1, deletions: 0, binary: false, patchTruncated: false, patch: '@@ -1,1 +1,2 @@\n x\n+y', head: { text: 'x\ny' } })
const context: PrContext = {
  schemaVersion: 1,
  ref: { host: 'github.com', owner: 'o', repo: 'r', number: 1 },
  title: 'Change',
  body: '',
  author: 'dev',
  state: 'open',
  draft: false,
  baseRef: 'main',
  headRef: 'feature',
  baseSha: 'b',
  headSha: 'h1',
  mergeBaseSha: 'm',
  fromFork: false,
  files: [file('a.ts'), file('b.ts'), file('c.ts')],
  reviews: [],
  reviewComments: [],
  issueComments: [],
  truncated: [],
} as PrContext

function ports(published: PublishedItems, compare: { status: string; paths: string[] }, requests: ReviewRequest[]): EnginePorts {
  const github = {
    getPrContext: async () => ok(context),
    readFile: async () => ok(undefined),
    listTree: async () => ok({ treeSha: 't', entries: [], truncated: false }),
    listDirectory: async () => ok([]),
    listCheckResults: async () => ok([]),
    downloadArchive: async () => err('x', 'none'),
    viewer: async () => ok({ id: RID, login: 'me' }),
    getHeadSha: async () => ok('h1'),
    listPublished: async () => ok(published),
    listThumbsDown: async () => ok([]),
    changedPathsBetween: async () => ok(compare),
  } as unknown as GitHubReader
  const provider: ReviewProvider = {
    id: 'fake',
    complete: async (req) => (requests.push(req), ok({ output: { findings: [] }, provider: 'fake', model: 'm' })),
  }
  return { github, scanSecrets: () => ({ completed: true, values: [], findings: [], layer: { layer: 'SECRETS', validator: 'secrets.builtin', status: 'PASSED', durationMs: 0 } }), providers: [{ name: 'fake', provider }], now: () => 0 }
}
const input = { ref: context.ref, engineVersion: '0.1.0', channel: 'CLI' as const, reviewerId: RID }
const filesIn = (r: ReviewRequest) => [...r.prompt.matchAll(/<file path="([^"]+)"/g)].map((m) => m[1])

describe('incremental reviews (roadmap item 4)', () => {
  const earlier: PublishedItems = { reviews: [{ id: 5, authorId: RID, body: reviewMarker('h0') }], reviewComments: [], issueComments: [] }

  it('re-checks only the files changed since the last reviewed head, and records what it did not re-check', async () => {
    const requests: ReviewRequest[] = []
    const { report } = await runReviewWithContext(input, ports(earlier, { status: 'ahead', paths: ['b.ts', 'README.md'] }, requests))
    expect(filesIn(requests[0]!)).toEqual(['b.ts'])
    expect(report.incremental).toEqual({ since: 'h0', files: 1, unchanged: ['a.ts', 'c.ts'] })
    expect(report.limitations.join(' ')).toContain('Incremental review: the AI re-checked the 1 file(s) changed since h0')
  })

  it('reviews everything on a first review, after a rewrite, or when asked', async () => {
    for (const [published, compare, review] of [
      [{ reviews: [], reviewComments: [], issueComments: [] }, { status: 'ahead', paths: ['b.ts'] }, {}],
      [earlier, { status: 'diverged', paths: ['b.ts'] }, {}],
      [earlier, { status: 'ahead', paths: ['b.ts'] }, { incremental: false }],
    ] as const) {
      const requests: ReviewRequest[] = []
      const { report } = await runReviewWithContext({ ...input, review }, ports(published, compare, requests))
      expect(filesIn(requests[0]!)).toEqual(['a.ts', 'b.ts', 'c.ts'])
      expect(report.incremental).toBeUndefined()
    }
  })

  it('finds the head of the latest own review', () => {
    const items: PublishedItems = { reviews: [{ id: 5, authorId: RID, body: reviewMarker('h0') }, { id: 9, authorId: RID, body: reviewMarker('h2') }, { id: 12, authorId: 3, body: reviewMarker('h9') }], reviewComments: [], issueComments: [] }
    expect(lastReviewedHead(items, RID)).toBe('h2')
  })

  it('does not count findings in files it did not re-check as resolved', async () => {
    const requests: ReviewRequest[] = []
    const { report } = await runReviewWithContext(input, ports(earlier, { status: 'ahead', paths: ['b.ts'] }, requests))
    const prior = {
      inline: [
        { fingerprint: 'f'.repeat(64), title: 'In an unchanged file', path: 'a.ts', commentId: 1 },
        { fingerprint: 'e'.repeat(64), title: 'In a changed file', path: 'b.ts', commentId: 2 },
      ],
      summaryPrefixes: ['d'.repeat(16)],
    }
    const preview = renderPublish(report, planPublish(report, { hunks: {}, rid: RID, engineMajor: 0, productVersion: '0.1.0', unattended: false, prior }))
    expect(preview.resolved.map((r) => r.title)).toEqual(['In a changed file'])
  })
})
