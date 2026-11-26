/** A line added by the PR, with its line number in the head version of the file. */
export interface AddedLine {
  line: number
  text: string
}

export interface Hunk {
  newStart: number
  newLines: number
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/

/** Parses a unified diff patch (as GitHub returns it) into hunks and added lines. */
export function parsePatch(patch: string): { hunks: Hunk[]; added: AddedLine[] } {
  const hunks: Hunk[] = []
  const added: AddedLine[] = []
  let newLine = 0
  for (const raw of patch.split('\n')) {
    const header = HUNK_HEADER.exec(raw)
    if (header) {
      newLine = Number(header[1])
      hunks.push({ newStart: newLine, newLines: header[2] === undefined ? 1 : Number(header[2]) })
      continue
    }
    if (hunks.length === 0) continue
    if (raw.startsWith('+')) {
      added.push({ line: newLine, text: raw.slice(1) })
      newLine++
    } else if (raw.startsWith('-') || raw.startsWith('\\')) {
      // removed line or "\ No newline at end of file": head line number does not advance
    } else {
      newLine++
    }
  }
  return { hunks, added }
}

/** True when `line` (head numbering) falls inside one of the hunks — i.e. GitHub accepts an inline comment there. */
export function isInHunk(hunks: readonly Hunk[], line: number): boolean {
  return hunks.some((h) => line >= h.newStart && line < h.newStart + Math.max(h.newLines, 1))
}

/** One line of a unified diff with its numbers on each side. */
export interface DiffLine {
  kind: 'context' | 'add' | 'del'
  /** Line number in the base version (context and removed lines). */
  oldLine?: number | undefined
  /** Line number in the head version (context and added lines). */
  newLine?: number | undefined
  text: string
}

export interface DiffHunk {
  header: string
  lines: DiffLine[]
}

const FULL_HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/** Every line of a GitHub patch, numbered on both sides. */
export function diffLines(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = []
  let oldLine = 0
  let newLine = 0
  for (const raw of patch.split('\n')) {
    const header = FULL_HUNK_HEADER.exec(raw)
    if (header) {
      oldLine = Number(header[1])
      newLine = Number(header[2])
      hunks.push({ header: raw, lines: [] })
      continue
    }
    const hunk = hunks[hunks.length - 1]
    if (!hunk || raw.startsWith('\\')) continue
    if (raw.startsWith('+')) hunk.lines.push({ kind: 'add', newLine: newLine++, text: raw.slice(1) })
    else if (raw.startsWith('-')) hunk.lines.push({ kind: 'del', oldLine: oldLine++, text: raw.slice(1) })
    else hunk.lines.push({ kind: 'context', oldLine: oldLine++, newLine: newLine++, text: raw.startsWith(' ') ? raw.slice(1) : raw })
  }
  return hunks
}

/**
 * The parts of a patch around head-line ranges: each hunk that overlaps a range, cut to the range plus `context` lines
 * on each side (removed lines inside the window are kept), at most `maxLines` lines in all.
 */
export function hunksAround(patch: string, ranges: ReadonlyArray<{ start: number; end: number }>, context = 3, maxLines = 400): { hunks: DiffHunk[]; truncated: boolean } {
  const out: DiffHunk[] = []
  let used = 0
  let truncated = false
  for (const hunk of diffLines(patch)) {
    // Head-side position of every line (a removed line takes the position of the next head line).
    let next = hunk.lines.find((l) => l.newLine !== undefined)?.newLine ?? 1
    const pos = hunk.lines.map((l) => {
      if (l.newLine !== undefined) next = l.newLine + 1
      return l.newLine ?? next
    })
    const keep = hunk.lines.map((_, i) => ranges.some((r) => pos[i]! >= r.start - context && pos[i]! <= r.end + context))
    if (!keep.some(Boolean)) continue
    const lines = hunk.lines.filter((_, i) => keep[i])
    if (used + lines.length > maxLines) {
      truncated = true
      const room = maxLines - used
      if (room > 0) out.push({ header: hunk.header, lines: lines.slice(0, room) })
      break
    }
    used += lines.length
    out.push({ header: hunk.header, lines })
  }
  return { hunks: out, truncated }
}
