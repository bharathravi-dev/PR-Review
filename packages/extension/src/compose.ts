// Composition root for the browser extension's Standalone mode (AD-2, AD-16): the engine runs in the side panel
// page with the user's own GitHub token and AI key. No Sandbox exists here, so compile and lint are reported
// SKIPPED (NO_SANDBOX) by the engine itself. Isomorphic: no chrome.* APIs, so it is tested under Node.
import { OsvAdvisories } from '@pr-reviewer/advisories'
import { parsePrRef, runReviewWithContext, Secret, type Report, type ReviewProvider, type RunEvent } from '@pr-reviewer/core'
import { apiUrlForHost, GitHubClient, GitHubPrReader } from '@pr-reviewer/github'
import { AnthropicProvider, OpenAiCompatibleProvider } from '@pr-reviewer/providers-http'
import { BUILT_IN_VALIDATORS, scanSecrets } from '@pr-reviewer/validators'

/** Engine version recorded in Reports; kept in lockstep with @pr-reviewer/cli (a test checks it). */
export const ENGINE_VERSION = '0.1.0'

export interface StandaloneSettings {
  githubToken: string
  /** GitHub host (github.com or an Enterprise host the user added). */
  host?: string | undefined
  provider: {
    type: 'anthropic' | 'openai-compatible'
    apiKey: string
    model?: string | undefined
    /** OpenAI-compatible endpoint (default https://api.openai.com/v1). */
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

/** One Standalone review of a PR: GitHub reader, secret scan, file-only Validators, OSV, the user's AI provider. */
export async function runStandaloneReview(o: StandaloneRun): Promise<Report> {
  const host = o.settings.host ?? 'github.com'
  const ref = parsePrRef(o.pr, host)
  if (!ref.ok) throw new Error(ref.error.message)
  const client = new GitHubClient({ apiUrl: apiUrlForHost(host), token: o.settings.githubToken, fetch: o.fetch, userAgent: `pr-reviewer-extension/${ENGINE_VERSION}` })
  const github = new GitHubPrReader(client)
  const viewer = await github.viewer()
  const provider = createProvider(o.settings.provider, o.fetch)
  const { report } = await runReviewWithContext(
    {
      ref: ref.value,
      engineVersion: ENGINE_VERSION,
      channel: 'EXTENSION_STANDALONE',
      review: { ...(o.settings.provider.type === 'anthropic' ? {} : { provider: 'openai' }), model: o.settings.provider.model },
      reviewerId: viewer.ok ? viewer.value.id : undefined,
      onEvent: o.onEvent,
    },
    {
      github,
      scanSecrets: (ctx) => scanSecrets(ctx, () => Date.now()),
      providers: [{ name: provider.id, provider }],
      validators: BUILT_IN_VALIDATORS,
      advisories: new OsvAdvisories({ fetch: o.fetch }),
      now: o.now ?? (() => Date.now()),
    },
  )
  return report
}
