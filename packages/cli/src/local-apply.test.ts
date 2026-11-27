import type { Report } from '@pr-reviewer/core'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applySuggestionsLocally } from './local-apply.js'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('applySuggestionsLocally', () => {
  it('applies accepted suggestions bottom-up and rejects path traversal safely', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prr-apply-'))
    dirs.push(dir)
    const filePath = join(dir, 'app.ts')
    writeFileSync(filePath, ['line1', 'const a = 1', 'line3', 'const b = 2', 'line5'].join('\n'))

    const report = {
      findings: [
        {
          ruleId: 'ai/one',
          category: 'CORRECTNESS',
          severity: 'MAJOR',
          confidence: 'HIGH',
          scope: 'NEW',
          sourceFamily: 'AI',
          title: 'Fix a',
          description: 'd',
          suggestion: 'const a = 10',
          location: { anchorKind: 'LINE', path: 'app.ts', startLine: 2, endLine: 2 },
          provenance: { validator: 'ai.review' },
          fingerprint: 'fp1',
        },
        {
          ruleId: 'ai/two',
          category: 'CORRECTNESS',
          severity: 'MAJOR',
          confidence: 'HIGH',
          scope: 'NEW',
          sourceFamily: 'AI',
          title: 'Fix b',
          description: 'd',
          suggestion: 'const b = 20\nconst c = 30',
          location: { anchorKind: 'LINE', path: 'app.ts', startLine: 4, endLine: 4 },
          provenance: { validator: 'ai.review' },
          fingerprint: 'fp2',
        },
        {
          ruleId: 'ai/traversal',
          category: 'SECURITY',
          severity: 'MAJOR',
          confidence: 'HIGH',
          scope: 'NEW',
          sourceFamily: 'AI',
          title: 'Evil path',
          description: 'd',
          suggestion: 'pwned',
          location: { anchorKind: 'LINE', path: '../escape.txt', startLine: 1, endLine: 1 },
          provenance: { validator: 'ai.review' },
          fingerprint: 'fp3',
        },
      ],
    } as unknown as Report

    const io = { stdout: () => undefined, stderr: () => undefined }
    const out = await applySuggestionsLocally({ report, cwd: dir, yes: true, io, deps: { prompt: async () => 'y' } })
    expect(out.applied).toBe(2)
    expect(out.errors).toHaveLength(1)
    expect(readFileSync(filePath, 'utf8')).toBe(['line1', 'const a = 10', 'line3', 'const b = 20', 'const c = 30', 'line5'].join('\n'))
  })
})
