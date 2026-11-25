import { runAiReview, type CostLimits, type ProviderCandidate, type ReviewProvider, type UsageLedger } from './ai-review.js'
import { hashObject, uuidv7 } from './canonical.js'
import { parsePatch } from './diff.js'
import { detectProjects, type ProjectInfo } from './detect.js'
import { runEventEmitter, type EventSink } from './events.js'
import { createFileAccessor } from './files.js'
import { filterPaths, parseRepoConfig, REPO_CONFIG_PATH, REPO_RULES_DIR, type RepoSettings } from './repo-config.js'
import { parseRulesChecklist } from './rules.js'
import { executeValidators, type AdvisoryPort, type CachePort, type SandboxPort, type SandboxStep, type Validator, type ValidatorContext } from './validator.js'
import { applyDismissals, ownInlineComments, readDismissals } from './feedback.js'
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
  /** Provider order (AD-8): the first is the primary, the rest are fallbacks. Takes precedence over `provider`. */
  providers?: readonly ProviderCandidate[] | undefined
  /** A single provider (shorthand for a one-entry order). Absent with no `providers`: the AI layer is SKIPPED. */
  provider?: ReviewProvider | undefined
  /** Why no provider is available, shown in the Report. */
  providerUnavailableReason?: string | undefined
  /** Local usage record for monthly ceilings and stats (FR-12). */
  ledger?: UsageLedger | undefined
  /** The Validator registry (AD-5); the secret scan runs separately. */
  validators?: readonly Validator[] | undefined
  sandbox?: SandboxPort | undefined
  advisories?: AdvisoryPort | undefined
  cache?: CachePort | undefined
  /** Engine-owned dependency install steps for the Sandbox. */
  installSteps?: ((ctx: ValidatorContext) => SandboxStep[]) | undefined
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
  /** Notes from earlier stages (e.g. unreadable Review Rules) to report as limitations. */
  limitations?: readonly string[]
  onLayer?: ((layer: LayerResult) => void) | undefined
  /** Spending limits for metered providers (FR-12). */
  costLimits?: CostLimits | undefined
  /** Validator ids the user turned off. */
  disabledValidators?: readonly string[] | undefined
  /** Hosts Sandbox installs may reach (user config only; AD-7). */
  sandboxRegistries?: readonly string[] | undefined
  /** Run id to use (a remote engine assigns it before the run starts); defaults to a new UUIDv7. */
  runId?: string | undefined
  /** Receives the run's progress events (AD-16). */
  onEvent?: EventSink | undefined
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
  return (await runReviewWithContext(input, ports)).report
}

/** Like `runReview`, also returning the PR context the Report was built from (used to plan a publish). */
export async function runReviewWithContext(input: ReviewInput, ports: EnginePorts): Promise<{ report: Report; context?: PrContext }> {
  const startedAt = ports.now()
  const runId = input.runId ?? uuidv7(startedAt)
  const emit = runEventEmitter(runId, ports.now, input.onEvent)
  const layers: LayerResult[] = []
  const limitations: string[] = [...(input.limitations ?? [])]
  const record = (l: LayerResult) => {
    layers.push(l)
    input.onLayer?.(l)
    emit('LAYER_STATUS', { layer: l.layer, validator: l.validator, status: l.status, ...(l.reason ? { reason: l.reason } : {}), ...(l.detail ? { detail: l.detail } : {}) })
  }
  const finish = async (a: Omit<Parameters<typeof assemble>[0], 'input' | 'ports' | 'startedAt' | 'configHash' | 'runId'>): Promise<Report> => {
    emit('STAGE_STARTED', { stage: 'gate' })
    const report = await assemble({ input, ports, startedAt, configHash, runId, ...a })
    emit('STAGE_FINISHED', { stage: 'gate' })
    emit('DONE', { overallStatus: report.overallStatus, findings: report.findings.length })
    return report
  }
  const configHash = await computeConfigHash(input.review)

  emit('STAGE_STARTED', { stage: 'fetchContext', pr: `${input.ref.owner}/${input.ref.repo}#${input.ref.number}` })
  const t0 = ports.now()
  const ctxRes = await fetchContext(ports.github, input.ref, input.limits ?? DEFAULT_CONTEXT_LIMITS)
  if (!ctxRes.ok) {
    record({ layer: 'CONTEXT', validator: 'github.context', status: 'ERROR', reason: 'TOOL_CRASHED', detail: ctxRes.error.message, durationMs: elapsed(ports, t0) })
    emit('STAGE_FINISHED', { stage: 'fetchContext', ok: false })
    return { report: await finish({ layers, findings: [], limitations, redactions: 0 }) }
  }
  const ctx = ctxRes.value
  record({ layer: 'CONTEXT', validator: 'github.context', status: 'PASSED', durationMs: elapsed(ports, t0) })
  emit('STAGE_FINISHED', { stage: 'fetchContext', ok: true, title: ctx.title, headSha: ctx.headSha, files: ctx.files.length })
  limitations.push(...ctx.truncated)

  // Repository settings and rules, read at exactly the base commit: a PR cannot change its own review (AD-13).
  const repoRef = { host: input.ref.host, owner: input.ref.owner, repo: input.ref.repo }
  const repoConfig = await readRepoConfig(ports.github, repoRef, ctx.baseSha)
  limitations.push(...repoConfig.warnings)
  if (repoConfig.ignored.length) limitations.push(`Repository settings ignored (not allowed in ${REPO_CONFIG_PATH}): ${repoConfig.ignored.join(', ')}.`)
  const repoSettings = repoConfig.settings
  if (repoSettings.paths) {
    const kept = new Set(filterPaths(ctx.files.map((f) => f.path), repoSettings.paths))
    const dropped = ctx.files.length - kept.size
    if (dropped > 0) {
      ctx.files = ctx.files.filter((f) => kept.has(f.path))
      limitations.push(`${dropped} changed file(s) excluded by the repository's path settings.`)
    }
  }
  const repoRules = [...(repoSettings.reviewRules ?? []), ...repoConfig.rules]

  // detect (FR-3)
  emit('STAGE_STARTED', { stage: 'detect' })
  const files = createFileAccessor(ports.github, repoRef, { HEAD: ctx.headSha, BASE: ctx.mergeBaseSha })
  const detected = await detectProjects(files, ctx.files.map((f) => f.path))
  limitations.push(...detected.notes)
  const checks = await ports.github.listCheckResults(repoRef, ctx.headSha)
  if (!checks.ok) limitations.push(`CI results could not be read: ${checks.error.message}`)
  emit('STAGE_FINISHED', { stage: 'detect', projects: detected.projects.map((p) => ({ path: p.path || '.', language: p.language, frameworks: p.frameworks.map((f) => `${f.name} ${f.version ?? f.declared ?? '?'}`) })) })

  // plan + execute Validators (AD-5): parallel, time-limited, Sandbox only for repository tools.
  emit('STAGE_STARTED', { stage: 'validate' })
  const executed = await executeValidators(
    ports.validators ?? [],
    { pr: ctx, files, projects: detected.projects, checks: checks.ok ? checks.value : [], repoSettings, sandbox: new Map() },
    { advisories: ports.advisories, now: ports.now },
    {
      sandbox: ports.sandbox,
      cache: ports.cache,
      cacheNamespace: await hashObject({ rid: input.reviewerId ?? null, repoId: ctx.repoId ?? null, repo: `${input.ref.owner}/${input.ref.repo}`.toLowerCase() }),
      disabled: input.disabledValidators,
      archive: () => ports.github.downloadArchive(repoRef, ctx.headSha),
      installSteps: ports.installSteps,
      registries: input.sandboxRegistries,
      onLayer: record,
    },
  )
  limitations.push(...executed.notes)
  emit('STAGE_FINISHED', { stage: 'validate', findings: executed.findings.length, ...(executed.sandbox ? { sandbox: true } : {}) })

  // execute (deterministic and file-only Validators)
  emit('STAGE_STARTED', { stage: 'execute' })
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
  emit('STAGE_FINISHED', { stage: 'execute' })

  // redact → review
  const aiFindings: Finding[] = []
  let ai: Report['ai']
  const redacted = redactContext(ctx, scan)
  if (!redacted.ok) {
    record({ layer: 'AI_REVIEW', validator: 'ai.review', status: 'SKIPPED', reason: 'SECRET_SCAN_UNAVAILABLE', detail: redacted.error.message, durationMs: 0 })
  } else {
    const candidates: ProviderCandidate[] = ports.providers
      ? [...ports.providers]
      : [{ name: ports.provider?.id ?? 'anthropic', provider: ports.provider, unavailableReason: ports.providerUnavailableReason ?? 'No AI Provider is configured.', model: input.review?.model }]
    const first = candidates.find((c) => c.provider)
    if (first) emit('STAGE_STARTED', { stage: 'review', provider: first.name, ...(first.model ? { model: first.model } : {}) })
    const outcome = await runAiReview(redacted.value, candidates, {
      deterministicFindings: scan.findings,
      rules: input.review?.rules ?? [],
      repoRules,
      now: ports.now,
      channel: input.channel,
      limits: input.costLimits,
      ledger: ports.ledger,
    })
    record(outcome.layer)
    aiFindings.push(...outcome.findings)
    limitations.push(...outcome.notes)
    if (outcome.attempts.length > 0) {
      ai = { attempts: outcome.attempts, droppedFindings: { schema: 0, grounding: outcome.dropped }, partial: outcome.partial }
    }
    if (first) emit('STAGE_FINISHED', { stage: 'review', status: outcome.layer.status, ...(outcome.provider ? { provider: outcome.provider, model: outcome.model } : {}) })
  }

  emit('STAGE_STARTED', { stage: 'dedupe' })
  const headPaths = new Set(((await files.list('HEAD')) ?? []).map((e) => e.path))
  const normalized = normalize(ctx, [...scan.findings, ...executed.findings, ...aiFindings], headPaths)
  let deduped = await dedupe(ctx, normalized)

  // Finding feedback (FR-20b, AD-11): only knowable when the Reviewer Identity is known.
  if (input.reviewerId !== undefined) {
    const feedback = await readFeedback(ports.github, input.ref, input.reviewerId, ctx.author)
    if (feedback.ok) deduped = applyDismissals(deduped, feedback.dismissals)
    else limitations.push(`Finding feedback could not be read: ${feedback.reason}`)
  }
  emit('STAGE_FINISHED', { stage: 'dedupe' })
  emit('FINDING_COUNT', { count: deduped.length, dismissed: deduped.filter((f) => f.dismissed).length })
  const report = await finish({
    ctx,
    layers,
    findings: deduped,
    limitations,
    redactions: scan.values.length,
    ...(ai ? { ai } : {}),
    projects: detected.projects,
    repo: { sha: ctx.baseSha, settings: repoSettings, ignored: repoConfig.ignored, rules: repoRules },
    ...(executed.sandbox ? { sandbox: executed.sandbox } : {}),
  })
  return { report, context: ctx }
}

async function readFeedback(
  github: GitHubReader,
  ref: PrRef,
  rid: number,
  prAuthor: string,
): Promise<{ ok: true; dismissals: ReturnType<typeof readDismissals> } | { ok: false; reason: string }> {
  const published = await github.listPublished(ref)
  if (!published.ok) return { ok: false, reason: published.error.message }
  const own = ownInlineComments(published.value, rid, FPV)
  const thumbs = new Map<number, string[]>()
  let next = 0
  let failure: string | undefined
  const worker = async () => {
    while (next < own.length) {
      const c = own[next++]!
      const res = await github.listThumbsDown(ref, c.id)
      if (res.ok) thumbs.set(c.id, res.value)
      else failure = res.error.message
    }
  }
  await Promise.all(Array.from({ length: Math.min(5, own.length) }, worker))
  if (failure) return { ok: false, reason: failure }
  return { ok: true, dismissals: readDismissals(published.value, rid, FPV, prAuthor, thumbs) }
}

function elapsed(ports: EnginePorts, since: number): number {
  return Math.max(0, Math.round(ports.now() - since))
}

/** Stage `normalize` (AD-12): core alone assigns scope, sets commitSha, and marks LOW-confidence AI advisory. */
export function normalize(ctx: PrContext, findings: readonly Finding[], headPaths?: ReadonlySet<string>): Finding[] {
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
        // Without a baseline run, a Finding that doesn't touch the change is PRE_EXISTING (AD-12).
        scope = touched ? 'NEW' : 'PRE_EXISTING'
      }
    } else if (loc.path && headPaths?.has(loc.path)) {
      // In the Head Commit but not in a changed file: it was there before this PR.
      scope = 'PRE_EXISTING'
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
  runId: string
  ctx?: PrContext
  layers: LayerResult[]
  findings: Finding[]
  limitations: string[]
  redactions: number
  ai?: Report['ai']
  projects?: ProjectInfo[]
  repo?: { sha: string; settings: RepoSettings; ignored: string[]; rules: string[] }
  sandbox?: { planHash: string; imageDigest: string; ran: boolean }
}): Promise<Report> {
  const { input, ctx } = a
  const gate = evaluateGate(a.layers, a.findings, {
    ...(input.mandatoryLayers ? { mandatory: input.mandatoryLayers } : {}),
    ...(a.repo?.settings.thresholds?.failOn ? { failOn: a.repo.settings.thresholds.failOn } : {}),
  })
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
      id: a.runId,
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
    rulesChecklist: [...(input.review?.rules ?? []), ...(a.repo?.rules ?? []).map((r) => `(repository) ${r}`)],
    ...(a.projects ? { projects: a.projects } : {}),
    ...(a.sandbox ? { sandbox: a.sandbox } : {}),
    audit: {
      configSources: input.configSources ?? {},
      foreignMarkers: 0,
      redactions: a.redactions,
      ...(a.repo ? { repoConfig: { sha: a.repo.sha, settings: a.repo.settings, ignored: a.repo.ignored } } : {}),
    },
  })
}

/** Reads `.github/pr-reviewer.yml` and `.github/pr-reviewer/rules/*.md` at exactly `sha` (AD-13). */
async function readRepoConfig(
  github: GitHubReader,
  repo: { host: string; owner: string; repo: string },
  sha: string,
): Promise<ReturnType<typeof parseRepoConfig> & { rules: string[] }> {
  const text = await github.readFile(repo, REPO_CONFIG_PATH, sha)
  const parsed = text.ok ? parseRepoConfig(text.value) : { settings: {} as RepoSettings, ignored: [], warnings: [`${REPO_CONFIG_PATH} could not be read: ${text.error.message}`] }
  const rules: string[] = []
  const names = await github.listDirectory(repo, REPO_RULES_DIR, sha)
  if (names.ok) {
    for (const name of names.value.filter((n) => n.endsWith('.md')).slice(0, 20)) {
      const body = await github.readFile(repo, `${REPO_RULES_DIR}${name}`, sha)
      if (body.ok && body.value) rules.push(...parseRulesChecklist(body.value))
      else parsed.warnings.push(`Repository rules file ${REPO_RULES_DIR}${name} could not be read.`)
    }
  } else parsed.warnings.push(`Repository rules could not be listed: ${names.error.message}`)
  return { ...parsed, rules: rules.slice(0, 200) }
}
