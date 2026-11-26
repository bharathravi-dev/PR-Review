// Composition root for the browser extension's Standalone mode (AD-2, AD-16): the engine runs in the side panel
// page with the user's own GitHub token and AI key. No Sandbox exists here, so compile and lint are reported
// SKIPPED (NO_SANDBOX) by the engine itself. Isomorphic: no chrome.* APIs, so it is tested under Node.
import { OsvAdvisories } from '@pr-reviewer/advisories'
import {
  hunksFromContext,
  parsePrRef,
  planPublish,
  publish,
  readPrior,
  renderPublish,
  runReviewWithContext,
  Secret,
  type GitHubReader,
  type GitHubWriter,
  type PrContext,
  type PrRef,
  type PublishPlan,
  type PublishPreview,
  type PublishRecord,
  type Report,
  type ReviewProvider,
  type RunEvent,
} from '@pr-reviewer/core'
import { apiUrlForHost, GitHubClient, GitHubPrReader, GitHubPrWriter } from '@pr-reviewer/github'
import { AnthropicProvider, DEFAULT_OLLAMA_BASE_URL, listOllamaModels, OllamaProvider, OpenAiCompatibleProvider, type OllamaModel } from '@pr-reviewer/providers-http'
import { BUILT_IN_VALIDATORS, scanSecrets } from '@pr-reviewer/validators'

/** Engine version recorded in Reports; kept in lockstep with @pr-reviewer/cli (a test checks it). */
export const ENGINE_VERSION = '0.1.0'

export interface StandaloneSettings {
  githubToken: string
  /** GitHub host (github.com or an Enterprise host the user added). */
  host?: string | undefined
  provider: {
    /** ollama: a local model, no key; nothing leaves this computer for the AI step. */
    type: 'anthropic' | 'openai-compatible' | 'ollama'
    /** Empty for Ollama. */
    apiKey: string
    model?: string | undefined
    /** OpenAI-compatible endpoint (default https://api.openai.com/v1), or Ollama's address (default http://127.0.0.1:11434). */
    baseUrl?: string | undefined
  }
}

/** The PR a tab shows, from its URL only (never from the page): any tab on the host, including /files and /commits. */
export function prFromUrl(url: string | undefined, host = 'github.com'): { owner: string; repo: string; number: number } | undefined {
  if (!url) return undefined
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return undefined
  }
  if (u.protocol !== 'https:' || u.host !== host) return undefined
  const m = /^\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:\/|$)/.exec(u.pathname)
  return m ? { owner: m[1]!, repo: m[2]!, number: Number(m[3]) } : undefined
}

export function createProvider(p: StandaloneSettings['provider'], fetchImpl: typeof fetch): ReviewProvider {
  if (p.type === 'ollama') {
    if (!p.model) throw new Error('Choose an Ollama model.')
    return new OllamaProvider({ model: p.model, baseUrl: p.baseUrl, fetch: fetchImpl })
  }
  const apiKey = new Secret(p.apiKey)
  if (p.type === 'anthropic') return new AnthropicProvider({ apiKey, model: p.model, fetch: fetchImpl, browser: true })
  if (!p.model) throw new Error('An OpenAI-compatible provider needs a model name.')
  return new OpenAiCompatibleProvider({ name: 'openai', apiKey, model: p.model, baseUrl: p.baseUrl, fetch: fetchImpl })
}

export interface StandaloneRun {
  pr: string
  settings: StandaloneSettings
  fetch: typeof fetch
  onEvent?: ((e: RunEvent) => void) | undefined
  now?: () => number
}

/** A finished Standalone review with what posting needs (kept in the panel's memory only). */
export interface StandaloneResult {
  report: Report
  context: PrContext | undefined
  ref: PrRef
  viewer: { id: number; login: string } | undefined
}

function githubFor(settings: StandaloneSettings, fetchImpl: typeof fetch): { reader: GitHubReader; writer: GitHubWriter } {
  const host = settings.host ?? 'github.com'
  const client = new GitHubClient({ apiUrl: apiUrlForHost(host), token: settings.githubToken, fetch: fetchImpl, userAgent: `pr-reviewer-extension/${ENGINE_VERSION}` })
  return { reader: new GitHubPrReader(client), writer: new GitHubPrWriter(client) }
}

/** One Standalone review of a PR: GitHub reader, secret scan, file-only Validators, OSV, the user's AI provider. */
export async function runStandaloneReview(o: StandaloneRun): Promise<Report> {
  return (await runStandalone(o)).report
}

export async function runStandalone(o: StandaloneRun): Promise<StandaloneResult> {
  const host = o.settings.host ?? 'github.com'
  const ref = parsePrRef(o.pr, host)
  if (!ref.ok) throw new Error(ref.error.message)
  const github = githubFor(o.settings, o.fetch).reader
  const viewer = await github.viewer()
  const provider = createProvider(o.settings.provider, o.fetch)
  const { report, context } = await runReviewWithContext(
    {
      ref: ref.value,
      engineVersion: ENGINE_VERSION,
      channel: 'EXTENSION_STANDALONE',
      review: { ...(o.settings.provider.type === 'anthropic' ? {} : { provider: provider.id }), model: o.settings.provider.model },
      reviewerId: viewer.ok ? viewer.value.id : undefined,
      onEvent: o.onEvent,
    },
    {
      github,
      scanSecrets: (ctx) => scanSecrets(ctx, () => Date.now()),
      providers: [{ name: provider.id, provider, ...(o.settings.provider.model ? { model: o.settings.provider.model } : {}) }],
      validators: BUILT_IN_VALIDATORS,
      advisories: new OsvAdvisories({ fetch: o.fetch }),
      now: o.now ?? (() => Date.now()),
    },
  )
  return { report, context, ref: ref.value, viewer: viewer.ok ? { id: viewer.value.id, login: viewer.value.login } : undefined }
}

export type Edits = Record<string, { title?: string; description?: string; recommendation?: string }>

/** The report with the user's wording applied (same rule as ReviewService v1's publish). */
export function withEdits(report: Report, edits: Edits): Report {
  if (!Object.keys(edits).length) return report
  return {
    ...report,
    findings: report.findings.map((f) => {
      const e = f.fingerprint ? edits[f.fingerprint] : undefined
      if (!e) return f
      return { ...f, ...(e.title !== undefined ? { title: e.title } : {}), ...(e.description !== undefined ? { description: e.description } : {}), ...(e.recommendation !== undefined ? { recommendation: e.recommendation } : {}) }
    }),
  }
}

const repoPublish = (report: Report) => ((report.audit.repoConfig?.settings as { publish?: Record<string, unknown> } | undefined)?.publish ?? {})

export interface PostChoice {
  event: 'COMMENT' | 'REQUEST_CHANGES'
  include?: readonly string[] | undefined
  edits?: Edits
}

/** Builds the exact post (AD-23 "preview equals post"): prior publication is read from GitHub each time. */
export async function previewPost(r: StandaloneResult, settings: StandaloneSettings, fetchImpl: typeof fetch, choice: PostChoice): Promise<{ plan: PublishPlan; preview: PublishPreview; report: Report }> {
  if (!r.viewer) throw new Error('Posting needs your GitHub identity; check the token.')
  if (!r.context) throw new Error('The PR could not be loaded, so there is nothing to post.')
  const report = withEdits(r.report, choice.edits ?? {})
  const { reader } = githubFor(settings, fetchImpl)
  const published = await reader.listPublished(r.ref)
  if (!published.ok) throw new Error(published.error.message)
  const repo = repoPublish(report)
  const plan = planPublish(report, {
    prior: readPrior(published.value, r.viewer.id, report.run.fpv),
    hunks: hunksFromContext(r.context),
    rid: r.viewer.id,
    engineMajor: Number(ENGINE_VERSION.split('.')[0]) || 0,
    productVersion: ENGINE_VERSION,
    unattended: false,
    event: choice.event,
    include: choice.include,
    maxInline: typeof repo.maxInlineComments === 'number' ? repo.maxInlineComments : undefined,
    minInlineSeverity: typeof repo.minInlineSeverity === 'string' ? (repo.minInlineSeverity as never) : undefined,
  })
  return { plan, preview: renderPublish(report, plan), report }
}

/** Posts exactly the shown preview through core's single GitHub writer; the head is re-read first (AD-9, AD-23). */
export async function postReview(r: StandaloneResult, settings: StandaloneSettings, fetchImpl: typeof fetch, shown: { plan: PublishPlan; preview: PublishPreview; report: Report }): Promise<PublishRecord> {
  const { reader, writer } = githubFor(settings, fetchImpl)
  return publish(shown.report, shown.plan, shown.preview, r.ref, { reader, writer, now: () => Date.now() })
}

/** Checks a GitHub token: who it belongs to. */
export async function testGitHubToken(token: string, fetchImpl: typeof fetch, host = 'github.com'): Promise<{ ok: true; login: string } | { ok: false; message: string }> {
  const { reader } = githubFor({ githubToken: token, host, provider: { type: 'anthropic', apiKey: 'x' } }, fetchImpl)
  const v = await reader.viewer()
  return v.ok ? { ok: true, login: v.value.login } : { ok: false, message: v.error.message }
}

/** Checks an AI key with one small, free call (listing models). */
export async function testAiKey(p: StandaloneSettings['provider'], fetchImpl: typeof fetch): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  try {
    if (p.type === 'ollama') {
      const models = await listOllamaModels(p.baseUrl ?? DEFAULT_OLLAMA_BASE_URL, fetchImpl)
      if (!p.model) return { ok: false, message: 'Model: choose one of the models installed in Ollama.' }
      if (!models.some((m) => m.name === p.model)) return { ok: false, message: `Model: Ollama does not have ${p.model}. Install it with: ollama pull ${p.model}` }
      return { ok: true, message: `Works: Ollama is running with ${p.model}. Reviews stay on this computer.` }
    }
    if (p.type === 'anthropic') {
      const r = await fetchImpl('https://api.anthropic.com/v1/models?limit=1', { headers: { 'x-api-key': p.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } })
      if (r.ok) return { ok: true, message: `Works: Anthropic accepted the key${p.model ? ` (model ${p.model})` : ''}.` }
      return { ok: false, message: `AI key: Anthropic rejected it (${r.status}). Check the key or create a new one.` }
    }
    const base = (p.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '')
    const r = await fetchImpl(`${base}/models`, { headers: { authorization: `Bearer ${p.apiKey}` } })
    if (r.ok) return { ok: true, message: `Works: ${new URL(base).host} accepted the key.` }
    return { ok: false, message: `AI key: ${new URL(base).host} rejected it (${r.status}). Check the key or create a new one.` }
  } catch (e) {
    if (p.type === 'ollama') return { ok: false, message: ollamaProblem((e as Error).message) }
    return { ok: false, message: `AI key: could not reach the provider (${(e as Error).message}).` }
  }
}

/** GitHub's device flow (OAuth app client ID configured at build time). Never sees a password; the user approves on github.com. */
export async function startDeviceFlow(clientId: string, fetchImpl: typeof fetch, host = 'github.com'): Promise<{ deviceCode: string; userCode: string; verificationUri: string; expiresAt: number; interval: number }> {
  const r = await fetchImpl(`https://${host}/login/device/code`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ client_id: clientId, scope: 'repo' }) })
  const d = (await r.json().catch(() => ({}))) as { device_code?: string; user_code?: string; verification_uri?: string; expires_in?: number; interval?: number; error?: string }
  if (!r.ok || !d.device_code) throw new Error(deviceStartProblem(d.error, r.status))
  return { deviceCode: d.device_code, userCode: d.user_code!, verificationUri: d.verification_uri!, expiresAt: Date.now() + (d.expires_in ?? 900) * 1000, interval: d.interval ?? 5 }
}

/** GitHub's reason for not starting device sign-in, in words the person setting up the app can act on. */
export function deviceStartProblem(error: string | undefined, status: number): string {
  if (error === 'device_flow_disabled') return 'Sign in with GitHub is not switched on for this OAuth app yet. In the app’s settings on GitHub, tick “Enable Device Flow” and save, then try again. Or use a token instead.'
  if (error === 'incorrect_client_credentials' || status === 404) return 'GitHub does not know this OAuth app’s client ID. Check githubClientId in packages/extension/oauth.json, rebuild, and reload the extension. Or use a token instead.'
  return `GitHub refused to start sign-in (${error ?? status}). Try again, or use a token instead.`
}

export type DevicePoll = { status: 'pending' } | { status: 'slow_down'; interval: number } | { status: 'approved'; token: string } | { status: 'expired' } | { status: 'denied' } | { status: 'error'; message: string }

export async function pollDeviceFlow(clientId: string, deviceCode: string, fetchImpl: typeof fetch, host = 'github.com'): Promise<DevicePoll> {
  const r = await fetchImpl(`https://${host}/login/oauth/access_token`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ client_id: clientId, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) })
  const d = (await r.json().catch(() => ({}))) as { access_token?: string; error?: string; interval?: number }
  if (d.access_token) return { status: 'approved', token: d.access_token }
  if (d.error === 'authorization_pending') return { status: 'pending' }
  if (d.error === 'slow_down') return { status: 'slow_down', interval: d.interval ?? 10 }
  if (d.error === 'expired_token') return { status: 'expired' }
  if (d.error === 'access_denied') return { status: 'denied' }
  return { status: 'error', message: d.error ?? `HTTP ${r.status}` }
}

/** The Files changed anchor GitHub uses for a file and line (computed from API data, never the page). */
export async function diffAnchor(host: string, repo: string, pr: number, path: string, line?: number): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(path))
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `https://${host}/${repo}/pull/${pr}/files#diff-${hex}${line ? `R${line}` : ''}`
}

/** The PR's current head commit, to mark a stored review outdated (AD-23). */
export async function currentHead(settings: StandaloneSettings, pr: string, fetchImpl: typeof fetch): Promise<string | undefined> {
  const ref = parsePrRef(pr, settings.host ?? 'github.com')
  if (!ref.ok) return undefined
  const head = await githubFor(settings, fetchImpl).reader.getHeadSha(ref.value)
  return head.ok ? head.value : undefined
}

export { DEFAULT_OLLAMA_BASE_URL, listOllamaModels, type OllamaModel }

/** What to do when Ollama can't be used, in the words shown in setup. */
export function ollamaProblem(message: string): string {
  if (/403|allowed origins/.test(message)) {
    return 'Ollama refused the extension (403). Allow it once: quit Ollama, run  launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"  in a terminal, then open Ollama again.'
  }
  if (/reach/i.test(message)) return 'Ollama isn’t running. Open the Ollama app (or run: ollama serve), then try again.'
  return message
}

/** An Ollama address the extension may use: http on this computer, or https anywhere. */
export function ollamaOrigin(typed: string | undefined): string | undefined {
  const text = (typed ?? '').trim() || DEFAULT_OLLAMA_BASE_URL
  let url: URL
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `http://${text}`)
  } catch {
    return undefined
  }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost'
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) || url.username || url.password) return undefined
  return url.origin
}
