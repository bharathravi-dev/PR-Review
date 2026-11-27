/**
 * Review Engine core. Pure and I/O-free (AD-1): no Node built-ins, no fetch,
 * no process/env access, no runtime code generation. Effects arrive through ports.
 */
export * from './result.js'
export * from './pr-ref.js'
export * from './schemas.js'
export * from './ports.js'
export * from './fetch-context.js'
export * from './secret.js'
export * from './config.js'
export * from './findings.js'
export * from './diff.js'
export * from './redact.js'
export * from './ai-review.js'
export * from './report.js'
export * from './pipeline.js'
export * from './marker.js'
export * from './sanitize.js'
export * from './publish.js'
export * from './feedback.js'
export * from './learnings.js'
export * from './related.js'
export * from './rules.js'
export * from './events.js'
export * from './service.js'
export * from './files.js'
export * from './detect.js'
export * from './repo-config.js'
export * from './validator.js'
export * from './auto-review.js'
export { canonicalJson, hashObject, uuidv7 } from './canonical.js'

/** Version of every persisted or transmitted artefact shape (AD-4). */
export const SCHEMA_VERSION = 1

/** Major version of the engine; part of the idempotency key (AD-11). */
export const ENGINE_MAJOR = 0

/** Exit codes shared by every Channel that exits a process (spine Consistency Conventions). */
export const EXIT_CODES = {
  passed: 0,
  passedWithWarnings: 1,
  failed: 2,
  incomplete: 3,
  error: 4,
  cancelled: 5,
  /** A requested publish failed, was blocked by a draft, or was skipped for a newer engine. */
  publishFailed: 6,
  usage: 64,
} as const

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES]
export * from './noise.js'
export * from './effort.js'
export * from './commands.js'
export * from './approval.js'
export * from './tickets.js'
export * from './apply-fix.js'
export * from './usages.js'
export * from './line-diff.js'
export * from './standards-rag.js'
export * from './fix-bundle.js'
