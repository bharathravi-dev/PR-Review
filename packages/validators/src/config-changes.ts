// Flags changes to what runs on build, install, or CI (FR-39, Story 4.5). File-only; no Sandbox.
import { REPO_CONFIG_PATH, REPO_RULES_DIR, type Finding, type Validator } from '@pr-reviewer/core'
import { finding } from './util.js'

const RULES: Array<{ test: RegExp; what: string; security: boolean }> = [
  { test: /^\.github\/(workflows|actions)\//, what: 'a GitHub Actions workflow or action', security: true },
  { test: /(^|\/)\.npmrc$|(^|\/)\.yarnrc(\.yml)?$|(^|\/)\.pnpmfile\.cjs$/, what: 'package manager settings (registries, tokens, hooks)', security: true },
  { test: /(^|\/)(Dockerfile|docker-compose[^/]*\.ya?ml|Containerfile)$/, what: 'a container build file', security: true },
  { test: /(^|\/)(Makefile|Jenkinsfile|\.gitlab-ci\.yml|azure-pipelines\.yml|\.circleci\/config\.yml)$/, what: 'a build or CI script', security: true },
  { test: /(^|\/)\.husky\//, what: 'a git hook', security: true },
  { test: /(^|\/)tsconfig[^/]*\.json$/, what: 'TypeScript compiler settings', security: false },
  { test: /(^|\/)(\.eslintrc[^/]*|eslint\.config\.[cm]?[jt]s|tslint\.json|\.prettierrc[^/]*)$/, what: 'lint settings', security: false },
  { test: /(^|\/)(angular\.json|webpack\.config\.[cm]?[jt]s|vite\.config\.[cm]?[jt]s|rollup\.config\.[cm]?[jt]s|babel\.config\.[cm]?[jt]s|\.babelrc|jest\.config\.[cm]?[jt]s|karma\.conf\.js)$/, what: 'build or test tool settings', security: false },
  { test: /(^|\/)(\.nvmrc|\.node-version)$/, what: 'the Node.js version', security: false },
]

export const configChangesValidator: Validator = {
  id: 'repo.build-config-changes',
  version: '1',
  layers: ['SECURITY'],
  needsSandbox: false,
  baseline: false,
  hermetic: true,
  supports: () => ({ applicable: true }),
  async run(ctx) {
    const findings: Finding[] = []
    for (const file of ctx.pr.files) {
      const path = file.path
      const at = { anchorKind: 'FILE' as const, path }
      if (path === REPO_CONFIG_PATH || path.startsWith(REPO_RULES_DIR)) {
        findings.push(
          finding({
            ruleId: 'repo/pr-reviewer-settings-changed',
            category: 'BUILD',
            severity: 'INFO',
            confidence: 'HIGH',
            title: 'PR changes this repository\'s PR Reviewer settings',
            description: 'The settings and rules are read from the base branch, so this change does not affect the review of this PR; it applies after merge.',
            location: at,
            provenance: { validator: 'repo.build-config-changes' },
          }),
        )
        continue
      }
      if (/(^|\/)package\.json$/.test(path)) {
        const scripts = changedScripts(file.base?.text, file.head?.text)
        if (scripts.length > 0) {
          const lifecycle = scripts.filter((s) => /^(pre|post)?(install|prepare|publish|pack)$/.test(s))
          findings.push(
            finding({
              ruleId: 'repo/package-scripts-changed',
              category: lifecycle.length ? 'SECURITY' : 'BUILD',
              severity: lifecycle.length ? 'MAJOR' : 'MINOR',
              confidence: 'HIGH',
              title: `PR changes package scripts: ${scripts.join(', ')}`,
              description: lifecycle.length
                ? `${lifecycle.join(', ')} run automatically on install, on every developer machine and CI runner. Review exactly what they execute.`
                : 'These scripts run in builds, tests, or CI. Review what they execute.',
              location: at,
              provenance: { validator: 'repo.build-config-changes' },
            }),
          )
        }
        continue
      }
      const rule = RULES.find((r) => r.test.test(path))
      if (!rule) continue
      findings.push(
        finding({
          ruleId: rule.security ? 'repo/ci-config-changed' : 'repo/tool-config-changed',
          category: rule.security ? 'SECURITY' : 'BUILD',
          severity: rule.security ? 'MINOR' : 'INFO',
          confidence: 'HIGH',
          title: `PR changes ${rule.what}`,
          description: rule.security
            ? `${path} controls what runs in builds or CI, with access to their secrets. Review it as code.`
            : `${path} changes how the project is built or checked; results of this review's checks may differ from before.`,
          location: at,
          provenance: { validator: 'repo.build-config-changes' },
        }),
      )
    }
    return {
      layers: [{ layer: 'SECURITY', status: findings.some((f) => f.category === 'SECURITY') ? 'WARNING' : 'PASSED', detail: findings.length ? `${findings.length} build, tool, or CI configuration change(s).` : 'No build, tool, or CI configuration changed.' }],
      findings,
    }
  },
}

function changedScripts(base: string | undefined, head: string | undefined): string[] {
  const scripts = (t: string | undefined): Record<string, unknown> => {
    try {
      return ((JSON.parse(t ?? '{}') as { scripts?: Record<string, unknown> }).scripts ?? {}) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  const a = scripts(base)
  const b = scripts(head)
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort()
}
