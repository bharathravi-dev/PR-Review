import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONTEXT_LIMITS } from '@pr-reviewer/core'
import { describe, expect, it } from 'vitest'
import { runProcess } from './compose.js'
import { localChanges, repoFromRemote, splitDiff } from './local-git.js'

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'prr-local-'))
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x' } }).toString()
  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'Tess')
  writeFileSync(join(dir, 'a.ts'), 'export const a = 1\n')
  writeFileSync(join(dir, 'old.ts'), 'export const old = 1\n')
  git('add', '.')
  git('commit', '-qm', 'base')
  git('checkout', '-qb', 'feature')
  writeFileSync(join(dir, 'a.ts'), 'export const a = 2\nexport const b = 3\n')
  git('rm', '-q', 'old.ts')
  writeFileSync(join(dir, 'new.ts'), 'export const n = 1\n')
  git('add', '.')
  git('commit', '-qm', 'Add b and new')
  git('remote', 'add', 'origin', 'git@github.com:octo/app.git')
  return { dir, git }
}

describe('review --local (roadmap item 8)', () => {
  it('reads remotes and splits a diff into per-file patches', () => {
    expect(repoFromRemote('git@github.com:octo/app.git')).toEqual({ host: 'github.com', owner: 'octo', repo: 'app' })
    expect(repoFromRemote('https://github.example.com/team/svc')).toEqual({ host: 'github.example.com', owner: 'team', repo: 'svc' })
    expect(repoFromRemote('/some/path')).toBeUndefined()
    const parts = splitDiff('diff --git a/x b/x\nindex 1..2\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\ndiff --git a/i.png b/i.png\nBinary files a/i.png and b/i.png differ\n')
    expect(parts).toEqual([{ patch: '@@ -1 +1 @@\n-a\n+b', binary: false }, { binary: true }])
  })

  it('reviews the branch against main, with uncommitted tracked changes, without touching the checkout', async () => {
    const { dir, git } = repo()
    writeFileSync(join(dir, 'a.ts'), 'export const a = 2\nexport const b = 3\nexport const c = 4\n')
    const before = git('status', '--porcelain')
    const res = await localChanges({ cwd: dir, run: runProcess, env: process.env, base: 'main' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.dirty).toBe(true)
    expect(res.value.ref).toEqual({ host: 'github.com', owner: 'octo', repo: 'app', number: 0 })
    const ctx = await res.value.reader.getPrContext(res.value.ref, DEFAULT_CONTEXT_LIMITS)
    expect(ctx.ok).toBe(true)
    if (!ctx.ok) return
    const byPath = Object.fromEntries(ctx.value.files.map((f) => [f.path, f]))
    expect(Object.keys(byPath).sort()).toEqual(['a.ts', 'new.ts', 'old.ts'])
    expect(byPath['a.ts']).toMatchObject({ status: 'modified', additions: 3, deletions: 1, head: { text: 'export const a = 2\nexport const b = 3\nexport const c = 4\n' }, base: { text: 'export const a = 1\n' } })
    expect(byPath['a.ts']!.patch).toContain('+export const c = 4')
    expect(byPath['old.ts']).toMatchObject({ status: 'removed' })
    expect(byPath['new.ts']).toMatchObject({ status: 'added', head: { text: 'export const n = 1\n' } })
    expect(ctx.value).toMatchObject({ title: 'Add b and new', headRef: 'feature', baseRef: 'main', author: 'Tess' })
    expect(git('status', '--porcelain')).toBe(before)
    const tree = await res.value.reader.listTree(res.value.ref, res.value.headSha)
    expect(tree.ok && tree.value.entries.map((e) => e.path).sort()).toEqual(['a.ts', 'new.ts'])
    const archive = await res.value.reader.downloadArchive(res.value.ref, res.value.headSha)
    expect(archive.ok && [archive.value[0], archive.value[1]]).toEqual([0x1f, 0x8b])
  })
})
