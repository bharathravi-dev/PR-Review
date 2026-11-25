import { err, ok, type Result } from '@pr-reviewer/core'

/** REST API version pinned for every request (AD-9). */
export const GITHUB_API_VERSION = '2026-03-10'

export interface GitHubClientOptions {
  /** API base URL, e.g. "https://api.github.com" or "https://ghe.example.com/api/v3". */
  apiUrl: string
  token?: string | undefined
  fetch?: typeof fetch
  userAgent?: string
}

export interface Response<T> {
  data: T
  next?: string | undefined
}

/** Public GitHub's API URL for "github.com"; Enterprise hosts use "/api/v3". Overridable via Configuration. */
export function apiUrlForHost(host: string): string {
  return host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`
}

export class GitHubClient {
  readonly #apiUrl: string
  readonly #token: string | undefined
  readonly #fetch: typeof fetch
  readonly #userAgent: string

  constructor(opts: GitHubClientOptions) {
    this.#apiUrl = opts.apiUrl.replace(/\/+$/, '')
    this.#token = opts.token
    this.#fetch = opts.fetch ?? globalThis.fetch
    this.#userAgent = opts.userAgent ?? 'pr-reviewer'
  }

  async json<T>(pathOrUrl: string): Promise<Result<Response<T>>> {
    const res = await this.#request(pathOrUrl, 'application/vnd.github+json')
    if (!res.ok) return res
    return ok({ data: (await res.value.json()) as T, next: nextLink(res.value.headers.get('link')) })
  }

  /** Write request (POST/PATCH/DELETE) with a JSON body; returns the parsed response (undefined for 204). */
  async send<T>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<Result<T>> {
    const res = await this.#request(path, 'application/vnd.github+json', { method, body })
    if (!res.ok) return res
    if (res.value.status === 204) return ok(undefined as T)
    return ok((await res.value.json()) as T)
  }

  async raw(pathOrUrl: string): Promise<Result<string>> {
    const res = await this.#request(pathOrUrl, 'application/vnd.github.raw')
    if (!res.ok) return res
    return ok(await res.value.text())
  }

  /** Binary download (e.g. a source archive); follows redirects. Size-capped. */
  async bytes(pathOrUrl: string, maxBytes: number): Promise<Result<Uint8Array>> {
    const res = await this.#request(pathOrUrl, 'application/vnd.github+json')
    if (!res.ok) return res
    const declared = Number(res.value.headers.get('content-length') ?? 0)
    if (declared > maxBytes) return err('github_too_large', `The download is larger than ${Math.round(maxBytes / 1_048_576)} MB.`)
    const buf = new Uint8Array(await res.value.arrayBuffer())
    if (buf.length > maxBytes) return err('github_too_large', `The download is larger than ${Math.round(maxBytes / 1_048_576)} MB.`)
    return ok(buf)
  }

  /** Follows `Link: rel="next"` until exhausted or `maxItems` collected. */
  async paginate<T>(path: string, maxItems = Number.POSITIVE_INFINITY): Promise<Result<{ items: T[]; complete: boolean }>> {
    const items: T[] = []
    let url: string | undefined = path
    while (url && items.length < maxItems) {
      const page: Result<Response<T[]>> = await this.json<T[]>(url)
      if (!page.ok) return page
      items.push(...page.value.data)
      url = page.value.next
    }
    return ok({ items: items.slice(0, maxItems), complete: url === undefined && items.length <= maxItems })
  }

  async #request(
    pathOrUrl: string,
    accept: string,
    write?: { method: string; body?: unknown },
  ): Promise<Result<globalThis.Response>> {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${this.#apiUrl}${pathOrUrl}`
    const headers: Record<string, string> = {
      accept,
      'x-github-api-version': GITHUB_API_VERSION,
      'user-agent': this.#userAgent,
    }
    if (this.#token) headers.authorization = `Bearer ${this.#token}`
    const init: RequestInit = { headers }
    if (write) {
      init.method = write.method
      if (write.body !== undefined) {
        headers['content-type'] = 'application/json'
        init.body = JSON.stringify(write.body)
      }
    }
    let res: globalThis.Response
    try {
      res = await this.#fetch(url, init)
    } catch (e) {
      return err('github_unreachable', `Could not reach ${new URL(url).host}: ${(e as Error).message}`, true)
    }
    if (res.ok) return ok(res)
    return describeFailure(res, Boolean(this.#token), write !== undefined)
  }
}

function nextLink(link: string | null): string | undefined {
  if (!link) return undefined
  for (const part of link.split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="next"/.exec(part)
    if (m) return m[1]
  }
  return undefined
}

async function describeFailure(res: globalThis.Response, hasToken: boolean, isWrite: boolean): Promise<Result<never>> {
  const status = res.status
  if (status === 422) {
    let detail = ''
    try {
      const body = (await res.json()) as { message?: string; errors?: unknown[] }
      detail = [body.message, ...(body.errors ?? []).map((e) => (typeof e === 'string' ? e : JSON.stringify(e)))].filter(Boolean).join('; ')
    } catch {
      // body is not JSON
    }
    return err('github_unprocessable', `GitHub rejected the request (422)${detail ? `: ${detail}` : ''}.`)
  }
  if (isWrite && (status === 403 || status === 404) && hasToken && res.headers.get('x-ratelimit-remaining') !== '0') {
    return err(
      'github_no_write_access',
      `GitHub returned ${status} when posting: the token can read the PR but not comment on it. Classic tokens need \`repo\` (private) or \`public_repo\`; fine-grained tokens need "Pull requests: write" and "Issues: write"; SSO orgs need the token authorised for the org.`,
    )
  }
  if (status === 401) return err('github_unauthorized', 'GitHub rejected the token (expired or invalid). Run `gh auth login` or set a new GITHUB_TOKEN.')
  if ((status === 403 || status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset'))
    const when = Number.isFinite(reset) && reset > 0 ? ` until ${new Date(reset * 1000).toISOString()}` : ''
    return err('github_rate_limited', `GitHub API rate limit reached${when}.${hasToken ? '' : ' Set GITHUB_TOKEN to raise the limit.'}`, true)
  }
  if (status === 403 || status === 404) {
    return err(
      'github_no_access',
      `GitHub returned ${status}: the PR was not found or the token can't read it. ` +
        (hasToken
          ? 'The token needs read access to the repository: classic tokens need `repo` (private) or `public_repo`; fine-grained tokens need "Pull requests: read" and "Contents: read"; SSO orgs need the token authorised for the org.'
          : 'No GitHub token was found; set GITHUB_TOKEN or GH_TOKEN, or run `gh auth login`.'),
    )
  }
  return err('github_error', `GitHub returned HTTP ${status}.`, status >= 500)
}
