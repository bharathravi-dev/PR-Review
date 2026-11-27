import * as z from 'zod'
import { hashObject } from './canonical.js'
import type { ProjectInfo } from './detect.js'
import type { FileAccessor } from './files.js'
import { Finding, LayerId, LayerStatus, ReasonCode, type LayerResult } from './findings.js'
import type { CheckResult } from './ports.js'
import type { RepoSettings } from './repo-config.js'
import type { Result } from './result.js'
import type { PrContext } from './schemas.js'

// ── Sandbox port (AD-7) ──────────────────────────────────────────────────

/** Hosts INSTALL may reach by default: the npm registry and Yarn's mirror of it (Yarn lockfiles point there). */
export const DEFAULT_REGISTRIES: readonly string[] = ['registry.npmjs.org', 'registry.yarnpkg.com']

/** Toolchains the Sandbox runs (language-specific checks); node is the default. */
export type SandboxRuntime = 'node' | 'java' | 'python' | 'go'

/** Hosts each non-Node toolchain's install may reach: its own package registries only. */
export const RUNTIME_REGISTRIES: Readonly<Record<Exclude<SandboxRuntime, 'node'>, readonly string[]>> = {
  java: ['repo.maven.apache.org', 'repo1.maven.org', 'plugins.gradle.org', 'services.gradle.org', 'downloads.gradle.org', 'downloads.gradle-dn.com', 'jcenter.bintray.com', 'maven.google.com', 'dl.google.com'],
  python: ['pypi.org', 'files.pythonhosted.org'],
  go: ['proxy.golang.org', 'sum.golang.org', 'storage.googleapis.com'],
}

/** One command in the Sandbox. INSTALL may reach only the package registries; ANALYZE has no network. */
export interface SandboxStep {
  /** `<validator id>:<name>`; results are routed back by this id. */
  id: string
  phase: 'INSTALL' | 'ANALYZE'
  /** argv; no shell unless the command itself is `sh -c` written by product code. */
  cmd: string[]
  /** Working directory relative to the checkout root. */
  cwd: string
  timeoutMs: number
}

export interface SandboxPlan {
  /** Node major for the toolchain image. */
  nodeMajor: number
  /** The toolchain image (default node, chosen by nodeMajor). */
  runtime?: SandboxRuntime | undefined
  /** Hosts INSTALL may reach. */
  registries: string[]
  steps: SandboxStep[]
}

export interface SandboxStepResult {
  id: string
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  durationMs: number
  /** Set when the step was not run (e.g. its install failed). */
  skipped?: string | undefined
}

export interface SandboxRunResult {
  planHash: string
  headSha: string
  imageDigest: string
  results: SandboxStepResult[]
}

/** Shape check for Sandbox results crossing a job boundary (Auto-Review, AD-14); size-capped per field. */
export const SandboxRunResultSchema = z.object({
  planHash: z.string().max(128),
  headSha: z.string().max(128),
  imageDigest: z.string().max(256),
  results: z
    .array(
      z.object({
        id: z.string().max(500),
        exitCode: z.number().int().nullable(),
        stdout: z.string().max(10 * 1024 * 1024),
        stderr: z.string().max(10 * 1024 * 1024),
        timedOut: z.boolean(),
        durationMs: z.number(),
        skipped: z.string().max(2000).optional(),
      }),
    )
    .max(200),
})

export interface SandboxPort {
  /** Whether a container runtime (or user-approved host fallback) is usable, and which Node majors it carries. */
  probe(): Promise<Result<{ runtime: string; nodeMajors: number[]; egressControl: boolean; hostFallback?: boolean | undefined }>>
  /** Runs the plan on the head source archive; never sees a Credential (AD-7). */
  run(plan: SandboxPlan, planHash: string, source: { headSha: string; archive: Uint8Array }): Promise<Result<SandboxRunResult>>
}

// ── Advisory port (FR-4 dependencies) ────────────────────────────────────

export interface Advisory {
  id: string
  summary: string
  /** CRITICAL, HIGH, MODERATE, LOW, or undefined when the database gives none. */
  severity?: string | undefined
  aliases: string[]
  url?: string | undefined
  fixedIn?: string | undefined
}

/** Package ecosystems supported by AdvisoryPort / OSV queries. */
export type AdvisoryEcosystem = 'npm' | 'Maven' | 'PyPI' | 'Go'

export interface AdvisoryPort {
  readonly source: string
  query(packages: Array<{ ecosystem: AdvisoryEcosystem; name: string; version: string }>): Promise<Result<Array<{ name: string; version: string; advisories: Advisory[] }>>>
}

// ── SonarQube API port ──────────────────────────────────────────────────

export interface SonarIssue {
  key: string
  rule: string
  severity: string
  message: string
  component: string
  line?: number | undefined
  type?: string | undefined
}

export interface SonarReport {
  qualityGateStatus: 'OK' | 'WARN' | 'ERROR' | 'NONE'
  conditions?: Array<{ metricKey: string; status: string; actualValue?: string; errorThreshold?: string }> | undefined
  issues: SonarIssue[]
  url?: string | undefined
}

export interface SonarPort {
  readonly hostUrl: string
  readonly defaultProjectKey?: string | undefined
  fetchPullRequest(opts: { projectKey: string; pullRequest: number; branch?: string }): Promise<Result<SonarReport>>
}

// ── Cache port (AD-26) ──────────────────────────────────────────────────

/** Values are untrusted and re-parsed with their schema on read. */
export interface CachePort {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
}

// ── Validator contract (AD-5) ────────────────────────────────────────────

export interface ValidatorContext {
  pr: PrContext
  files: FileAccessor
  projects: ProjectInfo[]
  /** CI results on the Head Commit (FR-5). */
  checks: CheckResult[]
  repoSettings: RepoSettings
  /** This Validator's Sandbox step results, by step id (Sandbox Validators only). */
  sandbox: ReadonlyMap<string, SandboxStepResult>
}

export interface ValidatorPorts {
  advisories?: AdvisoryPort | undefined
  sonar?: SonarPort | undefined
  now: () => number
}

/** One layer's outcome from a Validator. Statuses other than PASSED/WARNING/FAILED carry a reason (AD-5). */
export const LayerOutcome = z.object({
  layer: LayerId,
  status: LayerStatus,
  reason: ReasonCode.optional(),
  detail: z.string().optional(),
  /** Overrides the Validator id shown for this row (e.g. one row per CI check). */
  validator: z.string().optional(),
})
export type LayerOutcome = z.infer<typeof LayerOutcome>

export const ValidatorResult = z.object({
  layers: z.array(LayerOutcome),
  findings: z.array(Finding),
  tool: z.string().optional(),
  toolVersion: z.string().optional(),
})
export type ValidatorResult = z.infer<typeof ValidatorResult>

export type Applicability = { applicable: true } | { applicable: false; reason: z.infer<typeof ReasonCode>; detail: string }

export interface Validator {
  id: string
  version: string
  layers: readonly LayerId[]
  /** True for any Validator that runs a tool resolving config, plugins, or dependencies from the repository. */
  needsSandbox: boolean
  /** Also runs on the merge-base tree to classify pre-existing Findings (not used yet; AD-12 fallback applies). */
  baseline: boolean
  /** True when the result depends only on `inputs` (cache key uses their blob SHAs). */
  hermetic: boolean
  /** Off unless the repository or user turns it on. */
  optional?: boolean
  /** Results may be reused across runs (AD-12). Off for anything that changes over time for the same commit (CI, advisories). */
  cacheable?: boolean
  supports(ctx: ValidatorContext): Applicability
  /** Repository paths the result depends on (hermetic Validators). */
  inputs?(ctx: ValidatorContext): string[]
  /** Commands to run in the Sandbox (Sandbox Validators). */
  sandboxSteps?(ctx: ValidatorContext): SandboxStep[]
  /** The toolchain its steps need (default node); each toolchain runs as its own Sandbox session. */
  runtime?: SandboxRuntime | undefined
  run(ctx: ValidatorContext, ports: ValidatorPorts): Promise<ValidatorResult>
}

export interface ExecuteOptions {
  concurrency?: number | undefined
  /** Per-Validator time limit for `run` (Sandbox time is limited per step). */
  timeoutMs?: number | undefined
  sandbox?: SandboxPort | undefined
  cache?: CachePort | undefined
  /** Cache namespace: H({rid, repoId}) so caches never cross users or repositories (NFR-11). */
  cacheNamespace?: string | undefined
  /** Validators the user config turned off. */
  disabled?: readonly string[] | undefined
  /** Optional validators enabled in user config (merged with repo config's validators.enable). */
  enabled?: readonly string[] | undefined
  /** Hosts dependency installs may reach (AD-7; default registry.npmjs.org). */
  registries?: readonly string[] | undefined
  /** Downloads the head source archive for the Sandbox (trusted code, AD-6); called only when a Sandbox runs. */
  archive?: (() => Promise<Result<Uint8Array>>) | undefined
  /** Install step builder: the engine owns installs (one per project). */
  installSteps?: ((ctx: ValidatorContext) => SandboxStep[]) | undefined
  onLayer?: ((l: LayerResult) => void) | undefined
}

export interface ExecuteOutcome {
  layers: LayerResult[]
  findings: Finding[]
  notes: string[]
  sandbox?: { planHash: string; imageDigest: string; ran: boolean; hostFallback?: boolean | undefined } | undefined
}

const usable = (r: Applicability): r is { applicable: true } => r.applicable

/**
 * Stages `plan` + `execute` (AD-3, AD-5, FR-4): runs every applicable Validator — Sandbox steps first, in one
 * Sandbox session — then each Validator's `run` in parallel with a concurrency limit and a time limit. A crash is
 * ERROR, a timeout TIMEOUT, and one failing Validator never stops the others. Without a Sandbox, Sandbox Validators
 * are SKIPPED (NO_SANDBOX) without being called.
 */
export async function executeValidators(validators: readonly Validator[], ctx: ValidatorContext, ports: ValidatorPorts, opts: ExecuteOptions = {}): Promise<ExecuteOutcome> {
  const now = ports.now
  const layers: LayerResult[] = []
  const findings: Finding[] = []
  const notes: string[] = []
  const record = (l: LayerResult) => {
    layers.push(l)
    opts.onLayer?.(l)
  }
  const rows = (v: Validator, status: LayerResult['status'], reason: LayerResult['reason'], detail: string) => {
    for (const layer of v.layers) record({ layer, validator: v.id, status, ...(reason ? { reason } : {}), detail, durationMs: 0 })
  }

  const enabled = new Set([...(ctx.repoSettings.validators?.enable ?? []), ...(opts.enabled ?? [])])
  const active: Validator[] = []
  for (const v of validators) {
    if (opts.disabled?.includes(v.id)) {
      rows(v, 'SKIPPED', 'DISABLED_BY_CONFIG', 'Turned off in the user config.')
      continue
    }
    if (v.optional && !enabled.has(v.id)) continue
    let s: Applicability
    try {
      s = v.supports(ctx)
    } catch (e) {
      rows(v, 'ERROR', 'TOOL_CRASHED', `supports() failed: ${(e as Error).message}`)
      continue
    }
    if (!usable(s)) rows(v, 'NOT_APPLICABLE', s.reason, s.detail)
    else active.push(v)
  }

  // Cache lookup (AD-12): exact key match only.
  const cached = new Map<string, ValidatorResult>()
  const keys = new Map<string, string>()
  if (opts.cache) {
    for (const v of active.filter((x) => x.cacheable)) {
      const key = await cacheKey(v, ctx, opts.cacheNamespace ?? 'default')
      if (!key) continue
      keys.set(v.id, key)
      const hit = ValidatorResult.safeParse(await opts.cache.get(key).catch(() => undefined))
      if (hit.success) cached.set(v.id, hit.data)
    }
  }

  // Sandbox: one session for every Sandbox Validator that needs a fresh result.
  const sandboxResults = new Map<string, SandboxStepResult>()
  const needSandbox = active.filter((v) => v.needsSandbox && !cached.has(v.id))
  const blocked = new Map<string, { reason: z.infer<typeof ReasonCode>; detail: string }>()
  let sandboxInfo: ExecuteOutcome['sandbox']
  let skipCacheForHostFallback = false
  if (needSandbox.length > 0) {
    const probe = opts.sandbox ? await opts.sandbox.probe() : undefined
    const nodeMajor = pickNodeMajor(ctx.projects, probe?.ok ? probe.value.nodeMajors : [])
    let block: { reason: z.infer<typeof ReasonCode>; detail: string } | undefined
    if (!opts.sandbox || !probe?.ok) {
      block = { reason: 'NO_SANDBOX', detail: `No Sandbox: ${probe && !probe.ok ? probe.error.message : 'Docker or Podman was not found'}. Build, compile, and lint checks were not run.` }
    } else if (!probe.value.egressControl && !probe.value.hostFallback) {
      block = { reason: 'NO_EGRESS_CONTROL', detail: 'Install could not be limited to the package registry, so it was not run.' }
    } else if (probe.value.hostFallback) {
      skipCacheForHostFallback = true
    }
    if (block) for (const v of needSandbox) blocked.set(v.id, block)
    else {
      // One Sandbox session per toolchain: Node (with the engine's installs) and each language's own image.
      const groups = new Map<SandboxRuntime, Validator[]>()
      for (const v of needSandbox) groups.set(v.runtime ?? 'node', [...(groups.get(v.runtime ?? 'node') ?? []), v])
      let archive: Result<Uint8Array> | undefined
      for (const [runtime, members] of [...groups].sort(([a], [b]) => (a === 'node' ? -1 : b === 'node' ? 1 : a.localeCompare(b)))) {
        if (runtime === 'node' && nodeMajor.major === undefined) {
          for (const v of members) blocked.set(v.id, { reason: 'UNSUPPORTED_RUNTIME', detail: `The project asks for Node ${nodeMajor.wanted}; the Sandbox has Node ${probe!.ok ? probe!.value.nodeMajors.join(', ') : '?'}.` })
          continue
        }
        const plan: SandboxPlan = {
          nodeMajor: nodeMajor.major ?? 24,
          ...(runtime !== 'node' ? { runtime } : {}),
          registries: runtime === 'node' ? (opts.registries?.length ? [...opts.registries] : [...DEFAULT_REGISTRIES]) : [...RUNTIME_REGISTRIES[runtime]],
          steps: [...(runtime === 'node' ? (opts.installSteps?.(ctx) ?? []) : []), ...members.flatMap((v) => v.sandboxSteps?.(ctx) ?? [])],
        }
        const planHash = await hashObject({ plan: plan as unknown as Record<string, unknown> })
        archive ??= opts.archive ? await opts.archive() : undefined
        if (!archive?.ok) {
          const why = archive && !archive.ok ? archive.error.message : 'no source archive available'
          for (const v of members) blocked.set(v.id, { reason: 'TOOL_CRASHED', detail: `The source could not be downloaded for the Sandbox: ${why}` })
          continue
        }
        const run = await opts.sandbox!.run(plan, planHash, { headSha: ctx.pr.headSha, archive: archive.value })
        if (!run.ok) for (const v of members) blocked.set(v.id, { reason: 'TOOL_CRASHED', detail: `The Sandbox failed: ${run.error.message}` })
        else if (run.value.planHash !== planHash || run.value.headSha !== ctx.pr.headSha) {
          for (const v of members) blocked.set(v.id, { reason: 'SANDBOX_OUTPUT_INVALID', detail: 'The Sandbox result did not match this run (plan or head commit).' })
        } else {
          for (const r of run.value.results) sandboxResults.set(r.id, r)
          sandboxInfo ??= { planHash, imageDigest: run.value.imageDigest, ran: true, ...(skipCacheForHostFallback ? { hostFallback: true } : {}) }
        }
      }
    }
  }

  // Run each Validator (parallel, limited, timed).
  const queue = [...active]
  const limit = Math.max(1, opts.concurrency ?? 4)
  const worker = async () => {
    for (let v = queue.shift(); v; v = queue.shift()) {
      const started = now()
      const hit = cached.get(v.id)
      if (hit) {
        absorb(v, hit, 0, ' (cached from an earlier run)')
        continue
      }
      const block = blocked.get(v.id)
      if (block) {
        rows(v, 'SKIPPED', block.reason, block.detail)
        continue
      }
      // A Validator sees its own steps and the engine's install steps.
      const own = new Map([...sandboxResults].filter(([id]) => id.startsWith(`${v.id}:`) || id.startsWith('install:')))
      try {
        const result = await withTimeout(v.run({ ...ctx, sandbox: own }, ports), opts.timeoutMs ?? 120_000)
        if (result === TIMED_OUT) {
          rows(v, 'TIMEOUT', 'TIME_LIMIT', `Did not finish within ${Math.round((opts.timeoutMs ?? 120_000) / 1000)}s.`)
          continue
        }
        const parsed = ValidatorResult.safeParse(result)
        if (!parsed.success) {
          rows(v, 'ERROR', 'SCHEMA_INVALID', 'The Validator returned an invalid result.')
          continue
        }
        absorb(v, parsed.data, Math.max(0, Math.round(now() - started)))
        const key = keys.get(v.id)
        if (key && opts.cache && !(v.needsSandbox && skipCacheForHostFallback) && parsed.data.layers.every((l) => l.status !== 'ERROR' && l.status !== 'TIMEOUT')) {
          await opts.cache.set(key, parsed.data).catch(() => notes.push(`The result of ${v.id} could not be cached.`))
        }
      } catch (e) {
        rows(v, 'ERROR', 'TOOL_CRASHED', `Crashed: ${(e as Error).message}`)
      }
    }
  }
  const absorb = (v: Validator, r: ValidatorResult, durationMs: number, suffix = '') => {
    for (const l of r.layers) {
      record({
        layer: l.layer,
        validator: l.validator ?? v.id,
        status: l.status,
        ...(l.reason ? { reason: l.reason } : {}),
        ...(l.detail || suffix ? { detail: `${l.detail ?? ''}${suffix}`.trim() } : {}),
        ...(r.tool ? { tool: r.tool } : {}),
        ...(r.toolVersion ? { toolVersion: r.toolVersion } : {}),
        durationMs,
      })
    }
    findings.push(...r.findings.map((f) => ({ ...f, scope: 'UNKNOWN' as const })))
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, active.length)) }, worker))
  return { layers, findings, notes, sandbox: sandboxInfo }
}

const TIMED_OUT = Symbol('timeout')
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: unknown
  return Promise.race([p, new Promise<typeof TIMED_OUT>((resolve) => (timer = setTimeout(() => resolve(TIMED_OUT), ms)))]).finally(() => clearTimeout(timer))
}

/** The Node major for the Sandbox: the first project's request if the image set has it, else the newest. */
function pickNodeMajor(projects: readonly ProjectInfo[], available: readonly number[]): { major?: number; wanted?: number } {
  const wanted = projects.find((p) => p.nodeMajor !== undefined)?.nodeMajor
  if (wanted === undefined) return available.length ? { major: Math.max(...available) } : {}
  return available.includes(wanted) ? { major: wanted, wanted } : { wanted }
}

/**
 * Validator cache key (AD-12): H({validator id and version, inputs}). Hermetic Validators key on the blob SHAs of
 * their declared inputs; others on the head tree SHA plus lockfile blob SHAs. Namespaced per user and repository.
 */
async function cacheKey(v: Validator, ctx: ValidatorContext, namespace: string): Promise<string | undefined> {
  const tree = await ctx.files.list('HEAD')
  if (!tree) return undefined
  const blob = new Map(tree.map((e) => [e.path, e.sha]))
  let inputs: Record<string, unknown>
  if (v.hermetic && v.inputs) {
    inputs = Object.fromEntries(v.inputs(ctx).map((p) => [p, blob.get(p) ?? null]))
  } else {
    const treeSha = await ctx.files.treeSha('HEAD')
    if (!treeSha) return undefined
    inputs = { tree: treeSha, locks: Object.fromEntries(ctx.projects.flatMap((p) => (p.lockfile ? [[p.lockfile, blob.get(p.lockfile) ?? null]] : []))) }
  }
  return hashObject({
    ns: namespace,
    validator: v.id,
    version: v.version,
    settings: { failOn: ctx.repoSettings.thresholds?.failOn ?? null },
    inputs,
  })
}
