import { describe, expect, it } from 'vitest'
import { parsePatch } from './diff.js'
import { unifiedDiff } from './line-diff.js'

describe('unifiedDiff (patches for forges without one)', () => {
  it('makes a hunk with context, in GitHub patch form', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].join('\n') + '\n'
    const after = ['a', 'b', 'c', 'd', 'E', 'f', 'g', 'h', 'i', 'j', 'k'].join('\n') + '\n'
    expect(unifiedDiff(before, after)).toBe('@@ -2,9 +2,10 @@\n b\n c\n d\n-e\n+E\n f\n g\n h\n i\n j\n+k')
    const added = parsePatch(unifiedDiff(before, after)!).added.map((l) => [l.line, l.text])
    expect(added).toEqual([
      [5, 'E'],
      [11, 'k'],
    ])
  })

  it('handles new files, deleted files, and no change', () => {
    expect(unifiedDiff('', 'x\ny\n')).toBe('@@ -0,0 +1,2 @@\n+x\n+y')
    expect(unifiedDiff('x\n', '')).toBe('@@ -1,1 +0,0 @@\n-x')
    expect(unifiedDiff('same\n', 'same\n')).toBe('')
  })

  it('gives line numbers parsePatch reads back exactly, for edits far apart', () => {
    const before = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join('\n')
    const lines = before.split('\n')
    lines[9] = 'changed 10'
    lines.splice(150, 0, 'inserted after 150')
    const after = lines.join('\n')
    const added = parsePatch(unifiedDiff(before, after)!).added.map((l) => [l.line, l.text])
    expect(added).toEqual([
      [10, 'changed 10'],
      [151, 'inserted after 150'],
    ])
  })
})
