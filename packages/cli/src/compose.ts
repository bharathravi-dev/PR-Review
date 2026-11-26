// Composition root for the CLI Channel (AD-2, AD-16): the only CLI file that imports adapters.
import type { AdvisoryPort, CredentialResolver, GitHubReader, GitHubWriter, ReviewProvider, SandboxPort, Secret, SecretScanner, Validator } from '@pr-reviewer/core'
import { OsvAdvisories } from '@pr-reviewer/advisories'
import { DefaultCredentialResolver, envNamesFor } from '@pr-reviewer/credentials'
import { AutomationClient, GitHubClient, GitHubPrReader, GitHubPrWriter, apiUrlForHost } from '@pr-reviewer/github'
import { ClaudeCodeProvider, CodexProvider, findClaudeCode, findCodex, runFixAgent, runProcess, type ProcessRunner } from '@pr-reviewer/providers-cli'
import { AnthropicProvider, OllamaProvider, OpenAiCompatibleProvider } from '@pr-reviewer/providers-http'
import { ContainerSandbox, NODE_IMAGES } from '@pr-reviewer/sandbox'
import { BUILT_IN_VALIDATORS, installSteps, scanSecrets } from '@pr-reviewer/validators'

export { apiUrlForHost, envNamesFor, findClaudeCode, findCodex, runFixAgent, runProcess }
export type { ProcessRunner }
export type { AutomationClient }

/** Node majors the Sandbox has pinned images for. */
export const SANDBOX_NODE_MAJORS: readonly number[] = Object.keys(NODE_IMAGES).map(Number)

export function createAutomation(opts: { apiUrl: string; token?: string | undefined; fetch: typeof fetch; userAgent: string }): AutomationClient {
  return new AutomationClient(new GitHubClient(opts))
}

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

export function createOllamaProvider(opts: ConstructorParameters<typeof OllamaProvider>[0]): ReviewProvider {
  return new OllamaProvider(opts)
}

export function createClaudeCodeProvider(opts: ConstructorParameters<typeof ClaudeCodeProvider>[0]): ReviewProvider {
  return new ClaudeCodeProvider(opts)
}

export function createCodexProvider(opts: ConstructorParameters<typeof CodexProvider>[0]): ReviewProvider {
  return new CodexProvider(opts)
}

export const secretScanner: SecretScanner = scanSecrets

export const validators: readonly Validator[] = BUILT_IN_VALIDATORS
export { installSteps }

export function createSandbox(opts: { runtime?: string | undefined }): SandboxPort {
  return new ContainerSandbox({ command: opts.runtime })
}

export function createAdvisories(opts: { url?: string | undefined; fetch: typeof fetch }): AdvisoryPort {
  return new OsvAdvisories(opts)
}
