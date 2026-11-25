import * as z from 'zod'
import { Finding, LayerId, LayerResult, LayerStatus, ReasonCode, type Severity } from './findings.js'

export const OverallStatus = z.enum(['PASSED', 'PASSED_WITH_WARNINGS', 'FAILED', 'INCOMPLETE', 'ERROR', 'CANCELLED'])
export type OverallStatus = z.infer<typeof OverallStatus>

export const Channel = z.enum(['CLI', 'AUTO_REVIEW', 'WEB', 'EXTENSION_STANDALONE', 'EXTENSION_CONNECTED'])
export type Channel = z.infer<typeof Channel>

/** Fingerprint algorithm version (AD-11, AD-12). Changing the algorithm requires a new engine major. */
export const FPV = 1

export const LayerSummary = z.object({ layer: LayerId, status: LayerStatus, reason: ReasonCode.optional() })
export type LayerSummary = z.infer<typeof LayerSummary>

export const AiAttempt = z.object({
  provider: z.string(),
  model: z.string(),
  outcome: z.enum(['SUCCEEDED', 'FAILED', 'SKIPPED']),
  reason: z.string().optional(),
  usage: z.object({ input: z.number().optional(), output: z.number().optional() }).optional(),
})

/** The consolidated output of a Review Run (AD-15). Immutable after `assemble`; Channels render only from it. */
export const Report = z.looseObject({
  schemaVersion: z.literal(1),
  run: z.looseObject({
    id: z.string(),
    idempotencyKey: z.string().optional(),
    host: z.string(),
    repo: z.object({ id: z.number().int().optional(), fullName: z.string() }),
    pr: z.number().int(),
    baseSha: z.string().optional(),
    headSha: z.string().optional(),
    mergeBaseSha: z.string().optional(),
    configHash: z.string(),
    engineVersion: z.string(),
    fpv: z.number().int(),
    channel: Channel,
    startedAt: z.string(),
    finishedAt: z.string(),
  }),
  title: z.string().optional(),
  overallStatus: OverallStatus,
  layers: z.array(LayerResult),
  layerSummary: z.array(LayerSummary),
  coverage: z.object({ ran: z.array(LayerId), notRun: z.array(LayerId), headline: z.string() }),
  findings: z.array(Finding),
  resolvedFingerprints: z.array(z.string()),
  limitations: z.array(z.string()),
  gate: z.object({ result: OverallStatus, failedRules: z.array(z.string()) }),
  ai: z
    .object({
      attempts: z.array(AiAttempt),
      droppedFindings: z.object({ schema: z.number().int(), grounding: z.number().int() }),
      partial: z.boolean(),
    })
    .optional(),
  rulesChecklist: z.array(z.string()),
  audit: z.object({
    configSources: z.record(z.string(), z.string()),
    foreignMarkers: z.number().int(),
    redactions: z.number().int(),
  }),
})
export type Report = z.infer<typeof Report>

/** Worst-status precedence for combining several Validators on one layer (AD-24). */
const PRECEDENCE: LayerResult['status'][] = ['ERROR', 'TIMEOUT', 'FAILED', 'WARNING', 'SKIPPED', 'PASSED', 'NOT_APPLICABLE']
const EXECUTED = new Set<LayerResult['status']>(['PASSED', 'FAILED', 'WARNING'])
const BLOCKING = new Set<Severity>(['BLOCKER', 'CRITICAL'])
const COUNTED_SCOPES = new Set<Finding['scope']>(['NEW', 'WORSENED', 'UNKNOWN'])

/** Layers that must execute for a run to be complete; only user config may change them (AD-13). */
export const DEFAULT_MANDATORY_LAYERS: readonly LayerId[] = ['CONTEXT', 'SECRETS']

export interface GateResult {
  result: OverallStatus
  failedRules: string[]
  layerSummary: LayerSummary[]
  coverage: Report['coverage']
}

/**
 * Stage `gate` (AD-3, AD-24): the only place layer summaries, coverage, and the Overall Status are computed.
 * A Mandatory Layer that did not execute makes the run INCOMPLETE (ERROR if context failed); gating BLOCKER or
 * CRITICAL Findings from non-AI sources in counted scopes FAIL it; AI-only Findings never fail it (FR-6);
 * dismissals never change it (AD-11); a run cancelled mid-way is CANCELLED.
 */
export function evaluateGate(
  layers: readonly LayerResult[],
  findings: readonly Finding[],
  opts: { mandatory?: readonly LayerId[]; cancelled?: boolean } = {},
): GateResult {
  const byLayer = new Map<LayerId, LayerResult[]>()
  for (const l of layers) byLayer.set(l.layer, [...(byLayer.get(l.layer) ?? []), l])
  const layerSummary: LayerSummary[] = [...byLayer.entries()].map(([layer, rows]) => {
    const worst = [...rows].sort((a, b) => PRECEDENCE.indexOf(a.status) - PRECEDENCE.indexOf(b.status))[0]!
    return { layer, status: worst.status, ...(worst.reason ? { reason: worst.reason } : {}) }
  })
  const ran = layerSummary.filter((s) => EXECUTED.has(s.status)).map((s) => s.layer)
  const notRun = layerSummary.filter((s) => !EXECUTED.has(s.status) && s.status !== 'NOT_APPLICABLE').map((s) => s.layer)
  const headline =
    notRun.length === 0
      ? `Checks run: ${ran.join(', ') || 'none'}.`
      : `Checks run: ${ran.join(', ') || 'none'}. Not run: ${notRun.join(', ')} — a check that did not run is not a pass.`
  const coverage = { ran, notRun, headline }
  const failedRules: string[] = []
  const done = (result: OverallStatus): GateResult => ({ result, failedRules, layerSummary, coverage })

  if (opts.cancelled) return done('CANCELLED')

  const mandatory = opts.mandatory ?? DEFAULT_MANDATORY_LAYERS
  for (const layer of mandatory) if (!ran.includes(layer)) failedRules.push(`Mandatory layer ${layer} did not run.`)
  if (failedRules.length > 0) {
    const contextFailed = layerSummary.some((s) => s.layer === 'CONTEXT' && s.status === 'ERROR')
    return done(contextFailed ? 'ERROR' : 'INCOMPLETE')
  }

  const blockers = findings.filter(
    (f) => f.sourceFamily !== 'AI' && f.disposition !== 'ADVISORY' && BLOCKING.has(f.severity) && COUNTED_SCOPES.has(f.scope),
  )
  if (blockers.length > 0) {
    for (const f of blockers) {
      failedRules.push(`${f.severity} ${f.ruleId} at ${f.location.path ?? 'PR'}${f.location.startLine ? `:${f.location.startLine}` : ''}`)
    }
    return done('FAILED')
  }
  if (findings.length > 0 || notRun.length > 0 || layerSummary.some((s) => s.status === 'WARNING' || s.status === 'FAILED')) {
    return done('PASSED_WITH_WARNINGS')
  }
  return done('PASSED')
}

const SEVERITY_ORDER: Severity[] = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO']

/** Sort order for Report Findings (AD-15): severity, disposition, path, start line, fingerprint. */
export function compareFindings(a: Finding, b: Finding): number {
  return (
    SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
    (a.disposition === 'ADVISORY' ? 1 : 0) - (b.disposition === 'ADVISORY' ? 1 : 0) ||
    (a.location.path ?? '').localeCompare(b.location.path ?? '') ||
    (a.location.startLine ?? 0) - (b.location.startLine ?? 0) ||
    (a.fingerprint ?? '').localeCompare(b.fingerprint ?? '')
  )
}

/** Human-readable Markdown rendering of a Report (core renderer, AD-15). */
export function renderMarkdown(report: Report): string {
  const out: string[] = []
  const ref = `${report.run.repo.fullName}#${report.run.pr}`
  out.push(`# PR review: ${ref}${report.title ? ` — ${report.title}` : ''}`, '')
  out.push(`**Overall: ${report.overallStatus}**  ·  head \`${report.run.headSha?.slice(0, 7) ?? '?'}\``, '')
  out.push(`> ${report.coverage.headline}`, '')
  if (report.gate.failedRules.length > 0) out.push('## Gate', ...report.gate.failedRules.map((r) => `- ${r}`), '')

  out.push('## Checks', '', '| Layer | Validator | Status | Detail |', '|---|---|---|---|')
  for (const l of report.layers) out.push(`| ${l.layer} | ${l.validator} | ${l.status}${l.reason ? ` (${l.reason})` : ''} | ${(l.detail ?? '').replace(/\|/g, '\\|')} |`)
  out.push('')

  out.push(`## Findings (${report.findings.length})`, '')
  if (report.findings.length === 0) out.push('No findings.', '')
  for (const f of report.findings) {
    const where = f.location.path ? `\`${f.location.path}${f.location.startLine ? `:${f.location.startLine}` : ''}\`` : 'whole PR'
    const tags = [f.sourceFamily + (f.provenance.model ? ` (${f.provenance.model})` : ''), `confidence ${f.confidence}`, f.scope]
    if (f.disposition === 'ADVISORY') tags.push('advisory')
    if (f.dismissed) tags.push('dismissed')
    out.push(`### ${f.severity} · ${f.category} · ${f.title}`, `${where} · ${tags.join(' · ')}`, '', f.description)
    if (f.impact) out.push('', `**Impact:** ${f.impact}`)
    if (f.recommendation) out.push('', `**Recommendation:** ${f.recommendation}`)
    out.push('')
  }
  if (report.ai) {
    for (const a of report.ai.attempts) {
      const u = a.usage
      out.push(`_AI: ${a.provider} ${a.model} ${a.outcome}${u ? `, ${u.input ?? '?'} input / ${u.output ?? '?'} output tokens` : ''}._`)
    }
    const d = report.ai.droppedFindings
    if (d.schema + d.grounding > 0) out.push(`_${d.grounding} AI finding(s) dropped for locations outside the Head Commit._`)
  }
  if (report.rulesChecklist.length > 0) {
    out.push('', `## Review Rules checked (${report.rulesChecklist.length})`, ...report.rulesChecklist.map((r) => `- ${r}`))
  }
  if (report.limitations.length > 0) out.push('', '## Limitations', ...report.limitations.map((n) => `- ${n}`))
  return `${out.join('\n')}\n`
}
