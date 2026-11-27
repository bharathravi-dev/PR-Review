import { describe, expect, it } from 'vitest'
import { buildFixBundle, renderFixBundleMarkdown } from './fix-bundle.js'
import type { Report } from './report.js'

describe('Recommended Fix Bundle', () => {
  it('collects actionable findings and renders code suggestions cleanly', () => {
    const report = {
      findings: [
        {
          ruleId: 'standards/empty-catch',
          category: 'CORRECTNESS',
          severity: 'MINOR',
          confidence: 'HIGH',
          scope: 'NEW',
          sourceFamily: 'DETERMINISTIC',
          title: 'Empty catch',
          description: 'desc',
          recommendation: 'Log error.',
          location: { anchorKind: 'LINE', path: 'src/a.ts', startLine: 10 },
          provenance: { validator: 'standards.local' },
          fingerprint: 'fp1',
        },
        {
          ruleId: 'ai/npe',
          category: 'CORRECTNESS',
          severity: 'MAJOR',
          confidence: 'HIGH',
          scope: 'NEW',
          sourceFamily: 'AI',
          title: 'Null check',
          description: 'desc',
          recommendation: 'Guard null.',
          suggestion: 'if (x != null) x.run()',
          location: { anchorKind: 'LINE', path: 'src/b.java', startLine: 20, endLine: 21 },
          provenance: { validator: 'ai.review' },
          fingerprint: 'fp2',
        },
        {
          ruleId: 'ai/dismissed',
          category: 'STYLE',
          severity: 'INFO',
          confidence: 'LOW',
          scope: 'NEW',
          sourceFamily: 'AI',
          title: 'Dismissed item',
          description: 'desc',
          recommendation: 'ignore',
          dismissed: true,
          location: { anchorKind: 'FILE', path: 'src/c.ts' },
          provenance: { validator: 'ai.review' },
          fingerprint: 'fp3',
        },
      ],
    } as unknown as Report

    const bundle = buildFixBundle(report)
    expect(bundle.totalActionable).toBe(2)
    expect(bundle.withCodeSuggestions).toBe(1)
    const md = renderFixBundleMarkdown(bundle, 'octo/app#1')
    expect(md).toContain('Recommended Fix Bundle: octo/app#1')
    expect(md).toContain('if (x != null) x.run()')
    expect(md).not.toContain('Dismissed item')
  })
})
