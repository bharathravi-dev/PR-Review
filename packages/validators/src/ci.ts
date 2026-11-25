// Reuse of CI and SonarQube results on the Head Commit (FR-5, Story 4.3). Results come only from the exact head SHA.
import type { CheckResult, LayerId, LayerOutcome, Validator } from '@pr-reviewer/core'

/** Which layer a CI check reports into (core/rule-map, AD-24). */
export function layerForCheck(name: string): LayerId {
  if (/sonar/i.test(name)) return 'STATIC_ANALYSIS'
  if (/codeql|snyk|security|semgrep|trivy|dependency|audit/i.test(name)) return 'SECURITY'
  if (/\b(test|tests|jest|karma|vitest|mocha|cypress|playwright|e2e|spec)\b/i.test(name)) return 'TESTS'
  if (/lint|eslint|tslint|prettier|format|style/i.test(name)) return 'LINT'
  if (/build|compile|tsc|bundle/i.test(name)) return 'COMPILE'
  return 'EXTERNAL_RESULTS'
}

function outcome(c: CheckResult): Pick<LayerOutcome, 'status' | 'reason'> {
  switch (c.conclusion) {
    case 'success':
      return { status: 'PASSED' }
    case 'failure':
    case 'timed_out':
    case 'action_required':
    case 'error':
      return { status: 'FAILED' }
    case 'pending':
      return { status: 'SKIPPED', reason: 'UNKNOWN' }
    default:
      return { status: 'SKIPPED', reason: 'NOT_SUPPORTED' }
  }
}

export const ciResultsValidator: Validator = {
  id: 'ci.results',
  version: '1',
  layers: ['EXTERNAL_RESULTS'],
  needsSandbox: false,
  baseline: false,
  hermetic: false,
  supports(ctx) {
    return ctx.checks.some((c) => c.name !== 'pr-reviewer')
      ? { applicable: true }
      : { applicable: false, reason: 'NOT_SUPPORTED', detail: 'No CI results are attached to the head commit.' }
  },
  async run(ctx) {
    const layers: LayerOutcome[] = ctx.checks
      .filter((c) => c.name !== 'pr-reviewer')
      .map((c) => {
        const o = outcome(c)
        const state = c.conclusion === 'pending' ? 'still running when the review started' : c.conclusion
        const detail = [c.summary, state !== 'success' ? `(${state})` : undefined, c.url].filter(Boolean).join(' ')
        return { layer: layerForCheck(c.name), validator: `ci:${c.name}`, ...o, ...(detail ? { detail } : {}) }
      })
    return { layers, findings: [] }
  },
}
