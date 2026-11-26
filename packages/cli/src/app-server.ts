// `pr-reviewer app`: the webhook server for automatic reviews (roadmap item 7): the GitHub App, and webhooks from
// GitLab, Bitbucket and Azure DevOps. Configured by environment variables, like `pr-reviewer web`, so it runs in a
// container. GitHub reviews post as the App's bot; other forges post with the server's token for that host.
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Secret, type ResolvedConfig } from '@pr-reviewer/core'
import { apiUrlForHost, createGitHub } from './compose.js'
import type { CliDeps } from './deps.js'
import { connectGitHub, type GitHubConnection } from './engine.js'
import { createAppAuth, createJobQueue, routeAzure, routeBitbucket, routeEvent, routeGitLab, sameSecret, verifySignature, type AppJob } from './github-app.js'
import { answerCommands, reviewAndPost } from './respond.js'

export interface AppServerOptions {
  /** The GitHub App; absent when only other forges send webhooks. */
  github?: { appId: string; privateKey: string; webhookSecret: string } | undefined
  /** Shared secrets for the other forges' webhooks; a forge without one has no endpoint. */
  gitlabSecret?: string | undefined
  bitbucketSecret?: string | undefined
  azureSecret?: string | undefined
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

export interface ForgeSettings {
  github?: { appId: string; privateKey: string; webhookSecret: string } | undefined
  gitlabSecret?: string | undefined
  bitbucketSecret?: string | undefined
  azureSecret?: string | undefined
}

/**
 * Reads which forges send webhooks: the GitHub App (PR_REVIEWER_APP_ID, key, PR_REVIEWER_WEBHOOK_SECRET) and/or
 * PR_REVIEWER_GITLAB_WEBHOOK_SECRET, PR_REVIEWER_BITBUCKET_WEBHOOK_SECRET, PR_REVIEWER_AZURE_WEBHOOK_SECRET.
 */
export function forgeSettingsFromEnv(env: Readonly<Record<string, string | undefined>>): { ok: true; value: ForgeSettings } | { ok: false; problems: string[] } {
  const value: ForgeSettings = {}
  const problems: string[] = []
  const githubWanted = !!(env.PR_REVIEWER_APP_ID || env.PR_REVIEWER_APP_PRIVATE_KEY || env.PR_REVIEWER_APP_PRIVATE_KEY_FILE || env.PR_REVIEWER_WEBHOOK_SECRET)
  if (githubWanted) {
    const gh = appSettingsFromEnv(env)
    if (gh.ok) value.github = { appId: gh.appId, privateKey: gh.privateKey, webhookSecret: gh.webhookSecret }
    else problems.push(...gh.problems)
  }
  for (const [name, key] of [['PR_REVIEWER_GITLAB_WEBHOOK_SECRET', 'gitlabSecret'], ['PR_REVIEWER_BITBUCKET_WEBHOOK_SECRET', 'bitbucketSecret'], ['PR_REVIEWER_AZURE_WEBHOOK_SECRET', 'azureSecret']] as const) {
    const v = env[name]
    if (v === undefined) continue
    if (v.length < 16) problems.push(`${name}: at least 16 characters`)
    else value[key] = v
  }
  if (!problems.length && !value.github && !value.gitlabSecret && !value.bitbucketSecret && !value.azureSecret) problems.push('Configure at least one forge: the GitHub App (PR_REVIEWER_APP_ID, PR_REVIEWER_APP_PRIVATE_KEY, PR_REVIEWER_WEBHOOK_SECRET) or a webhook secret for GitLab, Bitbucket or Azure DevOps (docs/github-app.md)')
  return problems.length ? { ok: false, problems } : { ok: true, value }
}

/** Reads the GitHub App's settings from the environment; returns problems instead of throwing. */
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
  const auth = o.github ? createAppAuth({ appId: o.github.appId, privateKey: o.github.privateKey, apiUrl, fetch: o.deps.fetch, userAgent: USER_AGENT }) : undefined

  /** GitHub: the App in one installation. Other forges: the server's own token for that host. */
  const connect = async (job: AppJob, secrets: Secret[]): Promise<GitHubConnection> => {
    if (job.forge && job.forge !== 'github') return connectGitHub(o.config, o.deps, secrets, job.ref.host)
    if (!auth) throw new Error('The GitHub App is not configured.')
    const token = await auth.installationToken(job.installationId)
    secrets.push(new Secret(token))
    const { reader, writer } = createGitHub({ apiUrl, token, fetch: o.deps.fetch, userAgent: USER_AGENT })
    return { reader, writer, token, viewer: await auth.botIdentity() }
  }

  const runJob =
    o.runJob ??
    (async (job: AppJob) => {
      const secrets: Secret[] = []
      const github = await connect(job, secrets)
      if (!github.viewer) throw new Error(`no identity on ${job.ref.host}: ${github.tokenError ?? github.viewerError ?? 'unknown'}`)
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
    if (req.method !== 'POST' || !url.pathname.startsWith('/webhooks/')) return send(res, 404, { error: 'not_found' })
    const forge = url.pathname.slice('/webhooks/'.length)
    read(req).then(
      (body) => {
        const h = (name: string) => req.headers[name] as string | undefined
        // Every delivery must prove it comes from the forge: a signature or the shared secret.
        let trusted = false
        if (forge === 'github') trusted = !!o.github && verifySignature(o.github.webhookSecret, body, h('x-hub-signature-256'))
        else if (forge === 'gitlab') trusted = !!o.gitlabSecret && sameSecret(o.gitlabSecret, h('x-gitlab-token'))
        else if (forge === 'bitbucket') trusted = !!o.bitbucketSecret && verifySignature(o.bitbucketSecret, body, h('x-hub-signature'))
        else if (forge === 'azure-devops') {
          const basic = /^Basic (.+)$/.exec(h('authorization') ?? '')?.[1]
          trusted = !!o.azureSecret && sameSecret(o.azureSecret, basic ? Buffer.from(basic, 'base64').toString('utf8').split(':').slice(1).join(':') : undefined)
        } else return send(res, 404, { error: 'not_found' })
        if (!trusted) return send(res, 401, { error: 'bad_signature' })
        let payload: unknown
        try {
          payload = JSON.parse(body.toString('utf8'))
        } catch {
          return send(res, 400, { error: 'invalid_json' })
        }
        const opts = { reviewDrafts: o.reviewDrafts }
        const job =
          forge === 'github'
            ? routeEvent(String(h('x-github-event') ?? ''), payload as Parameters<typeof routeEvent>[1], host, opts)
            : forge === 'gitlab'
              ? routeGitLab(String(h('x-gitlab-event') ?? ''), payload as Parameters<typeof routeGitLab>[1], opts)
              : forge === 'bitbucket'
                ? routeBitbucket(String(h('x-event-key') ?? ''), payload as Parameters<typeof routeBitbucket>[1], opts)
                : routeAzure(payload as Parameters<typeof routeAzure>[0], opts)
        if (!job) return send(res, 202, { queued: false })
        const queued = queue.push(job)
        log(`${forge}: ${job.key}${queued ? '' : ' (already waiting)'}\n`)
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
