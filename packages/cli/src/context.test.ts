import { describe, expect, it } from 'vitest'
import { DefaultCredentialResolver } from '@pr-reviewer/credentials'
import { main } from './main.js'

const API = 'https://api.github.com'
const pull = {
  title: 'Fix bug', body: 'x', user: { login: 'dev' }, state: 'open', draft: true,
  base: { ref: 'main', sha: 'aaaaaaa1', repo: { full_name: 'octo/app' } },
  head: { ref: 'fix', sha: 'bbbbbbb2', repo: { full_name: 'octo/app' } },
}

function fakeFetch(seen: string[] = []) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    seen.push(`${url} auth=${(init?.headers as Record<string, string>)?.authorization ?? '-'}`)
    const routes: Record<string, unknown> = {
      [`${API}/repos/octo/app/pulls/5`]: pull,
      [`${API}/repos/octo/app/compare/aaaaaaa1...bbbbbbb2?per_page=1`]: { merge_base_commit: { sha: 'ccccccc3' } },
      [`${API}/repos/octo/app/pulls/5/files?per_page=100`]: [],
      [`${API}/repos/octo/app/pulls/5/reviews?per_page=100`]: [],
      [`${API}/repos/octo/app/pulls/5/comments?per_page=100`]: [],
      [`${API}/repos/octo/app/issues/5/comments?per_page=100`]: [],
    }
    return url in routes ? new Response(JSON.stringify(routes[url])) : new Response('{}', { status: 404 })
  }) as typeof fetch
}

async function run(argv: string[], env: Record<string, string> = {}, seen: string[] = []) {
  let out = ''
  let err = ''
  const credentials = new DefaultCredentialResolver({ env, keychain: async () => undefined, ghToken: async () => undefined })
  const code = await main(argv, { stdout: (t) => (out += t), stderr: (t) => (err += t) }, { env: { PR_REVIEWER_CONFIG: '/nonexistent/config.yml', ...env }, fetch: fakeFetch(seen), credentials })
  return { code, out, err }
}

describe('pr-reviewer context', () => {
  it('prints a summary for owner/repo#n using GITHUB_TOKEN', async () => {
    const seen: string[] = []
    const r = await run(['context', 'octo/app#5'], { GITHUB_TOKEN: 'tok' }, seen)
    expect(r.code).toBe(0)
    expect(r.out).toContain('octo/app#5  Fix bug')
    expect(r.out).toContain('(draft)')
    expect(r.out).toContain('merge-base ccccccc')
    expect(seen.every((s) => s.endsWith('auth=Bearer tok'))).toBe(true)
  })

  it('prints schema-shaped JSON with --json and accepts a PR URL', async () => {
    const r = await run(['context', 'https://github.com/octo/app/pull/5', '--json'], { GH_TOKEN: 'g' })
    expect(r.code).toBe(0)
    expect(JSON.parse(r.out)).toMatchObject({ schemaVersion: 1, headSha: 'bbbbbbb2', mergeBaseSha: 'ccccccc3', files: [] })
  })

  it('uses --api-url instead of the derived host', async () => {
    const seen: string[] = []
    const r = await run(['context', 'octo/app#5', '--api-url', 'https://proxy.example.com'], {}, seen)
    expect(r.code).toBe(4)
    expect(seen[0]).toContain('https://proxy.example.com/repos/octo/app/pulls/5')
  })

  it('exits 4 with the permission hint when GitHub denies access', async () => {
    const r = await run(['context', 'octo/app#9'])
    expect(r.code).toBe(4)
    expect(r.err).toContain('Could not load octo/app#9')
    expect(r.err).toContain('No GitHub token was found')
  })

  it('never prints the token, even when an error message contains it', async () => {
    const boom = (async () => { throw new Error('socket closed for Bearer sekret-token-123') }) as typeof fetch
    let out = ''
    let err = ''
    const credentials = new DefaultCredentialResolver({ env: { GITHUB_TOKEN: 'sekret-token-123' }, keychain: async () => undefined, ghToken: async () => undefined })
    const code = await main(['context', 'octo/app#5'], { stdout: (t) => (out += t), stderr: (t) => (err += t) }, { env: { PR_REVIEWER_CONFIG: '/nonexistent/c.yml' }, fetch: boom, credentials })
    expect(code).toBe(4)
    expect(err).toContain('[REDACTED]')
    expect(out + err).not.toContain('sekret-token-123')
  })

  it('exits 64 for missing or invalid references and unknown options', async () => {
    expect((await run(['context'])).code).toBe(64)
    expect((await run(['context', 'not-a-pr'])).code).toBe(64)
    expect((await run(['context', 'octo/app#5', '--frob'])).code).toBe(64)
  })
})
