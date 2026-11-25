// Composition root for the CLI Channel (AD-2, AD-16): the only CLI file that imports adapters.
import type { CredentialResolver, GitHubReader, ReviewProvider, Secret, SecretScanner } from '@pr-reviewer/core'
import { DefaultCredentialResolver } from '@pr-reviewer/credentials'
import { GitHubClient, GitHubPrReader, apiUrlForHost } from '@pr-reviewer/github'
import { AnthropicProvider } from '@pr-reviewer/providers'
import { scanSecrets } from '@pr-reviewer/validators'

export { apiUrlForHost }

export function createCredentialResolver(env: Readonly<Record<string, string | undefined>>): CredentialResolver {
  return new DefaultCredentialResolver({ env })
}

export function createGitHubReader(opts: { apiUrl: string; token?: string | undefined; fetch: typeof fetch; userAgent: string }): GitHubReader {
  return new GitHubPrReader(new GitHubClient(opts))
}

export function createAnthropicProvider(opts: { apiKey: Secret; model?: string | undefined; baseUrl?: string | undefined; fetch: typeof fetch }): ReviewProvider {
  return new AnthropicProvider(opts)
}

export const secretScanner: SecretScanner = scanSecrets
