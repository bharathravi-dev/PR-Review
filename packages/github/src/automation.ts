// GitHub operations for the Auto-Review Channel (AD-14): the private automation repository, workflow dispatch,
// discovery searches, and health issues. Never touches reviewed PRs (publishing stays in the engine, AD-9).
import { err, ok, type Candidate, type Result } from '@pr-reviewer/core'
import type { GitHubClient } from './client.js'

const enc = (s: string) => encodeURIComponent(s)
const encPath = (p: string) => p.split('/').map(enc).join('/')
const toBase64 = (text: string) => Buffer.from(text, 'utf8').toString('base64')

export interface HealthIssue {
  number: number
  body: string
  url: string
}

export class AutomationClient {
  constructor(private readonly client: GitHubClient) {}

  async whoAmI(): Promise<Result<string>> {
    const res = await this.client.json<{ login: string }>('/user')
    return res.ok ? ok(res.value.data.login) : res
  }

  async repoExists(owner: string, repo: string): Promise<Result<{ exists: boolean; private?: boolean; defaultBranch?: string }>> {
    const res = await this.client.json<{ private: boolean; default_branch: string }>(`/repos/${enc(owner)}/${enc(repo)}`)
    if (res.ok) return ok({ exists: true, private: res.value.data.private, defaultBranch: res.value.data.default_branch })
    return res.error.code === 'github_no_access' && /returned 404/.test(res.error.message) ? ok({ exists: false }) : res
  }

  /** Creates a private repository in the user's account (initialised, so files can be added). */
  async createPrivateRepo(name: string, description: string): Promise<Result<{ url: string; defaultBranch: string }>> {
    const res = await this.client.send<{ html_url: string; default_branch: string }>('POST', '/user/repos', { name, description, private: true, auto_init: true, has_issues: true, has_wiki: false, has_projects: false })
    return res.ok ? ok({ url: res.value.html_url, defaultBranch: res.value.default_branch }) : res
  }

  /** Creates or updates one file through the contents API (no git needed). */
  async putFile(owner: string, repo: string, path: string, content: string, message: string, branch: string): Promise<Result<void>> {
    const url = `/repos/${enc(owner)}/${enc(repo)}/contents/${encPath(path)}`
    const current = await this.client.json<{ sha: string; content?: string }>(`${url}?ref=${enc(branch)}`)
    const sha = current.ok ? current.value.data.sha : undefined
    if (current.ok && current.value.data.content && Buffer.from(current.value.data.content, 'base64').toString('utf8') === content) return ok(undefined)
    const res = await this.client.send<unknown>('PUT', url, { message, content: toBase64(content), branch, ...(sha ? { sha } : {}) })
    return res.ok ? ok(undefined) : res
  }

  async readFile(owner: string, repo: string, path: string, ref?: string): Promise<Result<string | undefined>> {
    const res = await this.client.raw(`/repos/${enc(owner)}/${enc(repo)}/contents/${encPath(path)}${ref ? `?ref=${enc(ref)}` : ''}`)
    if (res.ok) return res
    return res.error.code === 'github_no_access' && /returned 404/.test(res.error.message) ? ok(undefined) : res
  }

  /** Starts a workflow_dispatch run. */
  async dispatch(owner: string, repo: string, workflow: string, ref: string, inputs: Record<string, string>): Promise<Result<void>> {
    const res = await this.client.send<unknown>('POST', `/repos/${enc(owner)}/${enc(repo)}/actions/workflows/${enc(workflow)}/dispatches`, { ref, inputs })
    return res.ok ? ok(undefined) : res
  }

  /** Open PRs matching a search query, with the details discovery needs (head SHA, draft, association). */
  async searchPulls(query: string, limit: number, login: string): Promise<Result<Candidate[]>> {
    const res = await this.client.json<{ items: Array<{ number: number; repository_url: string; user: { login: string } | null; author_association: string; draft?: boolean }> }>(
      `/search/issues?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=${Math.min(100, limit)}`,
    )
    if (!res.ok) return res
    const out: Candidate[] = []
    for (const item of res.value.data.items.slice(0, limit)) {
      const m = /\/repos\/([^/]+)\/([^/]+)$/.exec(item.repository_url)
      if (!m) continue
      const repo = `${decodeURIComponent(m[1]!)}/${decodeURIComponent(m[2]!)}`
      const pull = await this.client.json<{ head: { sha: string }; draft?: boolean; requested_reviewers?: Array<{ login: string }>; author_association?: string; state: string }>(
        `/repos/${encPath(repo)}/pulls/${item.number}`,
      )
      if (!pull.ok) return pull
      if (pull.value.data.state !== 'open') continue
      out.push({
        repo,
        number: item.number,
        headSha: pull.value.data.head.sha,
        author: item.user?.login ?? 'ghost',
        association: pull.value.data.author_association ?? item.author_association,
        draft: pull.value.data.draft ?? item.draft ?? false,
        reviewRequested: (pull.value.data.requested_reviewers ?? []).some((u) => u.login.toLowerCase() === login.toLowerCase()),
      })
    }
    return ok(out)
  }

  async openIssues(owner: string, repo: string): Promise<Result<HealthIssue[]>> {
    const res = await this.client.paginate<{ number: number; body: string | null; html_url: string; pull_request?: unknown }>(`/repos/${enc(owner)}/${enc(repo)}/issues?state=open&per_page=100`, 300)
    return res.ok ? ok(res.value.items.filter((i) => !i.pull_request).map((i) => ({ number: i.number, body: i.body ?? '', url: i.html_url }))) : res
  }

  async createIssue(owner: string, repo: string, title: string, body: string): Promise<Result<{ number: number; url: string }>> {
    const res = await this.client.send<{ number: number; html_url: string }>('POST', `/repos/${enc(owner)}/${enc(repo)}/issues`, { title, body })
    return res.ok ? ok({ number: res.value.number, url: res.value.html_url }) : res
  }

  async closeIssue(owner: string, repo: string, number: number, comment: string): Promise<Result<void>> {
    const c = await this.client.send<unknown>('POST', `/repos/${enc(owner)}/${enc(repo)}/issues/${number}/comments`, { body: comment })
    if (!c.ok) return c
    const res = await this.client.send<unknown>('PATCH', `/repos/${enc(owner)}/${enc(repo)}/issues/${number}`, { state: 'closed', state_reason: 'completed' })
    return res.ok ? ok(undefined) : res
  }

  /** Whether a GitHub Actions secret exists (names only; values are never readable). */
  async secretNames(owner: string, repo: string): Promise<Result<string[]>> {
    const res = await this.client.json<{ secrets: Array<{ name: string }> }>(`/repos/${enc(owner)}/${enc(repo)}/actions/secrets?per_page=100`)
    return res.ok ? ok(res.value.data.secrets.map((s) => s.name)) : res
  }
}

export function automationError(message: string): Result<never> {
  return err('automation_error', message)
}
