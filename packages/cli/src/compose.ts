// Composition root for the CLI Channel (AD-2, AD-16): the only CLI file that imports adapters.
import { redactText, Secret as SecretValue, type AdvisoryPort, type CredentialResolver, type GitHubReader, type GitHubWriter, type PrContext, type ReviewProvider, type SandboxPort, type Secret, type SecretScanner, type SonarPort, type Ticket, type Validator } from '@pr-reviewer/core'
import { OsvAdvisories } from '@pr-reviewer/advisories'
import { DefaultCredentialResolver, envNamesFor } from '@pr-reviewer/credentials'
import { AutomationClient, AzureDevOpsReader, AzureDevOpsWriter, BitbucketReader, BitbucketWriter, GitHubClient, GitHubPrReader, GitHubPrWriter, GitLabReader, GitLabWriter, apiUrlForHost, createSonarPort, createTicketPort, gitlabApiUrl } from '@pr-reviewer/github'
import { ClaudeCodeProvider, CodexProvider, findClaudeCode, findCodex, runFixAgent, runProcess, type ProcessRunner } from '@pr-reviewer/providers-cli'
import { AnthropicProvider, OllamaProvider, OpenAiCompatibleProvider } from '@pr-reviewer/providers-http'
import { ContainerSandbox, FallbackSandbox, NODE_IMAGES } from '@pr-reviewer/sandbox'
import { BUILT_IN_VALIDATORS, installSteps, preservesValidSyntax, scanSecrets } from '@pr-reviewer/validators'

export { apiUrlForHost, envNamesFor, findClaudeCode, findCodex, preservesValidSyntax, runFixAgent, runProcess }
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

/** Azure DevOps (Azure Repos) pull requests behind the same ports. */
export function createAzureDevOps(opts: { token?: string | undefined; fetch: typeof fetch; userAgent: string }): { reader: GitHubReader; writer: GitHubWriter } {
  return { reader: new AzureDevOpsReader(opts), writer: new AzureDevOpsWriter(opts) }
}

/** Bitbucket Cloud pull requests behind the same ports. */
export function createBitbucket(opts: { token?: string | undefined; fetch: typeof fetch; userAgent: string }): { reader: GitHubReader; writer: GitHubWriter } {
  return { reader: new BitbucketReader(opts), writer: new BitbucketWriter(opts) }
}

/** GitLab merge requests behind the same ports (roadmap item 10). */
export function createGitLab(opts: { apiUrl?: string | undefined; host: string; token?: string | undefined; fetch: typeof fetch; userAgent: string }): { reader: GitHubReader; writer: GitHubWriter } {
  const o = { apiUrl: opts.apiUrl ?? gitlabApiUrl(opts.host), token: opts.token, fetch: opts.fetch, userAgent: opts.userAgent }
  return { reader: new GitLabReader(o), writer: new GitLabWriter(o) }
}

/** Jira (JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN) and Linear (LINEAR_API_KEY) tickets, when configured. */
export function createTickets(env: Readonly<Record<string, string | undefined>>, fetchImpl: typeof fetch, secrets: Secret[]): ((keys: readonly string[]) => Promise<Ticket[]>) | undefined {
  const jira = env.JIRA_BASE_URL && env.JIRA_EMAIL && env.JIRA_API_TOKEN ? { baseUrl: env.JIRA_BASE_URL, email: env.JIRA_EMAIL, token: env.JIRA_API_TOKEN } : undefined
  const linear = env.LINEAR_API_KEY ? { apiKey: env.LINEAR_API_KEY } : undefined
  if (!jira && !linear) return undefined
  if (jira) secrets.push(new SecretValue(jira.token))
  if (linear) secrets.push(new SecretValue(linear.apiKey))
  return createTicketPort({ fetch: fetchImpl, jira, linear })
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

export function createSandbox(opts: { runtime?: string | undefined; allowLocalFallback?: ((reason: string) => Promise<boolean>) | undefined }): SandboxPort {
  const primary = new ContainerSandbox({ command: opts.runtime })
  if (!opts.allowLocalFallback) return primary
  return new FallbackSandbox({ primary, allowFallback: opts.allowLocalFallback })
}

export function createAdvisories(opts: { url?: string | undefined; fetch: typeof fetch }): AdvisoryPort {
  return new OsvAdvisories(opts)
}

/** Direct SonarQube / SonarCloud REST API client when SONAR_HOST_URL is configured. */
export function createSonar(env: Readonly<Record<string, string | undefined>>, fetchImpl: typeof fetch, secrets: Secret[]): SonarPort | undefined {
  const hostUrl = env.SONAR_HOST_URL?.trim()
  if (!hostUrl) return undefined
  const token = env.SONAR_TOKEN?.trim()
  if (token) secrets.push(new SecretValue(token))
  const projectKey = env.SONAR_PROJECT_KEY?.trim()
  return createSonarPort({ hostUrl, token, projectKey, fetch: fetchImpl })
}

/** Removes secrets from one file's text with the same scanner the review uses (replies in the PR thread). */
export function redactFile(path: string, text: string): string {
  const ctx = { files: [{ path, status: 'modified', additions: 0, deletions: 0, binary: false, patchTruncated: false, head: { text } }], title: '', body: '', reviews: [], reviewComments: [], issueComments: [] } as unknown as PrContext
  return redactText(text, scanSecrets(ctx).values)
}
