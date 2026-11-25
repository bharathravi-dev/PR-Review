import * as z from 'zod'

/** Closed set of Validation Layers (AD-15 / layer enum). */
export const LayerId = z.enum([
  'CONTEXT',
  'SYNTAX',
  'COMPILE',
  'LINT',
  'FRAMEWORK',
  'STATIC_ANALYSIS',
  'SECURITY',
  'DEPENDENCIES',
  'TESTS',
  'EXTERNAL_RESULTS',
  'AI_REVIEW',
])
export type LayerId = z.infer<typeof LayerId>

export const LayerStatus = z.enum(['PASSED', 'FAILED', 'WARNING', 'SKIPPED', 'ERROR', 'TIMEOUT', 'NOT_APPLICABLE'])
export type LayerStatus = z.infer<typeof LayerStatus>

export const Severity = z.enum(['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO'])
export type Severity = z.infer<typeof Severity>

export const Confidence = z.enum(['HIGH', 'MEDIUM', 'LOW'])
export const Scope = z.enum(['NEW', 'WORSENED', 'PRE_EXISTING', 'UNKNOWN'])
export const SourceFamily = z.enum(['DETERMINISTIC', 'EXTERNAL', 'AI'])
export const AnchorKind = z.enum(['LINE', 'FILE', 'PR'])

export const Category = z.enum([
  'SYNTAX',
  'COMPILATION',
  'LINT',
  'FRAMEWORK',
  'SECURITY',
  'PERFORMANCE',
  'CORRECTNESS',
  'MAINTAINABILITY',
  'ARCHITECTURE',
  'TESTING',
  'DEPENDENCY',
  'ACCESSIBILITY',
  'COMPATIBILITY',
  'CONFIGURATION',
])

export const Location = z.strictObject({
  anchorKind: AnchorKind,
  path: z.string().optional(),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
})

export const Provenance = z.strictObject({
  validator: z.string(),
  tool: z.string().optional(),
  toolVersion: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
})

/** One issue in the common finding schema (Validation Capability Spec §23). No Finding ever carries a secret value. */
export const Finding = z.strictObject({
  ruleId: z.string(),
  category: Category,
  severity: Severity,
  confidence: Confidence,
  /** Assigned by core `normalize` only; Validators leave it UNKNOWN. */
  scope: Scope,
  sourceFamily: SourceFamily,
  title: z.string(),
  description: z.string(),
  impact: z.string().optional(),
  recommendation: z.string().optional(),
  evidence: z.string().optional(),
  location: Location,
  provenance: Provenance,
  partial: z.boolean().optional(),
  /** Set by core `dedupe`. */
  fingerprint: z.string().optional(),
})
export type Finding = z.infer<typeof Finding>

export const ReasonCode = z.enum([
  'NO_SANDBOX',
  'NOT_APPLICABLE_TECHNOLOGY',
  'UNSUPPORTED_VERSION',
  'DEPENDENCY_LAYER_FAILED',
  'COST_CEILING',
  'PROVIDER_UNAVAILABLE',
  'TOOL_CRASHED',
  'TIMED_OUT',
  'INVALID_OUTPUT',
  'DISABLED_BY_CONFIG',
])

export const LayerResult = z.strictObject({
  layer: LayerId,
  validator: z.string(),
  status: LayerStatus,
  reason: ReasonCode.optional(),
  detail: z.string().optional(),
  tool: z.string().optional(),
  toolVersion: z.string().optional(),
  durationMs: z.number().int().nonnegative(),
})
export type LayerResult = z.infer<typeof LayerResult>
