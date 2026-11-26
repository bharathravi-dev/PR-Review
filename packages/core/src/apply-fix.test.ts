import { describe, expect, it } from 'vitest'
import { applyFix, replaceLines } from './apply-fix.js'
import type { Finding } from './findings.js'
import type { GitHubReader, GitHubWriter } from './ports.js'
import type { Report } from './report.js'
import { ok } from './result.js'

const ref = { host: 'github.com', owner: 'o', repo: 'r', number: 1 }
const FILE = 'a\nfor (;;) {\n  try { return fn() } catch {}\n}\nb\n'
const f = { fingerprint: 'f'.repeat(64), fingerprints: ['f'.repeat(64)], title: 'Retries forever', suggestion: 'for (let i = 0; i < 3; i++) {\n  try { return fn() } catch {}\n}', location: { anchorKind: 'LINE', path: 'src/retry.ts', startLine: 2, endLine: 4 } } as unknown as Finding
const report = (findings: Finding[] = [f]) => ({ run: { headSha: 'h1' }, findings }) as unknown as Report

function ports(head = 'h1') {
  const commits: unknown[] = []
  return {
    commits,
    p: {
      reader: { getHeadSha: async () => ok(head), readFile: async () => ok(FILE) } as unknown as GitHubReader,
      writer: { commitFile: async (repo: unknown, change: unknown) => (commits.push({ repo, change }), ok({ commitSha: 'c0ffee1', url: 'u' })) } as unknown as GitHubWriter,
    },
  }
}

describe('Apply fix (roadmap item 16)', () => {
  it('replaces exactly the lines a finding points at, keeping line endings', () => {
    expect(replaceLines('a\nb\nc\n', 2, 2, 'B1\nB2\n')).toBe('a\nB1\nB2\nc\n')
    expect(replaceLines('a\r\nb\r\nc', 1, 2, 'x')).toBe('x\r\nc')
  })

  it('commits the suggestion to the PR branch (the fork, when it is one)', async () => {
    const { p, commits } = ports()
    const done = await applyFix(ref, report(), { headRef: 'retry', headRepo: 'dev/r', headSha: 'h1' }, 'f'.repeat(64), p)
    expect(done).toEqual({ ok: true, value: { commitSha: 'c0ffee1', url: 'u' } })
    expect(commits[0]).toEqual({
      repo: { host: 'github.com', owner: 'dev', repo: 'r' },
      change: { branch: 'retry', path: 'src/retry.ts', content: 'a\nfor (let i = 0; i < 3; i++) {\n  try { return fn() } catch {}\n}\nb\n', expectedHead: 'h1', message: expect.stringMatching(/^Apply review suggestion: Retries forever/) },
    })
  })

  it('refuses when the PR moved, or the finding has no suggestion', async () => {
    expect(await applyFix(ref, report(), { headRef: 'retry', headSha: 'h1' }, 'f'.repeat(64), ports('h2').p)).toMatchObject({ ok: false, error: { code: 'head_moved' } })
    expect(await applyFix(ref, report([{ ...f, suggestion: undefined } as Finding]), { headRef: 'retry', headSha: 'h1' }, 'f'.repeat(64), ports().p)).toMatchObject({ ok: false, error: { code: 'no_suggestion' } })
  })
})
