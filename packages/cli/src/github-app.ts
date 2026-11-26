// The GitHub App (roadmap item 7): install it once, and every PR is reviewed on push and `@pr-reviewer` commands
// are answered. This file holds the pure parts: webhook signatures, the App's JWT and installation tokens, routing
// events to jobs, and a small queue. `pr-reviewer app` (app-server.ts) serves the webhook.
import { createHmac, createSign, timingSafeEqual } from 'node:crypto'
import { parseCommand, type PrRef } from '@pr-reviewer/core'

/** True when `header` (X-Hub-Signature-256) is the HMAC-SHA256 of the raw body with the webhook secret. */
export function verifySignature(secret: string, body: Buffer, header: string | undefined): boolean {
  if (!secret || !header?.startsWith('sha256=')) return false
  const want = Buffer.from(`sha256=${createHmac('sha256', secret).update(body).digest('hex')}`)
  const got = Buffer.from(header)
  return want.length === got.length && timingSafeEqual(want, got)
}

const b64url = (data: string | Buffer) => Buffer.from(data).toString('base64url')

/** The App's own JWT (RS256), valid for nine minutes; GitHub allows ten and clocks drift. */
export function appJwt(appId: string, privateKeyPem: string, nowMs: number): string {
  const now = Math.floor(nowMs / 1000)
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: appId }))
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKeyPem)
  return `${head}.${body}.${b64url(sig)}`
}

export interface AppAuthOptions {
  appId: string
  privateKey: string
  apiUrl: string
  fetch: typeof fetch
  userAgent: string
  now?: () => number
}

/** Installation tokens (cached until five minutes before they expire) and the App's bot identity. */
export function createAppAuth(o: AppAuthOptions) {
  const now = o.now ?? Date.now
  const cache = new Map<number, { token: string; expiresAt: number }>()
  let bot: { id: number; login: string } | undefined
  const call = async <T>(method: string, path: string, auth: string): Promise<T> => {
    const res = await o.fetch(`${o.apiUrl}${path}`, { method, headers: { accept: 'application/vnd.github+json', authorization: auth, 'user-agent': o.userAgent, 'x-github-api-version': '2022-11-28' } })
    if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${path}`)
    return (await res.json()) as T
  }
  return {
    async installationToken(installationId: number): Promise<string> {
      const hit = cache.get(installationId)
      if (hit && hit.expiresAt - now() > 5 * 60_000) return hit.token
      const r = await call<{ token: string; expires_at: string }>('POST', `/app/installations/${installationId}/access_tokens`, `Bearer ${appJwt(o.appId, o.privateKey, now())}`)
      cache.set(installationId, { token: r.token, expiresAt: Date.parse(r.expires_at) })
      return r.token
    },
    /** The App's bot user (e.g. pr-reviewer[bot]): the Reviewer Identity of everything the App posts. */
    async botIdentity(): Promise<{ id: number; login: string }> {
      if (bot) return bot
      const app = await call<{ slug: string }>('GET', '/app', `Bearer ${appJwt(o.appId, o.privateKey, now())}`)
      const user = await call<{ id: number; login: string }>('GET', `/users/${encodeURIComponent(`${app.slug}[bot]`)}`, `Bearer ${appJwt(o.appId, o.privateKey, now())}`)
      bot = { id: user.id, login: user.login }
      return bot
    },
  }
}

export type Forge = 'github' | 'gitlab' | 'bitbucket' | 'azure-devops'
/** installationId is the GitHub App installation; other forges use the server's own token for that host. */
export type AppJob = { kind: 'review' | 'respond'; ref: PrRef; installationId: number; key: string; forge?: Forge }

/** Constant-time comparison of a shared secret (GitLab's X-Gitlab-Token, Azure DevOps basic auth). */
export function sameSecret(secret: string, given: string | undefined): boolean {
  if (!secret || given === undefined) return false
  const a = Buffer.from(secret)
  const b = Buffer.from(given)
  return a.length === b.length && timingSafeEqual(a, b)
}

const job = (forge: Forge, kind: AppJob['kind'], ref: PrRef): AppJob => ({ kind, ref, installationId: 0, forge, key: `${kind}:${ref.host}/${ref.owner}/${ref.repo}#${ref.number}` })

/** GitLab: Merge Request Hook (open, reopen, update with new commits) and Note Hook commands on merge requests. */
export function routeGitLab(event: string, p: { object_kind?: string; object_attributes?: { action?: string; oldrev?: string; iid?: number; draft?: boolean; work_in_progress?: boolean; noteable_type?: string; note?: string }; project?: { web_url?: string; path_with_namespace?: string }; merge_request?: { iid?: number }; user?: { username?: string } }, opts: { reviewDrafts?: boolean | undefined } = {}): AppJob | undefined {
  const path = p.project?.path_with_namespace
  const host = p.project?.web_url ? new URL(p.project.web_url).host : undefined
  if (!path || !host) return undefined
  const at = path.lastIndexOf('/')
  const ref = (n: number | undefined): PrRef | undefined => (n ? { host, owner: path.slice(0, at), repo: path.slice(at + 1), number: n } : undefined)
  const a = p.object_attributes ?? {}
  if (event === 'Merge Request Hook') {
    const fresh = a.action === 'open' || a.action === 'reopen' || (a.action === 'update' && !!a.oldrev)
    if (!fresh || ((a.draft || a.work_in_progress) && !opts.reviewDrafts)) return undefined
    const r = ref(a.iid)
    return r ? job('gitlab', 'review', r) : undefined
  }
  if (event === 'Note Hook' && a.noteable_type === 'MergeRequest' && parseCommand(a.note ?? '')) {
    const r = ref(p.merge_request?.iid)
    return r ? job('gitlab', 'respond', r) : undefined
  }
  return undefined
}

/** Bitbucket: pullrequest:created / pullrequest:updated, and comment commands. */
export function routeBitbucket(event: string, p: { pullrequest?: { id?: number; draft?: boolean }; repository?: { full_name?: string }; comment?: { content?: { raw?: string } }; actor?: { type?: string } }, opts: { reviewDrafts?: boolean | undefined } = {}): AppJob | undefined {
  const [owner, repo] = (p.repository?.full_name ?? '').split('/')
  const n = p.pullrequest?.id
  if (!owner || !repo || !n) return undefined
  const ref = { host: 'bitbucket.org', owner, repo, number: n }
  if (event === 'pullrequest:created' || event === 'pullrequest:updated') return p.pullrequest?.draft && !opts.reviewDrafts ? undefined : job('bitbucket', 'review', ref)
  if (event === 'pullrequest:comment_created' && parseCommand(p.comment?.content?.raw ?? '')) return job('bitbucket', 'respond', ref)
  return undefined
}

/** Azure DevOps service hooks: pull request created or updated (new commits), and comment commands. */
export function routeAzure(p: { eventType?: string; resource?: { pullRequestId?: number; isDraft?: boolean; repository?: { name?: string; project?: { name?: string }; remoteUrl?: string; url?: string }; comment?: { content?: string }; pullRequest?: { pullRequestId?: number; repository?: { name?: string; project?: { name?: string }; url?: string } } }; message?: { text?: string } }, opts: { reviewDrafts?: boolean | undefined } = {}): AppJob | undefined {
  const r = p.resource ?? {}
  const pr = r.pullRequest ?? r
  const repo = pr.repository
  const orgName = /dev\.azure\.com\/([^/]+)\//.exec(repo?.url ?? '')?.[1] ?? /https:\/\/([^.]+)\.visualstudio\.com/.exec(repo?.url ?? '')?.[1]
  const n = pr.pullRequestId
  if (!repo?.name || !repo.project?.name || !orgName || !n) return undefined
  const ref = { host: 'dev.azure.com', owner: `${decodeURIComponent(orgName)}/${repo.project.name}`, repo: repo.name, number: n }
  if (p.eventType === 'git.pullrequest.created' || (p.eventType === 'git.pullrequest.updated' && /pushed|updated the source branch/i.test(p.message?.text ?? 'pushed'))) {
    return r.isDraft && !opts.reviewDrafts ? undefined : job('azure-devops', 'review', ref)
  }
  if (p.eventType === 'ms.vss-code.git-pullrequest-comment-event' && parseCommand(r.comment?.content ?? '')) return job('azure-devops', 'respond', ref)
  return undefined
}

const REVIEW_ACTIONS = new Set(['opened', 'reopened', 'synchronize', 'ready_for_review'])

interface Payload {
  action?: string
  installation?: { id?: number }
  repository?: { name?: string; owner?: { login?: string } }
  pull_request?: { number?: number; draft?: boolean }
  issue?: { number?: number; pull_request?: unknown }
  comment?: { body?: string }
  sender?: { type?: string }
}

/** Turns a webhook delivery into a job, or nothing. Drafts wait for "ready for review" unless `reviewDrafts`. */
export function routeEvent(event: string, payload: Payload, host: string, opts: { reviewDrafts?: boolean | undefined } = {}): AppJob | undefined {
  const installationId = payload.installation?.id
  const owner = payload.repository?.owner?.login
  const repo = payload.repository?.name
  if (!installationId || !owner || !repo) return undefined
  const job = (kind: AppJob['kind'], number: number | undefined): AppJob | undefined =>
    number ? { kind, ref: { host, owner, repo, number }, installationId, key: `${kind}:${owner}/${repo}#${number}` } : undefined
  if (event === 'pull_request' && REVIEW_ACTIONS.has(payload.action ?? '')) {
    if (payload.pull_request?.draft && !opts.reviewDrafts) return undefined
    return job('review', payload.pull_request?.number)
  }
  // Commands come from people; the App's own answers (and other bots) are ignored.
  if ((event === 'issue_comment' || event === 'pull_request_review_comment') && payload.action === 'created' && payload.sender?.type !== 'Bot') {
    if (!parseCommand(payload.comment?.body ?? '')) return undefined
    if (event === 'issue_comment' && !payload.issue?.pull_request) return undefined
    return job('respond', event === 'issue_comment' ? payload.issue?.number : payload.pull_request?.number)
  }
  return undefined
}

/**
 * Runs jobs a few at a time. A job whose key is already waiting is dropped (the waiting one will see the latest
 * state when it runs), so a burst of pushes to one PR becomes one review.
 */
export function createJobQueue(run: (job: AppJob) => Promise<void>, concurrency = 2, onError: (job: AppJob, e: unknown) => void = () => undefined) {
  const waiting: AppJob[] = []
  let active = 0
  const pump = () => {
    while (active < concurrency && waiting.length) {
      const job = waiting.shift()!
      active++
      run(job)
        .catch((e: unknown) => onError(job, e))
        .finally(() => {
          active--
          pump()
        })
    }
  }
  return {
    push(job: AppJob): boolean {
      if (waiting.some((w) => w.key === job.key)) return false
      waiting.push(job)
      pump()
      return true
    },
    get size() {
      return waiting.length + active
    },
  }
}
