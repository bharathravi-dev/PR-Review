import type { Category, Finding, Severity, Validator } from '@pr-reviewer/core'
import { finding } from './util.js'

function parseProjectKey(properties: string | undefined): string | undefined {
  if (!properties) return undefined
  for (const raw of properties.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^sonar\.projectKey\s*=\s*(.+)$/.exec(line)
    if (m) return m[1]!.trim()
  }
  return undefined
}

function mapSeverity(raw: string): Severity {
  switch (raw.toUpperCase()) {
    case 'BLOCKER':
      return 'BLOCKER'
    case 'CRITICAL':
      return 'CRITICAL'
    case 'MAJOR':
      return 'MAJOR'
    case 'MINOR':
      return 'MINOR'
    default:
      return 'INFO'
  }
}

function mapCategory(type: string | undefined): Category {
  switch (type?.toUpperCase()) {
    case 'VULNERABILITY':
    case 'SECURITY_HOTSPOT':
      return 'SECURITY'
    case 'BUG':
      return 'CORRECTNESS'
    default:
      return 'MAINTAINABILITY'
  }
}

function componentPath(component: string): string | undefined {
  const idx = component.indexOf(':')
  const p = idx >= 0 ? component.slice(idx + 1) : component
  return p || undefined
}

/** Queries SonarQube / SonarCloud REST API directly for quality gate status and PR issues. */
export const sonarApiValidator: Validator = {
  id: 'sonar.api',
  version: '1',
  layers: ['STATIC_ANALYSIS'],
  needsSandbox: false,
  baseline: false,
  hermetic: false,
  supports: () => ({ applicable: true }),
  async run(ctx, ports) {
    if (!ports.sonar) {
      return {
        layers: [
          {
            layer: 'STATIC_ANALYSIS',
            status: 'NOT_APPLICABLE',
            reason: 'NOT_SUPPORTED',
            detail: 'SonarQube API not configured (set SONAR_HOST_URL and SONAR_TOKEN to enable).',
          },
        ],
        findings: [],
      }
    }
    const props = await ctx.files.read('sonar-project.properties', 'HEAD').catch(() => undefined)
    const projectKey = parseProjectKey(props) ?? ports.sonar.defaultProjectKey ?? `${ctx.pr.ref.owner}_${ctx.pr.ref.repo}`
    const res = await ports.sonar.fetchPullRequest({ projectKey, pullRequest: ctx.pr.ref.number, branch: ctx.pr.headRef })
    if (!res.ok) {
      return {
        layers: [{ layer: 'STATIC_ANALYSIS', status: 'ERROR', reason: 'TOOL_CRASHED', detail: res.error.message }],
        findings: [],
      }
    }
    const report = res.value
    const prPaths = new Set(ctx.pr.files.filter((f) => f.status !== 'removed').map((f) => f.path))
    const findings: Finding[] = report.issues.map((issue) => {
      const path = componentPath(issue.component)
      const validLine = path && prPaths.has(path) && issue.line !== undefined && issue.line >= 1
      return {
        ruleId: `sonar/${issue.rule}`,
        category: mapCategory(issue.type),
        severity: mapSeverity(issue.severity),
        confidence: 'HIGH',
        scope: 'NEW',
        sourceFamily: 'EXTERNAL',
        title: issue.message,
        description: `SonarQube rule \`${issue.rule}\`${issue.type ? ` (${issue.type})` : ''}: ${issue.message}`,
        location: validLine ? { anchorKind: 'LINE', path, startLine: issue.line, endLine: issue.line } : path ? { anchorKind: 'FILE', path } : { anchorKind: 'PR' },
        provenance: { validator: 'sonar.api', tool: 'sonarqube', ...(report.url ? { url: report.url } : {}) },
      }
    })
    const status = report.qualityGateStatus === 'ERROR' ? 'FAILED' : report.qualityGateStatus === 'WARN' || findings.length > 0 ? 'WARNING' : 'PASSED'
    const detailParts = [
      `Quality gate: ${report.qualityGateStatus}`,
      `${findings.length} open issue(s) on PR`,
      report.url ?? '',
    ].filter(Boolean)
    return {
      layers: [{ layer: 'STATIC_ANALYSIS', status, detail: `${detailParts.join(' · ')}.` }],
      findings,
    }
  },
}
