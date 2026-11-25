/**
 * Review Engine core. Pure and I/O-free (AD-1): no Node built-ins, no fetch,
 * no process/env access, no runtime code generation. Effects arrive through ports.
 */

/** Version of every persisted or transmitted artefact shape (AD-4). */
export const SCHEMA_VERSION = 1

/** Major version of the engine; part of the idempotency key (AD-11). */
export const ENGINE_MAJOR = 0

/** Exit codes shared by every Channel that exits a process (spine Consistency Conventions). */
export const EXIT_CODES = {
  passed: 0,
  passedWithWarningsStrict: 1,
  failed: 2,
  incomplete: 3,
  error: 4,
  cancelled: 5,
  usage: 64,
} as const

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES]
