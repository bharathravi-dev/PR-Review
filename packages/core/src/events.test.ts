import { describe, expect, it } from 'vitest'
import { RunEvent, runEventEmitter } from './events.js'
import type { PublishPreview } from './publish.js'
import { PublishRequest, previewDigest } from './service.js'

describe('runEventEmitter', () => {
  it('numbers events per run and matches the RunEvent schema', () => {
    const seen: RunEvent[] = []
    const emit = runEventEmitter('run-1', () => Date.UTC(2026, 10, 25), (e) => seen.push(e))
    emit('STAGE_STARTED', { stage: 'fetchContext' })
    emit('DONE', { overallStatus: 'PASSED' })
    expect(seen.map((e) => [e.seq, e.type])).toEqual([[1, 'STAGE_STARTED'], [2, 'DONE']])
    expect(seen.every((e) => RunEvent.safeParse(e).success && e.runId === 'run-1' && e.at === '2026-11-25T00:00:00.000Z')).toBe(true)
  })

  it('does nothing without a sink', () => {
    expect(() => runEventEmitter('r', () => 0, undefined)('DONE')).not.toThrow()
  })
})

describe('ReviewService v1 shapes', () => {
  const preview = (summaryBody: string): PublishPreview => ({
    event: 'COMMENT', pending: false, reviewBody: 'r', summaryBody, inline: [{ path: 'a.ts', line: 2, side: 'RIGHT', fingerprint: 'f', body: 'b' }],
    summaryOnly: [], withheld: 0, stillOpen: [], resolved: [],
  })

  it('binds the digest to what will be posted', async () => {
    expect(await previewDigest(preview('s'))).toBe(await previewDigest(preview('s')))
    expect(await previewDigest(preview('s'))).not.toBe(await previewDigest(preview('t')))
  })

  it('accepts only the user choices for a publish', () => {
    expect(PublishRequest.parse({})).toEqual({ event: 'COMMENT' })
    expect(PublishRequest.safeParse({ event: 'APPROVE' }).success).toBe(false)
    expect(PublishRequest.parse({ include: ['x'], rid: 1, prior: {} })).toEqual({ event: 'COMMENT', include: ['x'] })
  })
})
