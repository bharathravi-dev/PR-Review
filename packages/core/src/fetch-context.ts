import type { PrRef } from './pr-ref.js'
import type { GitHubReader } from './ports.js'
import { err, ok, type Result } from './result.js'
import { DEFAULT_CONTEXT_LIMITS, PrContext, type ContextLimits } from './schemas.js'

/** Pipeline stage `fetchContext` (AD-3): reads through the port and validates the shape (AD-4). */
export async function fetchContext(
  reader: GitHubReader,
  ref: PrRef,
  limits: ContextLimits = DEFAULT_CONTEXT_LIMITS,
): Promise<Result<PrContext>> {
  const res = await reader.getPrContext(ref, limits)
  if (!res.ok) return res
  const parsed = PrContext.safeParse(res.value)
  if (!parsed.success) {
    return err('context_invalid', `GitHub adapter returned an invalid PR context: ${parsed.error.issues[0]?.message ?? 'unknown'}`)
  }
  return ok(parsed.data)
}
