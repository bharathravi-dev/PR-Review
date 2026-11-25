export interface SanitizeOptions {
  /** URL prefixes links may point to (e.g. the PR's own repository); everything else is unlinked. */
  allowedLinkPrefixes: readonly string[]
}

const URL_RE = /\bhttps?:\/\/[^\s<>()[\]]+/g

/**
 * Makes model- or tool-generated text safe to publish under the user's identity (AD-9):
 * strips HTML (including comments, so text can never carry a forged marker) and images,
 * unlinks URLs outside the allow-list, and neutralises @-mentions and team mentions.
 * Runs before the hidden marker is appended.
 */
export function sanitizeText(text: string, opts: SanitizeOptions): string {
  const allowed = (url: string) => opts.allowedLinkPrefixes.some((p) => url === p || url.startsWith(p.endsWith('/') ? p : `${p}/`))
  let out = text
    .replace(/<!--[\s\S]*?(-->|$)/g, '')
    .replace(/<\/?[A-Za-z][^>]*>/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (m, label: string, url: string) => (allowed(url) ? m : label))
  out = out.replace(URL_RE, (url, offset: number, whole: string) => {
    const before = whole.slice(Math.max(0, offset - 2), offset)
    if (before === '](') return url
    return allowed(url) ? url : '[link removed]'
  })
  out = out.replace(/(^|[^\w`/@.])@([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\/[A-Za-z0-9_.-]+)?)/g, '$1`@$2`')
  return out
}
