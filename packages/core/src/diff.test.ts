import { describe, expect, it } from 'vitest'
import { diffLines, hunksAround, isInHunk, parsePatch } from './diff.js'

describe('parsePatch', () => {
  it('numbers added lines in head coordinates across hunks', () => {
    const patch = ['@@ -1,3 +1,4 @@', ' a', '-b', '+B', '+C', ' d', '@@ -20 +21,2 @@ fn()', '+x', ' y', '\\ No newline at end of file'].join('\n')
    const { hunks, added } = parsePatch(patch)
    expect(hunks).toEqual([{ newStart: 1, newLines: 4 }, { newStart: 21, newLines: 2 }])
    expect(added).toEqual([{ line: 2, text: 'B' }, { line: 3, text: 'C' }, { line: 21, text: 'x' }])
    expect(isInHunk(hunks, 4)).toBe(true)
    expect(isInHunk(hunks, 5)).toBe(false)
    expect(isInHunk(hunks, 22)).toBe(true)
  })
})

describe('diff lines and hunks around findings', () => {
  const patch = ['@@ -68,6 +68,6 @@', ' <div class="progress">', '-  <p *ngIf="isDownloading">', '+  <p *ngIf="!isComplete">', '   Downloading {{ items[currentIndex]?.name }}', ' </div>', '@@ -120,3 +120,4 @@', ' a', '+b', ' c', ' d'].join('\n')

  it('numbers every line on both sides', () => {
    const [h1, h2] = diffLines(patch)
    expect(h1!.lines.map((l) => [l.kind, l.oldLine, l.newLine])).toEqual([
      ['context', 68, 68],
      ['del', 69, undefined],
      ['add', undefined, 69],
      ['context', 70, 70],
      ['context', 71, 71],
    ])
    expect(h2!.lines.find((l) => l.kind === 'add')).toMatchObject({ newLine: 121, text: 'b' })
  })

  it('keeps only the hunks around a range, with context, and caps the size', () => {
    const one = hunksAround(patch, [{ start: 69, end: 69 }], 0)
    expect(one.hunks).toHaveLength(1)
    expect(one.hunks[0]!.lines.map((l) => l.kind)).toEqual(['del', 'add'])
    const both = hunksAround(patch, [{ start: 69, end: 69 }, { start: 121, end: 121 }], 1)
    expect(both.hunks).toHaveLength(2)
    const capped = hunksAround(patch, [{ start: 60, end: 130 }], 3, 4)
    expect(capped.truncated).toBe(true)
    expect(capped.hunks.flatMap((h) => h.lines)).toHaveLength(4)
  })
})
