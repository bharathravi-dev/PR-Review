import { describe, expect, it } from 'vitest'

// The review page's module is plain browser JavaScript; load it by URL so the type checker does not need types for it.
const view = (await import(new URL('../static/findings-view.js', import.meta.url).href)) as {
  groupFindings: (f: F[]) => { fresh: F[]; pre: F[] }
  defaultSelection: (f: F[]) => Set<string>
  selectAllFingerprints: (f: F[]) => string[]
  findingsSummary: (f: F[]) => string
}
interface F { fingerprint?: string; severity: string; scope: string; dismissed?: { by: string } }

const tslint = (n: number): F => ({ fingerprint: `t${n}`, severity: 'MINOR', scope: 'PRE_EXISTING' })
// The classic-page screenshot: 20 pre-existing TSLint style findings listed first, then 2 AI findings.
const report: F[] = [...Array.from({ length: 20 }, (_, i) => tslint(i)), { fingerprint: 'ai1', severity: 'MINOR', scope: 'NEW' }, { fingerprint: 'ai2', severity: 'MINOR', scope: 'NEW' }]

describe('review page: what matters first (Story 9.1)', () => {
  it('puts new findings first and groups pre-existing ones after them', () => {
    const { fresh, pre } = view.groupFindings(report)
    expect(fresh.map((f) => f.fingerprint)).toEqual(['ai1', 'ai2'])
    expect(pre).toHaveLength(20)
    expect(view.findingsSummary(report)).toBe('2 new findings (2 minor) · 20 pre-existing')
  })

  it('ticks only new, undismissed findings, and Select all does the same', () => {
    const withDismissed = [...report, { fingerprint: 'ai3', severity: 'MAJOR', scope: 'NEW', dismissed: { by: 'dev' } }]
    expect([...view.defaultSelection(withDismissed)].sort()).toEqual(['ai1', 'ai2'])
    expect(view.selectAllFingerprints(withDismissed).sort()).toEqual(['ai1', 'ai2'])
  })

  it('orders new findings by severity, keeping report order within a severity, and treats UNKNOWN scope as new', () => {
    const mixed: F[] = [
      { fingerprint: 'a', severity: 'MINOR', scope: 'NEW' },
      { fingerprint: 'b', severity: 'CRITICAL', scope: 'UNKNOWN' },
      { fingerprint: 'c', severity: 'MAJOR', scope: 'NEW' },
      { fingerprint: 'd', severity: 'MINOR', scope: 'NEW' },
    ]
    expect(view.groupFindings(mixed).fresh.map((f) => f.fingerprint)).toEqual(['b', 'c', 'a', 'd'])
    expect(view.findingsSummary([{ fingerprint: 'x', severity: 'MAJOR', scope: 'NEW' }])).toBe('1 new finding (1 major)')
    expect(view.findingsSummary([tslint(1)])).toBe('0 new findings · 1 pre-existing')
  })
})
