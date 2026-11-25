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
