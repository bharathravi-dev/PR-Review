// Bitbucket Cloud pull requests (roadmap item 10): the same reader and writer ports as GitHub and GitLab. A
// workspace is the owner, a repository slug the repo. Account UUIDs become stable numbers for markers.
import { err, ok, type CheckResult, type ContextLimits, type GitHubReader, type GitHubWriter, type InlineComment, type PrContext, type PrRef, type PublishedItem, type PublishedItems, type PullSummary, type RepoRef, type Result, type TreeEntry } from '@pr-reviewer/core'

export interface BitbucketOptions {
  /** https://api.bitbucket.org/2.0 */
  apiUrl?: string | undefined
  /** An access token (Bearer) or "username:app-password" (Basic). */
  token?: string | undefined
  fetch: typeof fetch
  userAgent: string
}

const API = 'https://api.bitbucket.org/2.0'
const repoPath = (r: RepoRef) => `/repositories/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.repo)}`
const prPath = (r: PrRef) => `${repoPath(r)}/pullrequests/${r.number}`
const webUrl = (r: PrRef) => `https://bitbucket.org/${r.owner}/${r.repo}/pull-requests/${r.number}`

/** A stable number for a Bitbucket account UUID ("{8-4-4-4-12}"): its first 52 bits. */
export const accountNumber = (uuid: string | undefined) => (uuid ? Number.parseInt(uuid.replace(/[^0-9a-f]/gi, '').slice(0, 13), 16) : undefined)

interface Comment {
  id: number
  content?: { raw?: string }
  user?: { uuid?: string; nickname?: string; display_name?: string }
  inline?: { path?: string; to?: number | null; from?: number | null }
  parent?: { id: number }
  created_on?: string
  deleted?: boolean
  resolution?: unknown
  links?: { html?: { href?: string } }
}
interface Pr {
  id: number
  title: string
  description?: string
  state: string
  draft?: boolean
  author?: { nickname?: string; display_name?: string }
  updated_on?: string
  source: { branch: { name: string }; commit: { hash: string }; repository?: { full_name?: string } }
  destination: { branch: { name: string }; commit: { hash: string }; repository?: { full_name?: string } }
}

const STATE: Record<string, string> = { SUCCESSFUL: 'success', FAILED: 'failure', STOPPED: 'cancelled', INPROGRESS: 'pending' }

class Client {
  constructor(private readonly o: BitbucketOptions) {}
  get api() {
    return (this.o.apiUrl ?? API).replace(/\/+$/, '')
  }
  async request(method: string, pathOrUrl: string, body?: unknown, form?: FormData): Promise<Result<Response>> {
    const auth = this.o.token ? (this.o.token.includes(':') ? `Basic ${Buffer.from(this.o.token).toString('base64')}` : `Bearer ${this.o.token}`) : undefined
    let res: Response
    try {
      res = await this.o.fetch(pathOrUrl.startsWith('http') ? pathOrUrl : `${this.api}${pathOrUrl}`, {
        method,
        headers: { accept: 'application/json', 'user-agent': this.o.userAgent, ...(auth ? { authorization: auth } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : form ? { body: form } : {}),
      })
    } catch (e) {
      return err('bitbucket_unreachable', `Could not reach Bitbucket: ${(e as Error).message}`, true)
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return err(res.status === 404 ? 'bitbucket_not_found' : res.status === 401 ? 'bitbucket_unauthorized' : 'bitbucket_error', `Bitbucket answered ${res.status} for ${pathOrUrl.split('?')[0]}${text ? `: ${text.slice(0, 200)}` : ''}`, res.status >= 500)
    }
    return ok(res)
  }
  async json<T>(path: string, method = 'GET', body?: unknown): Promise<Result<T>> {
    const r = await this.request(method, path, body)
    return r.ok ? ok((r.value.status === 204 ? undefined : await r.value.json()) as T) : r
  }
  /** Follows Bitbucket's `next` links. */
  async all<T>(path: string, max = 5000): Promise<Result<T[]>> {
    const out: T[] = []
    let next: string | undefined = `${path}${path.includes('?') ? '&' : '?'}pagelen=100`
    while (next && out.length < max) {
      const r: Result<{ values?: T[]; next?: string }> = await this.json(next)
      if (!r.ok) return r
      out.push(...(r.value.values ?? []))
      next = r.value.next
    }
    return ok(out.slice(0, max))
  }
}

/** Splits a unified diff into per-file patches (from the first @@), keyed by the new path. */
function patches(diff: string): Map<string, { patch?: string; binary: boolean }> {
  const out = new Map<string, { patch?: string; binary: boolean }>()
  for (const chunk of diff.split(/^diff --git /m).slice(1)) {
    const name = /^\+\+\+ (?:b\/)?(.+)$/m.exec(chunk)?.[1] ?? /^a\/\S+ b\/(\S+)/.exec(chunk)?.[1]
    if (!name || name === '/dev/null') {
      const old = /^--- (?:a\/)?(.+)$/m.exec(chunk)?.[1]
      if (old) out.set(old, { binary: false, ...(chunk.includes('\n@@') ? { patch: chunk.slice(chunk.indexOf('\n@@') + 1).replace(/\n$/, '') } : {}) })
      continue
    }
    if (/^Binary files /m.test(chunk)) out.set(name, { binary: true })
    else out.set(name, { binary: false, ...(chunk.includes('\n@@') ? { patch: chunk.slice(chunk.indexOf('\n@@') + 1).replace(/\n$/, '') } : {}) })
  }
  return out
}

export class BitbucketReader implements GitHubReader {
  readonly #c: Client
  constructor(o: BitbucketOptions) {
    this.#c = new Client(o)
  }

  /** PR payloads carry 12-character hashes; markers and head checks need the full one. */
  async #full(repo: RepoRef, hash: string): Promise<string> {
    if (hash.length >= 40) return hash
    const r = await this.#c.json<{ hash: string }>(`${repoPath(repo)}/commit/${encodeURIComponent(hash)}`)
    return r.ok ? r.value.hash : hash
  }

  async readFile(repo: RepoRef, path: string, sha: string): Promise<Result<string | undefined>> {
    const r = await this.#c.request('GET', `${repoPath(repo)}/src/${encodeURIComponent(sha)}/${path.split('/').map(encodeURIComponent).join('/')}`)
    if (!r.ok) return r.error.code === 'bitbucket_not_found' ? ok(undefined) : r
    return ok(await r.value.text())
  }

  async listTree(repo: RepoRef, sha: string): Promise<Result<{ treeSha: string; entries: TreeEntry[]; truncated: boolean }>> {
    const r = await this.#c.all<{ path: string; type: string; commit?: { hash?: string }; size?: number }>(`${repoPath(repo)}/src/${encodeURIComponent(sha)}/?max_depth=50`, 20_000)
    if (!r.ok) return r
    return ok({ treeSha: sha, entries: r.value.map((e) => ({ path: e.path, type: e.type === 'commit_directory' ? 'tree' : 'blob', sha: `${sha}:${e.path}`, ...(e.size !== undefined ? { size: e.size } : {}) })), truncated: r.value.length >= 20_000 })
  }

  async listDirectory(repo: RepoRef, path: string, sha: string): Promise<Result<string[]>> {
    const r = await this.#c.all<{ path: string }>(`${repoPath(repo)}/src/${encodeURIComponent(sha)}/${path ? `${path.split('/').map(encodeURIComponent).join('/')}/` : ''}`, 1000)
    return r.ok ? ok(r.value.map((e) => e.path.split('/').pop()!)) : r.error.code === 'bitbucket_not_found' ? ok([]) : r
  }

  async listCheckResults(repo: RepoRef, sha: string): Promise<Result<CheckResult[]>> {
    const r = await this.#c.all<{ key: string; name?: string; state: string; description?: string; url?: string }>(`${repoPath(repo)}/commit/${encodeURIComponent(sha)}/statuses`, 500)
    if (!r.ok) return r
    return ok(r.value.map((s) => ({ kind: 'status' as const, name: s.name ?? s.key, conclusion: STATE[s.state] ?? 'pending', summary: s.description, url: s.url })))
  }

  async downloadArchive(repo: RepoRef, sha: string): Promise<Result<Uint8Array>> {
    const r = await this.#c.request('GET', `https://bitbucket.org/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/get/${encodeURIComponent(sha)}.tar.gz`)
    return r.ok ? ok(new Uint8Array(await r.value.arrayBuffer())) : r
  }

  async listOpenPulls(repo: { host: string; owner: string; repo: string }, limit: number): Promise<Result<PullSummary[]>> {
    const r = await this.#c.json<{ values: Pr[] }>(`${repoPath(repo)}/pullrequests?state=OPEN&sort=-updated_on&pagelen=${Math.min(limit, 50)}`)
    if (!r.ok) return r
    return ok(r.value.values.map((p) => ({ number: p.id, title: p.title, author: p.author?.nickname ?? p.author?.display_name ?? 'ghost', headSha: p.source.commit.hash, draft: p.draft ?? false, updatedAt: p.updated_on ?? '' })))
  }

  async getPrContext(ref: PrRef, limits: ContextLimits): Promise<Result<PrContext>> {
    const pr = await this.#c.json<Pr>(prPath(ref))
    if (!pr.ok) return pr
    const p = pr.value
    const head = await this.#full(ref, p.source.commit.hash)
    const base = await this.#full(ref, p.destination.commit.hash)
    const mb = await this.#c.json<{ hash: string }>(`${repoPath(ref)}/merge-base/${encodeURIComponent(`${head}..${base}`)}`)
    const mergeBase = mb.ok ? mb.value.hash : base
    const [stat, diff, comments] = await Promise.all([
      this.#c.all<{ status: string; old?: { path: string } | null; new?: { path: string } | null; lines_added?: number; lines_removed?: number }>(`${prPath(ref)}/diffstat`, limits.maxFiles),
      this.#c.request('GET', `${prPath(ref)}/diff`),
      this.#c.all<Comment>(`${prPath(ref)}/comments`),
    ])
    if (!stat.ok) return stat
    if (!diff.ok) return diff
    if (!comments.ok) return comments
    const byPath = patches(await diff.value.text())
    const truncated: string[] = []
    let budget = limits.maxTotalBytes
    const files: PrContext['files'] = []
    const load = async (sha: string, path: string) => {
      const t = await this.readFile(ref, path, sha)
      if (!t.ok || t.value === undefined) return { omitted: 'unavailable' as const }
      if (t.value.length > limits.maxFileBytes) return { omitted: 'too_large' as const }
      if (t.value.length > budget) return { omitted: 'total_limit' as const }
      budget -= t.value.length
      return { text: t.value }
    }
    for (const s of stat.value) {
      const path = s.new?.path ?? s.old?.path ?? ''
      const status = s.status === 'added' ? 'added' : s.status === 'removed' ? 'removed' : s.status === 'renamed' ? 'renamed' : 'modified'
      const d = byPath.get(path) ?? { binary: false }
      const file: PrContext['files'][number] = {
        path,
        ...(status === 'renamed' && s.old?.path ? { previousPath: s.old.path } : {}),
        status,
        additions: s.lines_added ?? 0,
        deletions: s.lines_removed ?? 0,
        binary: d.binary,
        ...(d.patch ? { patch: d.patch } : {}),
        patchTruncated: !d.patch && !d.binary && (s.lines_added ?? 0) + (s.lines_removed ?? 0) > 0,
      }
      if (!file.binary && status !== 'removed') file.head = await load(head, path)
      if (!file.binary && status !== 'added') file.base = await load(mergeBase, s.old?.path ?? path)
      files.push(file)
    }
    if (stat.value.length >= limits.maxFiles) truncated.push(`Only the first ${limits.maxFiles} changed files were loaded.`)
    const live = comments.value.filter((c) => !c.deleted)
    const comment = (c: Comment) => ({ id: c.id, author: c.user?.nickname ?? c.user?.display_name ?? 'ghost', body: c.content?.raw ?? '', createdAt: c.created_on ?? '', ...(c.inline?.path ? { path: c.inline.path } : {}), ...(c.inline?.to ? { line: c.inline.to } : {}) })
    return ok({
      schemaVersion: 1,
      ref: { host: ref.host, owner: ref.owner, repo: ref.repo, number: ref.number },
      title: p.title,
      body: p.description ?? '',
      author: p.author?.nickname ?? p.author?.display_name ?? 'ghost',
      state: p.state === 'OPEN' ? 'open' : p.state.toLowerCase(),
      draft: p.draft ?? false,
      baseRef: p.destination.branch.name,
      headRef: p.source.branch.name,
      baseSha: base,
      headSha: head,
      mergeBaseSha: mergeBase,
      ...(p.source.repository?.full_name ? { headRepo: p.source.repository.full_name } : {}),
      fromFork: !!p.source.repository?.full_name && p.source.repository.full_name !== p.destination.repository?.full_name,
      files,
      reviews: [],
      reviewComments: live.filter((c) => c.inline).map(comment),
      issueComments: live.filter((c) => !c.inline).map(comment),
      truncated,
    } as PrContext)
  }

  async viewer(): Promise<Result<{ id: number; login: string }>> {
    const r = await this.#c.json<{ uuid: string; nickname?: string; username?: string }>('/user')
    return r.ok ? ok({ id: accountNumber(r.value.uuid)!, login: r.value.nickname ?? r.value.username ?? '' }) : r
  }

  async getHeadSha(ref: PrRef): Promise<Result<string>> {
    const r = await this.#c.json<Pr>(prPath(ref))
    return r.ok ? ok(await this.#full(ref, r.value.source.commit.hash)) : r
  }

  async listPublished(ref: PrRef): Promise<Result<PublishedItems>> {
    const r = await this.#c.all<Comment>(`${prPath(ref)}/comments`)
    if (!r.ok) return r
    const items: PublishedItems = { reviews: [], reviewComments: [], issueComments: [] }
    const byId = new Map(r.value.map((c) => [c.id, c]))
    const rootOf = (c: Comment): Comment => (c.parent && byId.get(c.parent.id) ? rootOf(byId.get(c.parent.id)!) : c)
    for (const c of r.value) {
      if (c.deleted) continue
      const root = rootOf(c)
      const base: PublishedItem = { id: c.id, authorId: accountNumber(c.user?.uuid), body: c.content?.raw ?? '', createdAt: c.created_on, url: c.links?.html?.href ?? `${webUrl(ref)}#comment-${c.id}`, authorLogin: c.user?.nickname }
      if (root.inline) {
        items.reviewComments.push({ ...base, ...(root !== c ? { inReplyTo: root.id } : {}), path: root.inline.path, ...(root.inline.to ? { line: root.inline.to } : {}), outdated: false })
      } else {
        items.issueComments.push(base)
        if (/kind=review\b/.test(base.body)) items.reviews.push({ ...base, state: 'COMMENTED' })
      }
    }
    return ok(items)
  }

  async listThumbsDown(): Promise<Result<string[]>> {
    return ok([])
  }

  async searchCommentedPulls(): Promise<Result<Array<{ owner: string; repo: string; number: number; title: string; author: string }>>> {
    return ok([])
  }

  async canPush(repo: RepoRef, login: string): Promise<Result<boolean>> {
    const r = await this.#c.json<{ values?: Array<{ permission: string; user?: { nickname?: string } }> }>(`/workspaces/${encodeURIComponent(repo.owner)}/permissions/repositories/${encodeURIComponent(repo.repo)}?q=${encodeURIComponent(`user.nickname="${login.replace(/"/g, '')}"`)}`)
    return r.ok ? ok((r.value.values ?? []).some((v) => v.permission === 'write' || v.permission === 'admin')) : r
  }

  async changedPathsBetween(repo: RepoRef, base: string, head: string): Promise<Result<{ status: string; paths: string[] }>> {
    const mb = await this.#c.json<{ hash: string }>(`${repoPath(repo)}/merge-base/${encodeURIComponent(`${head}..${base}`)}`)
    if (!mb.ok) return mb
    if (!mb.value.hash.startsWith(base) && !base.startsWith(mb.value.hash)) return ok({ status: 'diverged', paths: [] })
    const stat = await this.#c.all<{ old?: { path: string } | null; new?: { path: string } | null }>(`${repoPath(repo)}/diffstat/${encodeURIComponent(`${head}..${base}`)}`)
    if (!stat.ok) return stat
    return ok({ status: 'ahead', paths: stat.value.flatMap((s) => [s.new?.path, s.old?.path].filter((p): p is string => !!p)) })
  }

  async searchCode(q: { repo?: RepoRef; owner?: string; symbol: string; limit: number }): Promise<Result<Array<{ repo: string; path: string; fragments: string[] }>>> {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(q.symbol)) return ok([])
    const ws = q.repo?.owner ?? q.owner ?? ''
    const query = q.repo ? `${q.symbol} repo:${q.repo.repo}` : q.symbol
    const r = await this.#c.json<{ values?: Array<{ file?: { path?: string; links?: { self?: { href?: string } } }; content_matches?: Array<{ lines?: Array<{ segments?: Array<{ text?: string }> }> }> }> }>(`/workspaces/${encodeURIComponent(ws)}/search/code?search_query=${encodeURIComponent(query)}&pagelen=${Math.min(q.limit, 30)}`)
    if (!r.ok) return r
    return ok(
      (r.value.values ?? []).map((v) => {
        const repoSlug = /\/repositories\/[^/]+\/([^/]+)\//.exec(v.file?.links?.self?.href ?? '')?.[1] ?? q.repo?.repo ?? ''
        return { repo: `${ws}/${decodeURIComponent(repoSlug)}`, path: v.file?.path ?? '', fragments: (v.content_matches ?? []).map((m) => (m.lines ?? []).map((l) => (l.segments ?? []).map((s) => s.text ?? '').join('')).join('\n')) }
      }),
    )
  }
}

export class BitbucketWriter implements GitHubWriter {
  readonly #c: Client
  constructor(o: BitbucketOptions) {
    this.#c = new Client(o)
  }

  async createReview(ref: PrRef, review: { commitId: string; event?: 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE' | undefined; body: string; comments: readonly InlineComment[] }): Promise<Result<{ id: number; url: string }>> {
    const pr = await this.#c.json<Pr>(prPath(ref))
    if (!pr.ok) return pr
    if (!review.commitId.startsWith(pr.value.source.commit.hash)) return err('head_moved', 'The pull request moved to a new commit; review it again.')
    for (const c of review.comments) {
      const posted = await this.#c.json<Comment>(`${prPath(ref)}/comments`, 'POST', { content: { raw: c.body }, inline: { path: c.path, to: c.line } })
      if (!posted.ok) return posted
    }
    const note = await this.#c.json<Comment>(`${prPath(ref)}/comments`, 'POST', { content: { raw: review.body } })
    if (!note.ok) return note
    if (review.event === 'APPROVE') {
      const a = await this.#c.json<unknown>(`${prPath(ref)}/approve`, 'POST')
      if (!a.ok) return a
    }
    if (review.event === 'REQUEST_CHANGES') {
      const a = await this.#c.json<unknown>(`${prPath(ref)}/request-changes`, 'POST')
      if (!a.ok) return a
    }
    return ok({ id: note.value.id, url: note.value.links?.html?.href ?? `${webUrl(ref)}#comment-${note.value.id}` })
  }

  async createIssueComment(ref: PrRef, body: string): Promise<Result<{ id: number; url: string }>> {
    const r = await this.#c.json<Comment>(`${prPath(ref)}/comments`, 'POST', { content: { raw: body } })
    return r.ok ? ok({ id: r.value.id, url: r.value.links?.html?.href ?? `${webUrl(ref)}#comment-${r.value.id}` }) : r
  }

  async replyToReviewComment(ref: PrRef, commentId: number, body: string): Promise<Result<{ id: number; url: string }>> {
    const r = await this.#c.json<Comment>(`${prPath(ref)}/comments`, 'POST', { content: { raw: body }, parent: { id: commentId } })
    return r.ok ? ok({ id: r.value.id, url: r.value.links?.html?.href ?? `${webUrl(ref)}#comment-${r.value.id}` }) : r
  }

  async updateIssueComment(ref: PrRef, id: number, body: string): Promise<Result<{ id: number; url: string }>> {
    const r = await this.#c.json<Comment>(`${prPath(ref)}/comments/${id}`, 'PUT', { content: { raw: body } })
    return r.ok ? ok({ id: r.value.id, url: r.value.links?.html?.href ?? `${webUrl(ref)}#comment-${id}` }) : r
  }

  async deleteIssueComment(ref: PrRef, id: number): Promise<Result<void>> {
    const r = await this.#c.request('DELETE', `${prPath(ref)}/comments/${id}`)
    return r.ok ? ok(undefined) : r
  }

  async resolveThreads(ref: PrRef, commentIds: readonly number[]): Promise<Result<number>> {
    let n = 0
    for (const id of commentIds) if ((await this.#c.request('POST', `${prPath(ref)}/comments/${id}/resolve`)).ok) n++
    return ok(n)
  }

  async createCommitStatus(ref: PrRef, sha: string, status: { state: 'success' | 'failure' | 'error'; description: string; context: string; targetUrl?: string | undefined }): Promise<Result<void>> {
    const r = await this.#c.request('POST', `${repoPath(ref)}/commit/${encodeURIComponent(sha)}/statuses/build`, {
      state: status.state === 'success' ? 'SUCCESSFUL' : 'FAILED',
      key: status.context.slice(0, 40),
      name: status.context,
      description: status.description.slice(0, 255),
      url: status.targetUrl ?? webUrl(ref),
    })
    return r.ok ? ok(undefined) : r
  }

  async commitFile(repo: RepoRef, change: { branch: string; path: string; content: string; message: string; expectedHead: string }): Promise<Result<{ commitSha: string; url?: string | undefined }>> {
    const branch = await this.#c.json<{ target: { hash: string } }>(`${repoPath(repo)}/refs/branches/${encodeURIComponent(change.branch)}`)
    if (!branch.ok) return branch
    if (branch.value.target.hash !== change.expectedHead) return err('head_moved', 'The branch moved since the review; review it again, then commit the fix.')
    const form = new FormData()
    form.set(change.path, change.content)
    form.set('message', change.message)
    form.set('branch', change.branch)
    form.set('parents', change.expectedHead)
    const r = await this.#c.request('POST', `${repoPath(repo)}/src`, undefined, form)
    if (!r.ok) return r
    const after = await this.#c.json<{ target: { hash: string } }>(`${repoPath(repo)}/refs/branches/${encodeURIComponent(change.branch)}`)
    return ok({ commitSha: after.ok ? after.value.target.hash : '' })
  }
}
