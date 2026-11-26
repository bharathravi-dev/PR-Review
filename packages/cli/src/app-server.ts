// `pr-reviewer app`: the GitHub App's webhook server (roadmap item 7). Configured by environment variables, like
// `pr-reviewer web`, so it runs in a container. Reviews post as the App's bot; nothing is approved or merged.
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Secret, type ResolvedConfig } from '@pr-reviewer/core'
import { apiUrlForHost, createGitHub } from './compose.js'
import type { CliDeps } from './deps.js'
import type { GitHubConnection } from './engine.js'
import { createAppAuth, createJobQueue, routeEvent, verifySignature, type AppJob } from './github-app.js'
import { answerCommands, reviewAndPost } from './respond.js'

export interface AppServerOptions {
  appId: string
  privateKey: string
  webhookSecret: string
  host?: string | undefined
  port?: number | undefined
  bind?: string | undefined
  reviewDrafts?: boolean | undefined
  concurrency?: number | undefined
  config: ResolvedConfig
  deps: CliDeps
  log?: (text: string) => void
  /** Replaces the job runner (tests). */
  runJob?: ((job: AppJob) => Promise<void>) | undefined
}

const USER_AGENT = 'pr-reviewer-app'
const MAX_BODY = 5 * 1024 * 1024

/** Reads the App's settings from the environment; returns problems instead of throwing. */
export function appSettingsFromEnv(env: Readonly<Record<string, string | undefined>>): { ok: true; appId: string; privateKey: string; webhookSecret: string } | { ok: false; problems: string[] } {
  const problems: string[] = []
  const appId = env.PR_REVIEWER_APP_ID ?? ''
  if (!/^\d+$/.test(appId)) problems.push('PR_REVIEWER_APP_ID: the App ID (a number, from the App settings page)')
  let privateKey = env.PR_REVIEWER_APP_PRIVATE_KEY ?? ''
  if (!privateKey && env.PR_REVIEWER_APP_PRIVATE_KEY_FILE) {
    try {
      privateKey = readFileSync(env.PR_REVIEWER_APP_PRIVATE_KEY_FILE, 'utf8')
    } catch (e) {
      problems.push(`PR_REVIEWER_APP_PRIVATE_KEY_FILE: ${(e as Error).message}`)
    }
  }
  privateKey = privateKey.replace(/\\n/g, '\n')
  if (!/-----BEGIN (RSA )?PRIVATE KEY-----/.test(privateKey)) problems.push('PR_REVIEWER_APP_PRIVATE_KEY (or _FILE): the App private key in PEM form')
  const webhookSecret = env.PR_REVIEWER_WEBHOOK_SECRET ?? ''
  if (webhookSecret.length < 16) problems.push('PR_REVIEWER_WEBHOOK_SECRET: the webhook secret set on the App, at least 16 characters')
  return problems.length ? { ok: false, problems } : { ok: true, appId, privateKey, webhookSecret }
}

export async function startAppServer(o: AppServerOptions): Promise<{ url: string; close(): Promise<void>; queueSize(): number }> {
  const log = o.log ?? (() => undefined)
  const host = o.host ?? 'github.com'
  const apiUrl = apiUrlForHost(host)
  const auth = createAppAuth({ appId: o.appId, privateKey: o.privateKey, apiUrl, fetch: o.deps.fetch, userAgent: USER_AGENT })

  /** A GitHub connection that acts as the App in one installation. */
  const connect = async (installationId: number, secrets: Secret[]): Promise<GitHubConnection> => {
    const token = await auth.installationToken(installationId)
    secrets.push(new Secret(token))
    const { reader, writer } = createGitHub({ apiUrl, token, fetch: o.deps.fetch, userAgent: USER_AGENT })
    return { reader, writer, token, viewer: await auth.botIdentity() }
  }

  const runJob =
    o.runJob ??
    (async (job: AppJob) => {
      const secrets: Secret[] = []
      const github = await connect(job.installationId, secrets)
      const pr = `${job.ref.owner}/${job.ref.repo}#${job.ref.number}`
      if (job.kind === 'review') {
        const r = await reviewAndPost({ config: o.config, deps: o.deps, secrets, ref: job.ref, github, channel: 'AUTO_REVIEW', log: (t) => log(`${pr}: ${t}\n`) })
        log(`${pr}: review ${r.ok ? 'posted' : `not posted (${r.message})`}\n`)
      } else {
        const r = await answerCommands({ config: o.config, deps: o.deps, secrets, ref: job.ref, github, channel: 'AUTO_REVIEW' })
        log(`${pr}: ${r.ok ? r.lines.join('; ') : r.error}\n`)
      }
    })
  const queue = createJobQueue(runJob, o.concurrency ?? 2, (job, e) => log(`${job.key}: failed: ${(e as Error).message}\n`))

  const read = (req: IncomingMessage) =>
    new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = []
      let size = 0
      req.on('data', (c: Buffer) => {
        size += c.length
        if (size > MAX_BODY) reject(new Error('too large'))
        else chunks.push(c)
      })
      req.on('end', () => resolve(Buffer.concat(chunks)))
      req.on('error', reject)
    })
  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://app')
    if (req.method === 'GET' && url.pathname === '/healthz') return send(res, 200, { ok: true, queued: queue.size })
    if (req.method !== 'POST' || url.pathname !== '/webhooks/github') return send(res, 404, { error: 'not_found' })
    read(req).then(
      (body) => {
        // Only deliveries signed with the App's webhook secret are accepted.
        if (!verifySignature(o.webhookSecret, body, req.headers['x-hub-signature-256'] as string | undefined)) return send(res, 401, { error: 'bad_signature' })
        const event = String(req.headers['x-github-event'] ?? '')
        let payload: unknown
        try {
          payload = JSON.parse(body.toString('utf8'))
        } catch {
          return send(res, 400, { error: 'invalid_json' })
        }
        const job = routeEvent(event, payload as Parameters<typeof routeEvent>[1], host, { reviewDrafts: o.reviewDrafts })
        if (!job) return send(res, 202, { queued: false })
        const queued = queue.push(job)
        log(`${event}: ${job.key}${queued ? '' : ' (already waiting)'}\n`)
        return send(res, 202, { queued, job: job.key })
      },
      () => send(res, 413, { error: 'too_large' }),
    )
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(o.port ?? 3000, o.bind ?? '0.0.0.0', () => resolve())
  })
  const port = (server.address() as AddressInfo).port
  return {
    url: `http://${o.bind ?? '0.0.0.0'}:${port}`,
    queueSize: () => queue.size,
    close: () => new Promise<void>((resolve) => (server.close(() => resolve()), server.closeAllConnections())),
  }
}
