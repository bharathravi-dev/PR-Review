// Opt-in approval (roadmap item 9). Off unless `publish.approve.enabled: true`. Even then, the review approves only
// when every condition holds; otherwise it stays a comment, and the review says which condition was not met.
import * as z from 'zod'
import { LayerId, Severity, type Finding, type LayerResult } from './findings.js'
import type { Report } from './report.js'

export const ApproveSettings = z.strictObject({
  enabled: z.boolean(),
  /** Findings above this severity block approval (default MINOR: any MAJOR, CRITICAL or BLOCKER blocks). */
  maxSeverity: Severity.optional(),
  /** Checks that must have run and passed (default COMPILE and LINT); a check that did not run blocks approval. */
  requireLayers: z.array(LayerId).optional(),
})
export type ApproveSettings = z.infer<typeof ApproveSettings>

const ORDER: readonly Finding['severity'][] = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO']
const DEFAULT_LAYERS: readonly LayerResult['layer'][] = ['COMPILE', 'LINT']

export interface ApprovalDecision {
  approve: boolean
  /** Why it approves, or every reason it does not. */
  reasons: string[]
}

/** Whether a review may approve, under the user's approval policy. Never approves a draft or a failed review. */
export function decideApproval(report: Report, settings: ApproveSettings | undefined, opts: { draft?: boolean | undefined; ownPr?: boolean | undefined } = {}): ApprovalDecision {
  if (!settings?.enabled) return { approve: false, reasons: ['approval is off'] }
  const no: string[] = []
  if (opts.draft) no.push('the PR is a draft')
  if (opts.ownPr) no.push('GitHub does not let you approve your own PR')
  if (report.overallStatus !== 'PASSED' && report.overallStatus !== 'PASSED_WITH_WARNINGS') no.push(`the review ${report.overallStatus.toLowerCase().replace(/_/g, ' ')}`)
  const max = ORDER.indexOf(settings.maxSeverity ?? 'MINOR')
  const blocking = report.findings.filter((f) => f.scope !== 'PRE_EXISTING' && !f.dismissed && ORDER.indexOf(f.severity) < max)
  if (blocking.length) no.push(`${blocking.length} finding(s) above ${(settings.maxSeverity ?? 'MINOR').toLowerCase()}`)
  for (const layer of settings.requireLayers ?? DEFAULT_LAYERS) {
    const ran = report.layers.filter((l) => l.layer === layer && l.status !== 'NOT_APPLICABLE')
    if (!ran.length) continue // nothing of this kind in the PR (e.g. no lint configured): nothing to require
    const bad = ran.filter((l) => l.status !== 'PASSED')
    if (bad.length) no.push(`${layer.toLowerCase()} ${bad.map((l) => l.status.toLowerCase()).join(', ')}${bad.some((l) => l.status === 'SKIPPED') ? ' (a check that did not run is not a pass)' : ''}`)
  }
  const ai = report.layers.find((l) => l.layer === 'AI_REVIEW')
  if (!ai || ai.status === 'ERROR' || ai.status === 'SKIPPED' || ai.status === 'TIMEOUT') no.push('the AI review did not complete')
  if (no.length) return { approve: false, reasons: no }
  const checks = (settings.requireLayers ?? DEFAULT_LAYERS).map((l) => l.toLowerCase()).join(' and ')
  return { approve: true, reasons: [`no findings above ${(settings.maxSeverity ?? 'MINOR').toLowerCase()}`, `${checks} passed where they apply`, 'the AI review completed'] }
}
