import * as z from 'zod'

// Eval-free mode so core runs under a CSP without 'unsafe-eval' (AD-1, browser extension).
z.config({ jitless: true })

export const FileStatus = z.enum(['added', 'modified', 'removed', 'renamed', 'copied', 'changed', 'unchanged'])

/** One side (base or head) of a changed file's content. */
export const FileContent = z.object({
  text: z.string().optional(),
  /** Why `text` is absent or partial: over the per-file or total limit, binary, or unavailable. */
  omitted: z.enum(['too_large', 'total_limit', 'binary', 'unavailable']).optional(),
})

export const ChangedFile = z.object({
  path: z.string(),
  previousPath: z.string().optional(),
  status: FileStatus,
  additions: z.number().int(),
  deletions: z.number().int(),
  binary: z.boolean(),
  /** Unified diff text from GitHub; absent for binary files or when GitHub truncates it. */
  patch: z.string().optional(),
  patchTruncated: z.boolean(),
  head: FileContent.optional(),
  base: FileContent.optional(),
})

export const ReviewSummary = z.object({
  id: z.number().int(),
  author: z.string(),
  state: z.string(),
  body: z.string(),
  submittedAt: z.string().optional(),
})

export const CommentSummary = z.object({
  id: z.number().int(),
  author: z.string(),
  body: z.string(),
  path: z.string().optional(),
  line: z.number().int().optional(),
  createdAt: z.string(),
})

/** Everything the engine knows about a PR at its Head Commit (FR-2). */
export const PrContext = z.object({
  schemaVersion: z.literal(1),
  ref: z.object({ host: z.string(), owner: z.string(), repo: z.string(), number: z.number().int() }),
  /** Numeric id of the base repository; part of idempotency keys (AD-11). */
  repoId: z.number().int().optional(),
  title: z.string(),
  body: z.string(),
  author: z.string(),
  state: z.string(),
  draft: z.boolean(),
  baseRef: z.string(),
  headRef: z.string(),
  baseSha: z.string(),
  headSha: z.string(),
  mergeBaseSha: z.string(),
  headRepo: z.string().optional(),
  /** Logins whose review is requested (pending reviews, FR-20a). */
  requestedReviewers: z.array(z.string()).optional(),
  /** GitHub author_association of the PR author. */
  authorAssociation: z.string().optional(),
  fromFork: z.boolean(),
  files: z.array(ChangedFile),
  reviews: z.array(ReviewSummary),
  reviewComments: z.array(CommentSummary),
  issueComments: z.array(CommentSummary),
  /** Human-readable notes about anything incomplete (FR-2: listed, never silently dropped). */
  truncated: z.array(z.string()),
})

export type PrContext = z.infer<typeof PrContext>
export type ChangedFile = z.infer<typeof ChangedFile>

/** Size limits for file content in context (bytes). */
export const ContextLimits = z.object({
  maxFileBytes: z.number().int().positive(),
  maxTotalBytes: z.number().int().positive(),
  maxFiles: z.number().int().positive(),
})
export type ContextLimits = z.infer<typeof ContextLimits>

export const DEFAULT_CONTEXT_LIMITS: ContextLimits = {
  maxFileBytes: 60_000,
  maxTotalBytes: 350_000,
  maxFiles: 300,
}
