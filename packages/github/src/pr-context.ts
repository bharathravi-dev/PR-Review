import { err, ok, type ContextLimits, type GitHubReader, type PrContext, type PrRef, type PublishedItem, type Result } from '@pr-reviewer/core'
import type { GitHubClient } from './client.js'

interface ApiUser { login: string; id?: number }
interface ApiPull {
  title: string
  body: string | null
  user: ApiUser | null
  state: string
  draft?: boolean
  base: { ref: string; sha: string; repo: { id: number; full_name: string } }
  head: { ref: string; sha: string; repo: { full_name: string } | null }
}
interface ApiFile {
  filename: string
  previous_filename?: string
  status: PrContext['files'][number]['status']
  additions: number
  deletions: number
  changes: number
  patch?: string
}
interface ApiReview { id: number; user: ApiUser | null; state: string; body: string | null; submitted_at?: string }
interface ApiComment { id: number; user: ApiUser | null; body: string | null; path?: string; line?: number | null; created_at: string }

const BINARY_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|icns|pdf|zip|gz|tgz|bz2|xz|7z|rar|jar|war|class|exe|dll|so|dylib|bin|woff2?|ttf|otf|eot|mp3|mp4|mov|avi|webm|wav|ogg|psd|sketch|fig)$/i
const CONTENT_CONCURRENCY = 6

const enc = (s: string) => encodeURIComponent(s)
const encPath = (p: string) => p.split('/').map(enc).join('/')

/** Implements the read port with the GitHub REST API. */
export class GitHubPrReader implements GitHubReader {
  constructor(private readonly client: GitHubClient) {}

  async viewer(): Promise<Result<{ id: number; login: string }>> {
    const res = await this.client.json<{ id: number; login: string }>('/user')
    return res.ok ? ok({ id: res.value.data.id, login: res.value.data.login }) : res
  }

  async getHeadSha(ref: PrRef): Promise<Result<string>> {
    const res = await this.client.json<ApiPull>(`/repos/${enc(ref.owner)}/${enc(ref.repo)}/pulls/${ref.number}`)
    return res.ok ? ok(res.value.data.head.sha) : res
  }

  async listPublished(ref: PrRef): Promise<Result<{ reviews: PublishedItem[]; issueComments: PublishedItem[] }>> {
    const repoPath = `/repos/${enc(ref.owner)}/${enc(ref.repo)}`
    const [reviews, comments] = await Promise.all([
      this.client.paginate<ApiReview>(`${repoPath}/pulls/${ref.number}/reviews?per_page=100`),
      this.client.paginate<ApiComment>(`${repoPath}/issues/${ref.number}/comments?per_page=100`),
    ])
    if (!reviews.ok) return reviews
    if (!comments.ok) return comments
    return ok({
      reviews: reviews.value.items.map((r) => ({ id: r.id, authorId: r.user?.id, body: r.body ?? '', state: r.state })),
      issueComments: comments.value.items.map((c) => ({ id: c.id, authorId: c.user?.id, body: c.body ?? '', createdAt: c.created_at })),
    })
  }

  async getPrContext(ref: PrRef, limits: ContextLimits): Promise<Result<PrContext>> {
    const repoPath = `/repos/${enc(ref.owner)}/${enc(ref.repo)}`
    const pull = await this.client.json<ApiPull>(`${repoPath}/pulls/${ref.number}`)
    if (!pull.ok) return pull
    const pr = pull.value.data

    const compare = await this.client.json<{ merge_base_commit: { sha: string } }>(
      `${repoPath}/compare/${pr.base.sha}...${pr.head.sha}?per_page=1`,
    )
    if (!compare.ok) return compare

    const [files, reviews, reviewComments, issueComments] = await Promise.all([
      this.client.paginate<ApiFile>(`${repoPath}/pulls/${ref.number}/files?per_page=100`, limits.maxFiles),
      this.client.paginate<ApiReview>(`${repoPath}/pulls/${ref.number}/reviews?per_page=100`),
      this.client.paginate<ApiComment>(`${repoPath}/pulls/${ref.number}/comments?per_page=100`),
      this.client.paginate<ApiComment>(`${repoPath}/issues/${ref.number}/comments?per_page=100`),
    ])
    for (const r of [files, reviews, reviewComments, issueComments]) if (!r.ok) return r
    if (!files.ok || !reviews.ok || !reviewComments.ok || !issueComments.ok) return err('github_error', 'unreachable')

    const truncated: string[] = []
    if (!files.value.complete) truncated.push(`Only the first ${limits.maxFiles} changed files were loaded.`)

    const mergeBaseSha = compare.value.data.merge_base_commit.sha
    const changed: PrContext['files'] = files.value.items.map((f) => {
      const hasPatch = typeof f.patch === 'string'
      const binary = BINARY_EXT.test(f.filename) || (!hasPatch && f.changes === 0 && f.status !== 'renamed')
      const patchTruncated = !hasPatch && !binary && f.changes > 0
      if (patchTruncated) truncated.push(`Diff for ${f.filename} was too large for GitHub to return.`)
      return {
        path: f.filename,
        ...(f.previous_filename ? { previousPath: f.previous_filename } : {}),
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        binary,
        ...(hasPatch ? { patch: f.patch } : {}),
        patchTruncated,
      }
    })

    const omitted = await this.#loadContents(repoPath, changed, pr.head.sha, mergeBaseSha, limits)
    if (omitted.too_large) truncated.push(`${omitted.too_large} file version(s) exceeded ${limits.maxFileBytes} bytes; content not loaded.`)
    if (omitted.total_limit) truncated.push(`${omitted.total_limit} file version(s) skipped after the ${limits.maxTotalBytes}-byte context budget.`)
    if (omitted.unavailable) truncated.push(`${omitted.unavailable} file version(s) could not be read from GitHub.`)

    const baseRepo = pr.base.repo.full_name
    const headRepo = pr.head.repo?.full_name
    return ok({
      schemaVersion: 1,
      ref: { host: ref.host, owner: ref.owner, repo: ref.repo, number: ref.number },
      repoId: pr.base.repo.id,
      title: pr.title,
      body: pr.body ?? '',
      author: pr.user?.login ?? 'ghost',
      state: pr.state,
      draft: pr.draft ?? false,
      baseRef: pr.base.ref,
      headRef: pr.head.ref,
      baseSha: pr.base.sha,
      headSha: pr.head.sha,
      mergeBaseSha,
      ...(headRepo ? { headRepo } : {}),
      fromFork: headRepo !== undefined && headRepo !== baseRepo,
      files: changed,
      reviews: reviews.value.items.map((r) => ({
        id: r.id,
        author: r.user?.login ?? 'ghost',
        state: r.state,
        body: r.body ?? '',
        ...(r.submitted_at ? { submittedAt: r.submitted_at } : {}),
      })),
      reviewComments: reviewComments.value.items.map(toComment),
      issueComments: issueComments.value.items.map(toComment),
      truncated,
    })
  }

  /** Loads head and merge-base text within per-file and total budgets; mutates `files`. */
  async #loadContents(
    repoPath: string,
    files: PrContext['files'],
    headSha: string,
    baseSha: string,
    limits: ContextLimits,
  ): Promise<Record<'too_large' | 'total_limit' | 'unavailable', number>> {
    const counts = { too_large: 0, total_limit: 0, unavailable: 0 }
    let budget = limits.maxTotalBytes
    const jobs: Array<() => Promise<void>> = []
    for (const file of files) {
      if (file.binary) {
        if (file.status !== 'removed') file.head = { omitted: 'binary' }
        if (file.status !== 'added') file.base = { omitted: 'binary' }
        continue
      }
      const sides: Array<['head' | 'base', string, string]> = []
      if (file.status !== 'removed') sides.push(['head', file.path, headSha])
      if (file.status !== 'added') sides.push(['base', file.previousPath ?? file.path, baseSha])
      for (const [side, path, sha] of sides) {
        jobs.push(async () => {
          if (budget <= 0) {
            file[side] = { omitted: 'total_limit' }
            counts.total_limit++
            return
          }
          const res = await this.client.raw(`${repoPath}/contents/${encPath(path)}?ref=${sha}`)
          if (!res.ok) {
            file[side] = { omitted: 'unavailable' }
            counts.unavailable++
            return
          }
          const bytes = new TextEncoder().encode(res.value).length
          if (bytes > limits.maxFileBytes) {
            file[side] = { omitted: 'too_large' }
            counts.too_large++
          } else if (bytes > budget) {
            file[side] = { omitted: 'total_limit' }
            counts.total_limit++
            budget = 0
          } else {
            budget -= bytes
            file[side] = { text: res.value }
          }
        })
      }
    }
    let next = 0
    const worker = async () => {
      while (next < jobs.length) await jobs[next++]?.()
    }
    await Promise.all(Array.from({ length: Math.min(CONTENT_CONCURRENCY, jobs.length) }, worker))
    return counts
  }
}

function toComment(c: ApiComment): PrContext['issueComments'][number] {
  return {
    id: c.id,
    author: c.user?.login ?? 'ghost',
    body: c.body ?? '',
    ...(c.path ? { path: c.path } : {}),
    ...(typeof c.line === 'number' ? { line: c.line } : {}),
    createdAt: c.created_at,
  }
}
