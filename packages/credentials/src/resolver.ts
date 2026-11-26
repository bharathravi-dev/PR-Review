import { execFile } from 'node:child_process'
import { err, ok, Secret, type CredentialResolver, type Result } from '@pr-reviewer/core'

/** Environment variables checked, in order, for each Credential reference. */
export function envNamesFor(ref: string): string[] {
  if (ref === 'github') return ['GITHUB_TOKEN', 'GH_TOKEN']
  if (ref === 'gitlab') return ['GITLAB_TOKEN', 'GL_TOKEN']
  if (ref === 'bitbucket') return ['BITBUCKET_TOKEN']
  if (ref === 'azure-devops') return ['AZURE_DEVOPS_TOKEN', 'AZURE_DEVOPS_EXT_PAT']
  if (ref === 'provider:anthropic') return ['ANTHROPIC_API_KEY']
  if (ref === 'provider:openai') return ['OPENAI_API_KEY']
  const id = ref.replace(/^provider:/, '')
  return [`PR_REVIEWER_${id.toUpperCase().replace(/-/g, '_')}_API_KEY`]
}

export const KEYCHAIN_SERVICE = 'pr-reviewer'

export interface ResolverDeps {
  env: Readonly<Record<string, string | undefined>>
  /** Reads a stored value for `account` from the OS keychain; undefined when absent or unavailable. */
  keychain?: (account: string) => Promise<string | undefined>
  /** Returns the GitHub CLI's token for `host`; undefined when gh is missing or logged out. */
  ghToken?: (host: string) => Promise<string | undefined>
}

/** Resolves Credential references from env vars, then the OS keychain, then the GitHub CLI (github only). */
export class DefaultCredentialResolver implements CredentialResolver {
  readonly #deps: Required<ResolverDeps>

  constructor(deps: ResolverDeps) {
    this.#deps = { keychain: osKeychain, ghToken: ghCliToken, ...deps }
  }

  async resolve(ref: string, opts: { host?: string } = {}): Promise<Result<Secret>> {
    for (const name of envNamesFor(ref)) {
      const v = this.#deps.env[name]?.trim()
      if (v) return ok(new Secret(v))
    }
    const stored = await this.#deps.keychain(ref).catch(() => undefined)
    if (stored) return ok(new Secret(stored))
    if (ref === 'github') {
      const token = await this.#deps.ghToken(opts.host ?? 'github.com').catch(() => undefined)
      if (token) return ok(new Secret(token))
    }
    const where = [
      ...envNamesFor(ref).map((n) => `env ${n}`),
      `the OS keychain (service "${KEYCHAIN_SERVICE}", account "${ref}")`,
    ]
    if (ref === 'github') where.push('`gh auth login`')
    return err('credential_missing', `No value found for credential "${ref}". Set one of: ${where.join(', ')}.`)
  }
}

async function osKeychain(account: string): Promise<string | undefined> {
  try {
    const mod = (await import('@napi-rs/keyring')) as {
      Entry: new (service: string, account: string) => { getPassword(): string | null }
    }
    return new mod.Entry(KEYCHAIN_SERVICE, account).getPassword() ?? undefined
  } catch {
    return undefined
  }
}

function ghCliToken(host: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('gh', ['auth', 'token', '--hostname', host], { timeout: 10_000 }, (error, stdout) => {
      resolve(error ? undefined : stdout.trim() || undefined)
    })
  })
}
