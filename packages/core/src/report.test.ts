import { describe, expect, it } from 'vitest'
import type { Finding, LayerResult } from './findings.js'
import { evaluateGate } from './report.js'

const layer = (l: LayerResult['layer'], status: LayerResult['status'], reason?: LayerResult['reason']): LayerResult => ({
  layer: l,
  validator: l.toLowerCase(),
  status,
  durationMs: 0,
  ...(reason ? { reason } : {}),
})
const finding = (over: Partial<Finding>): Finding => ({
  ruleId: 'secrets/x',
  category: 'SECURITY',
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
  const ok = [layer('CONTEXT', 'PASSED'), layer('SECURITY', 'PASSED')]

  it('passes a clean run with every layer executed', () => {
    expect(evaluateGate([...ok, layer('AI_REVIEW', 'PASSED')], []).result).toBe('PASSED')
  })

  it('never passes when a mandatory layer did not run', () => {
    const r = evaluateGate([layer('CONTEXT', 'PASSED'), layer('SECURITY', 'ERROR', 'TOOL_CRASHED')], [])
    expect(r.result).toBe('INCOMPLETE')
    expect(r.reasons[0]).toContain('SECURITY')
    expect(evaluateGate([layer('CONTEXT', 'ERROR')], []).result).toBe('ERROR')
  })

  it('fails on new deterministic blockers but not on pre-existing or AI-only ones', () => {
    expect(evaluateGate(ok, [finding({})]).result).toBe('FAILED')
    expect(evaluateGate(ok, [finding({ scope: 'PRE_EXISTING' })]).result).toBe('PASSED_WITH_WARNINGS')
    expect(evaluateGate(ok, [finding({ sourceFamily: 'AI', ruleId: 'ai/security' })]).result).toBe('PASSED_WITH_WARNINGS')
  })

  it('warns, never passes, when an optional layer was skipped or errored', () => {
    const r = evaluateGate([...ok, layer('AI_REVIEW', 'SKIPPED', 'PROVIDER_UNAVAILABLE')], [])
    expect(r.result).toBe('PASSED_WITH_WARNINGS')
    expect(r.coverage).toEqual(['CONTEXT', 'SECURITY'])
  })
})
