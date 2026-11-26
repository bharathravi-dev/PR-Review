// Less noise (roadmap item 3): reviewers are judged on false positives and repetition. Runs after dedupe.
import type { Finding } from './findings.js'
import { compareFindings } from './report.js'

/** The same AI finding in this many places or more becomes one finding that lists the places. */
export const REPEAT_THRESHOLD = 3
const PLACES_LISTED = 10

const key = (f: Finding) => `${f.category}|${f.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`
const where = (f: Finding) => `${f.location.path ?? 'the PR'}${f.location.startLine ? `:${f.location.startLine}` : ''}`

export interface QuietResult {
  findings: Finding[]
  /** Notes for the Report's limitations. */
  notes: string[]
}

/**
 * Keeps AI style remarks out (unless asked for) and folds an AI finding repeated in many places into its strongest
 * occurrence, which lists the others and carries their fingerprints (so earlier comments still match it).
 * Deterministic and tool findings are left as they are: each of those is a fact about its own line.
 */
export function quietFindings(findings: readonly Finding[], opts: { styleFindings?: boolean | undefined } = {}): QuietResult {
  const notes: string[] = []
  let kept = [...findings]
  if (!opts.styleFindings) {
    const style = kept.filter((f) => f.sourceFamily === 'AI' && f.category === 'STYLE')
    if (style.length) {
      kept = kept.filter((f) => !style.includes(f))
      notes.push(`${style.length} style-only AI remark(s) were left out (set ai.styleFindings: true to include them).`)
    }
  }
  const groups = new Map<string, Finding[]>()
  for (const f of kept) if (f.sourceFamily === 'AI') groups.set(key(f), [...(groups.get(key(f)) ?? []), f])
  const folded = new Set<Finding>()
  const replaced = new Map<Finding, Finding>()
  let foldedCount = 0
  for (const group of groups.values()) {
    if (group.length < REPEAT_THRESHOLD) continue
    const [lead, ...rest] = [...group].sort(compareFindings)
    const places = rest.map(where)
    const listed = places.slice(0, PLACES_LISTED).join(', ') + (places.length > PLACES_LISTED ? `, and ${places.length - PLACES_LISTED} more` : '')
    replaced.set(lead!, {
      ...lead!,
      description: `${lead!.description}\n\nThe same problem appears in ${rest.length} more place(s): ${listed}.`,
      fingerprints: [...new Set([...(lead!.fingerprints ?? []), ...rest.flatMap((f) => f.fingerprints ?? (f.fingerprint ? [f.fingerprint] : []))])],
    })
    for (const f of rest) folded.add(f)
    foldedCount += rest.length
  }
  if (foldedCount) notes.push(`${foldedCount} repeated AI finding(s) were folded into the first occurrence of each, which lists where else it appears.`)
  return { findings: kept.filter((f) => !folded.has(f)).map((f) => replaced.get(f) ?? f), notes }
}
