// What the panel stores per PR, also read by the Review button on the page (Story 7.5).

/** The last review of each of this many most recent PRs is kept in the browser (UX-DR19). */
export const MAX_STORED = 50

/** Built at runtime so the content script bundle stays ASCII-only. */
const ELLIPSIS = JSON.parse('"\\u2026"') as string

/** Stored key for a PR: "owner/repo#n", lower-cased. */
export const prKey = (pr: string) => pr.toLowerCase()

export interface PrState {
  status: 'running' | 'done'
  /** New (not pre-existing) findings of the last review. */
  findings: number
  headSha: string
}

/** The Review button's label for a PR (UX-DR16): "Review", "Reviewing…", "<n> findings", "No findings", "Outdated". */
export function buttonLabel(s: PrState | undefined, currentHead?: string): { label: string; state: 'review' | 'running' | 'current' | 'outdated' } {
  if (!s) return { label: 'Review', state: 'review' }
  if (s.status === 'running') return { label: `Reviewing${ELLIPSIS}`, state: 'running' }
  if (currentHead && s.headSha && currentHead !== s.headSha) return { label: 'Outdated', state: 'outdated' }
  return { label: s.findings === 0 ? 'No findings' : `${s.findings} finding${s.findings === 1 ? '' : 's'}`, state: 'current' }
}
