import { describe, expect, it } from 'vitest'
import { isInHunk, parsePatch } from './diff.js'

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
