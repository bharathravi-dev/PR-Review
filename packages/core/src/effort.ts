// Adaptive effort (roadmap item 5): a quick pass for small, low-risk changes and a deeper one for risky changes.
import type { Finding } from './findings.js'
import type { PrContext } from './schemas.js'

export type EffortLevel = 'light' | 'standard' | 'deep'
export type EffortSetting = EffortLevel | 'adaptive'

export interface EffortChoice {
  level: EffortLevel
  reasons: string[]
}

/** Paths where a mistake tends to be costly: access control, secrets, money, data migrations, build and deploy. */
const SENSITIVE = /(^|[/._-])(auth|authn|authz|authenticat\w*|authori[sz]\w*|login|logout|session|tokens?|crypto\w*|security|permissions?|acl|rbac|payments?|billing|secrets?|passwords?|oauth|jwt|sso|saml|migrations?)([/._-]|$)|^\.github\/workflows\/|(^|\/)Dockerfile[^/]*$|\.tf$|(^|\/)nginx[^/]*\.conf$/i
const DOCS = /\.(md|mdx|txt|rst|adoc|png|jpe?g|gif|svg|webp|ico)$|(^|\/)(LICENSE|CHANGELOG|AUTHORS|CODEOWNERS)[^/]*$/i
const TESTS = /(^|\/)(__tests__|tests?|spec)\/|\.(test|spec)\.[a-z0-9]+$|_test\.(go|py)$/i
const SMALL_LINES = 40
const LIGHT_LINES = 200

/** Chooses how hard to look at a PR from its files, its size, and what the deterministic checks found. */
export function chooseEffort(ctx: Pick<PrContext, 'files'>, deterministic: readonly Finding[]): EffortChoice {
  const lines = ctx.files.reduce((n, f) => n + f.additions + f.deletions, 0)
  const sensitive = ctx.files.map((f) => f.path).filter((p) => SENSITIVE.test(p))
  const serious = deterministic.filter((f) => f.scope !== 'PRE_EXISTING' && (f.severity === 'BLOCKER' || f.severity === 'CRITICAL'))
  const deep: string[] = []
  if (sensitive.length) deep.push(`touches sensitive files (${sensitive.slice(0, 3).join(', ')}${sensitive.length > 3 ? `, +${sensitive.length - 3} more` : ''})`)
  if (serious.length) deep.push(`${serious.length} blocker or critical finding(s) from the checks`)
  if (deep.length) return { level: 'deep', reasons: deep }
  const docsOnly = ctx.files.length > 0 && ctx.files.every((f) => DOCS.test(f.path))
  const testsOrDocs = ctx.files.length > 0 && ctx.files.every((f) => DOCS.test(f.path) || TESTS.test(f.path))
  if (docsOnly) return { level: 'light', reasons: ['documentation only'] }
  if (testsOrDocs && lines <= LIGHT_LINES) return { level: 'light', reasons: [`tests and documentation only, ${lines} line(s)`] }
  if (lines <= SMALL_LINES) return { level: 'light', reasons: [`small change, ${lines} line(s)`] }
  return { level: 'standard', reasons: [`${ctx.files.length} file(s), ${lines} line(s)`] }
}

/** The trusted instruction added to the review for this effort (none for standard). */
export function effortRule(choice: EffortChoice): string | undefined {
  if (choice.level === 'light') return `This is a small, low-risk change (${choice.reasons.join('; ')}). Report only clear defects; leave out minor suggestions.`
  if (choice.level === 'deep') return `This change needs extra care (${choice.reasons.join('; ')}). Check authentication and authorisation, input validation, secrets handling, data exposure, error handling and failure modes carefully.`
  return undefined
}
