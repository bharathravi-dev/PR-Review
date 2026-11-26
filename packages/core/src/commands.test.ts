import { describe, expect, it } from 'vitest'
import type { ReviewProvider, ReviewRequest } from './ai-review.js'
import { handleCommand, parseCommand, pendingCommands, replyMarker, type CommandPorts } from './commands.js'
import type { GitHubReader, GitHubWriter, PublishedItems } from './ports.js'
import { ok } from './result.js'

const RID = 77
const ref = { host: 'github.com', owner: 'o', repo: 'r', number: 3 }
const FILE = ['import x from "y"', 'const key = "sk-live-0123456789"', 'export function retry(fn) {', '  for (;;) {', '    try { return fn() } catch {}', '  }', '}'].join('\n')
const finding = { id: 10, authorId: RID, body: '**MAJOR · correctness** — Retries forever\n\nThe loop never stops.', path: 'src/retry.ts', line: 6, startLine: 4 }
const items = (more: Partial<PublishedItems> = {}): PublishedItems => ({ reviews: [], issueComments: [], reviewComments: [finding], ...more })

function ports(answer: unknown, o: { canAct?: boolean } = {}) {
  const asked: ReviewRequest[] = []
  const posted: Array<{ where: string; body: string }> = []
  let reviews = 0
  const provider: ReviewProvider = { id: 'fake', complete: async (req) => (asked.push(req), ok({ output: answer, provider: 'fake', model: 'm' })) }
  const writer = {
    createIssueComment: async (_r: unknown, body: string) => (posted.push({ where: 'issue', body }), ok({ id: 1, url: 'u' })),
    replyToReviewComment: async (_r: unknown, id: number, body: string) => (posted.push({ where: `thread:${id}`, body }), ok({ id: 2, url: 'u' })),
  } as unknown as GitHubWriter
  const p: CommandPorts = {
    reader: { readFile: async () => ok(FILE) } as unknown as GitHubReader,
    writer,
    provider,
    redact: (_path, text) => text.replace('sk-live-0123456789', '[REDACTED]'),
    review: async () => (reviews++, { ok: true, message: '[Open the review](u)' }),
    canAct: async () => o.canAct ?? true,
  }
  return { p, asked, posted, reviews: () => reviews }
}

describe('commands in the PR thread (roadmap item 6)', () => {
  it('reads @pr-reviewer and /pr-reviewer commands anywhere on a line, with aliases', () => {
    expect(parseCommand('@pr-reviewer why is this a problem?')).toEqual({ verb: 'why', text: 'is this a problem?' })
    expect(parseCommand('Thanks!\n/pr-reviewer dismiss: intentional')).toEqual({ verb: 'ignore', text: 'intentional' })
    expect(parseCommand('@PR-REVIEWER Explain')).toEqual({ verb: 'why', text: '' })
    expect(parseCommand('please review this, @pr-reviewerbot')).toBeUndefined()
    expect(parseCommand('@pr-reviewer approve')).toBeUndefined()
  })

  it('finds each command once, ignoring its own comments and answered ones', () => {
    const it2 = items({
      issueComments: [
        { id: 20, authorId: 5, authorLogin: 'ann', body: '@pr-reviewer review' },
        { id: 21, authorId: 5, authorLogin: 'ann', body: '@pr-reviewer help' },
        { id: 22, authorId: RID, body: `Here you go ${replyMarker(21)}` },
        { id: 23, authorId: RID, body: '@pr-reviewer help' },
      ],
      reviewComments: [finding, { id: 30, authorId: 5, authorLogin: 'ann', body: '@pr-reviewer why', inReplyTo: 10 }],
    })
    expect(pendingCommands(it2, RID).map((c) => [c.commentId, c.verb, c.threadRoot])).toEqual([
      [20, 'review', undefined],
      [30, 'why', 10],
    ])
  })

  it('explains a finding in its thread, showing the AI the code without secrets', async () => {
    const { p, asked, posted } = ports({ answer: 'The loop retries forever when fn keeps failing.' })
    const out = await handleCommand(ref, 'h1', { verb: 'why', text: 'really?', commentId: 30, author: 'ann', threadRoot: 10 }, items(), RID, p)
    expect(out).toBe('answered #30 (why)')
    expect(asked[0]!.prompt).toContain('    4|   for (;;) {')
    expect(asked[0]!.prompt).not.toContain('sk-live-0123456789')
    expect(asked[0]!.prompt).toContain('The maintainer asks: "really?"')
    expect(posted[0]).toEqual({ where: 'thread:10', body: `The loop retries forever when fn keeps failing.\n\n${replyMarker(30)}` })
  })

  it('answers fix with a committable suggestion for exactly the commented lines', async () => {
    const { p, asked, posted } = ports({ explanation: 'Stop after three tries.', replacement: '  for (let i = 0; i < 3; i++) {\n    try { return fn() } catch {}\n  }' })
    await handleCommand(ref, 'h1', { verb: 'fix', text: '', commentId: 31, author: 'ann', threadRoot: 10 }, items(), RID, p)
    expect(asked[0]!.prompt).toContain('<lines_to_replace start="4" end="6">')
    expect(posted[0]!.body).toContain('```suggestion\n  for (let i = 0; i < 3; i++) {')
    const leaky = ports({ explanation: 'Use the key.', replacement: 'const key = "[REDACTED]"' })
    await handleCommand(ref, 'h1', { verb: 'fix', text: '', commentId: 32, author: 'ann', threadRoot: 10 }, items(), RID, leaky.p)
    expect(leaky.posted[0]!.body).not.toContain('```suggestion')
  })

  it('reviews again, dismisses, helps, and refuses people without push access or threads that are not its own', async () => {
    const a = ports({})
    await handleCommand(ref, 'h1', { verb: 'review', text: '', commentId: 40, author: 'ann' }, items(), RID, a.p)
    expect(a.reviews()).toBe(1)
    expect(a.posted[0]).toMatchObject({ where: 'issue', body: expect.stringContaining('Reviewed again. [Open the review](u)') })
    await handleCommand(ref, 'h1', { verb: 'ignore', text: '', commentId: 41, author: 'ann', threadRoot: 10 }, items(), RID, a.p)
    expect(a.posted[1]!.body).toContain('Dismissed.')
    await handleCommand(ref, 'h1', { verb: 'why', text: '', commentId: 42, author: 'ann', threadRoot: 99 }, items({ reviewComments: [finding, { id: 99, authorId: 5, body: 'a human comment' }] }), RID, a.p)
    expect(a.posted[2]!.body).toContain('in the thread of one of my review comments')
    const b = ports({}, { canAct: false })
    expect(await handleCommand(ref, 'h1', { verb: 'review', text: '', commentId: 43, author: 'eve' }, items(), RID, b.p)).toBe('skipped #43: @eve has no push access')
    expect(b.posted).toHaveLength(0)
  })
})
