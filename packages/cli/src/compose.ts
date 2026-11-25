// Composition root for the CLI Channel (AD-2, AD-16): the only CLI file that imports adapters.
import type { CredentialResolver, GitHubReader, GitHubWriter, ReviewProvider, Secret, SecretScanner } from '@pr-reviewer/core'
import { DefaultCredentialResolver } from '@pr-reviewer/credentials'
import { GitHubClient, GitHubPrReader, GitHubPrWriter, apiUrlForHost } from '@pr-reviewer/github'
import { ClaudeCodeProvider, CodexProvider, findClaudeCode, findCodex } from '@pr-reviewer/providers-cli'
import { AnthropicProvider, OpenAiCompatibleProvider } from '@pr-reviewer/providers-http'
import { scanSecrets } from '@pr-reviewer/validators'

export { apiUrlForHost, findClaudeCode, findCodex }

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

export function createAnthropicProvider(opts: { name?: string | undefined; apiKey: Secret; model?: string | undefined; baseUrl?: string | undefined; timeoutMs?: number | undefined; fetch: typeof fetch }): ReviewProvider {
  return new AnthropicProvider(opts)
}

export function createOpenAiProvider(opts: ConstructorParameters<typeof OpenAiCompatibleProvider>[0]): ReviewProvider {
  return new OpenAiCompatibleProvider(opts)
}

export function createClaudeCodeProvider(opts: ConstructorParameters<typeof ClaudeCodeProvider>[0]): ReviewProvider {
  return new ClaudeCodeProvider(opts)
}

export function createCodexProvider(opts: ConstructorParameters<typeof CodexProvider>[0]): ReviewProvider {
  return new CodexProvider(opts)
}

export const secretScanner: SecretScanner = scanSecrets
