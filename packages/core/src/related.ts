// Related files: unchanged code next to the change, so the AI can judge how the change interacts with it.
//   imported by <changed>  local modules a changed file imports, ranked by the names its changed lines use
//   imports <changed>      files that import a changed file and mention names from its changed lines (callers)
//   tests for <changed>    test files named after a changed file
// JavaScript/TypeScript and Python imports are understood; other languages get their tests only. Context only:
// findings must still point at changed files. Everything here is read at the head commit through the FileAccessor.
import type { FileAccessor } from './files.js'

export interface RelatedFile {
  path: string
  /** Why it was picked, e.g. "imported by src/a.ts". */
  relation: string
  /** Numbered lines ("12: text"), the whole file or excerpts around the relevant names. */
  text: string
  /** True when only excerpts are shown. */
  excerpt: boolean
}

export interface RelatedLimits {
  maxFiles: number
  maxTotalChars: number
  maxFileChars: number
  /** Files read while looking for callers (each read is one GitHub request). */
  maxCallerReads: number
}

export const DEFAULT_RELATED_LIMITS: RelatedLimits = { maxFiles: 8, maxTotalChars: 40_000, maxFileChars: 6_000, maxCallerReads: 20 }

interface ChangedInput {
  path: string
  status: string
  patch?: string | undefined
  headText?: string | undefined
}

const JS = /\.(?:[cm]?[jt]sx?)$/
const PY = /\.py$/
const SKIP_DIR = /(?:^|\/)(?:node_modules|dist|build|out|vendor|third_party|coverage|\.git|\.next|__pycache__|\.venv|venv)\//
const MINIFIED = /\.min\.[cm]?js$/
const TEST_FILE = /(?:^|\/)(?:__tests__\/|tests?\/)|[._-](?:test|spec)\.[^/]+$|(?:^|\/)test_[^/]+\.py$|_test\.py$/
const KEYWORDS = new Set(
  'const let var function return export import from default class extends new this super async await yield if else for while do switch case break continue throw try catch finally typeof instanceof void delete true false null undefined interface type enum implements public private protected readonly static abstract declare namespace module require self def lambda pass raise with elif except none and not or is in as of print string number boolean object any unknown never'.split(
    ' ',
  ),
)

const lang = (path: string): 'js' | 'py' | undefined => (JS.test(path) ? 'js' : PY.test(path) ? 'py' : undefined)
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const stemOf = (p: string) => baseOf(p).replace(/(?:\.(?:test|spec))?\.[^.]+$/, '')

function normalize(path: string): string | undefined {
  const out: string[] = []
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (!out.length) return undefined
      out.pop()
    } else out.push(seg)
  }
  return out.join('/')
}

/** Identifiers on the lines a patch adds or removes (the names the change is about). */
export function changedIdentifiers(patch: string | undefined): Set<string> {
  const out = new Set<string>()
  if (!patch) return out
  for (const line of patch.split('\n')) {
    if (!(line.startsWith('+') || line.startsWith('-'))) continue
    for (const m of line.slice(1).matchAll(/[A-Za-z_$][\w$]{2,}/g)) if (!KEYWORDS.has(m[0].toLowerCase())) out.add(m[0])
  }
  return out
}

export interface ImportRef {
  /** The module as written ("./net.js", ".models", "pkg.sub"). */
  spec: string
  /** Names it brings in, when the statement lists them. */
  names: string[]
}

/** Import statements of a JavaScript/TypeScript or Python file. */
export function parseImports(text: string, language: 'js' | 'py'): ImportRef[] {
  const out: ImportRef[] = []
  if (language === 'js') {
    const names = (clause: string) =>
      clause
        .replace(/\*\s+as\s+/g, ',')
        .replace(/[{}*]/g, ',')
        .split(',')
        .map((n) => n.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()!.trim())
        .filter((n) => /^[A-Za-z_$][\w$]*$/.test(n))
    for (const m of text.matchAll(/^\s*(?:import|export)\s+(?:type\s+)?([^;'"()=]{0,500}?)\s+from\s+['"]([^'"]+)['"]/gm)) out.push({ spec: m[2]!, names: names(m[1]!) })
    for (const m of text.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) out.push({ spec: m[1]!, names: [] })
    for (const m of text.matchAll(/(?:const|let|var)\s+([\w${},\s:]+?)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push({ spec: m[2]!, names: names(m[1]!.replace(/:\s*\w+/g, '')) })
    for (const m of text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push({ spec: m[1]!, names: [] })
  } else {
    for (const m of text.matchAll(/^\s*from\s+([.\w]+)\s+import\s+\(?([^)\n]+)\)?/gm)) {
      out.push({ spec: m[1]!, names: m[2]!.split(',').map((n) => n.trim().split(/\s+as\s+/)[0]!.trim()).filter((n) => /^\w+$/.test(n)) })
    }
    for (const m of text.matchAll(/^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/gm)) for (const mod of m[1]!.split(',')) out.push({ spec: mod.trim(), names: [] })
  }
  return out
}

/** The repository file an import refers to, or undefined for packages and anything not in the tree. */
export function resolveImport(from: string, spec: string, language: 'js' | 'py', paths: ReadonlySet<string>): string | undefined {
  const first = (candidates: string[]) => candidates.find((c) => paths.has(c))
  if (language === 'js') {
    if (!spec.startsWith('.')) return undefined
    const base = normalize(`${dirOf(from)}/${spec}`)
    if (base === undefined) return undefined
    const noExt = base.replace(/\.[cm]?jsx?$/, '')
    const exts = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']
    return first([base, ...exts.map((e) => noExt + e), ...exts.map((e) => `${base}/index${e}`)])
  }
  const dots = /^\.*/.exec(spec)![0].length
  const rest = spec.slice(dots).replace(/\./g, '/')
  const roots: string[] = []
  if (dots > 0) {
    let dir: string | undefined = dirOf(from)
    for (let i = 1; i < dots && dir !== undefined; i++) dir = dir ? dirOf(dir) : undefined
    if (dir === undefined) return undefined
    roots.push(dir)
  } else roots.push('', 'src', dirOf(from))
  for (const root of roots) {
    const stem = [root, rest].filter(Boolean).join('/')
    const hit = first(rest ? [`${stem}.py`, `${stem}/__init__.py`] : [`${stem}/__init__.py`])
    if (hit) return hit
  }
  return undefined
}

/** Test files in the tree named after a source file. */
export function testsFor(path: string, paths: Iterable<string>): string[] {
  const stem = stemOf(path)
  const dir = dirOf(path)
  const out: string[] = []
  for (const p of paths) {
    if (p === path || !TEST_FILE.test(p)) continue
    const b = baseOf(p)
    const named = b.startsWith(`${stem}.test.`) || b.startsWith(`${stem}.spec.`) || b === `test_${stem}.py` || b === `${stem}_test.py` || (/(?:^|\/)__tests__\//.test(p) && stemOf(p) === stem)
    // Next to the file, in a __tests__ folder below it, or in a tests folder anywhere for Python.
    if (named && (dirOf(p) === dir || dirOf(p).startsWith(dir ? `${dir}/` : '') || p.endsWith('.py'))) out.push(p)
  }
  return out.sort((a, b) => a.length - b.length).slice(0, 2)
}

/** How many leading directory segments two paths share (more = closer). */
function closeness(a: string, b: string): number {
  const x = dirOf(a).split('/')
  const y = dirOf(b).split('/')
  let n = 0
  while (n < x.length && n < y.length && x[n] === y[n]) n++
  return n
}

/** Numbered lines of the whole file, or of windows around lines that mention any of `focus`, within `max` chars. */
export function excerpt(text: string, focus: readonly string[], max: number, declarationsOnly = false): { text: string; excerpt: boolean } {
  const lines = text.split('\n')
  const numbered = (i: number) => `${i + 1}: ${lines[i]}`
  const whole = lines.map((_, i) => numbered(i)).join('\n')
  if (whole.length <= max) return { text: whole, excerpt: false }
  const words = focus.filter((f) => /^[\w$]+$/.test(f))
  const mention = words.length ? new RegExp(`\\b(?:${words.map((w) => w.replace(/\$/g, '\\$')).join('|')})\\b`) : undefined
  const decl = /\b(?:function|class|const|let|var|def|interface|type|enum)\b/
  const hits: number[] = []
  if (mention) lines.forEach((l, i) => mention.test(l) && (!declarationsOnly || decl.test(l)) && hits.push(i))
  if (!hits.length && declarationsOnly && mention) lines.forEach((l, i) => mention.test(l) && hits.push(i))
  const keep = new Set<number>()
  for (const h of hits) for (let i = Math.max(0, h - 3); i <= Math.min(lines.length - 1, h + (declarationsOnly ? 12 : 4)); i++) keep.add(i)
  if (!keep.size) for (let i = 0; i < Math.min(lines.length, 40); i++) keep.add(i)
  const out: string[] = []
  let prev = -2
  let size = 0
  for (const i of [...keep].sort((a, b) => a - b)) {
    const row = `${i !== prev + 1 ? (out.length ? '…\n' : '') : ''}${numbered(i)}`
    if (size + row.length + 1 > max) {
      out.push('… (more not shown)')
      break
    }
    out.push(row)
    size += row.length + 1
    prev = i
  }
  return { text: out.join('\n'), excerpt: true }
}

interface Candidate {
  path: string
  relation: string
  score: number
  focus: string[]
  /** 0 imported module, 1 caller, 2 test. */
  kind: number
}

/** Picks and reads the related files for a change, within the limits. */
export async function findRelatedFiles(files: FileAccessor, changed: readonly ChangedInput[], limits: RelatedLimits = DEFAULT_RELATED_LIMITS): Promise<{ related: RelatedFile[]; notes: string[] }> {
  const tree = await files.list('HEAD')
  if (!tree) return { related: [], notes: [] }
  const paths = new Set(tree.map((e) => e.path).filter((p) => !SKIP_DIR.test(p) && !MINIFIED.test(p)))
  const changedPaths = new Set(changed.map((c) => c.path))
  const live = changed.filter((c) => c.status !== 'removed' && c.headText !== undefined && !SKIP_DIR.test(c.path))
  const candidates: Candidate[] = []
  const notes: string[] = []

  for (const c of live) {
    const language = lang(c.path)
    const idents = changedIdentifiers(c.patch)
    if (language) {
      for (const imp of parseImports(c.headText!, language)) {
        const target = resolveImport(c.path, imp.spec, language, paths)
        if (!target || changedPaths.has(target)) continue
        const used = imp.names.filter((n) => idents.has(n))
        const score = used.length ? used.length + 1 : imp.names.length ? 0 : 0.5
        if (score > 0) candidates.push({ path: target, relation: `imported by ${c.path}`, score, focus: used.length ? used : imp.names, kind: 0 })
      }
    }
    if (!TEST_FILE.test(c.path)) for (const t of testsFor(c.path, paths)) if (!changedPaths.has(t)) candidates.push({ path: t, relation: `tests for ${c.path}`, score: 1, focus: [...idents], kind: 2 })
  }

  // Callers: nearby files of the same language that import a changed file, read until the read budget runs out.
  const targets = live.filter((c) => lang(c.path) && !TEST_FILE.test(c.path) && changedIdentifiers(c.patch).size > 0)
  if (targets.length) {
    const pool = [...paths]
      .filter((p) => !changedPaths.has(p) && !TEST_FILE.test(p) && targets.some((t) => lang(t.path) === lang(p)))
      .map((p) => ({ p, near: Math.max(...targets.map((t) => closeness(p, t.path))) }))
      .sort((a, b) => b.near - a.near || a.p.localeCompare(b.p))
    const toRead = pool.slice(0, limits.maxCallerReads)
    if (pool.length > toRead.length) notes.push(`Related files: looked for callers in the ${toRead.length} nearest of ${pool.length} files only.`)
    const texts = await Promise.all(toRead.map(async ({ p }) => [p, await files.read(p, 'HEAD')] as const))
    for (const [p, text] of texts) {
      if (text === undefined) continue
      const language = lang(p)!
      const imported = new Set(parseImports(text, language).map((i) => resolveImport(p, i.spec, language, paths)))
      for (const t of targets) {
        if (!imported.has(t.path)) continue
        const used = [...changedIdentifiers(t.patch)].filter((n) => new RegExp(`\\b${n.replace(/\$/g, '\\$')}\\b`).test(text))
        if (used.length) candidates.push({ path: p, relation: `imports ${t.path}`, score: used.length, focus: used, kind: 1 })
      }
    }
  }

  // Best first; one entry per file with all its relations; within the file and size budgets.
  candidates.sort((a, b) => b.score - a.score || a.kind - b.kind || a.path.localeCompare(b.path))
  const byPath = new Map<string, Candidate & { relations: string[] }>()
  for (const c of candidates) {
    const seen = byPath.get(c.path)
    if (seen) {
      if (!seen.relations.includes(c.relation)) seen.relations.push(c.relation)
      seen.focus = [...new Set([...seen.focus, ...c.focus])]
    } else if (byPath.size < limits.maxFiles) byPath.set(c.path, { ...c, relations: [c.relation] })
  }
  const related: RelatedFile[] = []
  let total = 0
  for (const c of byPath.values()) {
    const text = await files.read(c.path, 'HEAD')
    if (text === undefined) continue
    const budget = Math.min(limits.maxFileChars, limits.maxTotalChars - total)
    if (budget < 500) break
    const shown = excerpt(text, c.focus, budget, c.kind === 0)
    total += shown.text.length
    related.push({ path: c.path, relation: c.relations.join('; '), ...shown })
  }
  return { related, notes }
}
