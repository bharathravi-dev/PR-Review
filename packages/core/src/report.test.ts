import { describe, expect, it } from 'vitest'
import type { Finding, LayerResult } from './findings.js'
import { evaluateGate } from './report.js'

const layer = (l: LayerResult['layer'], status: LayerResult['status'], reason?: LayerResult['reason'], validator = l.toLowerCase()): LayerResult => ({
  layer: l,
  validator,
  status,
  durationMs: 0,
  ...(reason ? { reason } : {}),
})
const finding = (over: Partial<Finding>): Finding => ({
  ruleId: 'secrets/x',
  category: 'SECRET',
  severity: 'CRITICAL',
  confidence: 'HIGH',
  scope: 'NEW',
  sourceFamily: 'DETERMINISTIC',
  title: 't',
  description: 'd',
  location: { anchorKind: 'LINE', path: 'a.ts', startLine: 1, endLine: 1 },
  provenance: { validator: 'v' },
  ...over,
})

describe('evaluateGate', () => {
  const ok = [layer('CONTEXT', 'PASSED'), layer('SECRETS', 'PASSED')]

  it('passes a clean run with every layer executed', () => {
    const r = evaluateGate([...ok, layer('AI_REVIEW', 'PASSED')], [])
    expect(r.result).toBe('PASSED')
    expect(r.coverage).toEqual({ ran: ['CONTEXT', 'SECRETS', 'AI_REVIEW'], notRun: [], headline: 'Checks run: CONTEXT, SECRETS, AI_REVIEW.' })
  })

  it('never passes when a mandatory layer did not run', () => {
    const r = evaluateGate([layer('CONTEXT', 'PASSED'), layer('SECRETS', 'ERROR', 'TOOL_CRASHED')], [])
    expect(r.result).toBe('INCOMPLETE')
    expect(r.failedRules[0]).toContain('SECRETS')
    expect(evaluateGate([layer('CONTEXT', 'ERROR')], []).result).toBe('ERROR')
  })

  it('fails on gating deterministic blockers in counted scopes only', () => {
    expect(evaluateGate(ok, [finding({})]).result).toBe('FAILED')
    expect(evaluateGate(ok, [finding({ scope: 'UNKNOWN' })]).result).toBe('FAILED')
    expect(evaluateGate(ok, [finding({ scope: 'PRE_EXISTING' })]).result).toBe('PASSED_WITH_WARNINGS')
    expect(evaluateGate(ok, [finding({ sourceFamily: 'AI', ruleId: 'ai/security' })]).result).toBe('PASSED_WITH_WARNINGS')
  })

  it('combines validators on one layer by worst status and never reports a skip as run', () => {
    const r = evaluateGate([...ok, layer('LINT', 'PASSED', undefined, 'a'), layer('LINT', 'SKIPPED', 'NO_SANDBOX', 'b')], [])
    expect(r.layerSummary.find((s) => s.layer === 'LINT')).toEqual({ layer: 'LINT', status: 'SKIPPED', reason: 'NO_SANDBOX' })
    expect(r.result).toBe('PASSED_WITH_WARNINGS')
    expect(r.coverage.notRun).toEqual(['LINT'])
    expect(r.coverage.headline).toContain('a check that did not run is not a pass')
  })

  it('reports CANCELLED when the run was superseded', () => {
    expect(evaluateGate(ok, [], { cancelled: true }).result).toBe('CANCELLED')
  })
})
