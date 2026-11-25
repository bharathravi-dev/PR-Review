import * as z from 'zod'

/** Closed layer catalogue (AD-24): spec L1–L14 with secrets and dependencies split out, plus CONTEXT and EXTERNAL_RESULTS. */
export const LayerId = z.enum([
  'CONTEXT',
  'SYNTAX',
  'COMPILE',
  'LINT',
  'FRAMEWORK',
  'STATIC_ANALYSIS',
  'MAINTAINABILITY',
  'PERFORMANCE',
  'SECRETS',
  'SECURITY',
  'DEPENDENCIES',
  'CORRECTNESS',
  'ARCHITECTURE',
  'TESTS',
  'ACCESSIBILITY',
  'COMPATIBILITY',
  'EXTERNAL_RESULTS',
  'AI_REVIEW',
])
export type LayerId = z.infer<typeof LayerId>

export const LayerStatus = z.enum(['PASSED', 'FAILED', 'WARNING', 'SKIPPED', 'ERROR', 'TIMEOUT', 'NOT_APPLICABLE'])
export type LayerStatus = z.infer<typeof LayerStatus>

/** Closed reason codes for SKIPPED / ERROR / TIMEOUT and cancellations (AD-24). */
export const ReasonCode = z.enum([
  'NO_SANDBOX',
  'UNSUPPORTED_RUNTIME',
  'NO_EGRESS_CONTROL',
  'NOT_SUPPORTED',
  'DISABLED_BY_CONFIG',
  'SUPERSEDED_BY_VALIDATOR',
  'SECRET_SCAN_UNAVAILABLE',
  'COST_CEILING',
  'PROVIDER_UNAVAILABLE',
  'RATE_LIMITED',
  'SANDBOX_OUTPUT_INVALID',
  'SCHEMA_INVALID',
  'TOOL_CRASHED',
  'TIME_LIMIT',
  'CONFIG_UNSUPPORTED',
  'REPO_OPTED_OUT',
  'SUPERSEDED',
  'USER_ABORT',
  'UNKNOWN',
])
export type ReasonCode = z.infer<typeof ReasonCode>

export const Severity = z.enum(['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO'])
export type Severity = z.infer<typeof Severity>

export const Confidence = z.enum(['HIGH', 'MEDIUM', 'LOW'])
export const Scope = z.enum(['NEW', 'WORSENED', 'PRE_EXISTING', 'UNKNOWN'])
export const SourceFamily = z.enum(['DETERMINISTIC', 'EXTERNAL', 'AI'])
export const AnchorKind = z.enum(['LINE', 'FILE', 'PR'])
export const Disposition = z.enum(['GATING', 'ADVISORY'])

/** Closed category catalogue (AD-15); also the AI catalogue, versioned with the prompt template. */
export const Category = z.enum([
  'CORRECTNESS',
  'SECURITY',
  'SECRET',
  'PERFORMANCE',
  'MAINTAINABILITY',
  'ARCHITECTURE',
  'TESTS',
  'ACCESSIBILITY',
  'COMPATIBILITY',
  'DEPENDENCY',
  'BUILD',
  'STYLE',
  'PROMPT_INJECTION',
])
export type Category = z.infer<typeof Category>

export const Location = z.strictObject({
  anchorKind: AnchorKind,
  path: z.string().optional(),
  side: z.enum(['HEAD', 'BASE']).optional(),
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

/** One issue in the common finding schema (AD-15). No Finding ever carries a secret value. */
export const Finding = z.strictObject({
  /** Strongest member's fingerprint; set by `dedupe`. */
  id: z.string().optional(),
  ruleId: z.string(),
  category: Category,
  severity: Severity,
  confidence: Confidence,
  /** Assigned by core `normalize` only; Validators leave it UNKNOWN. */
  scope: Scope,
  sourceFamily: SourceFamily,
  /** ADVISORY Findings (LOW-confidence AI) are reported but never published inline by default. */
  disposition: Disposition.optional(),
  title: z.string(),
  description: z.string(),
  impact: z.string().optional(),
  recommendation: z.string().optional(),
  /** Exact replacement for the anchored lines (published as a committable suggestion). */
  suggestion: z.string().optional(),
  evidence: z.string().optional(),
  location: Location,
  commitSha: z.string().optional(),
  provenance: Provenance,
  alsoReportedBy: z.array(z.string()).optional(),
  partial: z.boolean().optional(),
  fingerprint: z.string().optional(),
  fingerprints: z.array(z.string()).optional(),
  dismissed: z.strictObject({ by: z.string(), byPrAuthor: z.boolean() }).optional(),
})
export type Finding = z.infer<typeof Finding>

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
