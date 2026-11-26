// GitLab merge requests (roadmap item 10): the same reader and writer ports as GitHub, so every feature (review,
// posting, incremental reviews, commands, approval) works on GitLab. A merge request maps to a PR: iid → number,
// discussions on the diff → inline review comments, other notes → conversation comments.
import { err, ok, type CheckResult, type ContextLimits, type GitHubReader, type GitHubWriter, type InlineComment, type PrContext, type PrRef, type PublishedItem, type PublishedItems, type PullSummary, type RepoRef, type Result, type TreeEntry } from '@pr-reviewer/core'

export interface GitLabOptions {
  /** e.g. https://gitlab.com/api/v4 */
  apiUrl: string
  token?: string | undefined
  fetch: typeof fetch
  userAgent: string
}

export const gitlabApiUrl = (host: string) => `https://${host}/api/v4`
const pid = (r: RepoRef) => encodeURIComponent(`${r.owner}/${r.repo}`)
const mrPath = (r: PrRef) => `/projects/${pid(r)}/merge_requests/${r.number}`
const webUrl = (r: PrRef) => `https://${r.host}/${r.owner}/${r.repo}/-/merge_requests/${r.number}`

interface Note {
  id: number
  body: string
  system?: boolean
  author?: { id?: number; username?: string }
  created_at?: string
  resolvable?: boolean
  resolved?: boolean
  position?: { new_path?: string; new_line?: number | null; old_path?: string }
}
interface Discussion {
  id: string
  individual_note?: boolean
  notes: Note[]
}
interface Mr {
  iid: number
  title: string
  description?: string | null
  state: string
  draft?: boolean
  work_in_progress?: boolean
  sha: string
  source_branch: string
  target_branch: string
  author?: { username?: string }
  updated_at?: string
  source_project_id?: number
  target_project_id?: number
  project_id?: number
  diff_refs?: { base_sha: string; head_sha: string; start_sha: string } | null
}

class GitLabClient {
  constructor(private readonly o: GitLabOptions) {}
  async request(method: string, path: string, body?: unknown): Promise<Result<Response>> {
    let res: Response
    try {
      res = await this.o.fetch(`${this.o.apiUrl}${path}`, {
        method,
        headers: { accept: 'application/json', 'user-agent': this.o.userAgent, ...(this.o.token ? { 'private-token': this.o.token } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
    } catch (e) {
      return err('gitlab_unreachable', `Could not reach GitLab: ${(e as Error).message}`, true)
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const code = res.status === 401 ? 'gitlab_unauthorized' : res.status === 403 ? 'gitlab_forbidden' : res.status === 404 ? 'gitlab_not_found' : 'gitlab_error'
      return err(code, `GitLab answered ${res.status} for ${path.split('?')[0]}${text ? `: ${text.slice(0, 200)}` : ''}`, res.status >= 500)
    }
    return ok(res)
  }
  async json<T>(path: string, method = 'GET', body?: unknown): Promise<Result<T>> {
    const r = await this.request(method, path, body)
    return r.ok ? ok((r.value.status === 204 ? undefined : await r.value.json()) as T) : r
  }
  /** Follows GitLab's x-next-page header. */
  async all<T>(path: string, max = 10_000): Promise<Result<T[]>> {
    const out: T[] = []
    let page = '1'
    while (page && out.length < max) {
      const r = await this.request('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`)
      if (!r.ok) return r
      out.push(...((await r.value.json()) as T[]))
      page = r.value.headers.get('x-next-page') ?? ''
    }
    return ok(out.slice(0, max))
  }
}

const STATUS: Record<string, string> = { success: 'success', failed: 'failure', canceled: 'cancelled', skipped: 'skipped', manual: 'action_required' }

export class GitLabReader implements GitHubReader {
  readonly #c: GitLabClient
  constructor(o: GitLabOptions) {
    this.#c = new GitLabClient(o)
  }

  async readFile(repo: RepoRef, path: string, sha: string): Promise<Result<string | undefined>> {
    const r = await this.#c.request('GET', `/projects/${pid(repo)}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(sha)}`)
    if (!r.ok) return r.error.code === 'gitlab_not_found' ? ok(undefined) : r
    return ok(await r.value.text())
  }

  async listTree(repo: RepoRef, sha: string): Promise<Result<{ treeSha: string; entries: TreeEntry[]; truncated: boolean }>> {
    const r = await this.#c.all<{ path: string; type: string; id: string }>(`/projects/${pid(repo)}/repository/tree?ref=${encodeURIComponent(sha)}&recursive=true`, 20_000)
    if (!r.ok) return r
    return ok({ treeSha: sha, entries: r.value.map((e) => ({ path: e.path, type: (e.type === 'tree' ? 'tree' : e.type === 'commit' ? 'commit' : 'blob') as TreeEntry['type'], sha: e.id })), truncated: r.value.length >= 20_000 })
  }

  async listDirectory(repo: RepoRef, path: string, sha: string): Promise<Result<string[]>> {
    const r = await this.#c.all<{ name: string }>(`/projects/${pid(repo)}/repository/tree?ref=${encodeURIComponent(sha)}&path=${encodeURIComponent(path)}`, 1000)
    return r.ok ? ok(r.value.map((e) => e.name)) : r.error.code === 'gitlab_not_found' ? ok([]) : r
  }

  async listCheckResults(repo: RepoRef, sha: string): Promise<Result<CheckResult[]>> {
    const r = await this.#c.all<{ name: string; status: string; description?: string | null; target_url?: string | null }>(`/projects/${pid(repo)}/repository/commits/${encodeURIComponent(sha)}/statuses`, 500)
    if (!r.ok) return r
    return ok(r.value.map((s) => ({ kind: 'status' as const, name: s.name, conclusion: STATUS[s.status] ?? 'pending', summary: s.description ?? undefined, url: s.target_url ?? undefined })))
  }

  async downloadArchive(repo: RepoRef, sha: string): Promise<Result<Uint8Array>> {
    const r = await this.#c.request('GET', `/projects/${pid(repo)}/repository/archive.tar.gz?sha=${encodeURIComponent(sha)}`)
    return r.ok ? ok(new Uint8Array(await r.value.arrayBuffer())) : r
  }

  async listOpenPulls(repo: { host: string; owner: string; repo: string }, limit: number): Promise<Result<PullSummary[]>> {
    const r = await this.#c.json<Mr[]>(`/projects/${pid(repo)}/merge_requests?state=opened&order_by=updated_at&sort=desc&per_page=${Math.min(limit, 100)}`)
    if (!r.ok) return r
    return ok(r.value.map((m) => ({ number: m.iid, title: m.title, author: m.author?.username ?? 'ghost', headSha: m.sha, draft: m.draft ?? m.work_in_progress ?? false, updatedAt: m.updated_at ?? '' })))
  }

  async getPrContext(ref: PrRef, limits: ContextLimits): Promise<Result<PrContext>> {
    const mr = await this.#c.json<Mr>(mrPath(ref))
    if (!mr.ok) return mr
    const m = mr.value
    const refs = m.diff_refs
    if (!refs) return err('gitlab_not_ready', 'GitLab has not computed this merge request’s diff yet; try again in a moment.', true)
    const [diffs, discussions] = await Promise.all([
      this.#c.all<{ old_path: string; new_path: string; new_file: boolean; renamed_file: boolean; deleted_file: boolean; diff: string; too_large?: boolean }>(`${mrPath(ref)}/diffs`, limits.maxFiles),
      this.#c.all<Discussion>(`${mrPath(ref)}/discussions`),
    ])
    if (!diffs.ok) return diffs
    if (!discussions.ok) return discussions
    const truncated: string[] = []
    let budget = limits.maxTotalBytes
    const files: PrContext['files'] = []
    for (const d of diffs.value) {
      const lines = d.diff ? d.diff.split('\n') : []
      const binary = !d.diff && !d.too_large && !d.new_file && !d.deleted_file && !d.renamed_file
      const file: PrContext['files'][number] = {
        path: d.new_path,
        ...(d.renamed_file ? { previousPath: d.old_path } : {}),
        status: d.new_file ? 'added' : d.deleted_file ? 'removed' : d.renamed_file ? 'renamed' : 'modified',
        additions: lines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length,
        deletions: lines.filter((l) => l.startsWith('-') && !l.startsWith('---')).length,
        binary,
        ...(d.diff ? { patch: d.diff.replace(/\n$/, '') } : {}),
        patchTruncated: d.too_large === true,
      }
      if (d.too_large) truncated.push(`Diff for ${d.new_path} was too large for GitLab to return.`)
      const load = async (sha: string, path: string) => {
        const t = await this.readFile(ref, path, sha)
        if (!t.ok || t.value === undefined) return { omitted: 'unavailable' as const }
        if (t.value.length > limits.maxFileBytes) return { omitted: 'too_large' as const }
        if (t.value.length > budget) return { omitted: 'total_limit' as const }
        budget -= t.value.length
        return { text: t.value }
      }
      if (!binary && !d.deleted_file) file.head = await load(refs.head_sha, d.new_path)
      if (!binary && !d.new_file) file.base = await load(refs.base_sha, d.old_path)
      files.push(file)
    }
    if (diffs.value.length >= limits.maxFiles) truncated.push(`Only the first ${limits.maxFiles} changed files were loaded.`)
    const notes = discussions.value.flatMap((d) => d.notes.filter((n) => !n.system).map((n) => ({ n, diff: !!d.notes[0]?.position })))
    const comment = (n: Note) => ({ id: n.id, author: n.author?.username ?? 'ghost', body: n.body, createdAt: n.created_at ?? '', ...(n.position?.new_path ? { path: n.position.new_path } : {}), ...(n.position?.new_line ? { line: n.position.new_line } : {}) })
    return ok({
      schemaVersion: 1,
      ref: { host: ref.host, owner: ref.owner, repo: ref.repo, number: ref.number },
      ...(m.target_project_id ? { repoId: m.target_project_id } : {}),
      title: m.title,
      body: m.description ?? '',
      author: m.author?.username ?? 'ghost',
      state: m.state === 'opened' ? 'open' : m.state,
      draft: m.draft ?? m.work_in_progress ?? false,
      baseRef: m.target_branch,
      headRef: m.source_branch,
      baseSha: refs.start_sha,
      headSha: refs.head_sha,
      mergeBaseSha: refs.base_sha,
      fromFork: m.source_project_id !== undefined && m.target_project_id !== undefined && m.source_project_id !== m.target_project_id,
      files,
      reviews: [],
      reviewComments: notes.filter((x) => x.diff).map((x) => comment(x.n)),
      issueComments: notes.filter((x) => !x.diff).map((x) => comment(x.n)),
      truncated,
    } as PrContext)
  }

  async viewer(): Promise<Result<{ id: number; login: string }>> {
    const r = await this.#c.json<{ id: number; username: string }>('/user')
    return r.ok ? ok({ id: r.value.id, login: r.value.username }) : r
  }

  async getHeadSha(ref: PrRef): Promise<Result<string>> {
    const r = await this.#c.json<Mr>(mrPath(ref))
    return r.ok ? ok(r.value.sha) : r
  }

  async listPublished(ref: PrRef): Promise<Result<PublishedItems>> {
    const r = await this.#c.all<Discussion>(`${mrPath(ref)}/discussions`)
    if (!r.ok) return r
    const items: PublishedItems = { reviews: [], reviewComments: [], issueComments: [] }
    for (const d of r.value) {
      const first = d.notes[0]
      for (const n of d.notes) {
        if (n.system) continue
        const base: PublishedItem = { id: n.id, authorId: n.author?.id, body: n.body, createdAt: n.created_at, url: `${webUrl(ref)}#note_${n.id}`, authorLogin: n.author?.username }
        if (first?.position) {
          items.reviewComments.push({ ...base, ...(n !== first ? { inReplyTo: first.id } : {}), path: first.position.new_path ?? first.position.old_path, ...(first.position.new_line ? { line: first.position.new_line } : {}), outdated: false })
        } else {
          items.issueComments.push(base)
          // GitLab has no review objects: the note that carries a review marker stands in for one.
          if (/kind=review\b/.test(n.body)) items.reviews.push({ ...base, state: 'COMMENTED' })
        }
      }
    }
    return ok(items)
  }

  async listThumbsDown(ref: PrRef, commentId: number): Promise<Result<string[]>> {
    const r = await this.#c.json<Array<{ name: string; user?: { username?: string } }>>(`${mrPath(ref)}/notes/${commentId}/award_emoji`)
    return r.ok ? ok(r.value.filter((e) => e.name === 'thumbsdown').map((e) => e.user?.username ?? '')) : r
  }

  async searchCommentedPulls(): Promise<Result<Array<{ owner: string; repo: string; number: number; title: string; author: string }>>> {
    return ok([])
  }

  async canPush(repo: RepoRef, login: string): Promise<Result<boolean>> {
    const r = await this.#c.json<Array<{ username: string; access_level: number }>>(`/projects/${pid(repo)}/members/all?query=${encodeURIComponent(login)}`)
    // Developer (30) and above can push.
    return r.ok ? ok(r.value.some((m) => m.username.toLowerCase() === login.toLowerCase() && m.access_level >= 30)) : r
  }

  async changedPathsBetween(repo: RepoRef, base: string, head: string): Promise<Result<{ status: string; paths: string[] }>> {
    const mb = await this.#c.json<{ id: string }>(`/projects/${pid(repo)}/repository/merge_base?refs[]=${encodeURIComponent(base)}&refs[]=${encodeURIComponent(head)}`)
    if (!mb.ok) return mb
    if (mb.value.id !== base) return ok({ status: 'diverged', paths: [] })
    const cmp = await this.#c.json<{ diffs?: Array<{ new_path: string; old_path: string }> }>(`/projects/${pid(repo)}/repository/compare?from=${encodeURIComponent(base)}&to=${encodeURIComponent(head)}`)
    if (!cmp.ok) return cmp
    return ok({ status: 'ahead', paths: (cmp.value.diffs ?? []).flatMap((d) => (d.old_path !== d.new_path ? [d.new_path, d.old_path] : [d.new_path])) })
  }
}

export class GitLabWriter implements GitHubWriter {
  readonly #c: GitLabClient
  constructor(o: GitLabOptions) {
    this.#c = new GitLabClient(o)
  }

  async #discussionOf(ref: PrRef, noteId: number): Promise<Result<Discussion | undefined>> {
    const r = await this.#c.all<Discussion>(`${mrPath(ref)}/discussions`)
    return r.ok ? ok(r.value.find((d) => d.notes.some((n) => n.id === noteId))) : r
  }

  async createReview(ref: PrRef, review: { commitId: string; event?: 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE' | undefined; body: string; comments: readonly InlineComment[] }): Promise<Result<{ id: number; url: string }>> {
    const mr = await this.#c.json<Mr>(mrPath(ref))
    if (!mr.ok) return mr
    const refs = mr.value.diff_refs
    if (!refs || refs.head_sha !== review.commitId) return err('head_moved', 'The merge request moved to a new commit; review it again.')
    for (const c of review.comments) {
      const posted = await this.#c.json<Discussion>(`${mrPath(ref)}/discussions`, 'POST', {
        body: c.body,
        position: { position_type: 'text', base_sha: refs.base_sha, start_sha: refs.start_sha, head_sha: refs.head_sha, new_path: c.path, old_path: c.path, new_line: c.line },
      })
      if (!posted.ok) return posted
    }
    const note = await this.#c.json<Note>(`${mrPath(ref)}/notes`, 'POST', { body: review.body })
    if (!note.ok) return note
    if (review.event === 'APPROVE') {
      const approved = await this.#c.json<unknown>(`${mrPath(ref)}/approve`, 'POST', { sha: review.commitId })
      if (!approved.ok) return approved
    }
    return ok({ id: note.value.id, url: `${webUrl(ref)}#note_${note.value.id}` })
  }

  async commitFile(repo: RepoRef, change: { branch: string; path: string; content: string; message: string; expectedHead: string }): Promise<Result<{ commitSha: string; url?: string | undefined }>> {
    const branch = await this.#c.json<{ commit: { id: string } }>(`/projects/${pid(repo)}/repository/branches/${encodeURIComponent(change.branch)}`)
    if (!branch.ok) return branch
    if (branch.value.commit.id !== change.expectedHead) return err('head_moved', 'The branch moved since the review; review it again, then commit the fix.')
    const r = await this.#c.json<{ id: string; web_url?: string }>(`/projects/${pid(repo)}/repository/commits`, 'POST', {
      branch: change.branch,
      commit_message: change.message,
      actions: [{ action: 'update', file_path: change.path, content: change.content, last_commit_id: change.expectedHead }],
    })
    return r.ok ? ok({ commitSha: r.value.id, url: r.value.web_url }) : r
  }

  async createIssueComment(ref: PrRef, body: string): Promise<Result<{ id: number; url: string }>> {
    const r = await this.#c.json<Note>(`${mrPath(ref)}/notes`, 'POST', { body })
    return r.ok ? ok({ id: r.value.id, url: `${webUrl(ref)}#note_${r.value.id}` }) : r
  }

  async replyToReviewComment(ref: PrRef, commentId: number, body: string): Promise<Result<{ id: number; url: string }>> {
    const d = await this.#discussionOf(ref, commentId)
    if (!d.ok) return d
    if (!d.value) return err('gitlab_not_found', 'That discussion no longer exists.')
    const r = await this.#c.json<Note>(`${mrPath(ref)}/discussions/${d.value.id}/notes`, 'POST', { body })
    return r.ok ? ok({ id: r.value.id, url: `${webUrl(ref)}#note_${r.value.id}` }) : r
  }

  async updateIssueComment(ref: PrRef, id: number, body: string): Promise<Result<{ id: number; url: string }>> {
    const r = await this.#c.json<Note>(`${mrPath(ref)}/notes/${id}`, 'PUT', { body })
    return r.ok ? ok({ id: r.value.id, url: `${webUrl(ref)}#note_${r.value.id}` }) : r
  }

  async deleteIssueComment(ref: PrRef, id: number): Promise<Result<void>> {
    const r = await this.#c.request('DELETE', `${mrPath(ref)}/notes/${id}`)
    return r.ok ? ok(undefined) : r
  }

  async resolveThreads(ref: PrRef, commentIds: readonly number[]): Promise<Result<number>> {
    if (!commentIds.length) return ok(0)
    const r = await this.#c.all<Discussion>(`${mrPath(ref)}/discussions`)
    if (!r.ok) return r
    let n = 0
    for (const d of r.value) {
      const first = d.notes[0]
      if (!first || !commentIds.includes(first.id) || !first.resolvable || first.resolved) continue
      const done = await this.#c.request('PUT', `${mrPath(ref)}/discussions/${d.id}?resolved=true`)
      if (done.ok) n++
    }
    return ok(n)
  }

  async createCommitStatus(ref: PrRef, sha: string, status: { state: 'success' | 'failure' | 'error'; description: string; context: string; targetUrl?: string | undefined }): Promise<Result<void>> {
    const r = await this.#c.request('POST', `/projects/${pid(ref)}/statuses/${encodeURIComponent(sha)}`, {
      state: status.state === 'success' ? 'success' : 'failed',
      name: status.context,
      description: status.description.slice(0, 140),
      ...(status.targetUrl ? { target_url: status.targetUrl } : {}),
    })
    return r.ok ? ok(undefined) : r
  }
}
