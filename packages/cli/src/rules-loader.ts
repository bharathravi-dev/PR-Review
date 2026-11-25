import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { parseRulesChecklist } from '@pr-reviewer/core'

export interface LoadedRules {
  rules: string[]
  warnings: string[]
}

/**
 * Loads Review Rules from user configuration entries (AD-13): file paths (relative to the config file, `~`
 * allowed) or HTTPS URLs (AD-19). A source that cannot be read is a warning, never a failure.
 */
export async function loadReviewRules(
  entries: readonly string[],
  opts: { configPath: string; homedir: string; fetch: typeof fetch },
): Promise<LoadedRules> {
  const rules: string[] = []
  const warnings: string[] = []
  for (const entry of entries) {
    let text: string
    try {
      if (/^https:\/\//i.test(entry)) {
        const res = await opts.fetch(entry, { signal: AbortSignal.timeout(10_000) })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        text = await res.text()
      } else if (/^[a-z]+:\/\//i.test(entry)) {
        throw new Error('only https:// URLs are allowed')
      } else {
        const expanded = entry.startsWith('~/') ? join(opts.homedir, entry.slice(2)) : entry
        text = await readFile(isAbsolute(expanded) ? expanded : resolve(dirname(opts.configPath), expanded), 'utf8')
      }
    } catch (e) {
      warnings.push(`Review Rules source ${entry} could not be read: ${(e as Error).message}`)
      continue
    }
    const items = parseRulesChecklist(text)
    if (items.length === 0) warnings.push(`Review Rules source ${entry} has no list items; nothing to check.`)
    for (const item of items) if (!rules.includes(item)) rules.push(item)
  }
  return { rules, warnings }
}
