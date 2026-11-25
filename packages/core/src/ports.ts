import type { PrRef } from './pr-ref.js'
import type { Result } from './result.js'
import type { ContextLimits, PrContext } from './schemas.js'

/** Read side of GitHub (AD-6). The only write path is the engine's publish stage (AD-9). */
export interface GitHubReader {
  getPrContext(ref: PrRef, limits: ContextLimits): Promise<Result<PrContext>>
}
