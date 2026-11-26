// Codebase context (roadmap item 17): who uses what this PR changes, across the whole repository and, when asked,
// the owner's other repositories. Found with the forge's code search (any language), shown to the AI as related
// code next to the import-graph context of related.ts.
import type { RelatedFile } from './related.js'
import type { GitHubReader } from './ports.js'
import type { RepoRef } from './pr-ref.js'

/** A code search hit with the matching fragments (no file reads needed). */
export interface CodeHit {
  repo: string
  path: string
  fragments: string[]
}

export interface UsageLimits {
  symbols: number
  hitsPerSymbol: number
  maxFiles: number
  maxTotalChars: number
}
export const DEFAULT_USAGE_LIMITS: UsageLimits = { symbols: 3, hitsPerSymbol: 8, maxFiles: 6, maxTotalChars: 12_000 }

const DECLARATION = /\b(?:export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum)|(?:async\s+)?def|func(?:\s+\([^)]*\))?|class|interface|(?:public|protected|internal)\s+(?:static\s+)?(?:async\s+)?(?:[\w<>[\],?]+\s+)?)\s*([A-Za-z_][A-Za-z0-9_]{3,})\b/
const COMMON = new Set(['main', 'init', 'test', 'setup', 'index', 'default', 'constructor', 'render', 'handler', 'value', 'data', 'result', 'error', 'props', 'state', 'config', 'options', 'string', 'number', 'boolean', 'Object', 'Array', 'Promise', 'void', 'static', 'public', 'private'])

/**
 * The symbols a patch declares or changes: names declared on added lines, and the function a hunk sits in (the
 * context git prints after the hunk header). Longest names first: they search with the least noise.
 */
export function changedSymbols(patch: string | undefined): string[] {
  if (!patch) return []
  const found = new Set<string>()
  for (const line of patch.split('\n')) {
    const header = /^@@[^@]*@@\s?(.*)$/.exec(line)
    const text = header ? header[1]! : line.startsWith('+') ? line.slice(1) : ''
    const m = DECLARATION.exec(text) ?? (header ? /([A-Za-z_][A-Za-z0-9_]{3,})\s*\(/.exec(text) : null)
    if (m && !COMMON.has(m[1]!)) found.add(m[1]!)
  }
  return [...found].sort((a, b) => b.length - a.length)
}

/**
 * Files that use the changed symbols, from code search: first this repository (beyond the changed files and the
 * import graph), then, with `crossRepo`, the owner's other repositories. Each becomes related code with the
 * matching fragments; nothing is read file by file.
 */
export async function findUsages(
  reader: GitHubReader,
  repo: RepoRef,
  symbols: readonly string[],
  skip: ReadonlySet<string>,
  opts: { crossRepo?: boolean | undefined; limits?: UsageLimits } = {},
): Promise<{ related: RelatedFile[]; notes: string[] }> {
  const limits = opts.limits ?? DEFAULT_USAGE_LIMITS
  if (!reader.searchCode || !symbols.length) return { related: [], notes: [] }
  const related: RelatedFile[] = []
  const notes: string[] = []
  const seen = new Set(skip)
  let chars = 0
  const self = `${repo.owner}/${repo.repo}`
  const add = (hit: CodeHit, symbol: string, other: boolean) => {
    const key = other ? `${hit.repo}:${hit.path}` : hit.path
    if (seen.has(key) || related.length >= limits.maxFiles) return
    const text = hit.fragments.join('\n…\n').slice(0, 2_000)
    if (!text.trim() || chars + text.length > limits.maxTotalChars) return
    seen.add(key)
    chars += text.length
    related.push({ path: key, relation: other ? `uses ${symbol} in ${hit.repo} (another repository)` : `uses ${symbol} (repository search)`, text, excerpt: true })
  }
  for (const symbol of symbols.slice(0, limits.symbols)) {
    const local = await reader.searchCode({ repo, symbol, limit: limits.hitsPerSymbol })
    if (!local.ok) {
      notes.push(`Repository search was not available: ${local.error.message}`)
      break
    }
    for (const hit of local.value) if (hit.repo === self) add(hit, symbol, false)
    if (opts.crossRepo) {
      const wide = await reader.searchCode({ owner: repo.owner, symbol, limit: limits.hitsPerSymbol })
      if (wide.ok) for (const hit of wide.value) if (hit.repo !== self) add(hit, symbol, true)
    }
  }
  const others = related.filter((r) => r.relation.includes('another repository'))
  if (others.length) notes.push(`Changed code is used in other repositories: ${[...new Set(others.map((r) => r.path.split(':')[0]))].join(', ')}.`)
  return { related, notes }
}
