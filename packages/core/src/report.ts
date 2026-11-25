import * as z from 'zod'
import { Finding, LayerId, LayerResult } from './findings.js'

export const OverallStatus = z.enum(['PASSED', 'PASSED_WITH_WARNINGS', 'FAILED', 'INCOMPLETE', 'ERROR', 'CANCELLED'])
export type OverallStatus = z.infer<typeof OverallStatus>

/** The consolidated output of a Review Run (AD-15). Channels render only from this object. */
export const Report = z.strictObject({
  schemaVersion: z.literal(1),
  run: z.strictObject({
    id: z.string(),
    repo: z.string(),
    pr: z.number().int(),
    host: z.string(),
    baseSha: z.string().optional(),
    headSha: z.string().optional(),
    mergeBaseSha: z.string().optional(),
    engineVersion: z.string(),
    channel: z.string(),
    startedAt: z.string(),
    finishedAt: z.string(),
  }),
  title: z.string().optional(),
  overallStatus: OverallStatus,
  coverage: z.array(LayerId),
  layers: z.array(LayerResult),
  findings: z.array(Finding),
  gate: z.strictObject({
    result: OverallStatus,
    reasons: z.array(z.string()),
  }),
  ai: z
    .strictObject({
      provider: z.string(),
      model: z.string(),
      usage: z.strictObject({ inputTokens: z.number(), outputTokens: z.number() }).optional(),
      droppedFindings: z.number().int(),
    })
    .optional(),
  notes: z.array(z.string()),
})
export type Report = z.infer<typeof Report>

const EXECUTED = new Set<LayerResult['status']>(['PASSED', 'FAILED', 'WARNING'])
const BLOCKING = new Set<Finding['severity']>(['BLOCKER', 'CRITICAL'])

/** Layers that must execute for a run to be complete, unless user configuration says otherwise. */
export const DEFAULT_MANDATORY_LAYERS: readonly LayerId[] = ['CONTEXT', 'SECURITY']

/**
 * Stage `gate`: the only place an Overall Status is computed (AD-3). A Mandatory Layer that did not
 * execute makes the run INCOMPLETE; new or worsened BLOCKER/CRITICAL findings from non-AI sources FAIL it;
 * AI-only findings never fail the gate (FR-6).
 */
export function evaluateGate(
  layers: readonly LayerResult[],
  findings: readonly Finding[],
  mandatory: readonly LayerId[] = DEFAULT_MANDATORY_LAYERS,
): { result: OverallStatus; reasons: string[]; coverage: LayerId[] } {
  const coverage = [...new Set(layers.filter((l) => EXECUTED.has(l.status)).map((l) => l.layer))]
  const reasons: string[] = []

  for (const layer of mandatory) {
    if (!coverage.includes(layer)) reasons.push(`Mandatory layer ${layer} did not run.`)
  }
  if (reasons.length > 0) {
    const contextFailed = layers.some((l) => l.layer === 'CONTEXT' && l.status === 'ERROR')
    return { result: contextFailed ? 'ERROR' : 'INCOMPLETE', reasons, coverage }
  }

  const blockers = findings.filter((f) => f.sourceFamily !== 'AI' && BLOCKING.has(f.severity) && (f.scope === 'NEW' || f.scope === 'WORSENED'))
  if (blockers.length > 0) {
    for (const f of blockers) reasons.push(`${f.severity} ${f.ruleId} at ${f.location.path ?? 'PR'}${f.location.startLine ? `:${f.location.startLine}` : ''}`)
    return { result: 'FAILED', reasons, coverage }
  }

  const degraded = layers.filter((l) => !EXECUTED.has(l.status) && l.status !== 'NOT_APPLICABLE')
  for (const l of degraded) reasons.push(`${l.layer} (${l.validator}) ${l.status}${l.reason ? ` ${l.reason}` : ''}`)
  if (findings.length > 0 || degraded.length > 0 || layers.some((l) => l.status === 'WARNING' || l.status === 'FAILED')) {
    return { result: 'PASSED_WITH_WARNINGS', reasons, coverage }
  }
  return { result: 'PASSED', reasons, coverage }
}

const SEVERITY_ORDER: Finding['severity'][] = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO']

/** Human-readable Markdown rendering of a Report. */
export function renderReportMarkdown(report: Report): string {
  const out: string[] = []
  const ref = `${report.run.repo}#${report.run.pr}`
  out.push(`# PR review: ${ref}${report.title ? ` — ${report.title}` : ''}`, '')
  out.push(`**Overall: ${report.overallStatus}**  ·  head \`${report.run.headSha?.slice(0, 7) ?? '?'}\`  ·  coverage: ${report.coverage.join(', ') || 'none'}`, '')
  const notRun = report.layers.filter((l) => !['PASSED', 'FAILED', 'WARNING'].includes(l.status))
  if (notRun.length > 0) {
    out.push(`> Not every check ran: ${notRun.map((l) => `${l.layer} ${l.status}${l.reason ? ` (${l.reason})` : ''}`).join('; ')}. A skipped check is not a passed check.`, '')
  }
  if (report.gate.reasons.length > 0) out.push('## Gate', ...report.gate.reasons.map((r) => `- ${r}`), '')

  out.push('## Checks', '', '| Layer | Validator | Status | Detail |', '|---|---|---|---|')
  for (const l of report.layers) out.push(`| ${l.layer} | ${l.validator} | ${l.status}${l.reason ? ` (${l.reason})` : ''} | ${(l.detail ?? '').replace(/\|/g, '\\|')} |`)
  out.push('')

  out.push(`## Findings (${report.findings.length})`, '')
  if (report.findings.length === 0) out.push('No findings.', '')
  for (const sev of SEVERITY_ORDER) {
    for (const f of report.findings.filter((x) => x.severity === sev)) {
      const where = f.location.path ? `\`${f.location.path}${f.location.startLine ? `:${f.location.startLine}` : ''}\`` : 'whole PR'
      out.push(`### ${f.severity} · ${f.category} · ${f.title}`, `${where} · ${f.sourceFamily}${f.provenance.model ? ` (${f.provenance.model})` : ''} · confidence ${f.confidence} · ${f.scope}`, '', f.description)
      if (f.impact) out.push('', `**Impact:** ${f.impact}`)
      if (f.recommendation) out.push('', `**Recommendation:** ${f.recommendation}`)
      out.push('')
    }
  }
  if (report.ai) {
    const u = report.ai.usage
    out.push(`_AI: ${report.ai.provider} ${report.ai.model}${u ? `, ${u.inputTokens} input / ${u.outputTokens} output tokens` : ''}${report.ai.droppedFindings ? `, ${report.ai.droppedFindings} finding(s) dropped for invalid locations` : ''}._`)
  }
  if (report.notes.length > 0) out.push('', '## Notes', ...report.notes.map((n) => `- ${n}`))
  return `${out.join('\n')}\n`
}
