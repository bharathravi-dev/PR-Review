import { createHmac, createVerify, generateKeyPairSync } from 'node:crypto'
import { parseUserConfig, resolveSettings } from '@pr-reviewer/core'
import { afterEach, describe, expect, it } from 'vitest'
import { appSettingsFromEnv, forgeSettingsFromEnv, startAppServer } from './app-server.js'
import type { CliDeps } from './deps.js'
import { appJwt, createAppAuth, createJobQueue, routeAzure, routeBitbucket, routeEvent, routeGitLab, sameSecret, verifySignature, type AppJob } from './github-app.js'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
const SECRET = 'webhook-secret-0123456789'
const sign = (body: string) => `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`
const repo = { name: 'app', owner: { login: 'octo' } }

describe('GitHub App (roadmap item 7)', () => {
  it('accepts only deliveries signed with the webhook secret', () => {
    const body = Buffer.from('{"a":1}')
    expect(verifySignature(SECRET, body, sign('{"a":1}'))).toBe(true)
    expect(verifySignature(SECRET, body, sign('{"a":2}'))).toBe(false)
    expect(verifySignature(SECRET, body, undefined)).toBe(false)
    expect(verifySignature('', body, sign('{"a":1}'))).toBe(false)
  })

  it('signs its JWT with the private key, valid for nine minutes', () => {
    const jwt = appJwt('123', privateKey, 1_000_000_000)
    const [h, b, s] = jwt.split('.')
    expect(createVerify('RSA-SHA256').update(`${h}.${b}`).verify(publicKey, Buffer.from(s!, 'base64url'))).toBe(true)
    const claims = JSON.parse(Buffer.from(b!, 'base64url').toString())
    expect(claims).toEqual({ iat: 1_000_000 - 60, exp: 1_000_000 + 540, iss: '123' })
  })

  it('caches installation tokens until they near expiry, and finds its bot identity', async () => {
    let now = Date.parse('2026-11-26T10:00:00Z')
    const calls: string[] = []
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${url.replace('https://api.github.com', '')}`)
      if (url.endsWith('/access_tokens')) return Response.json({ token: `tok${calls.length}`, expires_at: new Date(now + 60 * 60_000).toISOString() })
      if (url.endsWith('/app')) return Response.json({ slug: 'pr-reviewer' })
      return Response.json({ id: 99, login: 'pr-reviewer[bot]' })
    }) as unknown as typeof fetch
    const auth = createAppAuth({ appId: '1', privateKey, apiUrl: 'https://api.github.com', fetch: fetchImpl, userAgent: 't', now: () => now })
    const first = await auth.installationToken(7)
    expect(await auth.installationToken(7)).toBe(first)
    now += 56 * 60_000
    expect(await auth.installationToken(7)).not.toBe(first)
    expect(await auth.botIdentity()).toEqual({ id: 99, login: 'pr-reviewer[bot]' })
    expect(calls).toContain('GET /users/pr-reviewer%5Bbot%5D')
  })

  it('routes PR pushes to reviews and @pr-reviewer comments to replies; skips drafts, bots and plain comments', () => {
    const pr = (action: string, draft = false) => ({ action, installation: { id: 7 }, repository: repo, pull_request: { number: 9, draft } })
    expect(routeEvent('pull_request', pr('synchronize'), 'github.com')).toEqual({ kind: 'review', ref: { host: 'github.com', owner: 'octo', repo: 'app', number: 9 }, installationId: 7, key: 'review:octo/app#9' })
    expect(routeEvent('pull_request', pr('opened', true), 'github.com')).toBeUndefined()
    expect(routeEvent('pull_request', pr('opened', true), 'github.com', { reviewDrafts: true })?.kind).toBe('review')
    expect(routeEvent('pull_request', pr('closed'), 'github.com')).toBeUndefined()
    const comment = (body: string, type = 'User', onPr = true) => ({ action: 'created', installation: { id: 7 }, repository: repo, issue: { number: 9, ...(onPr ? { pull_request: {} } : {}) }, comment: { body }, sender: { type } })
    expect(routeEvent('issue_comment', comment('@pr-reviewer review'), 'github.com')?.key).toBe('respond:octo/app#9')
    expect(routeEvent('issue_comment', comment('looks good'), 'github.com')).toBeUndefined()
    expect(routeEvent('issue_comment', comment('@pr-reviewer help', 'Bot'), 'github.com')).toBeUndefined()
    expect(routeEvent('issue_comment', comment('@pr-reviewer help', 'User', false), 'github.com')).toBeUndefined()
    expect(routeEvent('pull_request_review_comment', { action: 'created', installation: { id: 7 }, repository: repo, pull_request: { number: 9 }, comment: { body: '@pr-reviewer why' }, sender: { type: 'User' } }, 'github.com')?.kind).toBe('respond')
  })

  it('folds a burst of pushes to one PR into one waiting review', async () => {
    const ran: string[] = []
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const q = createJobQueue(async (j) => {
      ran.push(j.key)
      await gate
    }, 1)
    const job = (n: number): AppJob => ({ kind: 'review', ref: { host: 'github.com', owner: 'o', repo: 'r', number: n }, installationId: 1, key: `review:o/r#${n}` })
    expect(q.push(job(1))).toBe(true)
    expect(q.push(job(2))).toBe(true)
    expect(q.push(job(2))).toBe(false)
    expect(q.size).toBe(2)
    release()
    await new Promise((r) => setTimeout(r, 10))
    expect(ran).toEqual(['review:o/r#1', 'review:o/r#2'])
  })

  it('reports missing settings instead of starting', () => {
    const bad = appSettingsFromEnv({ PR_REVIEWER_APP_ID: 'x' })
    expect(bad.ok).toBe(false)
    expect(!bad.ok && bad.problems.join(' ')).toContain('PR_REVIEWER_WEBHOOK_SECRET')
    expect(appSettingsFromEnv({ PR_REVIEWER_APP_ID: '12', PR_REVIEWER_APP_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n'), PR_REVIEWER_WEBHOOK_SECRET: SECRET }).ok).toBe(true)
  })
})

describe('pr-reviewer app server', () => {
  let close: (() => Promise<void>) | undefined
  afterEach(async () => close?.())

  it('rejects unsigned deliveries, queues signed PR events, and answers health checks', async () => {
    const jobs: AppJob[] = []
    const user = parseUserConfig({ version: 1 })
    const config = resolveSettings({ user: user.ok ? user.value : ({} as never) })
    const server = await startAppServer({ github: { appId: '1', privateKey, webhookSecret: SECRET }, gitlabSecret: 'gitlab-secret-0123456789', azureSecret: 'azure-secret-0123456789', port: 0, bind: '127.0.0.1', config: config.ok ? config.value : (undefined as never), deps: {} as CliDeps, runJob: async (j) => void jobs.push(j) })
    close = server.close
    const post = (body: string, sig?: string, event = 'pull_request') => fetch(`${server.url}/webhooks/github`, { method: 'POST', headers: { 'x-github-event': event, ...(sig ? { 'x-hub-signature-256': sig } : {}) }, body })
    const body = JSON.stringify({ action: 'opened', installation: { id: 7 }, repository: repo, pull_request: { number: 9 } })
    expect((await post(body)).status).toBe(401)
    expect((await post(body, sign(body.replace('9', '8')))).status).toBe(401)
    const ok = await post(body, sign(body))
    expect(ok.status).toBe(202)
    expect(await ok.json()).toEqual({ queued: true, job: 'review:octo/app#9' })
    await new Promise((r) => setTimeout(r, 10))
    expect(jobs.map((j) => j.key)).toEqual(['review:octo/app#9'])
    expect(await (await fetch(`${server.url}/healthz`)).json()).toEqual({ ok: true, queued: 0 })

    // GitLab: the X-Gitlab-Token must be the shared secret.
    const mr = JSON.stringify({ object_kind: 'merge_request', object_attributes: { action: 'open', iid: 5 }, project: { web_url: 'https://gitlab.com/acme/platform/api', path_with_namespace: 'acme/platform/api' } })
    const gl = (token?: string) => fetch(`${server.url}/webhooks/gitlab`, { method: 'POST', headers: { 'x-gitlab-event': 'Merge Request Hook', ...(token ? { 'x-gitlab-token': token } : {}) }, body: mr })
    expect((await gl('wrong')).status).toBe(401)
    expect(await (await gl('gitlab-secret-0123456789')).json()).toEqual({ queued: true, job: 'review:gitlab.com/acme/platform/api#5' })
    // Azure DevOps: basic auth with the shared secret as the password.
    const az = JSON.stringify({ eventType: 'git.pullrequest.created', resource: { pullRequestId: 9, repository: { name: 'api', project: { name: 'Platform' }, url: 'https://dev.azure.com/acme/_apis/git/repositories/x' } } })
    const auth = (pw: string) => `Basic ${Buffer.from(`hook:${pw}`).toString('base64')}`
    expect((await fetch(`${server.url}/webhooks/azure-devops`, { method: 'POST', headers: { authorization: auth('nope') }, body: az })).status).toBe(401)
    expect(await (await fetch(`${server.url}/webhooks/azure-devops`, { method: 'POST', headers: { authorization: auth('azure-secret-0123456789') }, body: az })).json()).toEqual({ queued: true, job: 'review:dev.azure.com/acme/Platform/api#9' })
    // Bitbucket is not configured here, so it has no endpoint to trust.
    expect((await fetch(`${server.url}/webhooks/bitbucket`, { method: 'POST', headers: { 'x-hub-signature': sign('{}') }, body: '{}' })).status).toBe(401)
  })
})

describe('webhooks from GitLab, Bitbucket and Azure DevOps', () => {
  it('routes merge request and pull request events to reviews, and comment commands to replies', () => {
    const project = { web_url: 'https://gitlab.example.com/team/svc', path_with_namespace: 'team/svc' }
    expect(routeGitLab('Merge Request Hook', { object_attributes: { action: 'update', oldrev: 'abc', iid: 3 }, project })?.ref).toEqual({ host: 'gitlab.example.com', owner: 'team', repo: 'svc', number: 3 })
    expect(routeGitLab('Merge Request Hook', { object_attributes: { action: 'update', iid: 3 }, project })).toBeUndefined()
    expect(routeGitLab('Merge Request Hook', { object_attributes: { action: 'open', iid: 3, draft: true }, project })).toBeUndefined()
    expect(routeGitLab('Note Hook', { object_attributes: { noteable_type: 'MergeRequest', note: '@pr-reviewer why' }, merge_request: { iid: 3 }, project })?.kind).toBe('respond')
    expect(routeBitbucket('pullrequest:updated', { pullrequest: { id: 7 }, repository: { full_name: 'acme/api' } })).toMatchObject({ kind: 'review', forge: 'bitbucket', ref: { host: 'bitbucket.org', owner: 'acme', repo: 'api', number: 7 } })
    expect(routeBitbucket('pullrequest:comment_created', { pullrequest: { id: 7 }, repository: { full_name: 'acme/api' }, comment: { content: { raw: 'nice' } } })).toBeUndefined()
    expect(routeAzure({ eventType: 'ms.vss-code.git-pullrequest-comment-event', resource: { comment: { content: '@pr-reviewer fix' }, pullRequest: { pullRequestId: 9, repository: { name: 'api', project: { name: 'Platform' }, url: 'https://acme.visualstudio.com/_apis/git/repositories/x' } } } })).toMatchObject({ kind: 'respond', ref: { owner: 'acme/Platform', number: 9 } })
    expect(sameSecret('abc', 'abc')).toBe(true)
    expect(sameSecret('abc', 'abd')).toBe(false)
  })

  it('starts with any one forge configured, and says what is missing otherwise', () => {
    expect(forgeSettingsFromEnv({ PR_REVIEWER_GITLAB_WEBHOOK_SECRET: 'gitlab-secret-0123456789' })).toEqual({ ok: true, value: { gitlabSecret: 'gitlab-secret-0123456789' } })
    const none = forgeSettingsFromEnv({})
    expect(!none.ok && none.problems[0]).toContain('Configure at least one forge')
    const partial = forgeSettingsFromEnv({ PR_REVIEWER_APP_ID: '12' })
    expect(!partial.ok && partial.problems.join(' ')).toContain('PR_REVIEWER_WEBHOOK_SECRET')
  })
})
