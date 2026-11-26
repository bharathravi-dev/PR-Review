// Known vulnerabilities in dependencies a PR adds or upgrades (FR-4, Story 4.8). Product-owned lockfile/manifest
// parsing across npm, Maven, PyPI, and Go; the advisory database is reached through AdvisoryPort. No Sandbox needed.
import type { Advisory, AdvisoryEcosystem, Finding, Severity, Validator } from '@pr-reviewer/core'
import { finding } from './util.js'

const NPM_LOCKFILE = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/
const MAVEN_POM = /(^|\/)pom\.xml$/
const PY_REQS = /(^|\/)requirements[^/]*\.txt$/
const GO_MOD = /(^|\/)go\.mod$/
const SUPPORTED_DEP_FILE = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|pom\.xml|requirements[^/]*\.txt|go\.mod)$/
const MAX_PACKAGES = 300

/** name → versions resolved by an npm/yarn/pnpm lockfile. */
export function lockedPackages(path: string, text: string | undefined): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  if (!text) return out
  const add = (name: string, version: string) => {
    if (!name || !/^\d+\.\d+\.\d+/.test(version)) return
    out.set(name, (out.get(name) ?? new Set()).add(version))
  }
  if (/package-lock\.json$|npm-shrinkwrap\.json$/.test(path)) {
    try {
      const lock = JSON.parse(text) as { packages?: Record<string, { version?: string; name?: string; link?: boolean }>; dependencies?: Record<string, { version?: string; dependencies?: unknown }> }
      if (lock.packages) {
        for (const [key, v] of Object.entries(lock.packages)) {
          if (!key || v.link || !v.version) continue
          add(v.name ?? key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length), v.version)
        }
      } else {
        const walk = (deps: Record<string, { version?: string; dependencies?: unknown }> | undefined) => {
          for (const [name, v] of Object.entries(deps ?? {})) {
            if (v.version) add(name, v.version)
            walk(v.dependencies as typeof deps)
          }
        }
        walk(lock.dependencies)
      }
    } catch {
      return out
    }
  } else if (path.endsWith('yarn.lock')) {
    // Blocks start with `"name@range", name@range:` and contain `version "x"` (v1) or `version: x` (berry).
    for (const m of text.matchAll(/^"?((?:@[^@/\s"]+\/)?[^@\s",]+)@[^\n]*:\n(?:[ \t]+[^\n]*\n)*?[ \t]+version:? "?([^"\n]+)"?/gm)) add(m[1]!, m[2]!)
  } else if (path.endsWith('pnpm-lock.yaml')) {
    for (const m of text.matchAll(/^ {2}['"]?\/?((?:@[^@/\s'"]+\/)?[^@/\s'"(]+)[@/](\d+\.\d+\.\d+[^:'"\s(]*)/gm)) add(m[1]!, m[2]!)
  }
  return out
}

function parsePomDependencies(text: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  const cleaned = text.replace(/<!--[\s\S]*?-->/g, '')
  for (const block of cleaned.matchAll(/<dependency\b[^>]*>([\s\S]*?)<\/dependency>/g)) {
    const body = block[1]!
    const groupId = /<groupId>\s*([^<\s]+)\s*<\/groupId>/.exec(body)?.[1]
    const artifactId = /<artifactId>\s*([^<\s]+)\s*<\/artifactId>/.exec(body)?.[1]
    const version = /<version>\s*([^<\s]+)\s*<\/version>/.exec(body)?.[1]
    if (!groupId || !artifactId || !version || version.includes('${')) continue
    const name = `${groupId}:${artifactId}`
    out.set(name, (out.get(name) ?? new Set()).add(version))
  }
  return out
}

function parsePyRequirements(text: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line || line.startsWith('-')) continue
    const m = /^([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?\s*==\s*([A-Za-z0-9_.+-]+)/.exec(line)
    if (!m) continue
    const name = m[1]!.toLowerCase()
    out.set(name, (out.get(name) ?? new Set()).add(m[2]!))
  }
  return out
}

function parseGoMod(text: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  let inRequire = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, '').trim()
    if (!line) continue
    if (/^require\s*\($/.test(line)) {
      inRequire = true
      continue
    }
    if (inRequire && line === ')') {
      inRequire = false
      continue
    }
    const reqLine = inRequire ? line : line.startsWith('require ') ? line.slice('require '.length).trim() : ''
    if (!reqLine) continue
    const m = /^([^\s]+)\s+v(\d+\.\d+\.\d+[^\s]*)/.exec(reqLine)
    if (!m) continue
    out.set(m[1]!, (out.get(m[1]!) ?? new Set()).add(m[2]!))
  }
  return out
}

/** Extracts `(ecosystem, packages)` from any supported dependency manifest or lockfile. */
export function parsedDependencies(path: string, text: string | undefined): { ecosystem: AdvisoryEcosystem; packages: Map<string, Set<string>> } | undefined {
  if (!text) return undefined
  if (NPM_LOCKFILE.test(path)) return { ecosystem: 'npm', packages: lockedPackages(path, text) }
  if (MAVEN_POM.test(path)) return { ecosystem: 'Maven', packages: parsePomDependencies(text) }
  if (PY_REQS.test(path)) return { ecosystem: 'PyPI', packages: parsePyRequirements(text) }
  if (GO_MOD.test(path)) return { ecosystem: 'Go', packages: parseGoMod(text) }
  return undefined
}

function ecosystemOf(path: string): AdvisoryEcosystem | undefined {
  if (NPM_LOCKFILE.test(path)) return 'npm'
  if (MAVEN_POM.test(path)) return 'Maven'
  if (PY_REQS.test(path)) return 'PyPI'
  if (GO_MOD.test(path)) return 'Go'
  return undefined
}

const SEVERITY: Record<string, Severity> = { CRITICAL: 'CRITICAL', HIGH: 'MAJOR', MODERATE: 'MINOR', MEDIUM: 'MINOR', LOW: 'INFO' }

export const dependencyAuditValidator: Validator = {
  id: 'deps.audit',
  version: '2',
  layers: ['DEPENDENCIES'],
  needsSandbox: false,
  baseline: false,
  hermetic: false,
  supports(ctx) {
    return ctx.pr.files.some((f) => SUPPORTED_DEP_FILE.test(f.path) || /(^|\/)package\.json$/.test(f.path))
      ? { applicable: true }
      : { applicable: false, reason: 'NOT_SUPPORTED', detail: 'No dependency changes in this PR.' }
  },
  async run(ctx, ports) {
    const depChanges = ctx.pr.files.filter((f) => SUPPORTED_DEP_FILE.test(f.path) && f.status !== 'removed')
    if (depChanges.length === 0) {
      return {
        layers: [{ layer: 'DEPENDENCIES', status: 'WARNING', detail: 'package.json changed without a lockfile change, so exact versions are unknown and were not checked.' }],
        findings: [],
      }
    }
    if (!ports.advisories) return { layers: [{ layer: 'DEPENDENCIES', status: 'SKIPPED', reason: 'NOT_SUPPORTED', detail: 'No advisory database is configured.' }], findings: [] }

    // Added or upgraded = (ecosystem, name, version) present at head and not at base.
    const added: Array<{ ecosystem: AdvisoryEcosystem; name: string; version: string; file: string }> = []
    const notes: string[] = []
    for (const f of depChanges) {
      const ecosystem = ecosystemOf(f.path)
      if (!ecosystem) continue
      const head = await ctx.files.read(f.path, 'HEAD')
      if (head === undefined) {
        notes.push(`${f.path} could not be read`)
        continue
      }
      const baseText = f.status === 'added' ? undefined : await ctx.files.read(f.previousPath ?? f.path, 'BASE')
      const headPkgs = parsedDependencies(f.path, head)?.packages ?? new Map()
      const basePkgs = parsedDependencies(f.path, baseText)?.packages ?? new Map()
      for (const [name, versions] of headPkgs) {
        for (const version of versions) {
          if (!basePkgs.get(name)?.has(version)) added.push({ ecosystem, name, version, file: f.path })
        }
      }
    }
    if (added.length === 0) {
      return { layers: [{ layer: 'DEPENDENCIES', status: 'PASSED', detail: `No pinned packages added or upgraded.${notes.length ? ` ${notes.join('; ')}.` : ''}` }], findings: [] }
    }
    const checked = added.slice(0, MAX_PACKAGES)
    const res = await ports.advisories.query(checked.map((p) => ({ ecosystem: p.ecosystem, name: p.name, version: p.version })))
    if (!res.ok) return { layers: [{ layer: 'DEPENDENCIES', status: 'ERROR', reason: 'TOOL_CRASHED', detail: `The advisory database (${ports.advisories.source}) could not be queried: ${res.error.message}` }], findings: [] }

    const findings: Finding[] = []
    for (let i = 0; i < res.value.length; i++) {
      const hit = res.value[i]!
      const entry = checked[i]
      const file = entry?.file ?? depChanges[0]!.path
      for (const a of hit.advisories) findings.push(vulnFinding(hit.name, hit.version, a, file, ports.advisories.source))
    }
    const detail = [
      `${checked.length} added or upgraded package version(s) checked against ${ports.advisories.source}.`,
      added.length > MAX_PACKAGES ? `${added.length - MAX_PACKAGES} more were not checked (limit ${MAX_PACKAGES}).` : '',
      notes.length ? `${notes.join('; ')}.` : '',
    ]
      .filter(Boolean)
      .join(' ')
    return { layers: [{ layer: 'DEPENDENCIES', status: findings.length ? 'WARNING' : 'PASSED', detail }], findings }
  },
}

function vulnFinding(name: string, version: string, a: Advisory, file: string, source: string): Finding {
  const ids = [a.id, ...a.aliases.filter((x) => x !== a.id)].slice(0, 4).join(', ')
  return finding({
    ruleId: `deps/${a.id}`,
    category: 'DEPENDENCY',
    severity: SEVERITY[(a.severity ?? '').toUpperCase()] ?? 'MINOR',
    confidence: 'HIGH',
    title: `${name}@${version}: ${a.summary || 'known vulnerability'}`,
    description: `This PR adds or upgrades to ${name}@${version}, which has a known vulnerability (${ids}${a.severity ? `, severity ${a.severity.toLowerCase()}` : ''}). Reachability unknown: whether your code uses the affected part was not checked.`,
    ...(a.fixedIn ? { recommendation: `Upgrade ${name} to ${a.fixedIn} or later.` } : { recommendation: 'Check the advisory for a fixed version or a workaround.' }),
    ...(a.url ? { evidence: a.url } : {}),
    location: { anchorKind: 'FILE', path: file },
    provenance: { validator: 'deps.audit', tool: source },
  })
}
