// `pr-reviewer review --local` (roadmap item 8): review the changes in this checkout before there is a PR. A reader
// that answers the engine's questions from git instead of GitHub. The "head" is the working tree's tracked content
// (captured with `git stash create`, which changes nothing), compared with where the branch left the base branch.
import { execFile } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { err, ok, type ContextLimits, type GitHubReader, type PrContext, type PrRef, type Result } from '@pr-reviewer/core'
import type { CliDeps } from './deps.js'

type Run = NonNullable<CliDeps['run']>

const STATUS: Record<string, PrContext['files'][number]['status']> = { M: 'modified', A: 'added', D: 'removed', R: 'renamed', C: 'copied', T: 'changed' }
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|jar|woff2?|ttf|otf|eot|mp[34]|mov|wasm|so|dylib|dll|exe|bin)$/i

export interface LocalChanges {
  reader: GitHubReader
  ref: PrRef
  base: string
  headSha: string
  /** True when uncommitted (tracked) changes are part of the review. */
  dirty: boolean
}

/** Parses `owner/repo` out of a GitHub-style remote URL (https or ssh), if it is one. */
export function repoFromRemote(url: string): { host: string; owner: string; repo: string } | undefined {
  const m = /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/git@|git@)([^/:]+)[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim())
  return m ? { host: m[1]!, owner: m[2]!, repo: m[3]! } : undefined
}

/** Splits a unified diff into one patch per file, without headers (GitHub's `patch` shape). */
export function splitDiff(diff: string): Array<{ patch?: string; binary: boolean }> {
  return diff
    .split(/^diff --git /m)
    .slice(1)
    .map((chunk) => {
      if (/^Binary files .* differ$/m.test(chunk)) return { binary: true }
      const at = chunk.indexOf('\n@@')
      return at === -1 ? { binary: false } : { patch: chunk.slice(at + 1).replace(/\n$/, ''), binary: false }
    })
}

export async function localChanges(o: { cwd: string; run: Run; env: CliDeps['env']; base?: string | undefined; limits?: ContextLimits }): Promise<Result<LocalChanges>> {
  const env = { PATH: o.env.PATH ?? '', HOME: o.env.HOME ?? '' }
  const git = async (args: string[], cwd = o.cwd) => {
    const r = await o.run('git', args, { cwd, env, stdin: '', timeoutMs: 60_000 })
    return { ok: r.code === 0 && !r.spawnError, out: r.stdout }
  }
  const top = await git(['rev-parse', '--show-toplevel'])
  if (!top.ok) return err('not_a_checkout', 'Run this inside a git checkout.')
  const root = top.out.trim()
  const g = (args: string[]) => git(args, root)

  let base = o.base
  if (!base) {
    const originHead = await g(['rev-parse', '--abbrev-ref', 'origin/HEAD'])
    base = originHead.ok && originHead.out.trim() !== 'origin/HEAD' ? originHead.out.trim() : (await g(['rev-parse', '--verify', '-q', 'main'])).ok ? 'main' : 'master'
  }
  const mb = await g(['merge-base', base, 'HEAD'])
  if (!mb.ok) return err('no_merge_base', `Could not find where this branch left ${base}. Pass --base <branch>.`)
  const mergeBase = mb.out.trim()
  const stash = await g(['stash', 'create'])
  const dirty = stash.ok && stash.out.trim() !== ''
  const headSha = dirty ? stash.out.trim() : (await g(['rev-parse', 'HEAD'])).out.trim()
  const branch = (await g(['rev-parse', '--abbrev-ref', 'HEAD'])).out.trim()
  const subject = (await g(['log', '-1', '--format=%s', 'HEAD'])).out.trim()
  const author = (await g(['config', 'user.name'])).out.trim() || 'you'
  const remote = repoFromRemote((await g(['remote', 'get-url', 'origin'])).out)
  const ref: PrRef = { host: remote?.host ?? 'github.com', owner: remote?.owner ?? 'local', repo: remote?.repo ?? root.split('/').pop() ?? 'repo', number: 0 }

  const show = async (sha: string, path: string): Promise<string | undefined> => {
    const r = await o.run('git', ['show', `${sha}:${path}`], { cwd: root, env, stdin: '', timeoutMs: 60_000 })
    return r.code === 0 ? r.stdout : undefined
  }

  const reader: GitHubReader = {
    readFile: async (_repo, path, sha) => ok(await show(sha, path)),
    listTree: async (_repo, sha) => {
      const r = await g(['ls-tree', '-r', '-l', '--full-tree', sha])
      if (!r.ok) return err('git_error', `git ls-tree ${sha} failed`)
      const entries = r.out
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [meta, path] = line.split('\t') as [string, string]
          const [, type, objSha, size] = meta.split(/\s+/)
          return { path, type: type as 'blob' | 'tree' | 'commit', sha: objSha!, ...(size && size !== '-' ? { size: Number(size) } : {}) }
        })
      return ok({ treeSha: sha, entries, truncated: false })
    },
    listDirectory: async (_repo, path) => {
      try {
        return ok(readdirSync(join(root, path)))
      } catch {
        return ok([])
      }
    },
    listCheckResults: async () => ok([]),
    // The archive is binary, so git is called directly here and its output kept as bytes.
    downloadArchive: (_repo, sha) =>
      new Promise((resolve) => {
        execFile('git', ['archive', '--format=tar.gz', sha], { cwd: root, env, encoding: 'buffer', maxBuffer: 512 * 1024 * 1024, timeout: 120_000 }, (e, stdout) => resolve(e ? err('git_error', `git archive failed: ${e.message}`) : ok(new Uint8Array(stdout))))
      }),
    listOpenPulls: async () => ok([]),
    viewer: async () => err('no_github', 'A local review has no GitHub identity.'),
    getHeadSha: async () => ok(headSha),
    listPublished: async () => ok({ reviews: [], reviewComments: [], issueComments: [] }),
    listThumbsDown: async () => ok([]),
    searchCommentedPulls: async () => ok([]),
    getPrContext: async (_ref, limits) => {
      const names = await g(['diff', '--name-status', '-M', '--no-color', mergeBase, headSha])
      const diff = await g(['diff', '-M', '--no-color', '--no-ext-diff', '--unified=3', mergeBase, headSha])
      if (!names.ok || !diff.ok) return err('git_error', 'git diff failed')
      const patches = splitDiff(diff.out)
      const truncated: string[] = ['A local review: uncommitted tracked changes are included; untracked files are not (git add -N them to include).']
      let budget = limits.maxTotalBytes
      const files: PrContext['files'] = []
      const rows = names.out.split('\n').filter(Boolean)
      if (rows.length > limits.maxFiles) truncated.push(`Only the first ${limits.maxFiles} changed files were loaded.`)
      for (const [i, row] of rows.slice(0, limits.maxFiles).entries()) {
        const [code, a, b] = row.split('\t') as [string, string, string | undefined]
        const status = STATUS[code[0]!] ?? 'modified'
        const path = b ?? a
        const p = patches[i] ?? { binary: false }
        const lines = (p.patch ?? '').split('\n')
        const file: PrContext['files'][number] = {
          path,
          ...(b ? { previousPath: a } : {}),
          status,
          additions: lines.filter((l) => l.startsWith('+')).length,
          deletions: lines.filter((l) => l.startsWith('-')).length,
          binary: p.binary || BINARY_EXT.test(path),
          ...(p.patch ? { patch: p.patch } : {}),
          patchTruncated: false,
        }
        const load = async (sha: string, at: string) => {
          const text = await show(sha, at)
          if (text === undefined) return { omitted: 'unavailable' as const }
          if (text.length > limits.maxFileBytes) return { omitted: 'too_large' as const }
          if (text.length > budget) return { omitted: 'total_limit' as const }
          budget -= text.length
          return { text }
        }
        if (!file.binary && status !== 'removed') file.head = await load(headSha, path)
        if (!file.binary && status !== 'added') file.base = await load(mergeBase, b ? a : path)
        files.push(file)
      }
      return ok({
        schemaVersion: 1,
        ref: { host: ref.host, owner: ref.owner, repo: ref.repo, number: 0 },
        title: subject || branch,
        body: '',
        author,
        state: 'open',
        draft: true,
        baseRef: base!,
        headRef: branch,
        baseSha: mergeBase,
        headSha,
        mergeBaseSha: mergeBase,
        fromFork: false,
        files,
        reviews: [],
        reviewComments: [],
        issueComments: [],
        truncated,
      } as PrContext)
    },
  }
  return ok({ reader, ref, base: base!, headSha, dirty })
}
