import { parsePatch, type ChangedFile, type Finding, type PrContext } from '@pr-reviewer/core'

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
