// Azure DevOps (Azure Repos) pull requests: the same reader and writer ports. The owner is "<organisation>/<project>",
// the repo the repository name. Azure returns file versions but no patch, so patches are computed (unifiedDiff).
// Comment ids are unique only within a thread, so each becomes thread × 1000 + comment.
import { err, ok, unifiedDiff, type CheckResult, type ContextLimits, type GitHubReader, type GitHubWriter, type InlineComment, type PrContext, type PrRef, type PublishedItem, type PublishedItems, type PullSummary, type RepoRef, type Result, type TreeEntry } from '@pr-reviewer/core'

export interface AzureDevOpsOptions {
  /** A personal access token (Code: Read & Write; Pull Request Threads). */
  token?: string | undefined
  /** The organisation, for the token's identity (viewer). */
  organisation?: string | undefined
  fetch: typeof fetch
  userAgent: string
}

const V = 'api-version=7.1'
const org = (r: RepoRef) => r.owner.split('/')[0]!
const project = (r: RepoRef) => r.owner.split('/').slice(1).join('/')
const repoUrl = (r: RepoRef) => `https://dev.azure.com/${encodeURIComponent(org(r))}/${encodeURIComponent(project(r))}/_apis/git/repositories/${encodeURIComponent(r.repo)}`
const prUrl = (r: PrRef) => `${repoUrl(r)}/pullrequests/${r.number}`
const webUrl = (r: PrRef) => `https://dev.azure.com/${org(r)}/${project(r)}/_git/${r.repo}/pullrequest/${r.number}`
const branchName = (ref: string) => ref.replace(/^refs\/heads\//, '')
/** Azure identity ids are GUIDs; markers need numbers. */
const idNumber = (guid: string | undefined) => (guid ? Number.parseInt(guid.replace(/[^0-9a-f]/gi, '').slice(0, 13), 16) : undefined)
const commentId = (thread: number, comment: number) => thread * 1000 + comment

interface Thread {
  id: number
  isDeleted?: boolean
  status?: string
  threadContext?: { filePath?: string; rightFileStart?: { line: number }; rightFileEnd?: { line: number } } | null
  comments: Array<{ id: number; parentCommentId?: number; content?: string; isDeleted?: boolean; commentType?: string; publishedDate?: string; author?: { id?: string; uniqueName?: string; displayName?: string } }>
}
interface Pr {
  pullRequestId: number
  title: string
  description?: string
  status: string
  isDraft?: boolean
  createdBy?: { uniqueName?: string; displayName?: string }
  sourceRefName: string
  targetRefName: string
  lastMergeSourceCommit?: { commitId: string }
  lastMergeTargetCommit?: { commitId: string }
  forkSource?: { repository?: { name?: string } } | null
  creationDate?: string
}

class Client {
  constructor(private readonly o: AzureDevOpsOptions) {}
  async request(method: string, url: string, body?: unknown, accept = 'application/json'): Promise<Result<Response>> {
    let res: Response
    try {
      res = await this.o.fetch(`${url}${url.includes('?') ? '&' : '?'}${V}`, {
        method,
        headers: { accept, 'user-agent': this.o.userAgent, ...(this.o.token ? { authorization: `Basic ${Buffer.from(`:${this.o.token}`).toString('base64')}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
    } catch (e) {
      return err('azure_unreachable', `Could not reach Azure DevOps: ${(e as Error).message}`, true)
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return err(res.status === 404 ? 'azure_not_found' : res.status === 401 || res.status === 203 ? 'azure_unauthorized' : 'azure_error', `Azure DevOps answered ${res.status} for ${url.split('?')[0]}${text ? `: ${text.slice(0, 200)}` : ''}`, res.status >= 500)
    }
    return ok(res)
  }
  async json<T>(url: string, method = 'GET', body?: unknown): Promise<Result<T>> {
    const r = await this.request(method, url, body)
    return r.ok ? ok((r.value.status === 204 ? undefined : await r.value.json()) as T) : r
  }
}

export class AzureDevOpsReader implements GitHubReader {
  readonly #c: Client
  readonly #org: string | undefined
  constructor(o: AzureDevOpsOptions) {
    this.#c = new Client(o)
    this.#org = o.organisation
  }

  /** A file's text at a commit, or '' when it does not exist there. */
  async #text(ref: RepoRef, path: string, sha: string): Promise<string> {
    const r = await this.readFile(ref, path, sha)
    return r.ok ? (r.value ?? '') : ''
  }

  async readFile(repo: RepoRef, path: string, sha: string): Promise<Result<string | undefined>> {
    const r = await this.#c.request('GET', `${repoUrl(repo)}/items?path=${encodeURIComponent(`/${path}`)}&versionDescriptor.versionType=commit&versionDescriptor.version=${encodeURIComponent(sha)}`, undefined, 'text/plain')
    if (!r.ok) return r.error.code === 'azure_not_found' ? ok(undefined) : r
    return ok(await r.value.text())
  }

  async listTree(repo: RepoRef, sha: string): Promise<Result<{ treeSha: string; entries: TreeEntry[]; truncated: boolean }>> {
    const r = await this.#c.json<{ value: Array<{ path: string; isFolder?: boolean; objectId: string }> }>(`${repoUrl(repo)}/items?scopePath=/&recursionLevel=Full&versionDescriptor.versionType=commit&versionDescriptor.version=${encodeURIComponent(sha)}`)
    if (!r.ok) return r
    return ok({ treeSha: sha, entries: r.value.value.filter((e) => e.path !== '/').map((e) => ({ path: e.path.replace(/^\//, ''), type: e.isFolder ? ('tree' as const) : ('blob' as const), sha: e.objectId })), truncated: false })
  }

  async listDirectory(repo: RepoRef, path: string, sha: string): Promise<Result<string[]>> {
    const r = await this.#c.json<{ value: Array<{ path: string }> }>(`${repoUrl(repo)}/items?scopePath=${encodeURIComponent(`/${path}`)}&recursionLevel=OneLevel&versionDescriptor.versionType=commit&versionDescriptor.version=${encodeURIComponent(sha)}`)
    if (!r.ok) return r.error.code === 'azure_not_found' ? ok([]) : r
    return ok(r.value.value.map((e) => e.path.split('/').pop()!).filter((n) => n && n !== path.split('/').pop()))
  }

  async listCheckResults(repo: RepoRef, sha: string): Promise<Result<CheckResult[]>> {
    const r = await this.#c.json<{ value: Array<{ state: string; description?: string; targetUrl?: string; context?: { name?: string; genre?: string } }> }>(`${repoUrl(repo)}/commits/${encodeURIComponent(sha)}/statuses`)
    if (!r.ok) return r
    const map: Record<string, string> = { succeeded: 'success', failed: 'failure', error: 'error', pending: 'pending', notApplicable: 'skipped' }
    return ok(r.value.value.map((s) => ({ kind: 'status' as const, name: [s.context?.genre, s.context?.name].filter(Boolean).join('/'), conclusion: map[s.state] ?? 'pending', summary: s.description, url: s.targetUrl })))
  }

  async downloadArchive(): Promise<Result<Uint8Array>> {
    return err('not_supported', 'Azure DevOps archives are zip files; the Sandbox needs a tar archive.')
  }

  async listOpenPulls(repo: { host: string; owner: string; repo: string }, limit: number): Promise<Result<PullSummary[]>> {
    const r = await this.#c.json<{ value: Pr[] }>(`${repoUrl(repo)}/pullrequests?searchCriteria.status=active&$top=${Math.min(limit, 100)}`)
    if (!r.ok) return r
    return ok(r.value.value.map((p) => ({ number: p.pullRequestId, title: p.title, author: p.createdBy?.uniqueName ?? 'ghost', headSha: p.lastMergeSourceCommit?.commitId ?? '', draft: p.isDraft ?? false, updatedAt: p.creationDate ?? '' })))
  }

  async getPrContext(ref: PrRef, limits: ContextLimits): Promise<Result<PrContext>> {
    const pr = await this.#c.json<Pr>(prUrl(ref))
    if (!pr.ok) return pr
    const p = pr.value
    const head = p.lastMergeSourceCommit?.commitId
    const base = p.lastMergeTargetCommit?.commitId
    if (!head || !base) return err('azure_not_ready', 'Azure DevOps has not computed this pull request’s merge yet; try again in a moment.', true)
    const mb = await this.#c.json<{ value: Array<{ commitId: string }> }>(`${repoUrl(ref)}/commits/${head}/mergebases?otherCommitId=${base}`)
    const mergeBase = mb.ok && mb.value.value[0] ? mb.value.value[0].commitId : base
    const iterations = await this.#c.json<{ value: Array<{ id: number }> }>(`${prUrl(ref)}/iterations`)
    if (!iterations.ok) return iterations
    const last = iterations.value.value.at(-1)?.id ?? 1
    const changes = await this.#c.json<{ changeEntries: Array<{ changeType: string; item?: { path?: string; isFolder?: boolean }; originalPath?: string }> }>(`${prUrl(ref)}/iterations/${last}/changes?$compareTo=0&$top=${limits.maxFiles}`)
    if (!changes.ok) return changes
    const threads = await this.#c.json<{ value: Thread[] }>(`${prUrl(ref)}/threads`)
    if (!threads.ok) return threads
    const truncated: string[] = []
    let budget = limits.maxTotalBytes
    const files: PrContext['files'] = []
    for (const c of changes.value.changeEntries) {
      if (c.item?.isFolder || !c.item?.path) continue
      const path = c.item.path.replace(/^\//, '')
      const previous = c.originalPath?.replace(/^\//, '')
      const status = c.changeType.includes('add') ? 'added' : c.changeType.includes('delete') ? 'removed' : c.changeType.includes('rename') ? 'renamed' : 'modified'
      const after = status === 'removed' ? '' : await this.#text(ref, path, head)
      const beforeText = status === 'added' ? '' : await this.#text(ref, previous ?? path, mergeBase)
      const binary = /\u0000/.test(after) || /\u0000/.test(beforeText)
      const patch = binary ? undefined : unifiedDiff(beforeText, after)
      const lines = (patch ?? '').split('\n')
      const file: PrContext['files'][number] = {
        path,
        ...(status === 'renamed' && previous ? { previousPath: previous } : {}),
        status,
        additions: lines.filter((l) => l.startsWith('+')).length,
        deletions: lines.filter((l) => l.startsWith('-')).length,
        binary,
        ...(patch ? { patch } : {}),
        patchTruncated: !binary && patch === undefined,
      }
      const keep = (text: string) => (text.length > limits.maxFileBytes ? { omitted: 'too_large' as const } : text.length > budget ? { omitted: 'total_limit' as const } : ((budget -= text.length), { text }))
      if (!binary && status !== 'removed') file.head = keep(after)
      if (!binary && status !== 'added') file.base = keep(beforeText)
      if (file.patchTruncated) truncated.push(`${path} is too large to diff here.`)
      files.push(file)
    }
    if (changes.value.changeEntries.length >= limits.maxFiles) truncated.push(`Only the first ${limits.maxFiles} changed files were loaded.`)
    const live = threads.value.value.filter((t) => !t.isDeleted)
    const comments = live.flatMap((t) => t.comments.filter((c) => !c.isDeleted && c.commentType !== 'system').map((c) => ({ t, c })))
    const summary = ({ t, c }: (typeof comments)[number]) => ({ id: commentId(t.id, c.id), author: c.author?.uniqueName ?? 'ghost', body: c.content ?? '', createdAt: c.publishedDate ?? '', ...(t.threadContext?.filePath ? { path: t.threadContext.filePath.replace(/^\//, '') } : {}), ...(t.threadContext?.rightFileEnd?.line ? { line: t.threadContext.rightFileEnd.line } : {}) })
    return ok({
      schemaVersion: 1,
      ref: { host: ref.host, owner: ref.owner, repo: ref.repo, number: ref.number },
      title: p.title,
      body: p.description ?? '',
      author: p.createdBy?.uniqueName ?? 'ghost',
      state: p.status === 'active' ? 'open' : p.status,
      draft: p.isDraft ?? false,
      baseRef: branchName(p.targetRefName),
      headRef: branchName(p.sourceRefName),
      baseSha: base,
      headSha: head,
      mergeBaseSha: mergeBase,
      fromFork: !!p.forkSource,
      files,
      reviews: [],
      reviewComments: comments.filter((x) => x.t.threadContext?.filePath).map(summary),
      issueComments: comments.filter((x) => !x.t.threadContext?.filePath).map(summary),
      truncated,
    } as PrContext)
  }

  async viewer(): Promise<Result<{ id: number; login: string }>> {
    if (this.#org) return this.viewerIn(this.#org)
    // The profile is the same identity in every organisation.
    const r = await this.#c.json<{ id?: string; emailAddress?: string; displayName?: string }>('https://app.vssps.visualstudio.com/_apis/profile/profiles/me')
    if (!r.ok) return r
    return r.value.id ? ok({ id: idNumber(r.value.id)!, login: r.value.emailAddress ?? r.value.displayName ?? '' }) : err('azure_unauthorized', 'Azure DevOps did not say who the token belongs to.')
  }

  /** The token's identity in an organisation. */
  async viewerIn(organisation: string): Promise<Result<{ id: number; login: string }>> {
    const r = await this.#c.json<{ authenticatedUser?: { id?: string; providerDisplayName?: string; properties?: { Account?: { $value?: string } } } }>(`https://dev.azure.com/${encodeURIComponent(organisation)}/_apis/connectionData`)
    if (!r.ok) return r
    const u = r.value.authenticatedUser
    return u?.id ? ok({ id: idNumber(u.id)!, login: u.properties?.Account?.$value ?? u.providerDisplayName ?? '' }) : err('azure_unauthorized', 'Azure DevOps did not say who the token belongs to.')
  }

  async getHeadSha(ref: PrRef): Promise<Result<string>> {
    const r = await this.#c.json<Pr>(prUrl(ref))
    return r.ok ? (r.value.lastMergeSourceCommit ? ok(r.value.lastMergeSourceCommit.commitId) : err('azure_not_ready', 'No source commit yet.')) : r
  }

  async listPublished(ref: PrRef): Promise<Result<PublishedItems>> {
    const r = await this.#c.json<{ value: Thread[] }>(`${prUrl(ref)}/threads`)
    if (!r.ok) return r
    const items: PublishedItems = { reviews: [], reviewComments: [], issueComments: [] }
    for (const t of r.value.value) {
      if (t.isDeleted) continue
      const first = t.comments.find((c) => !c.parentCommentId)
      for (const c of t.comments) {
        if (c.isDeleted || c.commentType === 'system') continue
        const base: PublishedItem = { id: commentId(t.id, c.id), authorId: idNumber(c.author?.id), body: c.content ?? '', createdAt: c.publishedDate, url: `${webUrl(ref)}?discussionId=${t.id}`, authorLogin: c.author?.uniqueName }
        if (t.threadContext?.filePath) {
          items.reviewComments.push({ ...base, ...(first && c !== first ? { inReplyTo: commentId(t.id, first.id) } : {}), path: t.threadContext.filePath.replace(/^\//, ''), ...(t.threadContext.rightFileEnd?.line ? { line: t.threadContext.rightFileEnd.line } : {}), outdated: false })
        } else {
          items.issueComments.push(base)
          if (/kind=review\b/.test(base.body)) items.reviews.push({ ...base, state: 'COMMENTED' })
        }
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

  /** Members of the project's teams can push in the default Azure DevOps setup. */
  async canPush(repo: RepoRef, login: string): Promise<Result<boolean>> {
    const teams = await this.#c.json<{ value: Array<{ id: string }> }>(`https://dev.azure.com/${encodeURIComponent(org(repo))}/_apis/projects/${encodeURIComponent(project(repo))}/teams?$top=20`)
    if (!teams.ok) return teams
    for (const t of teams.value.value) {
      const m = await this.#c.json<{ value: Array<{ identity?: { uniqueName?: string } }> }>(`https://dev.azure.com/${encodeURIComponent(org(repo))}/_apis/projects/${encodeURIComponent(project(repo))}/teams/${t.id}/members?$top=500`)
      if (m.ok && m.value.value.some((x) => x.identity?.uniqueName?.toLowerCase() === login.toLowerCase())) return ok(true)
    }
    return ok(false)
  }

  async changedPathsBetween(repo: RepoRef, base: string, head: string): Promise<Result<{ status: string; paths: string[] }>> {
    const mb = await this.#c.json<{ value: Array<{ commitId: string }> }>(`${repoUrl(repo)}/commits/${head}/mergebases?otherCommitId=${base}`)
    if (!mb.ok) return mb
    if (mb.value.value[0]?.commitId !== base) return ok({ status: 'diverged', paths: [] })
    const d = await this.#c.json<{ changes?: Array<{ item?: { path?: string }; originalPath?: string }> }>(`${repoUrl(repo)}/diffs/commits?baseVersion=${base}&baseVersionType=commit&targetVersion=${head}&targetVersionType=commit&$top=1000`)
    if (!d.ok) return d
    return ok({ status: 'ahead', paths: (d.value.changes ?? []).flatMap((c) => [c.item?.path, c.originalPath].filter((p): p is string => !!p).map((p) => p.replace(/^\//, ''))) })
  }
}

export class AzureDevOpsWriter implements GitHubWriter {
  readonly #c: Client
  constructor(o: AzureDevOpsOptions) {
    this.#c = new Client(o)
  }

  async #thread(ref: PrRef, body: string, at?: InlineComment): Promise<Result<{ id: number; commentId: number }>> {
    const r = await this.#c.json<{ id: number; comments: Array<{ id: number }> }>(`${prUrl(ref)}/threads`, 'POST', {
      comments: [{ parentCommentId: 0, content: body, commentType: 1 }],
      status: 1,
      ...(at ? { threadContext: { filePath: `/${at.path}`, rightFileStart: { line: at.startLine ?? at.line, offset: 1 }, rightFileEnd: { line: at.line, offset: 1 } } } : {}),
    })
    return r.ok ? ok({ id: r.value.id, commentId: r.value.comments[0]?.id ?? 1 }) : r
  }

  async createReview(ref: PrRef, review: { commitId: string; event?: 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE' | undefined; body: string; comments: readonly InlineComment[] }): Promise<Result<{ id: number; url: string }>> {
    const pr = await this.#c.json<Pr>(prUrl(ref))
    if (!pr.ok) return pr
    if (pr.value.lastMergeSourceCommit?.commitId !== review.commitId) return err('head_moved', 'The pull request moved to a new commit; review it again.')
    for (const c of review.comments) {
      const t = await this.#thread(ref, c.body, c)
      if (!t.ok) return t
    }
    const note = await this.#thread(ref, review.body)
    if (!note.ok) return note
    if (review.event === 'APPROVE' || review.event === 'REQUEST_CHANGES') {
      const conn = await this.#c.json<{ authenticatedUser?: { id?: string } }>(`https://dev.azure.com/${encodeURIComponent(org(ref))}/_apis/connectionData`)
      if (!conn.ok || !conn.value.authenticatedUser?.id) return err('azure_unauthorized', 'Could not tell who is voting.')
      const vote = await this.#c.json<unknown>(`${prUrl(ref)}/reviewers/${conn.value.authenticatedUser.id}`, 'PUT', { vote: review.event === 'APPROVE' ? 10 : -5 })
      if (!vote.ok) return vote
    }
    return ok({ id: commentId(note.value.id, note.value.commentId), url: `${webUrl(ref)}?discussionId=${note.value.id}` })
  }

  async createIssueComment(ref: PrRef, body: string): Promise<Result<{ id: number; url: string }>> {
    const t = await this.#thread(ref, body)
    return t.ok ? ok({ id: commentId(t.value.id, t.value.commentId), url: `${webUrl(ref)}?discussionId=${t.value.id}` }) : t
  }

  async replyToReviewComment(ref: PrRef, id: number, body: string): Promise<Result<{ id: number; url: string }>> {
    const thread = Math.floor(id / 1000)
    const r = await this.#c.json<{ id: number }>(`${prUrl(ref)}/threads/${thread}/comments`, 'POST', { parentCommentId: id % 1000, content: body, commentType: 1 })
    return r.ok ? ok({ id: commentId(thread, r.value.id), url: `${webUrl(ref)}?discussionId=${thread}` }) : r
  }

  async updateIssueComment(ref: PrRef, id: number, body: string): Promise<Result<{ id: number; url: string }>> {
    const thread = Math.floor(id / 1000)
    const r = await this.#c.json<unknown>(`${prUrl(ref)}/threads/${thread}/comments/${id % 1000}`, 'PATCH', { content: body })
    return r.ok ? ok({ id, url: `${webUrl(ref)}?discussionId=${thread}` }) : r
  }

  async deleteIssueComment(ref: PrRef, id: number): Promise<Result<void>> {
    const r = await this.#c.request('DELETE', `${prUrl(ref)}/threads/${Math.floor(id / 1000)}/comments/${id % 1000}`)
    return r.ok ? ok(undefined) : r
  }

  async resolveThreads(ref: PrRef, commentIds: readonly number[]): Promise<Result<number>> {
    let n = 0
    for (const id of commentIds) if ((await this.#c.request('PATCH', `${prUrl(ref)}/threads/${Math.floor(id / 1000)}`, { status: 'fixed' })).ok) n++
    return ok(n)
  }

  async createCommitStatus(ref: PrRef, sha: string, status: { state: 'success' | 'failure' | 'error'; description: string; context: string; targetUrl?: string | undefined }): Promise<Result<void>> {
    const [genre, ...name] = status.context.split('/')
    const r = await this.#c.request('POST', `${repoUrl(ref)}/commits/${encodeURIComponent(sha)}/statuses`, {
      state: status.state === 'success' ? 'succeeded' : status.state === 'failure' ? 'failed' : 'error',
      description: status.description.slice(0, 255),
      context: { genre: name.length ? genre : 'pr-reviewer', name: name.length ? name.join('/') : genre },
      ...(status.targetUrl ? { targetUrl: status.targetUrl } : {}),
    })
    return r.ok ? ok(undefined) : r
  }

  async commitFile(repo: RepoRef, change: { branch: string; path: string; content: string; message: string; expectedHead: string }): Promise<Result<{ commitSha: string; url?: string | undefined }>> {
    // oldObjectId makes Azure refuse the push if the branch moved since the review.
    const r = await this.#c.json<{ commits?: Array<{ commitId: string; url?: string }> }>(`${repoUrl(repo)}/pushes`, 'POST', {
      refUpdates: [{ name: `refs/heads/${change.branch}`, oldObjectId: change.expectedHead }],
      commits: [{ comment: change.message, changes: [{ changeType: 'edit', item: { path: `/${change.path}` }, newContent: { content: change.content, contentType: 'rawtext' } }] }],
    })
    if (!r.ok) return r.error.message.includes(' 409 ') || r.error.message.includes('TF401028') ? err('head_moved', 'The branch moved since the review; review it again, then commit the fix.') : r
    const c = r.value.commits?.[0]
    return c ? ok({ commitSha: c.commitId, url: c.url }) : err('azure_error', 'Azure DevOps did not return the new commit.')
  }
}
