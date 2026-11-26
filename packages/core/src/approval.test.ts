import { describe, expect, it } from 'vitest'
import { decideApproval } from './approval.js'
import type { Finding, LayerResult } from './findings.js'
import { planPublish, renderPublish } from './publish.js'
import { Report } from './report.js'

const layer = (layer: LayerResult['layer'], status: LayerResult['status']): LayerResult => ({ layer, validator: layer.toLowerCase(), status, durationMs: 1 }) as LayerResult
const finding = (severity: Finding['severity'], over: Partial<Finding> = {}): Finding =>
  ({ id: 'f'.repeat(64), fingerprint: 'f'.repeat(64), fingerprints: ['f'.repeat(64)], ruleId: 'ai/x', category: 'CORRECTNESS', severity, confidence: 'HIGH', scope: 'NEW', sourceFamily: 'AI', disposition: 'GATING', title: 't', description: 'd', location: { anchorKind: 'PR' }, provenance: { validator: 'ai.review' }, ...over }) as Finding

function report(findings: Finding[] = [], layers: LayerResult[] = [layer('COMPILE', 'PASSED'), layer('LINT', 'PASSED'), layer('AI_REVIEW', 'PASSED')], overallStatus = 'PASSED'): Report {
  return Report.parse({
    schemaVersion: 1,
    run: { id: 'r', idempotencyKey: 'k', host: 'github.com', repo: { id: 1, fullName: 'o/r' }, pr: 1, headSha: 'h1', configHash: 'c', engineVersion: '0.1.0', fpv: 1, channel: 'AUTO_REVIEW', startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:00:00Z' },
    overallStatus,
    layers,
    layerSummary: [],
    coverage: { ran: [], notRun: [], headline: 'h' },
    findings,
    resolvedFingerprints: [],
    limitations: [],
    gate: { result: overallStatus, failedRules: [] },
    rulesChecklist: [],
    audit: { configSources: {}, foreignMarkers: 0, redactions: 0 },
  })
}
const ON = { enabled: true }

describe('opt-in approval (roadmap item 9)', () => {
  it('is off unless enabled', () => {
    expect(decideApproval(report(), undefined)).toEqual({ approve: false, reasons: ['approval is off'] })
    expect(decideApproval(report(), { enabled: false }).approve).toBe(false)
  })

  it('approves a clean PR whose checks ran and passed', () => {
    expect(decideApproval(report([finding('MINOR'), finding('MAJOR', { scope: 'PRE_EXISTING' }), finding('CRITICAL', { dismissed: { by: 'ann', byPrAuthor: false } })]), ON)).toMatchObject({ approve: true })
  })

  it('refuses for each unmet condition, naming every one', () => {
    expect(decideApproval(report([finding('MAJOR')]), ON).reasons).toEqual(['1 finding(s) above minor'])
    expect(decideApproval(report([], [layer('COMPILE', 'SKIPPED'), layer('LINT', 'PASSED'), layer('AI_REVIEW', 'PASSED')]), ON).reasons[0]).toContain('a check that did not run is not a pass')
    expect(decideApproval(report([], [layer('COMPILE', 'PASSED'), layer('AI_REVIEW', 'ERROR')]), ON).reasons).toEqual(['the AI review did not complete'])
    expect(decideApproval(report([], undefined, 'FAILED'), ON).reasons).toEqual(['the review failed'])
    expect(decideApproval(report(), ON, { draft: true, ownPr: true }).reasons).toEqual(['the PR is a draft', 'GitHub does not let you approve your own PR'])
    expect(decideApproval(report([finding('MAJOR')]), { enabled: true, maxSeverity: 'MAJOR' }).approve).toBe(true)
    expect(decideApproval(report([], [layer('AI_REVIEW', 'PASSED'), layer('TESTS', 'FAILED')]), { enabled: true, requireLayers: ['TESTS'] }).approve).toBe(false)
  })

  it('turns a submitted comment into an approval that says why; never a pending review or a change request', () => {
    const r = report()
    const yes = { approve: true, reasons: ['no findings above minor'] }
    const plan = planPublish(r, { hunks: {}, rid: 7, engineMajor: 0, productVersion: '0.1.0', unattended: true, approval: yes })
    expect(plan.event).toBe('APPROVE')
    expect(renderPublish(r, plan).reviewBody).toMatch(/^Approved by PR Reviewer's approval policy: no findings above minor\./)
    expect(planPublish(r, { hunks: {}, rid: 7, engineMajor: 0, productVersion: '0.1.0', unattended: true, approval: yes, pending: true }).event).toBe('COMMENT')
    expect(planPublish(r, { hunks: {}, rid: 7, engineMajor: 0, productVersion: '0.1.0', unattended: false, approval: yes, event: 'REQUEST_CHANGES' }).event).toBe('REQUEST_CHANGES')
    expect(planPublish(r, { hunks: {}, rid: 7, engineMajor: 0, productVersion: '0.1.0', unattended: true, approval: { approve: false, reasons: [] } }).event).toBe('COMMENT')
  })
})
