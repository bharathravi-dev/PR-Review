import { err, ok, type Result } from './result.js'

/** A pull request on a GitHub host. `host` is the web host, e.g. "github.com". */
export interface PrRef {
  host: string
  owner: string
  repo: string
  number: number
}

const NAME = /^[A-Za-z0-9_.-]+$/
const SHORT = /^([^/\s#]+)\/([^/\s#]+)#(\d+)$/
/** `http(s)://host[:port]/path`; host is captured without userinfo. */
const URL_RE = /^https?:\/\/(?:[^@/\s]+@)?([^/\s?#]+)(\/[^\s]*)?$/i

/**
 * Parses a PR URL (`https://<host>/<owner>/<repo>/pull/<n>[/...]`) or `owner/repo#n`.
 * The short form uses `defaultHost`, which the caller takes from Configuration.
 */
export function parsePrRef(input: string, defaultHost: string): Result<PrRef> {
  const text = input.trim()
  const short = SHORT.exec(text)
  if (short) return build(defaultHost, short[1], short[2], short[3])

  const url = URL_RE.exec(text)
  if (!url) return err('pr_ref_invalid', `Not a PR URL or owner/repo#number: ${input}`)
  const [owner, repo, kind, num] = (url[2] ?? '').split(/[?#]/, 1)[0]!.split('/').filter(Boolean)
  if (kind !== 'pull' && kind !== 'pulls') return err('pr_ref_invalid', `Not a pull request URL: ${input}`)
  return build(url[1] ?? '', owner, repo, num)
}

function build(host: string, owner?: string, repo?: string, num?: string): Result<PrRef> {
  const number = Number(num)
  if (!owner || !repo || !NAME.test(owner) || !NAME.test(repo) || !Number.isInteger(number) || number <= 0) {
    return err('pr_ref_invalid', 'A PR reference needs an owner, a repository, and a positive PR number')
  }
  return ok({ host: host.toLowerCase(), owner, repo: repo.replace(/\.git$/, ''), number })
}

/** Canonical short form, e.g. "octo/repo#12". */
export const formatPrRef = (ref: PrRef): string => `${ref.owner}/${ref.repo}#${ref.number}`

export interface RepoRef {
  host: string
  owner: string
  repo: string
}

/** Parses `owner/repo` (on `defaultHost`) or a repository URL `https://<host>/<owner>/<repo>[/...]`. */
export function parseRepoRef(input: string, defaultHost: string): Result<RepoRef> {
  const text = input.trim()
  const short = /^([^/\s#]+)\/([^/\s#]+)$/.exec(text)
  const url = /^https?:\/\/(?:[^@/\s]+@)?([^/\s?#]+)\/([^/\s?#]+)\/([^/\s?#]+)/i.exec(text)
  const [host, owner, repo] = short ? [defaultHost, short[1], short[2]] : url ? [url[1], url[2], url[3]] : []
  if (!host || !owner || !repo || !NAME.test(owner) || !NAME.test(repo.replace(/\.git$/, ''))) {
    return err('repo_ref_invalid', `Not a repository: ${input} (expected owner/repo or a repository URL)`)
  }
  return ok({ host: host.toLowerCase(), owner, repo: repo.replace(/\.git$/, '') })
}
