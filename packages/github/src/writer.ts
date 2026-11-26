import { ok, type GitHubWriter, type InlineComment, type PrRef, type Result } from '@pr-reviewer/core'
import type { GitHubClient } from './client.js'

const repoPath = (ref: PrRef) => `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`

/** Write side of GitHub (AD-9). It has no approve, merge, or branch-protection operation by construction. */
const THREADS = `query($owner: String!, $repo: String!, $pr: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      reviewThreads(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { id isResolved comments(first: 1) { nodes { databaseId } } }
      }
    }
  }
}`
const RESOLVE = `mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { id isResolved } } }`

interface ThreadPage {
  repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Array<{ id: string; isResolved: boolean; comments: { nodes: Array<{ databaseId: number | null }> } }> } } | null } | null
}

export class GitHubPrWriter implements GitHubWriter {
  constructor(private readonly client: GitHubClient) {}

  async resolveThreads(ref: PrRef, commentIds: readonly number[]): Promise<Result<number>> {
    const wanted = new Set(commentIds)
    const toResolve: string[] = []
    let after: string | null = null
    for (let page = 0; page < 10; page++) {
      const res: Result<ThreadPage> = await this.client.graphql<ThreadPage>(THREADS, { owner: ref.owner, repo: ref.repo, pr: ref.number, after })
      if (!res.ok) return res
      const threads: NonNullable<NonNullable<ThreadPage['repository']>['pullRequest']>['reviewThreads'] | undefined = res.value.repository?.pullRequest?.reviewThreads
      if (!threads) break
      for (const t of threads.nodes) {
        const first = t.comments.nodes[0]?.databaseId
        if (!t.isResolved && first != null && wanted.has(first)) toResolve.push(t.id)
      }
      if (!threads.pageInfo.hasNextPage) break
      after = threads.pageInfo.endCursor
    }
    let resolved = 0
    for (const id of toResolve) {
      const r = await this.client.graphql<unknown>(RESOLVE, { id })
      if (r.ok) resolved++
    }
    return ok(resolved)
  }

  async createReview(
    ref: PrRef,
    review: { commitId: string; event?: 'COMMENT' | 'REQUEST_CHANGES' | undefined; body: string; comments: readonly InlineComment[] },
  ): Promise<Result<{ id: number; url: string }>> {
    const res = await this.client.send<{ id: number; html_url: string }>('POST', `${repoPath(ref)}/pulls/${ref.number}/reviews`, {
      commit_id: review.commitId,
      // Leaving out `event` creates a PENDING review, visible only to its author (FR-20a).
      ...(review.event ? { event: review.event } : {}),
      body: review.body,
      comments: review.comments.map((c) => ({
        path: c.path,
        line: c.line,
        side: c.side,
        ...(c.startLine !== undefined ? { start_line: c.startLine, start_side: c.side } : {}),
        body: c.body,
      })),
    })
    return res.ok ? ok({ id: res.value.id, url: res.value.html_url }) : res
  }

  async createIssueComment(ref: PrRef, body: string): Promise<Result<{ id: number; url: string }>> {
    const res = await this.client.send<{ id: number; html_url: string }>('POST', `${repoPath(ref)}/issues/${ref.number}/comments`, { body })
    return res.ok ? ok({ id: res.value.id, url: res.value.html_url }) : res
  }

  async replyToReviewComment(ref: PrRef, commentId: number, body: string): Promise<Result<{ id: number; url: string }>> {
    const res = await this.client.send<{ id: number; html_url: string }>('POST', `${repoPath(ref)}/pulls/${ref.number}/comments/${commentId}/replies`, { body })
    return res.ok ? ok({ id: res.value.id, url: res.value.html_url }) : res
  }

  async updateIssueComment(ref: PrRef, id: number, body: string): Promise<Result<{ id: number; url: string }>> {
    const res = await this.client.send<{ id: number; html_url: string }>('PATCH', `${repoPath(ref)}/issues/comments/${id}`, { body })
    return res.ok ? ok({ id: res.value.id, url: res.value.html_url }) : res
  }

  async createCommitStatus(
    ref: PrRef,
    sha: string,
    status: { state: 'success' | 'failure' | 'error'; description: string; context: string; targetUrl?: string | undefined },
  ): Promise<Result<void>> {
    const res = await this.client.send<unknown>('POST', `${repoPath(ref)}/statuses/${encodeURIComponent(sha)}`, {
      state: status.state,
      description: status.description.slice(0, 140),
      context: status.context,
      ...(status.targetUrl ? { target_url: status.targetUrl } : {}),
    })
    return res.ok ? ok(undefined) : res
  }

  async deleteIssueComment(ref: PrRef, id: number): Promise<Result<void>> {
    const res = await this.client.send<void>('DELETE', `${repoPath(ref)}/issues/comments/${id}`)
    return res.ok ? ok(undefined) : res
  }
}
