import { describe, expect, it } from 'vitest'
import { createSonarPort } from './sonar.js'

describe('createSonarPort', () => {
  it('fetches SonarQube quality gate status and PR issues with Basic auth', async () => {
    const seen: Array<{ url: string; auth?: string }> = []
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = String(input)
      const headers = (init?.headers ?? {}) as Record<string, string>
      seen.push({ url, auth: headers.authorization })
      if (url.includes('/api/qualitygates/project_status')) {
        return new Response(JSON.stringify({ projectStatus: { status: 'ERROR', conditions: [{ metricKey: 'new_bugs', status: 'ERROR' }] } }), { status: 200 })
      }
      return new Response(
        JSON.stringify({
          issues: [{ key: 'k1', rule: 'ts:S1', severity: 'MAJOR', type: 'BUG', message: 'Null deref', component: 'proj:src/a.ts', line: 9 }],
        }),
        { status: 200 },
      )
    }

    const sonar = createSonarPort({ hostUrl: 'https://sonar.example.com/', token: 'squ_secret', projectKey: 'proj', fetch: fakeFetch })
    const res = await sonar.fetchPullRequest({ projectKey: 'proj', pullRequest: 12 })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.qualityGateStatus).toBe('ERROR')
    expect(res.value.issues).toEqual([
      { key: 'k1', rule: 'ts:S1', severity: 'MAJOR', type: 'BUG', message: 'Null deref', component: 'proj:src/a.ts', line: 9 },
    ])
    expect(seen[0]?.auth).toBe(`Basic ${Buffer.from('squ_secret:', 'utf8').toString('base64')}`)
  })
})
