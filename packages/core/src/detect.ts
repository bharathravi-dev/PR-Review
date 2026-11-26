import * as z from 'zod'
import type { FileAccessor } from './files.js'

/** Frameworks whose versions are detected. Only Angular and React have framework checks today. */
const FRAMEWORKS: Array<{ name: string; pkg: string; checks: boolean }> = [
  { name: 'Angular', pkg: '@angular/core', checks: true },
  { name: 'React', pkg: 'react', checks: true },
  { name: 'Next.js', pkg: 'next', checks: false },
  { name: 'Vue', pkg: 'vue', checks: false },
  { name: 'Svelte', pkg: 'svelte', checks: false },
]

export const DetectedVersion = z.object({
  /** Resolved version (lockfile) or the lowest version a declared range allows. */
  version: z.string().optional(),
  declared: z.string().optional(),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  evidence: z.array(z.string()),
})
export type DetectedVersion = z.infer<typeof DetectedVersion>

/** One project in the repository and its stack (FR-3). */
export const ProjectInfo = z.looseObject({
  /** Directory relative to the repository root ('' for the root). */
  path: z.string(),
  name: z.string().optional(),
  language: z.enum(['TypeScript', 'JavaScript', 'Java', 'Kotlin', 'Python', 'Go', 'unknown']),
  /** "best-effort" when no supported stack was recognised: checks are generic, never framework-specific. */
  support: z.enum(['supported', 'best-effort']),
  frameworks: z.array(DetectedVersion.extend({ name: z.string(), checks: z.boolean() })),
  typescript: DetectedVersion.optional(),
  packageManager: z.enum(['npm', 'pnpm', 'yarn', 'maven', 'gradle', 'pip', 'go', 'unknown']),
  lockfile: z.string().optional(),
  /** Node major requested by .nvmrc, .node-version, or engines.node, else inferred from the Angular version. */
  nodeMajor: z.number().int().optional(),
  nodeMajorSource: z.enum(['.nvmrc', '.node-version', 'engines', 'framework']).optional(),
  configs: z.object({
    tsconfig: z.string().optional(),
    eslint: z.string().optional(),
    tslint: z.string().optional(),
    angularJson: z.string().optional(),
    /** Java and Kotlin: the build file (pom.xml, or build.gradle(.kts) with a Gradle wrapper). */
    maven: z.string().optional(),
    gradle: z.string().optional(),
    gradleWrapper: z.string().optional(),
    /** Python: pyproject.toml / setup.py / requirements.txt, and a ruff config if any. */
    python: z.string().optional(),
    ruff: z.string().optional(),
    /** Go: go.mod. */
    gomod: z.string().optional(),
  }),
  /** Dependency names declared in package.json (dependencies and devDependencies). */
  dependencies: z.array(z.string()),
  changedFiles: z.array(z.string()),
})
export type ProjectInfo = z.infer<typeof ProjectInfo>

const ESLINT_CONFIGS = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml', '.eslintrc']
const LOCKFILES: Array<[string, ProjectInfo['packageManager']]> = [['package-lock.json', 'npm'], ['npm-shrinkwrap.json', 'npm'], ['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn']]

const join = (dir: string, file: string) => (dir ? `${dir}/${file}` : file)
const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
const ignored = (path: string) => /(^|\/)(node_modules|bower_components|\.git|dist|build|vendor)\//.test(path)

/** Lowest version a semver range allows, as "major.minor.patch" (best effort). */
export function minVersion(range: string): string | undefined {
  const m = /(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/.exec(range.replace(/^[^\d]*/, ''))
  if (!m) return undefined
  const n = (s: string | undefined) => (s && /^\d+$/.test(s) ? s : '0')
  return `${m[1]}.${n(m[2])}.${n(m[3])}`
}

/** The Node major an Angular major was built and tested with (used only when the project pins none). */
function nodeForAngular(major: number | undefined): number | undefined {
  if (major === undefined || major < 12) return undefined
  if (major === 12) return 14
  if (major <= 14) return 16
  if (major <= 16) return 18
  if (major <= 18) return 20
  return 22
}

/** Whether a resolved version fits a simple declared range (^, ~, exact); other ranges are assumed to fit. */
export function withinRange(declared: string, version: string): boolean {
  const d = declared.trim()
  if (!/^[\^~]?\d/.test(d) || /\s|\|\||[<>*x]/i.test(d)) return true
  const min = minVersion(d)
  if (!min) return true
  const [a, b] = [min.split('.').map(Number), version.split('.').map((n) => Number.parseInt(n, 10))]
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return true
  const cmp = (x: number[], y: number[]) => x[0]! - y[0]! || x[1]! - y[1]! || x[2]! - y[2]!
  if (cmp(b, a) < 0) return false
  if (d.startsWith('~')) return b[0] === a[0] && b[1] === a[1]
  if (d.startsWith('^')) return a[0]! > 0 ? b[0] === a[0] : a[1]! > 0 ? b[0] === 0 && b[1] === a[1] : cmp(b, a) === 0
  return cmp(b, a) === 0
}

export const majorOf = (version: string | undefined) => (version ? Number(version.split('.')[0]) : undefined)

/** Resolved version of `pkg` from a lockfile's text. */
export function lockedVersion(lockfile: string, text: string, pkg: string, projectDir = ''): string | undefined {
  if (lockfile.endsWith('package-lock.json') || lockfile.endsWith('npm-shrinkwrap.json')) {
    try {
      const lock = JSON.parse(text) as { packages?: Record<string, { version?: string }>; dependencies?: Record<string, { version?: string }> }
      const prefix = projectDir ? `${projectDir}/` : ''
      return lock.packages?.[`${prefix}node_modules/${pkg}`]?.version ?? lock.packages?.[`node_modules/${pkg}`]?.version ?? lock.dependencies?.[pkg]?.version
    } catch {
      return undefined
    }
  }
  const esc = pkg.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  if (lockfile.endsWith('yarn.lock')) {
    const m = new RegExp(`^"?${esc}@[^\\n]*:\\n\\s+version:? "?([^"\\n]+)"?`, 'm').exec(text)
    return m?.[1]
  }
  if (lockfile.endsWith('pnpm-lock.yaml')) {
    const m = new RegExp(`['"]?/?${esc}[@/](\\d+\\.\\d+\\.\\d+[^:'"\\s(]*)`).exec(text)
    return m?.[1]
  }
  return undefined
}

function nodeMajorFrom(text: string | undefined): number | undefined {
  if (!text) return undefined
  const m = /(\d+)/.exec(text.trim().replace(/^v/, '').replace(/^lts\/.*/, ''))
  return m ? Number(m[1]) : undefined
}

/**
 * Stage `detect` (FR-3): finds each project (a directory with package.json), its language, frameworks and versions
 * with confidence and evidence, and maps each changed file to its owning project. Reads only through `files`.
 */
export async function detectProjects(files: FileAccessor, changedPaths: readonly string[]): Promise<{ projects: ProjectInfo[]; notes: string[] }> {
  const notes: string[] = []
  const entries = (await files.list('HEAD')) ?? []
  const paths = new Set(entries.map((e) => e.path))
  const allDirs = entries.filter((e) => /(^|\/)package\.json$/.test(e.path) && !ignored(e.path)).map((e) => dirOf(e.path))
  // Each changed file belongs to the deepest project containing it; only those projects are analysed.
  const byDepth = [...allDirs].sort((a, b) => b.length - a.length)
  const owned = new Map<string, string[]>()
  const unowned: string[] = []
  for (const path of changedPaths) {
    const owner = byDepth.find((d) => d === '' || path.startsWith(`${d}/`))
    if (owner === undefined) unowned.push(path)
    else owned.set(owner, [...(owned.get(owner) ?? []), path])
  }
  const projects: ProjectInfo[] = []

  for (const [dir, changedFiles] of owned) {
    const pkgText = await files.read(join(dir, 'package.json'), 'HEAD')
    let pkg: { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; engines?: { node?: string }; packageManager?: string } = {}
    try {
      pkg = JSON.parse(pkgText ?? '{}') as typeof pkg
    } catch {
      notes.push(`${join(dir, 'package.json')} is not valid JSON; the project's stack could not be detected.`)
    }
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }

    // The nearest lockfile at or above the project (workspaces keep one at the root).
    let lockfile: string | undefined
    let manager: ProjectInfo['packageManager'] = 'unknown'
    for (let d: string | undefined = dir; d !== undefined; d = d === '' ? undefined : dirOf(d)) {
      const hit = LOCKFILES.find(([f]) => paths.has(join(d!, f)))
      if (hit) {
        lockfile = join(d, hit[0])
        manager = hit[1]
        break
      }
    }
    if (manager === 'unknown' && pkg.packageManager) manager = (pkg.packageManager.split('@')[0] as ProjectInfo['packageManager']) ?? 'unknown'
    const lockText = lockfile ? await files.read(lockfile, 'HEAD') : undefined
    const lockDir = lockfile ? dirOf(lockfile) : ''
    const relDir = dir.startsWith(lockDir) ? dir.slice(lockDir.length).replace(/^\//, '') : dir

    const version = (name: string, source: string): DetectedVersion | undefined => {
      const declared = deps[name]
      if (!declared) return undefined
      const locked = lockfile && lockText ? lockedVersion(lockfile, lockText, name, relDir) : undefined
      if (locked && withinRange(declared, locked)) return { version: locked, declared, confidence: 'HIGH', evidence: [`${source} declares ${name}@${declared}`, `${lockfile} resolves ${locked}`] }
      if (locked) {
        // The lockfile disagrees with package.json (e.g. mid-upgrade): trust the declaration, and say so.
        notes.push(`${lockfile} resolves ${name} ${locked}, outside ${src}'s ${declared}; the lockfile looks out of date, so the declared version is used.`)
        const min = minVersion(declared)
        return { ...(min ? { version: min } : {}), declared, confidence: 'MEDIUM', evidence: [`${source} declares ${name}@${declared}`, `${lockfile} resolves ${locked} (out of date)`] }
      }
      const min = minVersion(declared)
      return { ...(min ? { version: min } : {}), declared, confidence: min ? 'MEDIUM' : 'LOW', evidence: [`${source} declares ${name}@${declared}`] }
    }

    const src = join(dir, 'package.json')
    const frameworks = FRAMEWORKS.flatMap((f) => {
      const v = version(f.pkg, src)
      return v ? [{ name: f.name, checks: f.checks, ...v }] : []
    })
    const tsconfig = ['tsconfig.json', 'tsconfig.app.json'].map((f) => join(dir, f)).find((f) => paths.has(f))
    const typescript = version('typescript', src)
    const eslint = ESLINT_CONFIGS.map((f) => join(dir, f)).find((f) => paths.has(f)) ?? (pkgText?.includes('"eslintConfig"') ? src : undefined)
    const tslint = paths.has(join(dir, 'tslint.json')) ? join(dir, 'tslint.json') : undefined
    const angularJson = paths.has(join(dir, 'angular.json')) ? join(dir, 'angular.json') : undefined
    const pinned: Array<[ProjectInfo['nodeMajorSource'], number | undefined]> = [
      ['.nvmrc', nodeMajorFrom(paths.has(join(dir, '.nvmrc')) ? await files.read(join(dir, '.nvmrc'), 'HEAD') : undefined)],
      ['.node-version', nodeMajorFrom(paths.has(join(dir, '.node-version')) ? await files.read(join(dir, '.node-version'), 'HEAD') : undefined)],
      ['engines', nodeMajorFrom(pkg.engines?.node ? minVersion(pkg.engines.node) : undefined)],
      ['framework', nodeForAngular(majorOf(frameworks.find((f) => f.name === 'Angular')?.version))],
    ]
    const [nodeMajorSource, nodeMajor] = pinned.find(([, v]) => v !== undefined) ?? [undefined, undefined]

    projects.push({
      path: dir,
      ...(pkg.name ? { name: pkg.name } : {}),
      language: typescript || tsconfig ? 'TypeScript' : 'JavaScript',
      support: 'supported',
      frameworks,
      ...(typescript ? { typescript } : {}),
      packageManager: manager,
      ...(lockfile ? { lockfile } : {}),
      ...(nodeMajor ? { nodeMajor, nodeMajorSource } : {}),
      configs: { ...(tsconfig ? { tsconfig } : {}), ...(eslint ? { eslint } : {}), ...(tslint ? { tslint } : {}), ...(angularJson ? { angularJson } : {}) },
      dependencies: Object.keys(deps).sort(),
      changedFiles,
    })
  }

  // Java, Kotlin, Python and Go projects (language-specific checks), for files no JavaScript project owns.
  const others = otherProjects(paths, unowned)
  for (const p of others.projects) projects.push(p)
  const leftover = others.leftover
  if (leftover.length > 0) {
    projects.push({ path: '', language: 'unknown', support: 'best-effort', frameworks: [], packageManager: 'unknown', configs: {}, dependencies: [], changedFiles: leftover })
    notes.push(
      `${leftover.length} changed file(s) are outside any recognised project (JavaScript/TypeScript, Java/Kotlin, Python, Go): best-effort review, no language-specific checks.`,
    )
  }
  notes.push(...files.notes())
  return { projects: projects.sort((a, b) => a.path.localeCompare(b.path)), notes }
}

const PY_MARKERS = ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt']
const RUFF_CONFIGS = ['ruff.toml', '.ruff.toml']

/**
 * Java/Kotlin (pom.xml, or build.gradle(.kts) next to a gradlew), Python (pyproject.toml, setup.py, setup.cfg,
 * requirements.txt) and Go (go.mod) projects: each changed file belongs to the deepest marker directory above it.
 */
export function otherProjects(paths: ReadonlySet<string>, changed: readonly string[]): { projects: ProjectInfo[]; leftover: string[] } {
  const markers = new Map<string, ProjectInfo>()
  const find = (dir: string): ProjectInfo | undefined => {
    if (markers.has(dir)) return markers.get(dir)
    const has = (f: string) => paths.has(join(dir, f))
    let found: ProjectInfo | undefined
    const base = { path: dir, support: 'supported' as const, frameworks: [], dependencies: [], changedFiles: [] as string[] }
    if (has('pom.xml')) found = { ...base, language: 'Java', packageManager: 'maven', configs: { maven: join(dir, 'pom.xml') } }
    else if (has('build.gradle') || has('build.gradle.kts')) {
      const gradle = join(dir, has('build.gradle.kts') ? 'build.gradle.kts' : 'build.gradle')
      // The wrapper may sit in a parent (multi-project builds); look upward for it.
      let wrapper: string | undefined
      for (let d: string | undefined = dir; d !== undefined && !wrapper; d = d === '' ? undefined : dirOf(d)) if (paths.has(join(d, 'gradlew'))) wrapper = join(d, 'gradlew')
      found = { ...base, language: has('build.gradle.kts') ? 'Kotlin' : 'Java', packageManager: 'gradle', configs: { gradle, ...(wrapper ? { gradleWrapper: wrapper } : {}) } }
    } else if (has('go.mod')) found = { ...base, language: 'Go', packageManager: 'go', configs: { gomod: join(dir, 'go.mod') } }
    else {
      const py = PY_MARKERS.find(has)
      if (py) {
        const ruff = RUFF_CONFIGS.find(has)
        found = { ...base, language: 'Python', packageManager: 'pip', configs: { python: join(dir, py), ...(ruff ? { ruff: join(dir, ruff) } : {}) } }
      }
    }
    markers.set(dir, found as ProjectInfo)
    return found
  }
  const byDir = new Map<string, ProjectInfo>()
  const leftover: string[] = []
  for (const path of changed) {
    let owner: ProjectInfo | undefined
    for (let d: string | undefined = dirOf(path); d !== undefined && !owner; d = d === '' ? undefined : dirOf(d)) owner = find(d)
    if (!owner) {
      leftover.push(path)
      continue
    }
    const p = byDir.get(owner.path) ?? { ...owner, changedFiles: [] }
    p.changedFiles.push(path)
    byDir.set(owner.path, p)
  }
  return { projects: [...byDir.values()], leftover }
}

/** The frameworks entry for `name` in a project, if any. */
export function framework(project: ProjectInfo, name: string): ProjectInfo['frameworks'][number] | undefined {
  return project.frameworks.find((f) => f.name === name)
}
