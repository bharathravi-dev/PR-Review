import type { GitHubReader, TreeEntry } from './ports.js'
import type { RepoRef } from './pr-ref.js'

export type Side = 'HEAD' | 'BASE'

/**
 * Read-only access to repository files at the run's exact commits (AD-6). Validators read repository content
 * only through this; reads are memoised per run.
 */
export interface FileAccessor {
  /** Files (blobs) at a side, or undefined when the tree could not be listed. */
  list(side: Side): Promise<TreeEntry[] | undefined>
  /** The tree object SHA of a side (for cache keys). */
  treeSha(side: Side): Promise<string | undefined>
  read(path: string, side: Side): Promise<string | undefined>
  /** Notes about anything that could not be read (truncated trees, failed reads). */
  notes(): string[]
}

export function createFileAccessor(reader: GitHubReader, repo: RepoRef, shas: Record<Side, string>): FileAccessor {
  const trees = new Map<Side, Promise<{ sha: string; entries: TreeEntry[] } | undefined>>()
  const reads = new Map<string, Promise<string | undefined>>()
  const notes = new Set<string>()
  const tree = (side: Side) => {
    let p = trees.get(side)
    if (!p) {
      p = reader.listTree(repo, shas[side]).then((r) => {
        if (!r.ok) {
          notes.add(`The ${side.toLowerCase()} file tree could not be listed: ${r.error.message}`)
          return undefined
        }
        if (r.value.truncated) notes.add(`The ${side.toLowerCase()} file tree is larger than GitHub lists in one response; some projects may not be detected.`)
        return { sha: r.value.treeSha, entries: r.value.entries.filter((e) => e.type === 'blob') }
      })
      trees.set(side, p)
    }
    return p
  }
  return {
    list: async (side) => (await tree(side))?.entries,
    treeSha: async (side) => (await tree(side))?.sha,
    read(path, side) {
      const key = `${side}:${path}`
      let p = reads.get(key)
      if (!p) {
        p = reader.readFile(repo, path, shas[side]).then((r) => {
          if (r.ok) return r.value
          notes.add(`${path} (${side.toLowerCase()}) could not be read: ${r.error.message}`)
          return undefined
        })
        reads.set(key, p)
      }
      return p
    },
    notes: () => [...notes],
  }
}

/** Glob → RegExp for repository paths: `**` any depth, `*` within a segment, `?` one character. */
export function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!
    if (c === '*' && glob[i + 1] === '*') {
      i++
      if (glob[i + 1] === '/') {
        i++
        re += '(?:.*/)?'
      } else re += '.*'
    } else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}
