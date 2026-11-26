import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ENGINE_VERSION, prFromUrl, runStandaloneReview } from './compose.js'
import { deviceStartProblem } from './compose.js'

const GH = 'https://api.github.com/repos/octo/app'
const LEAKED = ['AK', 'IA', 'QWERTYUIOPASDFGH'].join('')
const pull = { title: 'Add retry', body: '', user: { login: 'dev' }, state: 'open', draft: false, base: { ref: 'main', sha: 'base0001', repo: { full_name: 'octo/app' } }, head: { ref: 'retry', sha: 'head0002', repo: { full_name: 'octo/app' } } }
const patch = `@@ -1,2 +1,4 @@\n export const n = 1\n+export const retries = 3\n+export const awsKey = "${LEAKED}"\n export const m = 2`
const aiFinding = { category: 'CORRECTNESS', severity: 'MAJOR', confidence: 'MEDIUM', title: 'Retries without backoff', description: 'Retrying immediately can amplify load.', impact: null, recommendation: 'Add backoff.', path: 'src/retry.ts', startLine: 2, endLine: 2 }

function fakeFetch(aiBodies: string[]) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init)
    const url = req.url
    if (url.startsWith('https://api.anthropic.com/')) {
      aiBodies.push(await req.text())
      return Response.json({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: JSON.stringify({ findings: [aiFinding] }) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 900, output_tokens: 40 } })
    }
    if (url.startsWith('https://api.osv.dev/')) return Response.json({ results: [] })
    const routes: Record<string, unknown> = {
      'https://api.github.com/user': { id: 7, login: 'tom' },
      [`${GH}/pulls/9`]: pull,
      [`${GH}/compare/base0001...head0002?per_page=1`]: { merge_base_commit: { sha: 'mb000003' } },
      [`${GH}/pulls/9/files?per_page=100`]: [{ filename: 'src/retry.ts', status: 'modified', additions: 2, deletions: 0, changes: 2, patch }],
      [`${GH}/pulls/9/reviews?per_page=100`]: [],
      [`${GH}/pulls/9/comments?per_page=100`]: [],
      [`${GH}/issues/9/comments?per_page=100`]: [],
    }
    if (url === `${GH}/contents/src/retry.ts?ref=head0002`) return new Response(`export const n = 1\nexport const retries = 3\nexport const awsKey = "${LEAKED}"\nexport const m = 2\n`)
    if (url === `${GH}/contents/src/retry.ts?ref=mb000003`) return new Response('export const n = 1\nexport const m = 2\n')
    return url in routes ? Response.json(routes[url]) : new Response('{}', { status: 404 })
  }) as typeof fetch
}

describe('extension Standalone engine (Story 7.1)', () => {
  it('reviews a PR in the page with the user key: AI findings, secrets kept out of the AI, Sandbox checks skipped', async () => {
    const aiBodies: string[] = []
    const events: string[] = []
    const report = await runStandaloneReview({
      pr: 'https://github.com/octo/app/pull/9',
      settings: { githubToken: 'gh-test-token-0000', provider: { type: 'anthropic', apiKey: ['sk-ant-', 'test-', 'key-0123456789abcdefghij'].join('') } },
      fetch: fakeFetch(aiBodies),
      onEvent: (e) => events.push(e.type),
    })
    expect(report.run.channel).toBe('EXTENSION_STANDALONE')
    expect(report.findings.map((f) => f.title)).toContain('Retries without backoff')
    // The leaked key is a critical finding, so adaptive effort reviews deeply: review plus verification, neither sees it.
    expect(report.effort?.level).toBe('deep')
    expect(aiBodies).toHaveLength(2)
    for (const body of aiBodies) expect(body).not.toContain(LEAKED)
    expect(events[0]).toBe('STAGE_STARTED')
    expect(events.at(-1)).toBe('DONE')
    expect(report.findings.some((f) => f.category === 'SECRET')).toBe(true)
  })

  it('reads the PR from the tab URL only, on the configured host', () => {
    expect(prFromUrl('https://github.com/octo/app/pull/9/files')).toEqual({ owner: 'octo', repo: 'app', number: 9 })
    expect(prFromUrl('https://github.com/octo/app/pull/9')).toEqual({ owner: 'octo', repo: 'app', number: 9 })
    expect(prFromUrl('https://github.com/octo/app/issues/9')).toBeUndefined()
    expect(prFromUrl('http://github.com/octo/app/pull/9')).toBeUndefined()
    expect(prFromUrl('https://ghe.example.com/a/b/pull/3', 'ghe.example.com')).toEqual({ owner: 'a', repo: 'b', number: 3 })
    expect(prFromUrl('not a url')).toBeUndefined()
  })

  it('records the same engine version as the CLI', () => {
    const cli = JSON.parse(readFileSync(new URL('../../cli/package.json', import.meta.url), 'utf8')) as { version: string }
    expect(ENGINE_VERSION).toBe(cli.version)
  })
})

describe('device sign-in problems', () => {
  it('says how to fix an OAuth app without device flow or with a wrong client ID', () => {
    expect(deviceStartProblem('device_flow_disabled', 400)).toContain('Enable Device Flow')
    expect(deviceStartProblem('incorrect_client_credentials', 400)).toContain('oauth.json')
    expect(deviceStartProblem(undefined, 503)).toContain('(503)')
  })
})
