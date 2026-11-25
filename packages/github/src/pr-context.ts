import { err, ok, type CheckResult, type ContextLimits, type GitHubReader, type LinkedIssue, type PrContext, type PrRef, type PublishedItems, type PullSummary, type RepoRef, type Result, type TreeEntry } from '@pr-reviewer/core'
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
  requested_reviewers?: ApiUser[]
  author_association?: string
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
interface ApiComment { id: number; user: ApiUser | null; body: string | null; path?: string; line?: number | null; start_line?: number | null; position?: number | null; in_reply_to_id?: number; created_at: string; html_url?: string }

const BINARY_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|icns|pdf|zip|gz|tgz|bz2|xz|7z|rar|jar|war|class|exe|dll|so|dylib|bin|woff2?|ttf|otf|eot|mp3|mp4|mov|avi|webm|wav|ogg|psd|sketch|fig)$/i
const CONTENT_CONCURRENCY = 6

const enc = (s: string) => encodeURIComponent(s)
const encPath = (p: string) => p.split('/').map(enc).join('/')

/** Implements the read port with the GitHub REST API. */
const LINKED_ISSUES = `query($owner: String!, $repo: String!, $pr: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      closingIssuesReferences(first: 5) { nodes { number title body url repository { nameWithOwner } } }
    }
  }
}`
interface LinkedIssuesData {
  repository: { pullRequest: { closingIssuesReferences: { nodes: Array<{ number: number; title: string; body: string | null; url: string; repository: { nameWithOwner: string } }> } } | null } | null
}

export class GitHubPrReader implements GitHubReader {
  constructor(private readonly client: GitHubClient) {}

  async linkedIssues(ref: PrRef): Promise<Result<LinkedIssue[]>> {
    const res = await this.client.graphql<LinkedIssuesData>(LINKED_ISSUES, { owner: ref.owner, repo: ref.repo, pr: ref.number })
    if (!res.ok) return res
    const nodes = res.value.repository?.pullRequest?.closingIssuesReferences.nodes ?? []
    return ok(nodes.map((n) => ({ number: n.number, repo: n.repository.nameWithOwner, title: n.title, body: n.body ?? '', url: n.url })))
  }

  async listOpenPulls(repo: { host: string; owner: string; repo: string }, limit: number): Promise<Result<PullSummary[]>> {
    const res = await this.client.paginate<ApiPull & { number: number; updated_at: string }>(
      `/repos/${enc(repo.owner)}/${enc(repo.repo)}/pulls?state=open&sort=updated&direction=desc&per_page=${Math.min(100, limit)}`,
      limit,
    )
    if (!res.ok) return res
    return ok(
      res.value.items.map((p) => ({
        number: p.number,
        title: p.title,
        author: p.user?.login ?? 'ghost',
        headSha: p.head.sha,
        draft: p.draft ?? false,
        updatedAt: p.updated_at,
      })),
    )
  }

  async readFile(repo: RepoRef, path: string, sha: string): Promise<Result<string | undefined>> {
    const res = await this.client.raw(`/repos/${enc(repo.owner)}/${enc(repo.repo)}/contents/${encPath(path)}?ref=${enc(sha)}`)
    if (res.ok) return res
    // The PR itself was readable, so a 404 here means the file does not exist at this commit.
    return res.error.code === 'github_no_access' && /returned 404/.test(res.error.message) ? ok(undefined) : res
  }

  async listTree(repo: RepoRef, sha: string): Promise<Result<{ treeSha: string; entries: TreeEntry[]; truncated: boolean }>> {
    const res = await this.client.json<{ sha: string; tree: Array<{ path: string; type: TreeEntry['type']; sha: string; size?: number }>; truncated: boolean }>(
      `/repos/${enc(repo.owner)}/${enc(repo.repo)}/git/trees/${enc(sha)}?recursive=1`,
    )
    if (!res.ok) return res
    return ok({ treeSha: res.value.data.sha, entries: res.value.data.tree.map((t) => ({ path: t.path, type: t.type, sha: t.sha, ...(t.size !== undefined ? { size: t.size } : {}) })), truncated: res.value.data.truncated })
  }

  async listDirectory(repo: RepoRef, path: string, sha: string): Promise<Result<string[]>> {
    const res = await this.client.json<Array<{ name: string; type: string }> | { type: string }>(
      `/repos/${enc(repo.owner)}/${enc(repo.repo)}/contents/${encPath(path.replace(/\/+$/, ''))}?ref=${enc(sha)}`,
    )
    if (!res.ok) return res.error.code === 'github_no_access' && /returned 404/.test(res.error.message) ? ok([]) : res
    return ok(Array.isArray(res.value.data) ? res.value.data.filter((e) => e.type === 'file').map((e) => e.name) : [])
  }

  async listCheckResults(repo: RepoRef, sha: string): Promise<Result<CheckResult[]>> {
    const repoPath = `/repos/${enc(repo.owner)}/${enc(repo.repo)}`
    const [runs, status] = await Promise.all([
      this.client.json<{ check_runs: Array<{ name: string; status: string; conclusion: string | null; html_url?: string; details_url?: string; output?: { title?: string | null; summary?: string | null }; app?: { slug?: string } | null }> }>(
        `${repoPath}/commits/${enc(sha)}/check-runs?per_page=100`,
      ),
      this.client.json<{ statuses: Array<{ context: string; state: string; description: string | null; target_url: string | null }> }>(`${repoPath}/commits/${enc(sha)}/status?per_page=100`),
    ])
    if (!runs.ok) return runs
    if (!status.ok) return status
    return ok([
      ...runs.value.data.check_runs.map((r) => ({
        kind: 'check_run' as const,
        name: r.name,
        conclusion: r.status === 'completed' ? (r.conclusion ?? 'neutral') : 'pending',
        summary: r.output?.title ?? undefined,
        url: r.html_url ?? r.details_url,
        app: r.app?.slug,
      })),
      ...status.value.data.statuses.map((st) => ({
        kind: 'status' as const,
        name: st.context,
        conclusion: st.state === 'success' ? 'success' : st.state === 'failure' ? 'failure' : st.state === 'error' ? 'error' : 'pending',
        summary: st.description ?? undefined,
        url: st.target_url ?? undefined,
      })),
    ])
  }

  async downloadArchive(repo: RepoRef, sha: string): Promise<Result<Uint8Array>> {
    return this.client.bytes(`/repos/${enc(repo.owner)}/${enc(repo.repo)}/tarball/${enc(sha)}`, 500 * 1_048_576)
  }

  async viewer(): Promise<Result<{ id: number; login: string }>> {
    const res = await this.client.json<{ id: number; login: string }>('/user')
    return res.ok ? ok({ id: res.value.data.id, login: res.value.data.login }) : res
  }

  async getHeadSha(ref: PrRef): Promise<Result<string>> {
    const res = await this.client.json<ApiPull>(`/repos/${enc(ref.owner)}/${enc(ref.repo)}/pulls/${ref.number}`)
    return res.ok ? ok(res.value.data.head.sha) : res
  }

  async listPublished(ref: PrRef): Promise<Result<PublishedItems>> {
    const repoPath = `/repos/${enc(ref.owner)}/${enc(ref.repo)}`
    const [reviews, inline, comments] = await Promise.all([
      this.client.paginate<ApiReview>(`${repoPath}/pulls/${ref.number}/reviews?per_page=100`),
      this.client.paginate<ApiComment>(`${repoPath}/pulls/${ref.number}/comments?per_page=100`),
      this.client.paginate<ApiComment>(`${repoPath}/issues/${ref.number}/comments?per_page=100`),
    ])
    if (!reviews.ok) return reviews
    if (!inline.ok) return inline
    if (!comments.ok) return comments
    const item = (c: ApiComment) => ({
      id: c.id,
      authorId: c.user?.id,
      ...(c.user?.login ? { authorLogin: c.user.login } : {}),
      body: c.body ?? '',
      createdAt: c.created_at,
      ...(c.html_url ? { url: c.html_url } : {}),
    })
    return ok({
      reviews: reviews.value.items.map((r) => ({ id: r.id, authorId: r.user?.id, body: r.body ?? '', state: r.state })),
      reviewComments: inline.value.items.map((c) => ({
        ...item(c),
        ...(c.in_reply_to_id !== undefined ? { inReplyTo: c.in_reply_to_id } : {}),
        ...(c.path ? { path: c.path } : {}),
        ...(typeof c.line === 'number' ? { line: c.line, ...(typeof c.start_line === 'number' ? { startLine: c.start_line } : {}) } : {}),
        outdated: c.line === null || c.line === undefined ? c.position === null : false,
      })),
      issueComments: comments.value.items.map(item),
    })
  }

  async listThumbsDown(ref: PrRef, commentId: number): Promise<Result<string[]>> {
    const res = await this.client.paginate<{ user: ApiUser | null; content: string }>(
      `/repos/${enc(ref.owner)}/${enc(ref.repo)}/pulls/comments/${commentId}/reactions?content=-1&per_page=100`,
    )
    return res.ok ? ok(res.value.items.filter((r) => r.content === '-1').flatMap((r) => (r.user?.login ? [r.user.login] : []))) : res
  }

  async searchCommentedPulls(
    login: string,
    sinceIso: string,
    repo?: { owner: string; repo: string },
    limit = 200,
  ): Promise<Result<Array<{ owner: string; repo: string; number: number; title: string; author: string }>>> {
    const q = [`is:pr`, `commenter:${login}`, `updated:>=${sinceIso.slice(0, 10)}`, ...(repo ? [`repo:${repo.owner}/${repo.repo}`] : [])].join(' ')
    const res = await this.client.json<{ items: Array<{ number: number; title: string; repository_url: string; user: ApiUser | null }> }>(
      `/search/issues?q=${encodeURIComponent(q)}&sort=updated&order=desc&per_page=${Math.min(100, limit)}`,
    )
    if (!res.ok) return res
    return ok(
      res.value.data.items.flatMap((i) => {
        const m = /\/repos\/([^/]+)\/([^/]+)$/.exec(i.repository_url)
        return m ? [{ owner: decodeURIComponent(m[1]!), repo: decodeURIComponent(m[2]!), number: i.number, title: i.title, author: i.user?.login ?? 'ghost' }] : []
      }),
    )
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
      ...(pr.requested_reviewers ? { requestedReviewers: pr.requested_reviewers.map((u) => u.login) } : {}),
      ...(pr.author_association ? { authorAssociation: pr.author_association } : {}),
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
