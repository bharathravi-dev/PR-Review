import type { Secret } from './secret.js'
import type { PrRef, RepoRef } from './pr-ref.js'
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
  authorLogin?: string | undefined
  /** Inline review comments only: the comment this one replies to. */
  inReplyTo?: number | undefined
  /** Inline review comments only: GitHub no longer maps it to a line because the code there changed. */
  outdated?: boolean | undefined
  /** Inline review comments only: the file and the (first and last) head line it is anchored to. */
  path?: string | undefined
  line?: number | undefined
  startLine?: number | undefined
}

/** An inline review comment anywhere in a repository, for learning from feedback. */
export interface RepoReviewComment extends PublishedItem {
  /** The PR it was posted on. */
  pr: number
  /** GitHub's 👎 count on it (who reacted is read separately, and only when this is above zero). */
  thumbsDownCount?: number | undefined
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

/** One entry of a repository tree at an exact commit. */
export interface TreeEntry {
  path: string
  type: 'blob' | 'tree' | 'commit'
  /** Git object SHA (blob SHA for files): a content hash used in cache keys (AD-12). */
  sha: string
  size?: number | undefined
}

/** A CI result attached to one exact commit: a check run or a commit status (FR-5). */
export interface CheckResult {
  kind: 'check_run' | 'status'
  name: string
  /** Normalised: success, failure, neutral, skipped, cancelled, timed_out, action_required, pending, error. */
  conclusion: string
  summary?: string | undefined
  url?: string | undefined
  app?: string | undefined
}

/** An issue the PR says it closes ("Fixes #12"), as GitHub links it. */
export interface LinkedIssue {
  number: number
  /** owner/repo of the issue (may differ from the PR's). */
  repo: string
  title: string
  body: string
  url?: string | undefined
}

/** Read side of GitHub (AD-6). The only write path is the engine's publish stage (AD-9). */
export interface GitHubReader {
  /** A file's text at an exact commit; undefined when the file does not exist there. */
  readFile(repo: RepoRef, path: string, sha: string): Promise<Result<string | undefined>>
  /** The full file tree at an exact commit; `truncated` when GitHub cut it short. */
  listTree(repo: RepoRef, sha: string): Promise<Result<{ treeSha: string; entries: TreeEntry[]; truncated: boolean }>>
  /** File names directly inside a directory at an exact commit (empty when it does not exist). */
  listDirectory(repo: RepoRef, path: string, sha: string): Promise<Result<string[]>>
  /** Check runs and commit statuses attached to exactly this commit (FR-5). */
  listCheckResults(repo: RepoRef, sha: string): Promise<Result<CheckResult[]>>
  /** The source archive (gzip tar) at an exact commit, for the Sandbox (AD-6). */
  downloadArchive(repo: RepoRef, sha: string): Promise<Result<Uint8Array>>
  /** Open PRs of a repository, most recently updated first, up to `limit`. */
  listOpenPulls(repo: { host: string; owner: string; repo: string }, limit: number): Promise<Result<PullSummary[]>>
  getPrContext(ref: PrRef, limits: ContextLimits): Promise<Result<PrContext>>
  /** Issues the PR closes when merged (GitHub's closing references); optional for readers that can't tell. */
  linkedIssues?(ref: PrRef): Promise<Result<LinkedIssue[]>>
  /** The authenticated user — the Reviewer Identity. */
  viewer(): Promise<Result<{ id: number; login: string }>>
  /**
   * Paths changed between two commits (base...head) and how they relate: `ahead` when head descends from base.
   * Optional; incremental reviews need it (roadmap item 4).
   */
  changedPathsBetween?(repo: RepoRef, base: string, head: string): Promise<Result<{ status: string; paths: string[] }>>
  /**
   * Code search with matching fragments (optional; codebase context, roadmap item 17): in one repository, or across
   * an owner's repositories. Default branches only, as the forge indexes them.
   */
  searchCode?(q: { repo?: RepoRef; owner?: string; symbol: string; limit: number }): Promise<Result<Array<{ repo: string; path: string; fragments: string[] }>>>
  /** Current head SHA of the PR, re-read immediately before publishing (AD-23). */
  getHeadSha(ref: PrRef): Promise<Result<string>>
  /** Reviews, inline review comments, and issue comments on the PR, for marker-based self-recognition (AD-11). */
  listPublished(ref: PrRef): Promise<Result<PublishedItems>>
  /** Logins that reacted 👎 to an inline review comment (Finding feedback, FR-20b). */
  listThumbsDown(ref: PrRef, commentId: number): Promise<Result<string[]>>
  /** Inline review comments across the repository's PRs updated since a date, newest first, up to `max` (learning). */
  listRepoReviewComments?(repo: RepoRef, opts: { sinceIso: string; max: number }): Promise<Result<{ items: RepoReviewComment[]; complete: boolean }>>
  /** Whether a user can push to the repository (write, maintain, or admin); decides whose feedback teaches the reviewer. */
  canPush?(repo: RepoRef, login: string): Promise<Result<boolean>>
  /** PRs the user commented on, updated since an ISO date, optionally in one repository (FR-25a). */
  searchCommentedPulls(login: string, sinceIso: string, repo?: { owner: string; repo: string }, limit?: number): Promise<Result<Array<{ owner: string; repo: string; number: number; title: string; author: string }>>>
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
    review: { commitId: string; /** Omitted for a pending (draft) review only the author sees (FR-20a). */ event?: 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE' | undefined; body: string; comments: readonly InlineComment[] },
  ): Promise<Result<{ id: number; url: string }>>
  createIssueComment(ref: PrRef, body: string): Promise<Result<{ id: number; url: string }>>
  /**
   * Commits new content for one file to a branch (optional; "Apply fix", roadmap item 16). `expectedHead` is the
   * branch tip the change was made against; the commit fails rather than overwrite anything newer.
   */
  commitFile?(repo: RepoRef, change: { branch: string; path: string; content: string; message: string; expectedHead: string }): Promise<Result<{ commitSha: string; url?: string | undefined }>>
  /** Replies in a review thread (optional; commands in the PR thread use it, roadmap item 6). */
  replyToReviewComment?(ref: PrRef, commentId: number, body: string): Promise<Result<{ id: number; url: string }>>
  updateIssueComment(ref: PrRef, id: number, body: string): Promise<Result<{ id: number; url: string }>>
  deleteIssueComment(ref: PrRef, id: number): Promise<Result<void>>
  /**
   * Resolves the review threads whose first comment has one of these ids (the reviewer's own, fixed findings).
   * Returns how many were resolved; threads already resolved are skipped.
   */
  resolveThreads(ref: PrRef, commentIds: readonly number[]): Promise<Result<number>>
  /** Sets a commit status; informational only, it never changes branch protection (FR-21). */
  createCommitStatus(
    ref: PrRef,
    sha: string,
    status: { state: 'success' | 'failure' | 'error'; description: string; context: string; targetUrl?: string | undefined },
  ): Promise<Result<void>>
}

/** Resolves a Credential reference to a value (AD-10). `host` lets GitHub resolvers pick the right login. */
export interface CredentialResolver {
  resolve(ref: string, opts?: { host?: string }): Promise<Result<Secret>>
}
