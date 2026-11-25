// Composition root for the CLI Channel (AD-2, AD-16): the only CLI file that imports adapters.
import type { CredentialResolver, GitHubReader, GitHubWriter, ReviewProvider, Secret, SecretScanner } from '@pr-reviewer/core'
import { DefaultCredentialResolver } from '@pr-reviewer/credentials'
import { GitHubClient, GitHubPrReader, GitHubPrWriter, apiUrlForHost } from '@pr-reviewer/github'
import { AnthropicProvider } from '@pr-reviewer/providers'
import { scanSecrets } from '@pr-reviewer/validators'

export { apiUrlForHost }

export function createCredentialResolver(env: Readonly<Record<string, string | undefined>>): CredentialResolver {
  return new DefaultCredentialResolver({ env })
}

export function createGitHub(opts: { apiUrl: string; token?: string | undefined; fetch: typeof fetch; userAgent: string }): {
  reader: GitHubReader
  writer: GitHubWriter
} {
  const client = new GitHubClient(opts)
  return { reader: new GitHubPrReader(client), writer: new GitHubPrWriter(client) }
}

export function createAnthropicProvider(opts: { apiKey: Secret; model?: string | undefined; baseUrl?: string | undefined; fetch: typeof fetch }): ReviewProvider {
  return new AnthropicProvider(opts)
}

export const secretScanner: SecretScanner = scanSecrets
