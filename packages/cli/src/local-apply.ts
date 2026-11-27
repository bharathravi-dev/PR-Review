// Safe local application of Recommended Fix Bundle suggestions onto working-tree files (never commits/pushes).
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { buildFixBundle, replaceLines, type FixBundleItem, type Report } from '@pr-reviewer/core'
import type { CliDeps, CliIo } from './deps.js'

export interface LocalApplyOutcome {
  applied: number
  skipped: number
  errors: string[]
}

/** Filters bundle items down to line-anchored suggestions with exact replacement code. */
export function localApplicableSuggestions(report: Report): FixBundleItem[] {
  return buildFixBundle(report).items.filter((i) => i.suggestion !== undefined && i.startLine !== undefined && i.path !== '(PR-wide)')
}

/**
 * Applies selected suggested replacements to files inside `cwd` safely (path-traversal guarded, never commits).
 * Note: applies items bottom-up per file so earlier line numbers remain valid if multiple fixes touch one file.
 */
export async function applySuggestionsLocally(o: {
  report: Report
  cwd: string
  only?: readonly number[] | undefined
  yes?: boolean | undefined
  io: CliIo
  deps: Pick<CliDeps, 'prompt'>
}): Promise<LocalApplyOutcome> {
  const candidates = localApplicableSuggestions(o.report)
  const chosen = o.only?.length ? candidates.filter((_, idx) => o.only!.includes(idx + 1)) : candidates
  if (chosen.length === 0) {
    o.io.stderr('No line-anchored code replacement suggestions are available to apply locally.\n')
    return { applied: 0, skipped: 0, errors: [] }
  }

  const rootReal = realpathSync(o.cwd)
  const accepted: FixBundleItem[] = []
  let skipped = 0
  for (let i = 0; i < chosen.length; i++) {
    const item = chosen[i]!
    const end = item.endLine ?? item.startLine!
    if (o.yes) {
      accepted.push(item)
      continue
    }
    o.io.stderr(`\n[${i + 1}/${chosen.length}] ${item.path}:${item.startLine}${end !== item.startLine ? `-${end}` : ''} — ${item.title}\n`)
    o.io.stderr(`${item.suggestion!.split('\n').map((l) => `  + ${l}`).join('\n')}\n`)
    const ans = (await o.deps.prompt('Apply this change locally? [y/N/q] ')).trim().toLowerCase()
    if (ans === 'q' || ans === 'quit') {
      skipped += chosen.length - i
      break
    }
    if (ans === 'y' || ans === 'yes') accepted.push(item)
    else skipped++
  }

  // Group by file and sort descending by startLine so line numbers stay accurate across multiple edits in the same file.
  const byPath = new Map<string, FixBundleItem[]>()
  for (const item of accepted) byPath.set(item.path, [...(byPath.get(item.path) ?? []), item])

  let applied = 0
  const errors: string[] = []
  for (const [relPath, items] of byPath) {
    const abs = resolve(rootReal, relPath)
    if (!abs.startsWith(`${rootReal}${sep}`) || !existsSync(abs)) {
      errors.push(`${relPath}: file not found inside ${o.cwd}`)
      continue
    }
    const realTarget = realpathSync(abs)
    if (!realTarget.startsWith(`${rootReal}${sep}`)) {
      errors.push(`${relPath}: refuses to write outside repository root`)
      continue
    }
    let text = readFileSync(realTarget, 'utf8')
    const sorted = [...items].sort((a, b) => (b.startLine ?? 0) - (a.startLine ?? 0))
    for (const item of sorted) {
      const start = item.startLine!
      const end = item.endLine ?? start
      const lines = text.split(/\r?\n/)
      if (start < 1 || end > lines.length) {
        errors.push(`${relPath}:${start}-${end}: line range is out of bounds for local file`)
        continue
      }
      const next = replaceLines(text, start, end, item.suggestion!)
      if (next !== text) {
        text = next
        applied++
      }
    }
    writeFileSync(realTarget, text, 'utf8')
  }

  if (applied > 0) o.io.stderr(`\nApplied ${applied} suggestion(s) locally. Inspect changes with "git diff" before committing.\n`)
  for (const e of errors) o.io.stderr(`  ! ${e}\n`)
  return { applied, skipped, errors }
}
