// How the review page orders and pre-selects findings (Epic 9 Story 9.1, UX-DR26): new problems first by
// severity; pre-existing findings grouped after them and left out of the post unless ticked one by one.
// Pure functions, no DOM, so they are tested directly.

const SEVERITY_ORDER = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO']
const rank = (f) => {
  const i = SEVERITY_ORDER.indexOf(f.severity)
  return i === -1 ? SEVERITY_ORDER.length : i
}

/** A finding about code the PR did not introduce. */
export const isPreExisting = (f) => f.scope === 'PRE_EXISTING'

/** New findings (anything not pre-existing) and pre-existing ones, each ordered by severity, keeping report order within a severity. */
export function groupFindings(findings) {
  const sorted = findings.map((f, i) => [f, i]).sort(([a, i], [b, j]) => rank(a) - rank(b) || i - j).map(([f]) => f)
  return { fresh: sorted.filter((f) => !isPreExisting(f)), pre: sorted.filter(isPreExisting) }
}

/** Fingerprints ticked when a Report opens: new findings that were not dismissed. */
export function defaultSelection(findings) {
  return new Set(findings.filter((f) => f.fingerprint && !f.dismissed && !isPreExisting(f)).map((f) => f.fingerprint))
}

/** Fingerprints "Select all" ticks: the same set as the default (pre-existing findings are ticked one by one). */
export function selectAllFingerprints(findings) {
  return [...defaultSelection(findings)]
}

/** "2 new findings · 20 pre-existing" (with new findings' severities when there are any). */
export function findingsSummary(findings) {
  const { fresh, pre } = groupFindings(findings)
  const counts = SEVERITY_ORDER.map((s) => [s, fresh.filter((f) => f.severity === s).length]).filter(([, n]) => n > 0)
  const bySeverity = counts.length ? ` (${counts.map(([s, n]) => `${n} ${s.toLowerCase()}`).join(', ')})` : ''
  const newPart = `${fresh.length} new finding${fresh.length === 1 ? '' : 's'}${bySeverity}`
  return pre.length ? `${newPart} · ${pre.length} pre-existing` : newPart
}
