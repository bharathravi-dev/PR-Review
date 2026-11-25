import { parse } from 'yaml'
import * as z from 'zod'
import { globToRegExp } from './files.js'
import { Severity } from './findings.js'

/** Where a repository keeps its settings, read at exactly the PR's base commit (AD-13). */
export const REPO_CONFIG_PATH = '.github/pr-reviewer.yml'
/** Where a repository keeps Review Rules (Markdown), read at the base commit (AD-13). */
export const REPO_RULES_DIR = '.github/pr-reviewer/rules/'

/**
 * The allow-list (AD-13): what a repository may set. Nothing here can redirect Credentials or data, choose a
 * provider or endpoint, change the review event, the Sandbox, or Mandatory Layers.
 */
export const RepoSettings = z.object({
  /** Extra Review Rules, as text. */
  reviewRules: z.array(z.string().max(2000)).max(200).optional(),
  paths: z
    .object({
      include: z.array(z.string().max(300)).max(200).optional(),
      exclude: z.array(z.string().max(300)).max(200).optional(),
    })
    .optional(),
  thresholds: z
    .object({
      /** Lowest severity of a non-AI Finding that fails the gate; may only be stricter than the default (CRITICAL). */
      failOn: Severity.optional(),
    })
    .optional(),
  /** Comment limits: a repository may only lower the cap or raise the inline severity floor. */
  publish: z.object({ maxInlineComments: z.number().int().nonnegative().optional(), minInlineSeverity: Severity.optional() }).optional(),
  /** Optional Validators to turn on, by id. */
  validators: z.object({ enable: z.array(z.string().max(100)).max(50).optional() }).optional(),
  /** false asks automatic reviews to skip this repository (manual reviews still run). */
  automatedReview: z.boolean().optional(),
})
export type RepoSettings = z.infer<typeof RepoSettings>

const ALLOWED: Record<string, readonly string[] | true> = {
  version: true,
  reviewRules: true,
  paths: ['include', 'exclude'],
  thresholds: ['failOn'],
  publish: ['maxInlineComments', 'minInlineSeverity'],
  validators: ['enable'],
  automatedReview: true,
}

export interface RepoConfigResult {
  settings: RepoSettings
  /** Dotted keys that were present but not allowed, or invalid; listed in the Report. */
  ignored: string[]
  warnings: string[]
}

/** Parses `.github/pr-reviewer.yml` against the allow-list. Unknown or forbidden keys are ignored and reported. */
export function parseRepoConfig(text: string | undefined): RepoConfigResult {
  if (text === undefined) return { settings: {}, ignored: [], warnings: [] }
  let raw: unknown
  try {
    raw = parse(text, { schema: 'core', maxAliasCount: 50 })
  } catch (e) {
    return { settings: {}, ignored: [], warnings: [`${REPO_CONFIG_PATH} could not be parsed and was ignored: ${(e as Error).message.split('\n')[0]}`] }
  }
  if (raw === null || raw === undefined) return { settings: {}, ignored: [], warnings: [] }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { settings: {}, ignored: [], warnings: [`${REPO_CONFIG_PATH} is not a mapping and was ignored.`] }
  const obj = raw as Record<string, unknown>
  const warnings: string[] = []
  if (obj.version !== undefined && obj.version !== 1) {
    return { settings: {}, ignored: [], warnings: [`${REPO_CONFIG_PATH} has version ${String(obj.version)}, which this release does not understand; it was treated as absent.`] }
  }

  const ignored: string[] = []
  const kept: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    const allowed = ALLOWED[key]
    if (!allowed) {
      ignored.push(key)
      continue
    }
    if (key === 'version') continue
    if (allowed === true || typeof value !== 'object' || value === null || Array.isArray(value)) {
      kept[key] = value
      continue
    }
    const sub: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (allowed.includes(k)) sub[k] = v
      else ignored.push(`${key}.${k}`)
    }
    kept[key] = sub
  }

  // Validate each allowed key on its own so one bad value doesn't drop the rest.
  const settings: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(kept)) {
    const one = RepoSettings.safeParse({ [key]: value })
    if (one.success) Object.assign(settings, one.data)
    else {
      ignored.push(key)
      warnings.push(`${REPO_CONFIG_PATH}: "${key}" is invalid and was ignored (${one.error.issues[0]?.message ?? 'invalid'}).`)
    }
  }
  return { settings: settings as RepoSettings, ignored, warnings }
}

/** Applies include/exclude path patterns; returns the kept paths. */
export function filterPaths(paths: readonly string[], rules: RepoSettings['paths']): string[] {
  const include = (rules?.include ?? []).map(globToRegExp)
  const exclude = (rules?.exclude ?? []).map(globToRegExp)
  return paths.filter((p) => (include.length === 0 || include.some((r) => r.test(p))) && !exclude.some((r) => r.test(p)))
}
