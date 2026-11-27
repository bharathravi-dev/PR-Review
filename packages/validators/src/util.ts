import { parsePatch, type ChangedFile, type Finding, type PrContext, type SandboxStepResult } from '@pr-reviewer/core'

/** Lines a file adds (head line numbers), from its patch. */
export function addedLines(file: ChangedFile): Map<number, string> {
  return new Map(file.patch ? parsePatch(file.patch).added.map((a) => [a.line, a.text]) : [])
}

export function changedFile(ctx: { pr: PrContext }, path: string): ChangedFile | undefined {
  return ctx.pr.files.find((f) => f.path === path)
}

/** Builds a deterministic Finding; core assigns scope, fingerprint, and disposition. */
export function finding(f: Omit<Finding, 'scope' | 'sourceFamily'> & { sourceFamily?: Finding['sourceFamily'] }): Finding {
  return { sourceFamily: 'DETERMINISTIC', ...f, scope: 'UNKNOWN' }
}

export const relTo = (dir: string, path: string) => (dir && path.startsWith(`${dir}/`) ? path.slice(dir.length + 1) : path)
export const joinPath = (dir: string, path: string) => (dir ? `${dir}/${path}` : path)

const TEST_PATH = /(^|\/)(__tests__|tests?|spec|fixtures?|__mocks__)\/|\.(test|spec)\.[a-z0-9]+$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$/i
const JAVA_TEST_CLASS = /Test\.java$/

export function isTestFile(path: string): boolean {
  return TEST_PATH.test(path) || JAVA_TEST_CLASS.test(path)
}

export function isCommentLine(text: string): boolean {
  return /^\s*(\/\/|#|\*|\/\*|--)/.test(text)
}

export function tail(text: string, max = 300): string {
  const t = text.trim()
  return t.length > max ? `…${t.slice(-max)}` : t
}

/** POSIX path normalisation (resolves ./ and ../). */
export function normalizePosix(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

/** Turns a step result into a crash outcome, or undefined when the tool produced usable output. */
export function stepProblem(r: SandboxStepResult | undefined, okCodes: readonly number[]): string | undefined {
  if (!r) return 'the step did not run'
  if (r.skipped) return r.skipped
  if (r.timedOut) return 'it timed out'
  if (r.exitCode === 127) return tail(r.stderr) || 'the tool is not installed'
  if (r.exitCode === null || !okCodes.includes(r.exitCode)) return `exit ${r.exitCode}: ${tail(r.stderr || r.stdout)}`
  return undefined
}
