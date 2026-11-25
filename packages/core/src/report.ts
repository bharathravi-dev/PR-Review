import * as z from 'zod'
import { ProjectInfo } from './detect.js'
import { Finding, LayerId, LayerResult, LayerStatus, ReasonCode, Severity } from './findings.js'

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
  /** Which call: the review itself, or the verification pass over its findings. Absent means review. */
  stage: z.enum(['review', 'verify']).optional(),
  reason: z.string().optional(),
  /** METERED (billed per token) or PLAN (subscription through the vendor's CLI). */
  billing: z.enum(['METERED', 'PLAN']).optional(),
  usage: z
    .object({
      input: z.number().optional(),
      output: z.number().optional(),
      /** Estimated USD; from configured pricing, or as reported by the provider. */
      costUsd: z.number().optional(),
      costSource: z.enum(['PRICING', 'PROVIDER']).optional(),
    })
    .optional(),
})
export type AiAttempt = z.infer<typeof AiAttempt>

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
      droppedFindings: z.object({ schema: z.number().int(), grounding: z.number().int(), verification: z.number().int().optional() }),
      partial: z.boolean(),
    })
    .optional(),
  rulesChecklist: z.array(z.string()),
  /** The AI's overview of the PR (untrusted text). */
  walkthrough: z
    .object({
      summary: z.string(),
      files: z.array(z.object({ path: z.string(), change: z.string() })),
      effort: z.number().int().optional(),
      issues: z.array(z.object({ number: z.number().int(), repo: z.string(), title: z.string(), status: z.enum(['RESOLVED', 'PARTLY', 'NOT_RESOLVED', 'UNCLEAR']), note: z.string() })).optional(),
    })
    .optional(),
  /** What the repository's maintainers said about earlier comments, as given to the AI (untrusted text). */
  learnings: z
    .array(z.object({ kind: z.enum(['REMEMBER', 'DISMISSED']), text: z.string(), by: z.string(), pr: z.number().int(), url: z.string().optional() }))
    .optional(),
  /** Repository guidance files the review read at the base commit. */
  guidanceFiles: z.array(z.string()).optional(),
  /** Projects the PR touches, with their detected stack (FR-3). */
  projects: z.array(ProjectInfo).optional(),
  /** Present when repository tools ran in a Sandbox (AD-7). */
  sandbox: z.object({ planHash: z.string(), imageDigest: z.string(), ran: z.boolean() }).optional(),
  audit: z.object({
    configSources: z.record(z.string(), z.string()),
    foreignMarkers: z.number().int(),
    redactions: z.number().int(),
    /** Repository settings applied from the base commit, and keys that were ignored (AD-13). */
    repoConfig: z.object({ sha: z.string(), settings: z.record(z.string(), z.unknown()), ignored: z.array(z.string()) }).optional(),
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
  opts: { mandatory?: readonly LayerId[]; cancelled?: boolean; failOn?: Severity } = {},
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
  const noSandbox = layers.some((l) => l.reason === 'NO_SANDBOX')
  const coverage = { ran, notRun, headline: noSandbox ? `${headline} Build, compile, and lint were not run: no Sandbox (Docker or Podman).` : headline }
  const failedRules: string[] = []
  const done = (result: OverallStatus): GateResult => ({ result, failedRules, layerSummary, coverage })

  if (opts.cancelled) return done('CANCELLED')

  const mandatory = opts.mandatory ?? DEFAULT_MANDATORY_LAYERS
  for (const layer of mandatory) if (!ran.includes(layer)) failedRules.push(`Mandatory layer ${layer} did not run.`)
  if (failedRules.length > 0) {
    const contextFailed = layerSummary.some((s) => s.layer === 'CONTEXT' && s.status === 'ERROR')
    return done(contextFailed ? 'ERROR' : 'INCOMPLETE')
  }

  // A repository may make the gate stricter (failOn MAJOR or MINOR), never looser (AD-13).
  const order = Severity.options
  const failAt = opts.failOn && order.indexOf(opts.failOn) > order.indexOf('CRITICAL') ? order.indexOf(opts.failOn) : order.indexOf('CRITICAL')
  const blocking = (s: Severity) => BLOCKING.has(s) || order.indexOf(s) <= failAt
  const blockers = findings.filter(
    (f) => f.sourceFamily !== 'AI' && f.disposition !== 'ADVISORY' && !f.dismissed && blocking(f.severity) && COUNTED_SCOPES.has(f.scope),
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

export const ISSUE_STATUS = { RESOLVED: 'resolved', PARTLY: 'partly resolved', NOT_RESOLVED: 'not resolved', UNCLEAR: 'unclear' } as const

/** One line about an AI attempt: tokens and cost, honest about what is known (FR-12). */
export function describeAttempt(a: AiAttempt): string {
  const u = a.usage
  const parts = [`${a.stage === 'verify' ? 'verification: ' : ''}${a.provider} ${a.model} ${a.outcome}`]
  if (a.reason) parts.push(a.reason)
  if (u) parts.push(`${u.input ?? '?'} input / ${u.output ?? '?'} output tokens`)
  if (a.outcome === 'SUCCEEDED') {
    if (a.billing === 'PLAN') parts.push(`drawn from your plan's usage${u?.costUsd !== undefined ? ` (≈ $${u.costUsd.toFixed(2)} at list price, as reported)` : ''}`)
    else if (u?.costUsd !== undefined) parts.push(`≈ $${u.costUsd < 0.01 ? u.costUsd.toFixed(4) : u.costUsd.toFixed(2)}${u.costSource === 'PROVIDER' ? ' (reported by the provider)' : ''}`)
    else parts.push('cost not reported (set pricing for this provider to estimate it)')
  }
  return parts.join(', ')
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
  if (report.walkthrough) {
    const w = report.walkthrough
    out.push('## Walkthrough', '', w.summary, ...(w.effort ? ['', `Estimated review effort: ${w.effort}/5`] : []), '')
    if (w.issues?.length) out.push('Linked issues:', ...w.issues.map((i) => `- ${i.repo}#${i.number} ${i.title}: **${ISSUE_STATUS[i.status]}**. ${i.note}`), '')
    if (w.files.length) out.push('| File | Change |', '|---|---|', ...w.files.map((f) => `| \`${f.path}\` | ${f.change.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`), '')
  }
  if (report.gate.failedRules.length > 0) out.push('## Gate', ...report.gate.failedRules.map((r) => `- ${r}`), '')

  if (report.projects?.length) {
    out.push('## Projects', '')
    for (const p of report.projects) {
      const stack = p.support === 'best-effort' ? 'best-effort (unsupported technology)' : [p.language, ...p.frameworks.map((f) => `${f.name} ${f.version ?? f.declared ?? '?'} (${f.confidence.toLowerCase()} confidence)`)].join(', ')
      out.push(`- \`${p.path || '.'}\`: ${stack}${p.typescript?.version ? `, TypeScript ${p.typescript.version}` : ''} · ${p.changedFiles.length} changed file(s)`)
    }
    out.push('')
  }
  out.push('## Checks', '', '| Layer | Validator | Status | Detail |', '|---|---|---|---|')
  for (const l of report.layers.filter((x) => x.status !== 'NOT_APPLICABLE')) {
    out.push(`| ${l.layer} | ${l.validator} | ${l.status}${l.reason ? ` (${l.reason})` : ''} | ${(l.detail ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`)
  }
  const na = report.layers.filter((x) => x.status === 'NOT_APPLICABLE')
  if (na.length) out.push('', `_Not applicable: ${na.map((l) => `${l.validator} (${l.detail ?? l.reason ?? 'n/a'})`).join('; ')}_`)
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
    if (f.suggestion && !f.suggestion.includes('```')) out.push('', 'Suggested change:', '', '```', f.suggestion, '```')
    out.push('')
  }
  if (report.ai) {
    for (const a of report.ai.attempts) out.push(`_AI: ${describeAttempt(a)}._`)
    const d = report.ai.droppedFindings
    if (d.schema + d.grounding > 0) out.push(`_${d.grounding} AI finding(s) dropped for locations outside the Head Commit._`)
    if (d.verification) out.push(`_${d.verification} AI finding(s) dropped by the verification pass._`)
  }
  if (report.learnings?.length) {
    out.push('', `## Learned from this repository's feedback (${report.learnings.length})`, ...report.learnings.map((l) => `- ${l.kind === 'REMEMBER' ? 'Remember' : 'Dismissed'}: ${l.text.replace(/^Dismissed /, '')} (${l.by}, #${l.pr})`))
  }
  if (report.rulesChecklist.length > 0) {
    out.push('', `## Review Rules checked (${report.rulesChecklist.length})`, ...report.rulesChecklist.map((r) => `- ${r}`))
  }
  if (report.limitations.length > 0) out.push('', '## Limitations', ...report.limitations.map((n) => `- ${n}`))
  return `${out.join('\n')}\n`
}
