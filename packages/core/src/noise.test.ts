import { describe, expect, it } from 'vitest'
import type { Finding } from './findings.js'
import { quietFindings } from './noise.js'

let n = 0
const f = (over: Partial<Finding> = {}): Finding => {
  n++
  return { ruleId: 'ai/correctness', category: 'CORRECTNESS', severity: 'MINOR', confidence: 'HIGH', scope: 'NEW', sourceFamily: 'AI', title: 'Missing null check', description: 'd', location: { path: `src/f${n}.ts`, startLine: n, endLine: n, anchorKind: 'LINE' }, provenance: { validator: 'ai.review' }, fingerprint: `fp${n}`, fingerprints: [`fp${n}`], ...over } as Finding
}

describe('less noise (roadmap item 3)', () => {
  it('leaves AI style remarks out by default, with a note, and keeps them when asked', () => {
    const items = [f(), f({ category: 'STYLE', title: 'Missing commas' }), f({ category: 'STYLE', sourceFamily: 'DETERMINISTIC', title: 'lint: semi' })]
    const quiet = quietFindings(items)
    expect(quiet.findings.map((x) => x.title)).toEqual(['Missing null check', 'lint: semi'])
    expect(quiet.notes[0]).toContain('1 style-only AI remark(s) were left out')
    expect(quietFindings(items, { styleFindings: true }).findings).toHaveLength(3)
  })

  it('folds an AI finding repeated in three or more places into the strongest one, keeping every fingerprint', () => {
    const items = [f(), f({ severity: 'MAJOR' }), f({ title: 'missing  NULL check!' }), f({ title: 'Different problem' }), f({ sourceFamily: 'DETERMINISTIC', title: 'Missing null check' })]
    const quiet = quietFindings(items)
    const lead = quiet.findings.find((x) => x.sourceFamily === 'AI' && x.title.startsWith('Missing'))!
    expect(lead.severity).toBe('MAJOR')
    expect(lead.description).toMatch(/The same problem appears in 2 more place\(s\): src\/f\d+\.ts:\d+, src\/f\d+\.ts:\d+\./)
    expect(lead.fingerprints).toHaveLength(3)
    expect(quiet.findings).toHaveLength(3)
    expect(quiet.notes[0]).toContain('2 repeated AI finding(s) were folded')
  })

  it('leaves two occurrences alone', () => {
    expect(quietFindings([f(), f()]).findings).toHaveLength(2)
  })
})
