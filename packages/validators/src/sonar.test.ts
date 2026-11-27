import { ok, type FileAccessor, type PrContext, type SonarPort, type ValidatorContext } from '@pr-reviewer/core'
import { describe, expect, it } from 'vitest'
import { sonarApiValidator } from './sonar.js'

function makeCtx(propsText?: string): ValidatorContext {
  const pr: PrContext = {
    schemaVersion: 1,
    ref: { host: 'github.com', owner: 'acme', repo: 'web', number: 42 },
    title: 'Fix auth',
    body: '',
    author: 'dev',
    state: 'open',
    draft: false,
    baseRef: 'main',
    headRef: 'fix-auth',
    baseSha: 'b',
    headSha: 'h',
    mergeBaseSha: 'm',
    fromFork: false,
    files: [{ path: 'src/auth.ts', status: 'modified', additions: 4, deletions: 1, binary: false, patchTruncated: false }],
    reviews: [],
    reviewComments: [],
    issueComments: [],
    truncated: [],
  }
  const files: FileAccessor = {
    read: async (path) => (path === 'sonar-project.properties' ? propsText : undefined),
    list: async () => undefined,
    exists: async () => false,
    notes: () => [],
  }
  return { pr, files, projects: [], checks: [], repoSettings: {}, sandbox: new Map() }
}

describe('sonarApiValidator', () => {
  it('returns NOT_APPLICABLE when no SonarQube API port is configured', async () => {
    const out = await sonarApiValidator.run(makeCtx(), { now: () => 0 })
    expect(out.layers[0]).toMatchObject({ layer: 'STATIC_ANALYSIS', status: 'NOT_APPLICABLE', reason: 'NOT_SUPPORTED' })
    expect(out.findings).toEqual([])
  })

  it('imports SonarQube quality gate failures and PR issues using sonar-project.properties', async () => {
    const seen: Array<{ projectKey: string; pullRequest: number }> = []
    const sonar: SonarPort = {
      hostUrl: 'https://sonar.example.com',
      async fetchPullRequest(opts) {
        seen.push(opts)
        return ok({
          qualityGateStatus: 'ERROR',
          url: 'https://sonar.example.com/dashboard?id=acme-web-key&pullRequest=42',
          issues: [
            { key: 'AX1', rule: 'typescript:S3649', severity: 'CRITICAL', type: 'VULNERABILITY', message: 'SQL injection sink', component: 'acme-web-key:src/auth.ts', line: 12 },
          ],
        })
      },
    }
    const out = await sonarApiValidator.run(makeCtx('sonar.projectKey=acme-web-key\n'), { now: () => 0, sonar })
    expect(seen).toEqual([{ projectKey: 'acme-web-key', pullRequest: 42, branch: 'fix-auth' }])
    expect(out.layers[0]).toMatchObject({ layer: 'STATIC_ANALYSIS', status: 'FAILED' })
    expect(out.layers[0]!.detail).toContain('Quality gate: ERROR')
    expect(out.findings[0]).toMatchObject({
      ruleId: 'sonar/typescript:S3649',
      category: 'SECURITY',
      severity: 'CRITICAL',
      sourceFamily: 'EXTERNAL',
      location: { anchorKind: 'LINE', path: 'src/auth.ts', startLine: 12, endLine: 12 },
    })
  })
})
