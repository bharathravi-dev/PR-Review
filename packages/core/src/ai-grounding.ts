import { diffLines, parsePatch, type Hunk } from './diff.js'
import type { Finding, LayerResult } from './findings.js'
import type { RedactedContext } from './redact.js'
import type { Report } from './report.js'
import { validateYamlSyntax } from './standards-rag.js'

export interface GroundableCandidate {
  path: string | null
  startLine: number | null
  endLine: number | null
  recommendation?: string | null | undefined
  suggestion?: string | null | undefined
  evidenceQuote?: string | null | undefined
}

export type SuggestionSyntaxChecker = (path: string, patchedText: string, originalText: string) => boolean

export type GroundedFile = RedactedContext['files'][number]

export interface FileGroundingIndex {
  files: Map<string, GroundedFile>
  lineCounts: Map<string, number | undefined>
  hunks: Map<string, Hunk[]>
}

const collapseWs = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** Indexes non-removed files from the redacted PR context for deterministic line, hunk, and quote grounding. */
export function buildGroundingIndex(ctx: RedactedContext): FileGroundingIndex {
  const files = new Map<string, GroundedFile>()
  const lineCounts = new Map<string, number | undefined>()
  const hunks = new Map<string, Hunk[]>()
  for (const f of ctx.files) {
    if (f.status === 'removed') continue
    files.set(f.path, f)
    lineCounts.set(f.path, f.head?.text === undefined ? undefined : f.head.text.split('\n').length)
    hunks.set(f.path, f.patch ? parsePatch(f.patch).hunks : [])
  }
  return { files, lineCounts, hunks }
}

/**
 * Resolves a finding candidate's location strictly against loaded head text or diff hunks.
 * When `head.text` is omitted, lines outside diff hunks are dropped and files without any patch
 * downgrade to `FILE` so arbitrary fabricated line numbers cannot leak into reports.
 */
export function locateFinding(
  item: Pick<GroundableCandidate, 'path' | 'startLine' | 'endLine'>,
  index: FileGroundingIndex,
): Finding['location'] | undefined {
  if (item.path === null) return { anchorKind: 'PR' }
  if (!index.files.has(item.path)) return undefined
  const max = index.lineCounts.get(item.path)
  const start = item.startLine
  if (start === null || !Number.isInteger(start) || start < 1) return { anchorKind: 'FILE', path: item.path }
  const end = item.endLine !== null && Number.isInteger(item.endLine) && item.endLine >= start ? item.endLine : start
  if (max !== undefined) {
    if (end > max) return undefined
    return { anchorKind: 'LINE', path: item.path, startLine: start, endLine: end }
  }
  const fileHunks = index.hunks.get(item.path) ?? []
  if (fileHunks.length === 0) return { anchorKind: 'FILE', path: item.path }
  const overlapsHunk = fileHunks.some((h) => end >= h.newStart && start < h.newStart + Math.max(h.newLines, 1))
  if (!overlapsHunk) return undefined
  return { anchorKind: 'LINE', path: item.path, startLine: start, endLine: end }
}

/**
 * Verifies that an optional `evidenceQuote` on a line-anchored finding actually appears near the cited lines
 * (±3 lines) in the loaded head content or diff hunk, preventing quoted-code hallucinations.
 */
export function verifyQuoteGrounding(
  item: GroundableCandidate,
  location: Finding['location'],
  index: FileGroundingIndex,
  toleranceLines = 3,
): boolean {
  if (location.anchorKind !== 'LINE' || !location.path || location.startLine === undefined) return true
  const rawQuote = item.evidenceQuote
  if (!rawQuote) return true
  const quote = collapseWs(rawQuote)
  if (quote.length < 4) return true
  const file = index.files.get(location.path)
  if (!file) return false

  const start = Math.max(1, location.startLine - toleranceLines)
  const end = (location.endLine ?? location.startLine) + toleranceLines
  if (file.head?.text !== undefined) {
    const lines = file.head.text.split('\n')
    const windowText = collapseWs(lines.slice(start - 1, end).join(' '))
    return windowText.includes(quote)
  }
  if (file.patch) {
    const hunkLines: string[] = []
    for (const hunk of diffLines(file.patch)) {
      for (const l of hunk.lines) {
        if (l.newLine !== undefined && l.newLine >= start && l.newLine <= end) hunkLines.push(l.text)
      }
    }
    return collapseWs(hunkLines.join(' ')).includes(quote)
  }
  return false
}

/** Replaces lines `startLine..endLine` (1-based) in `headText` with `suggestion` while preserving line endings. */
export function spliceSuggestion(headText: string, startLine: number, endLine: number, suggestion: string): string {
  const eol = headText.includes('\r\n') ? '\r\n' : '\n'
  const lines = headText.split(/\r?\n/)
  const replacement = suggestion.replace(/\r?\n$/, '').split(/\r?\n/)
  return [...lines.slice(0, startLine - 1), ...replacement, ...lines.slice(endLine)].join(eol)
}

/** True when `startLine..endLine` falls entirely inside one diff hunk so GitHub/GitLab can commit the suggestion. */
export function isSuggestionWithinSingleHunk(file: GroundedFile, startLine: number, endLine: number): boolean {
  if (!file.patch) return false
  const hunks = parsePatch(file.patch).hunks
  return hunks.some((h) => startLine >= h.newStart && endLine < h.newStart + Math.max(h.newLines, 1))
}

function defaultCoreSyntaxCheck(path: string, patchedText: string): boolean {
  if (/\.json$/i.test(path) && !/(^|\/)(tsconfig[^/]*|jsconfig[^/]*|\.eslintrc[^/]*)\.json$/i.test(path)) {
    try {
      JSON.parse(patchedText)
      return true
    } catch {
      return false
    }
  }
  if (/\.ya?ml$/i.test(path)) return validateYamlSyntax(patchedText).ok
  return true
}

/**
 * Validates that an AI committable `suggestion` is non-identical code inside one diff hunk and introduces no syntax errors.
 */
export function verifySuggestionGrounding(
  item: GroundableCandidate,
  location: Finding['location'],
  index: FileGroundingIndex,
  syntaxCheck?: SuggestionSyntaxChecker | undefined,
): boolean {
  const raw = item.suggestion
  if (!raw || location.anchorKind !== 'LINE' || !location.path || location.startLine === undefined) return false
  if (raw.trim() === (item.recommendation ?? '').trim()) return false
  const file = index.files.get(location.path)
  if (!file) return false
  const start = location.startLine
  const end = location.endLine ?? start
  if (!isSuggestionWithinSingleHunk(file, start, end)) return false

  if (file.head?.text !== undefined) {
    const existing = file.head.text.split(/\r?\n/).slice(start - 1, end).join('\n').replace(/\r?\n$/, '')
    if (raw.replace(/\r?\n$/, '') === existing) return false
    const patched = spliceSuggestion(file.head.text, start, end, raw)
    if (syntaxCheck) return syntaxCheck(location.path, patched, file.head.text)
    return defaultCoreSyntaxCheck(location.path, patched)
  }
  return true
}

const COMPILE_PASS_CLAIM = /\b(compiles?|type[- ]?checks?|builds?)\b.{0,25}\b(cleanly|without errors?|pass(ed|es)?|succeed(s|ed)?)\b|\bno (compile|compilation|type|build) errors?\b/i
const TEST_PASS_CLAIM = /\b(all |unit |existing )?tests?\b.{0,25}\b(pass(ed|es)?|succeed(s|ed)?|green)\b|\bfully tested\b/i
const NO_ISSUES_CLAIM = /\bno (issues?|bugs?|errors?|problems?|findings?|vulnerabilities)\b/i
const FULL_COVERAGE_CLAIM = /\breviewed (every|all) files?\b|\bfull coverage\b/i

/**
 * Checks AI walkthrough prose against verified layer statuses, active findings, and file coverage,
 * appending an explicit accuracy note whenever narrative prose contradicts observed evidence.
 */
export function guardWalkthroughSummary(
  summary: string,
  state: {
    layers: readonly LayerResult[]
    findings: readonly Finding[]
    fileCoverage?: Report['fileCoverage'] | undefined
  },
): { summary: string; warnings: string[] } {
  const warnings: string[] = []
  const compileLayers = state.layers.filter((l) => l.layer === 'COMPILE')
  const compilePassed = compileLayers.length > 0 && compileLayers.every((l) => l.status === 'PASSED')
  if (COMPILE_PASS_CLAIM.test(summary) && !compilePassed) {
    warnings.push('AI summary mentioned compiling cleanly, but COMPILE did not run to PASSED.')
  }

  const testLayers = state.layers.filter((l) => l.layer === 'TESTS')
  const testsPassed = testLayers.length > 0 && testLayers.every((l) => l.status === 'PASSED')
  if (TEST_PASS_CLAIM.test(summary) && !testsPassed) {
    warnings.push('AI summary mentioned tests passing, but TESTS did not run to PASSED.')
  }

  const activeFindings = state.findings.filter((f) => !f.dismissed && f.scope !== 'PRE_EXISTING')
  if (NO_ISSUES_CLAIM.test(summary) && activeFindings.length > 0) {
    warnings.push(`AI summary claimed no issues, while ${activeFindings.length} finding(s) remain in the report.`)
  }

  const fc = state.fileCoverage
  if (fc && (fc.filesCapReached || fc.omittedTotalLimit > 0 || fc.patchTruncated > 0) && FULL_COVERAGE_CLAIM.test(summary)) {
    warnings.push('AI summary claimed full coverage, while some files or diffs were truncated or exceeded loader caps.')
  }

  if (warnings.length === 0) return { summary, warnings }
  return {
    summary: `${summary.trim()}\n\n_Accuracy check: ${warnings.join(' ')}_`,
    warnings,
  }
}
