import { runAiReview, type ReviewProvider } from './ai-review.js'
import { hashObject, uuidv7 } from './canonical.js'
import { parsePatch } from './diff.js'
import { fetchContext } from './fetch-context.js'
import type { Finding, LayerId, LayerResult } from './findings.js'
import type { PrRef } from './pr-ref.js'
import type { GitHubReader } from './ports.js'
import { redactContext, type SecretScanOutcome } from './redact.js'
import { compareFindings, evaluateGate, FPV, Report, type Channel } from './report.js'
import { DEFAULT_CONTEXT_LIMITS, type ContextLimits, type PrContext } from './schemas.js'

/** File-only secret scanner (Validator for the SECRETS layer) that also yields values for `redact`. */
export type SecretScanner = (ctx: PrContext) => SecretScanOutcome & { findings: Finding[]; layer: LayerResult }

export interface EnginePorts {
  github: GitHubReader
  scanSecrets: SecretScanner
  /** Absent when no AI Provider is available; the AI layer is then SKIPPED. */
  provider?: ReviewProvider | undefined
  /** Why no provider is available, shown in the Report. */
  providerUnavailableReason?: string | undefined
  /** Milliseconds since the epoch. */
  now: () => number
}

/** The review-affecting projection of Configuration (AD-12 `affectsReview`). */
export interface ReviewSettings {
  provider?: string | undefined
  model?: string | undefined
  rules?: readonly string[] | undefined
}

export interface ReviewInput {
  ref: PrRef
  engineVersion: string
  channel: Channel
  review?: ReviewSettings
  /** Numeric GitHub id of the Reviewer Identity; enables the idempotency key (AD-11). */
  reviewerId?: number | undefined
  limits?: ContextLimits
  mandatoryLayers?: readonly LayerId[]
  configSources?: Record<string, string>
  onLayer?: (layer: LayerResult) => void
}

/** configHash = H(review-affecting settings, defaults omitted) (AD-12). */
export function computeConfigHash(review: ReviewSettings = {}): Promise<string> {
  return hashObject({ provider: review.provider, model: review.model, rules: review.rules?.length ? [...review.rules] : undefined })
}

/** idempotencyKey = H({host, repoId, pr, headSha, configHash, engineMajor, rid}) (AD-11). */
export function computeIdempotencyKey(k: {
  host: string
  repoId: number
  pr: number
  headSha: string
  configHash: string
  engineMajor: number
  rid: number
}): Promise<string> {
  return hashObject({ ...k })
}

/**
 * Runs the fixed pipeline (AD-3): fetchContext → detect → plan → execute → redact → review → normalize →
 * dedupe → gate → assemble. Always returns a Report; failures become Layer Statuses, never exceptions.
 */
export async function runReview(input: ReviewInput, ports: EnginePorts): Promise<Report> {
  const startedAt = ports.now()
  const layers: LayerResult[] = []
  const limitations: string[] = []
  const record = (l: LayerResult) => {
    layers.push(l)
    input.onLayer?.(l)
  }
  const configHash = await computeConfigHash(input.review)

  const t0 = ports.now()
  const ctxRes = await fetchContext(ports.github, input.ref, input.limits ?? DEFAULT_CONTEXT_LIMITS)
  if (!ctxRes.ok) {
    record({ layer: 'CONTEXT', validator: 'github.context', status: 'ERROR', reason: 'TOOL_CRASHED', detail: ctxRes.error.message, durationMs: elapsed(ports, t0) })
    return assemble({ input, ports, startedAt, configHash, layers, findings: [], limitations, redactions: 0 })
  }
  const ctx = ctxRes.value
  record({ layer: 'CONTEXT', validator: 'github.context', status: 'PASSED', durationMs: elapsed(ports, t0) })
  limitations.push(...ctx.truncated)

  // detect, plan: technology detection and Validator selection arrive with Epic 4.

  // execute (deterministic and file-only Validators)
  let scan: ReturnType<SecretScanner>
  try {
    scan = ports.scanSecrets(ctx)
  } catch (e) {
    scan = {
      completed: false,
      values: [],
      findings: [],
      layer: { layer: 'SECRETS', validator: 'secrets.builtin', status: 'ERROR', reason: 'TOOL_CRASHED', detail: (e as Error).message, durationMs: 0 },
    }
  }
  record(scan.layer)

  // redact → review
  const aiFindings: Finding[] = []
  let ai: Report['ai']
  const redacted = redactContext(ctx, scan)
  if (!redacted.ok) {
    record({ layer: 'AI_REVIEW', validator: 'ai.review', status: 'SKIPPED', reason: 'SECRET_SCAN_UNAVAILABLE', detail: redacted.error.message, durationMs: 0 })
  } else if (!ports.provider) {
    record({ layer: 'AI_REVIEW', validator: 'ai.review', status: 'SKIPPED', reason: 'PROVIDER_UNAVAILABLE', detail: ports.providerUnavailableReason ?? 'No AI Provider is configured.', durationMs: 0 })
  } else {
    const outcome = await runAiReview(redacted.value, ports.provider, {
      deterministicFindings: scan.findings,
      rules: input.review?.rules ?? [],
      now: ports.now,
    })
    record(outcome.layer)
    aiFindings.push(...outcome.findings)
    ai = {
      attempts: [
        {
          provider: outcome.provider ?? ports.provider.id,
          model: outcome.model ?? input.review?.model ?? 'unknown',
          outcome: outcome.layer.status === 'ERROR' ? 'FAILED' : 'SUCCEEDED',
          ...(outcome.layer.status === 'ERROR' && outcome.layer.detail ? { reason: outcome.layer.detail } : {}),
          ...(outcome.usage ? { usage: { input: outcome.usage.inputTokens, output: outcome.usage.outputTokens } } : {}),
        },
      ],
      droppedFindings: { schema: 0, grounding: outcome.dropped },
      partial: false,
    }
  }

  const normalized = normalize(ctx, [...scan.findings, ...aiFindings])
  const deduped = await dedupe(ctx, normalized)
  return assemble({ input, ports, startedAt, configHash, ctx, layers, findings: deduped, limitations, redactions: scan.values.length, ...(ai ? { ai } : {}) })
}

function elapsed(ports: EnginePorts, since: number): number {
  return Math.max(0, Math.round(ports.now() - since))
}

/** Stage `normalize` (AD-12): core alone assigns scope, sets commitSha, and marks LOW-confidence AI advisory. */
export function normalize(ctx: PrContext, findings: readonly Finding[]): Finding[] {
  const added = new Map<string, Set<number>>()
  const changed = new Set<string>()
  for (const f of ctx.files) {
    changed.add(f.path)
    added.set(f.path, new Set(f.patch ? parsePatch(f.patch).added.map((a) => a.line) : []))
  }
  return findings.map((f) => {
    const loc = f.location
    let scope: Finding['scope'] = 'UNKNOWN'
    if (loc.anchorKind === 'PR') scope = 'NEW'
    else if (loc.path && changed.has(loc.path)) {
      if (loc.anchorKind === 'FILE') scope = 'NEW'
      else if (loc.startLine !== undefined) {
        const lines = added.get(loc.path) ?? new Set<number>()
        let touched = false
        for (let n = loc.startLine; n <= (loc.endLine ?? loc.startLine); n++) if (lines.has(n)) touched = true
        // Without a baseline run (Epic 4), a Finding that doesn't touch the change is PRE_EXISTING.
        scope = touched ? 'NEW' : 'PRE_EXISTING'
      }
    }
    const disposition = f.sourceFamily === 'AI' && f.confidence === 'LOW' ? 'ADVISORY' : (f.disposition ?? 'GATING')
    return { ...f, scope, disposition, commitSha: ctx.headSha, location: { ...loc, ...(loc.anchorKind === 'LINE' ? { side: 'HEAD' as const } : {}) } }
  })
}

const FAMILY_RANK: Record<Finding['sourceFamily'], number> = { DETERMINISTIC: 0, EXTERNAL: 1, AI: 2 }

/**
 * Stage `dedupe` (AD-12): fingerprint = H({fpv, ruleId, path, anchorKind, anchor, sourceFamily, ordinal}),
 * never line numbers; equal fingerprints merge, keeping the strongest member and every fingerprint.
 */
export async function dedupe(ctx: PrContext, findings: readonly Finding[]): Promise<Finding[]> {
  const heads = new Map(ctx.files.map((f) => [f.path, f.head?.text?.replace(/\r\n/g, '\n').split('\n')]))
  const withAnchor = findings.map((f) => {
    const loc = f.location
    let anchor = loc.anchorKind === 'PR' ? '@pr' : '@file'
    if (loc.anchorKind === 'LINE' && loc.path && loc.startLine) {
      const lines = heads.get(loc.path) ?? []
      anchor = lines.slice(loc.startLine - 1, loc.endLine ?? loc.startLine).map((l) => l.replace(/\s+/g, ' ').trim()).join('\n')
    }
    return { f, anchor }
  })
  // ordinal: occurrence index among Findings equal on every other fingerprint field, by start line.
  const groups = new Map<string, typeof withAnchor>()
  for (const item of withAnchor) {
    const k = JSON.stringify([item.f.ruleId, item.f.location.path ?? '', item.f.location.anchorKind, item.anchor, item.f.sourceFamily])
    groups.set(k, [...(groups.get(k) ?? []), item])
  }
  const fingerprinted: Finding[] = []
  for (const group of groups.values()) {
    group.sort((a, b) => (a.f.location.startLine ?? 0) - (b.f.location.startLine ?? 0))
    for (const [ordinal, { f, anchor }] of group.entries()) {
      const fp = await hashObject({ fpv: FPV, ruleId: f.ruleId, path: f.location.path ?? '', anchorKind: f.location.anchorKind, anchor, sourceFamily: f.sourceFamily, ordinal })
      fingerprinted.push({ ...f, fingerprint: fp, fingerprints: [fp], id: fp })
    }
  }
  const out = new Map<string, Finding>()
  for (const f of fingerprinted.sort((a, b) => FAMILY_RANK[a.sourceFamily] - FAMILY_RANK[b.sourceFamily])) {
    const existing = out.get(f.fingerprint!)
    if (existing) existing.alsoReportedBy = [...(existing.alsoReportedBy ?? []), f.provenance.validator]
    else out.set(f.fingerprint!, f)
  }
  return [...out.values()].sort(compareFindings)
}

async function assemble(a: {
  input: ReviewInput
  ports: EnginePorts
  startedAt: number
  configHash: string
  ctx?: PrContext
  layers: LayerResult[]
  findings: Finding[]
  limitations: string[]
  redactions: number
  ai?: Report['ai']
}): Promise<Report> {
  const { input, ctx } = a
  const gate = evaluateGate(a.layers, a.findings, input.mandatoryLayers ? { mandatory: input.mandatoryLayers } : {})
  const engineMajor = Number(input.engineVersion.split('.')[0]) || 0
  const idempotencyKey =
    ctx && ctx.repoId !== undefined && input.reviewerId !== undefined
      ? await computeIdempotencyKey({
          host: input.ref.host,
          repoId: ctx.repoId,
          pr: input.ref.number,
          headSha: ctx.headSha,
          configHash: a.configHash,
          engineMajor,
          rid: input.reviewerId,
        })
      : undefined
  return Report.parse({
    schemaVersion: 1,
    run: {
      id: uuidv7(a.startedAt),
      ...(idempotencyKey ? { idempotencyKey } : {}),
      host: input.ref.host,
      repo: { ...(ctx?.repoId !== undefined ? { id: ctx.repoId } : {}), fullName: `${input.ref.owner}/${input.ref.repo}`.toLowerCase() },
      pr: input.ref.number,
      ...(ctx ? { baseSha: ctx.baseSha, headSha: ctx.headSha, mergeBaseSha: ctx.mergeBaseSha } : {}),
      configHash: a.configHash,
      engineVersion: input.engineVersion,
      fpv: FPV,
      channel: input.channel,
      startedAt: new Date(a.startedAt).toISOString(),
      finishedAt: new Date(a.ports.now()).toISOString(),
    },
    ...(ctx ? { title: ctx.title } : {}),
    overallStatus: gate.result,
    layers: a.layers,
    layerSummary: gate.layerSummary,
    coverage: gate.coverage,
    findings: a.findings,
    resolvedFingerprints: [],
    limitations: a.limitations,
    gate: { result: gate.result, failedRules: gate.failedRules },
    ...(a.ai ? { ai: a.ai } : {}),
    rulesChecklist: [...(input.review?.rules ?? [])],
    audit: { configSources: input.configSources ?? {}, foreignMarkers: 0, redactions: a.redactions },
  })
}
