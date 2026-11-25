// Known vulnerabilities in dependencies a PR adds or upgrades (FR-4, Story 4.8). Product-owned lockfile parsing; the
// advisory database is reached through AdvisoryPort. No repository tool runs, so no Sandbox.
import type { Advisory, Finding, Severity, Validator } from '@pr-reviewer/core'
import { finding } from './util.js'

const LOCKFILE = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/
const MAX_PACKAGES = 300

/** name → versions resolved by a lockfile. */
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

const SEVERITY: Record<string, Severity> = { CRITICAL: 'CRITICAL', HIGH: 'MAJOR', MODERATE: 'MINOR', MEDIUM: 'MINOR', LOW: 'INFO' }

export const dependencyAuditValidator: Validator = {
  id: 'deps.audit',
  version: '1',
  layers: ['DEPENDENCIES'],
  needsSandbox: false,
  baseline: false,
  hermetic: false,
  supports(ctx) {
    return ctx.pr.files.some((f) => LOCKFILE.test(f.path) || /(^|\/)package\.json$/.test(f.path))
      ? { applicable: true }
      : { applicable: false, reason: 'NOT_SUPPORTED', detail: 'No dependency changes in this PR.' }
  },
  async run(ctx, ports) {
    const lockChanges = ctx.pr.files.filter((f) => LOCKFILE.test(f.path) && f.status !== 'removed')
    if (lockChanges.length === 0) {
      return {
        layers: [{ layer: 'DEPENDENCIES', status: 'WARNING', detail: 'package.json changed without a lockfile change, so exact versions are unknown and were not checked.' }],
        findings: [],
      }
    }
    if (!ports.advisories) return { layers: [{ layer: 'DEPENDENCIES', status: 'SKIPPED', reason: 'NOT_SUPPORTED', detail: 'No advisory database is configured.' }], findings: [] }

    // Added or upgraded = (name, version) present at head and not at base.
    const added: Array<{ name: string; version: string; lockfile: string }> = []
    const notes: string[] = []
    for (const f of lockChanges) {
      // Lockfiles are read in full through the file accessor (context text is size-limited).
      const head = await ctx.files.read(f.path, 'HEAD')
      if (head === undefined) {
        notes.push(`${f.path} could not be read`)
        continue
      }
      const base = lockedPackages(f.path, f.status === 'added' ? undefined : await ctx.files.read(f.previousPath ?? f.path, 'BASE'))
      for (const [name, versions] of lockedPackages(f.path, head)) {
        for (const version of versions) if (!base.get(name)?.has(version)) added.push({ name, version, lockfile: f.path })
      }
    }
    if (added.length === 0) {
      return { layers: [{ layer: 'DEPENDENCIES', status: 'PASSED', detail: `No packages added or upgraded.${notes.length ? ` ${notes.join('; ')}.` : ''}` }], findings: [] }
    }
    const checked = added.slice(0, MAX_PACKAGES)
    const res = await ports.advisories.query(checked.map((p) => ({ ecosystem: 'npm', name: p.name, version: p.version })))
    if (!res.ok) return { layers: [{ layer: 'DEPENDENCIES', status: 'ERROR', reason: 'TOOL_CRASHED', detail: `The advisory database (${ports.advisories.source}) could not be queried: ${res.error.message}` }], findings: [] }

    const findings: Finding[] = []
    for (const hit of res.value) {
      const where = checked.find((p) => p.name === hit.name && p.version === hit.version)
      for (const a of hit.advisories) findings.push(vulnFinding(hit.name, hit.version, a, where?.lockfile ?? lockChanges[0]!.path, ports.advisories.source))
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

function vulnFinding(name: string, version: string, a: Advisory, lockfile: string, source: string): Finding {
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
    location: { anchorKind: 'FILE', path: lockfile },
    provenance: { validator: 'deps.audit', tool: source },
  })
}
