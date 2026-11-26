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

export type AppJob = { kind: 'review' | 'respond'; ref: PrRef; installationId: number; key: string }

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
