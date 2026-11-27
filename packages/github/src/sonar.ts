import { err, ok, type Result, type SonarIssue, type SonarPort, type SonarReport } from '@pr-reviewer/core'

export interface SonarOptions {
  hostUrl: string
  token?: string | undefined
  projectKey?: string | undefined
  fetch: typeof fetch
  userAgent?: string | undefined
}

function authHeader(token: string): string {
  // SonarQube Web API uses Basic <base64(token:)> or Bearer for newer Cloud/Server tokens.
  const basic = Buffer.from(`${token}:`, 'utf8').toString('base64')
  return `Basic ${basic}`
}

/** Direct SonarQube / SonarCloud REST API client behind `SonarPort`. */
export function createSonarPort(opts: SonarOptions): SonarPort {
  const hostUrl = opts.hostUrl.replace(/\/+$/, '')
  const headers: Record<string, string> = {
    accept: 'application/json',
    'user-agent': opts.userAgent ?? 'pr-reviewer',
    ...(opts.token ? { authorization: authHeader(opts.token) } : {}),
  }

  return {
    hostUrl,
    ...(opts.projectKey ? { defaultProjectKey: opts.projectKey } : {}),
    async fetchPullRequest({ projectKey, pullRequest }) {
      const qgUrl = `${hostUrl}/api/qualitygates/project_status?projectKey=${encodeURIComponent(projectKey)}&pullRequest=${encodeURIComponent(String(pullRequest))}`
      const issuesUrl = `${hostUrl}/api/issues/search?componentKeys=${encodeURIComponent(projectKey)}&pullRequest=${encodeURIComponent(String(pullRequest))}&resolved=false&ps=100`
      try {
        const [qgRes, issuesRes] = await Promise.all([
          opts.fetch(qgUrl, { headers }),
          opts.fetch(issuesUrl, { headers }),
        ])
        if (!qgRes.ok) {
          return err('sonar_api_error', `SonarQube quality gate API returned HTTP ${qgRes.status} for ${projectKey}#${pullRequest}.`)
        }
        const qgJson = (await qgRes.json()) as {
          projectStatus?: {
            status?: string
            conditions?: Array<{ metricKey?: string; status?: string; actualValue?: string; errorThreshold?: string }>
          }
        }
        const statusRaw = qgJson.projectStatus?.status ?? 'NONE'
        const qualityGateStatus: SonarReport['qualityGateStatus'] =
          statusRaw === 'OK' || statusRaw === 'WARN' || statusRaw === 'ERROR' ? statusRaw : 'NONE'
        const conditions = qgJson.projectStatus?.conditions?.map((c) => ({
          metricKey: c.metricKey ?? 'unknown',
          status: c.status ?? 'NONE',
          ...(c.actualValue !== undefined ? { actualValue: c.actualValue } : {}),
          ...(c.errorThreshold !== undefined ? { errorThreshold: c.errorThreshold } : {}),
        }))

        const issues: SonarIssue[] = []
        if (issuesRes.ok) {
          const issuesJson = (await issuesRes.json()) as {
            issues?: Array<{ key?: string; rule?: string; severity?: string; message?: string; component?: string; line?: number; type?: string }>
          }
          for (const raw of issuesJson.issues ?? []) {
            if (!raw.key || !raw.message) continue
            issues.push({
              key: raw.key,
              rule: raw.rule ?? 'sonar:unknown',
              severity: raw.severity ?? 'MAJOR',
              message: raw.message,
              component: raw.component ?? '',
              ...(typeof raw.line === 'number' ? { line: raw.line } : {}),
              ...(raw.type ? { type: raw.type } : {}),
            })
          }
        }
        const url = `${hostUrl}/dashboard?id=${encodeURIComponent(projectKey)}&pullRequest=${encodeURIComponent(String(pullRequest))}`
        return ok({ qualityGateStatus, ...(conditions ? { conditions } : {}), issues, url })
      } catch (e) {
        return err('sonar_unreachable', `SonarQube API request failed: ${(e as Error).message}`)
      }
    },
  }
}
