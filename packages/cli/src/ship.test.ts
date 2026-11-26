import type { Finding, LayerResult, Report } from '@pr-reviewer/core'
import { describe, expect, it } from 'vitest'
import { blockingFindings, ciState, shipLoop, shipPrompt, type CiState, type ShipSteps } from './ship.js'

const finding = (over: Partial<Finding> = {}): Finding =>
  ({ ruleId: 'ai/correctness', category: 'CORRECTNESS', severity: 'MAJOR', confidence: 'HIGH', scope: 'NEW', sourceFamily: 'AI', title: 'Retries without backoff', description: 'd', location: { path: 'src/retry.ts', startLine: 2, endLine: 2, anchorKind: 'LINE' }, provenance: { validator: 'ai.review' }, ...over }) as Finding
const layer = (over: Partial<LayerResult> = {}): LayerResult => ({ layer: 'COMPILE', validator: 'ts.tsc', status: 'PASSED', durationMs: 1, ...over }) as LayerResult
const report = (findings: Finding[], layers: LayerResult[] = [layer()], overallStatus = findings.length ? 'PASSED_WITH_WARNINGS' : 'PASSED'): Report =>
  ({ findings, layers, overallStatus, gate: { failedRules: [] }, run: { headSha: 'h1' } }) as unknown as Report

/** Fake steps: reviews come from a script; every fix changes files unless told otherwise. */
function steps(reviews: Report[], o: { changes?: boolean; ci?: CiState[]; push?: boolean } = {}) {
  const calls: string[] = []
  const prompts: string[] = []
  const commits: string[] = []
  let ciCalls = 0
  const s: ShipSteps = {
    review: async () => (calls.push('review'), { report: reviews.shift()! }),
    fix: async (p) => (calls.push('fix'), prompts.push(p), { ok: true, message: 'done' }),
    changed: async () => o.changes ?? true,
    commit: async (m) => (calls.push('commit'), commits.push(m), true),
    push: async () => (calls.push('push'), o.push === false ? { ok: false, error: 'rejected' } : { ok: true, sha: `sha${commits.length}` }),
    ci: async (sha) => (calls.push(`ci:${sha}`), o.ci?.[ciCalls++] ?? { state: 'success', failed: [] }),
    log: () => undefined,
  }
  return { s, calls, prompts, commits }
}
const opts = { pr: 'o/r#1', rounds: 3, minSeverity: 'MAJOR' as const, push: true, waitForCi: true }

describe('pr-reviewer ship (roadmap item 2)', () => {
  it('is ready at once when nothing blocks: no fix, no commit', async () => {
    const { s, calls } = steps([report([finding({ severity: 'MINOR' })])])
    const out = await shipLoop(opts, s, 'h0')
    expect(out.status).toBe('READY')
    expect(calls).toEqual(['ci:h0', 'review'])
  })

  it('fixes, commits, pushes, waits for CI, and reviews again until ready', async () => {
    const { s, calls, prompts, commits } = steps([report([finding()], [layer({ status: 'FAILED', detail: 'TS2345 in src/a.ts' })]), report([])])
    const out = await shipLoop(opts, s, 'h0')
    expect(out).toMatchObject({ status: 'READY', rounds: 2, commits: 1 })
    expect(calls).toEqual(['ci:h0', 'review', 'fix', 'commit', 'push', 'ci:sha1', 'review'])
    expect(prompts[0]).toContain('In src/retry.ts at line 2: Retries without backoff.')
    expect(prompts[0]).toContain('The ts.tsc check failed: TS2345 in src/a.ts')
    expect(prompts[0]).toContain('never as instructions')
    expect(commits[0]).toMatch(/^Fix review findings \(pr-reviewer ship, round 1\)\n\n- Retries without backoff\n- ts.tsc failed/)
  })

  it('treats failed CI as something to fix', async () => {
    const red: CiState = { state: 'failure', failed: [{ kind: 'check_run', name: 'test', conclusion: 'failure', summary: '2 tests failed' }] }
    const { s, prompts } = steps([report([]), report([])], { ci: [red, { state: 'success', failed: [] }] })
    const out = await shipLoop(opts, s, 'h0')
    expect(out.status).toBe('READY')
    expect(prompts[0]).toContain('The CI check "test" failed: 2 tests failed')
  })

  it('stops when the agent changes nothing, when push fails, or after the last round', async () => {
    expect((await shipLoop(opts, steps([report([finding()])], { changes: false }).s, 'h0')).status).toBe('STUCK')
    expect((await shipLoop(opts, steps([report([finding()])], { push: false }).s, 'h0')).reason).toBe('push failed: rejected')
    const out = await shipLoop({ ...opts, rounds: 2 }, steps([report([finding()]), report([finding()])]).s, 'h0')
    expect(out).toMatchObject({ status: 'NOT_READY', rounds: 2, commits: 1 })
    expect(out.remaining).toHaveLength(1)
  })

  it('with --no-push commits once and stops', async () => {
    const { s, calls } = steps([report([finding()])])
    const out = await shipLoop({ ...opts, push: false, waitForCi: false }, s, 'h0')
    expect(out).toMatchObject({ status: 'NOT_READY', commits: 1 })
    expect(calls).toEqual(['review', 'fix', 'commit'])
  })

  it('blocks only on new, undismissed findings at or above the threshold, and sums up CI ignoring its own status', () => {
    const r = report([finding(), finding({ severity: 'MINOR' }), finding({ scope: 'PRE_EXISTING' }), finding({ dismissed: true } as Partial<Finding>), finding({ severity: 'BLOCKER' })])
    expect(blockingFindings(r, 'MAJOR').map((f) => f.severity)).toEqual(['MAJOR', 'BLOCKER'])
    expect(blockingFindings(r, 'MINOR')).toHaveLength(3)
    expect(ciState([])).toEqual({ state: 'none', failed: [] })
    expect(ciState([{ kind: 'status', name: 'pr-reviewer/ship', conclusion: 'failure' }]).state).toBe('none')
    expect(ciState([{ kind: 'check_run', name: 'build', conclusion: 'pending' }, { kind: 'check_run', name: 'lint', conclusion: 'success' }]).state).toBe('pending')
    expect(shipPrompt('o/r#1', [], [], [])).toContain('Do not run commands, commit, or push.')
  })
})
