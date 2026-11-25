import { runAiReview, type ReviewProvider } from './ai-review.js'
import { parsePatch } from './diff.js'
import { fetchContext } from './fetch-context.js'
import type { Finding, LayerId, LayerResult } from './findings.js'
import type { PrRef } from './pr-ref.js'
import type { GitHubReader } from './ports.js'
import { redactContext, type SecretScanOutcome } from './redact.js'
import { evaluateGate, Report, type OverallStatus } from './report.js'
import { DEFAULT_CONTEXT_LIMITS, type ContextLimits, type PrContext } from './schemas.js'

/** File-only secret scanner (a Validator for the SECURITY layer) that also yields values for `redact`. */
export type SecretScanner = (ctx: PrContext) => SecretScanOutcome & { findings: Finding[]; layer: LayerResult }

export interface EnginePorts {
  github: GitHubReader
  scanSecrets: SecretScanner
  /** Absent when no AI Provider is configured; the AI layer is then SKIPPED. */
  provider?: ReviewProvider | undefined
  /** Why no provider is available, shown in the Report. */
  providerUnavailableReason?: string | undefined
  /** SHA-256 of a string, lowercase hex (WebCrypto in both Node and browsers). */
  sha256: (text: string) => Promise<string>
  /** Milliseconds since the epoch. */
  now: () => number
}

export interface ReviewInput {
  ref: PrRef
  engineVersion: string
  channel: string
  limits?: ContextLimits
  rules?: readonly string[]
  mandatoryLayers?: readonly LayerId[]
  onLayer?: (layer: LayerResult) => void
}

/**
 * Runs the fixed pipeline (AD-3):
 * resolveConfig (caller) → fetchContext → detect → plan → execute → redact → review → normalize → dedupe → gate → assemble.
 * Always returns a Report; failures become Layer Statuses and an Overall Status, never exceptions.
 */
export async function runReview(input: ReviewInput, ports: EnginePorts): Promise<Report> {
  const startedAt = ports.now()
  const layers: LayerResult[] = []
  const notes: string[] = []
  const record = (l: LayerResult) => {
    layers.push(l)
    input.onLayer?.(l)
  }

  // fetchContext
  const t0 = ports.now()
  const ctxRes = await fetchContext(ports.github, input.ref, input.limits ?? DEFAULT_CONTEXT_LIMITS)
  if (!ctxRes.ok) {
    record({ layer: 'CONTEXT', validator: 'github.context', status: 'ERROR', reason: 'TOOL_CRASHED', detail: ctxRes.error.message, durationMs: elapsed(ports, t0) })
    return assemble(input, ports, startedAt, undefined, layers, [], notes)
  }
  const ctx = ctxRes.value
  record({ layer: 'CONTEXT', validator: 'github.context', status: 'PASSED', durationMs: elapsed(ports, t0) })
  notes.push(...ctx.truncated)

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
      layer: { layer: 'SECURITY', validator: 'secrets.builtin', status: 'ERROR', reason: 'TOOL_CRASHED', detail: (e as Error).message, durationMs: 0 },
    }
  }
  record(scan.layer)
  const deterministic = scan.findings

  // redact → review
  const aiFindings: Finding[] = []
  let ai: Report['ai']
  const redacted = redactContext(ctx, scan)
  if (!redacted.ok) {
    record({ layer: 'AI_REVIEW', validator: 'ai.review', status: 'SKIPPED', reason: 'DEPENDENCY_LAYER_FAILED', detail: redacted.error.message, durationMs: 0 })
  } else if (!ports.provider) {
    record({ layer: 'AI_REVIEW', validator: 'ai.review', status: 'SKIPPED', reason: 'PROVIDER_UNAVAILABLE', detail: ports.providerUnavailableReason ?? 'No AI Provider is configured.', durationMs: 0 })
  } else {
    const outcome = await runAiReview(redacted.value, ports.provider, {
      deterministicFindings: deterministic,
      rules: input.rules ?? [],
      now: ports.now,
    })
    record(outcome.layer)
    aiFindings.push(...outcome.findings)
    if (outcome.provider && outcome.model) {
      ai = { provider: outcome.provider, model: outcome.model, droppedFindings: outcome.dropped, ...(outcome.usage ? { usage: outcome.usage } : {}) }
    }
  }

  // normalize → dedupe
  const normalized = normalize(ctx, [...deterministic, ...aiFindings])
  const deduped = await dedupe(ctx, normalized, ports.sha256)

  return assemble(input, ports, startedAt, ctx, layers, deduped, notes, ai)
}

function elapsed(ports: EnginePorts, since: number): number {
  return Math.max(0, Math.round(ports.now() - since))
}

/** Stage `normalize`: core alone assigns scope (NEW / PRE_EXISTING / UNKNOWN) from the diff. */
export function normalize(ctx: PrContext, findings: readonly Finding[]): Finding[] {
  const added = new Map<string, Set<number>>()
  const status = new Map<string, string>()
  for (const f of ctx.files) {
    status.set(f.path, f.status)
    added.set(f.path, new Set(f.patch ? parsePatch(f.patch).added.map((a) => a.line) : []))
  }
  return findings.map((f) => {
    const loc = f.location
    let scope: Finding['scope'] = 'UNKNOWN'
    if (loc.anchorKind === 'PR') scope = 'NEW'
    else if (loc.path && status.has(loc.path)) {
      if (loc.anchorKind === 'FILE') scope = status.get(loc.path) === 'added' ? 'NEW' : 'UNKNOWN'
      else if (loc.startLine !== undefined) {
        const lines = added.get(loc.path) ?? new Set<number>()
        let touched = false
        for (let n = loc.startLine; n <= (loc.endLine ?? loc.startLine); n++) if (lines.has(n)) touched = true
        scope = touched ? 'NEW' : 'PRE_EXISTING'
      }
    }
    return { ...f, scope }
  })
}

const FAMILY_RANK: Record<Finding['sourceFamily'], number> = { DETERMINISTIC: 0, EXTERNAL: 1, AI: 2 }

/**
 * Stage `dedupe`: fingerprint = sha256 over [ruleId, path, whitespace-collapsed anchor lines ±2, source family]
 * (never line numbers, AD-12). Equal fingerprints merge, keeping the strongest evidence.
 */
export async function dedupe(ctx: PrContext, findings: readonly Finding[], sha256: (s: string) => Promise<string>): Promise<Finding[]> {
  const heads = new Map(ctx.files.map((f) => [f.path, f.head?.text?.split('\n')]))
  const out = new Map<string, Finding>()
  const sorted = [...findings].sort((a, b) => FAMILY_RANK[a.sourceFamily] - FAMILY_RANK[b.sourceFamily])
  for (const f of sorted) {
    const lines = f.location.path ? heads.get(f.location.path) : undefined
    let anchor = ''
    if (lines && f.location.startLine) {
      const from = Math.max(0, f.location.startLine - 3)
      const to = Math.min(lines.length, (f.location.endLine ?? f.location.startLine) + 2)
      anchor = lines.slice(from, to).map((l) => l.replace(/\s+/g, ' ').trim()).join('\n')
    }
    const fingerprint = await sha256(JSON.stringify([f.ruleId, f.location.path ?? '', f.location.anchorKind, anchor, f.sourceFamily]))
    if (!out.has(fingerprint)) out.set(fingerprint, { ...f, fingerprint })
  }
  return [...out.values()]
}

async function assemble(
  input: ReviewInput,
  ports: EnginePorts,
  startedAt: number,
  ctx: PrContext | undefined,
  layers: LayerResult[],
  findings: Finding[],
  notes: string[],
  ai?: Report['ai'],
): Promise<Report> {
  const gate = evaluateGate(layers, findings, input.mandatoryLayers)
  const repo = `${input.ref.owner}/${input.ref.repo}`
  const id = (await ports.sha256(`${input.ref.host}/${repo}#${input.ref.number}@${ctx?.headSha ?? ''}@${startedAt}`)).slice(0, 16)
  const overallStatus: OverallStatus = gate.result
  return Report.parse({
    schemaVersion: 1,
    run: {
      id,
      repo,
      pr: input.ref.number,
      host: input.ref.host,
      ...(ctx ? { baseSha: ctx.baseSha, headSha: ctx.headSha, mergeBaseSha: ctx.mergeBaseSha } : {}),
      engineVersion: input.engineVersion,
      channel: input.channel,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date(ports.now()).toISOString(),
    },
    ...(ctx ? { title: ctx.title } : {}),
    overallStatus,
    coverage: gate.coverage,
    layers,
    findings,
    gate: { result: gate.result, reasons: gate.reasons },
    ...(ai ? { ai } : {}),
    notes,
  })
}
