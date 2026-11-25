import type { Secret } from './secret.js'
import type { PrRef } from './pr-ref.js'
import type { Result } from './result.js'
import type { ContextLimits, PrContext } from './schemas.js'

/** A review or issue comment as `publish` needs it to recognise its own output (AD-11). */
export interface PublishedItem {
  id: number
  authorId: number | undefined
  body: string
  /** Reviews only. */
  state?: string | undefined
  createdAt?: string | undefined
  url?: string | undefined
}

export interface PublishedItems {
  reviews: PublishedItem[]
  reviewComments: PublishedItem[]
  issueComments: PublishedItem[]
}

/** An open pull request as listed for picking (FR-25). */
export interface PullSummary {
  number: number
  title: string
  author: string
  headSha: string
  draft: boolean
  updatedAt: string
}

/** Read side of GitHub (AD-6). The only write path is the engine's publish stage (AD-9). */
export interface GitHubReader {
  /** Open PRs of a repository, most recently updated first, up to `limit`. */
  listOpenPulls(repo: { host: string; owner: string; repo: string }, limit: number): Promise<Result<PullSummary[]>>
  getPrContext(ref: PrRef, limits: ContextLimits): Promise<Result<PrContext>>
  /** The authenticated user — the Reviewer Identity. */
  viewer(): Promise<Result<{ id: number; login: string }>>
  /** Current head SHA of the PR, re-read immediately before publishing (AD-23). */
  getHeadSha(ref: PrRef): Promise<Result<string>>
  /** Reviews, inline review comments, and issue comments on the PR, for marker-based self-recognition (AD-11). */
  listPublished(ref: PrRef): Promise<Result<PublishedItems>>
}

export interface InlineComment {
  path: string
  line: number
  startLine?: number | undefined
  side: 'RIGHT'
  body: string
}

/** Write side of GitHub, handed only to core `publish` (AD-9). No approve, merge, or branch-protection operation exists. */
export interface GitHubWriter {
  createReview(
    ref: PrRef,
    review: { commitId: string; event: 'COMMENT' | 'REQUEST_CHANGES'; body: string; comments: readonly InlineComment[] },
  ): Promise<Result<{ id: number; url: string }>>
  createIssueComment(ref: PrRef, body: string): Promise<Result<{ id: number; url: string }>>
  updateIssueComment(ref: PrRef, id: number, body: string): Promise<Result<{ id: number; url: string }>>
  deleteIssueComment(ref: PrRef, id: number): Promise<Result<void>>
}

/** Resolves a Credential reference to a value (AD-10). `host` lets GitHub resolvers pick the right login. */
export interface CredentialResolver {
  resolve(ref: string, opts?: { host?: string }): Promise<Result<Secret>>
}
