import { ok, type GitHubWriter, type InlineComment, type PrRef, type Result } from '@pr-reviewer/core'
import type { GitHubClient } from './client.js'

const repoPath = (ref: PrRef) => `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`

/** Write side of GitHub (AD-9). It has no approve, merge, or branch-protection operation by construction. */
export class GitHubPrWriter implements GitHubWriter {
  constructor(private readonly client: GitHubClient) {}

  async createReview(
    ref: PrRef,
    review: { commitId: string; event: 'COMMENT' | 'REQUEST_CHANGES'; body: string; comments: readonly InlineComment[] },
  ): Promise<Result<{ id: number; url: string }>> {
    const res = await this.client.send<{ id: number; html_url: string }>('POST', `${repoPath(ref)}/pulls/${ref.number}/reviews`, {
      commit_id: review.commitId,
      event: review.event,
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
