import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DefaultCredentialResolver } from '@pr-reviewer/credentials'
import { afterEach, describe, expect, it } from 'vitest'
import { main } from './main.js'
import { loadReviewRules } from './rules-loader.js'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'prr-rules-'))
  dirs.push(d)
  return d
}

const remote = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input)
  return url === 'https://rules.example.com/team.md' ? new Response('# Team\n- Remote rule one\n') : new Response('nope', { status: 404 })
}) as typeof fetch

describe('loadReviewRules', () => {
  it('reads files relative to the config file and https URLs, and warns on anything unreadable', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'local.md'), '- Local rule\n- Remote rule one\n')
    const r = await loadReviewRules(['local.md', 'https://rules.example.com/team.md', 'http://rules.example.com/x.md', 'missing.md', 'https://rules.example.com/404.md'], {
      configPath: join(dir, 'config.yml'),
      homedir: dir,
      fetch: remote,
    })
    expect(r.rules).toEqual(['Local rule', 'Remote rule one'])
    expect(r.warnings).toHaveLength(3)
    expect(r.warnings[0]).toContain('only https:// URLs are allowed')
    expect(r.warnings[1]).toContain('missing.md could not be read')
    expect(r.warnings[2]).toContain('HTTP 404')
  })
})

describe('review with Review Rules', () => {
  it('lists the rules in the Report checklist and reports unreadable sources as limitations', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'team.md'), '# Rules\n- No debug leftovers.\n- Errors are handled.\n')
    writeFileSync(join(dir, 'config.yml'), 'version: 1\nreviewRules:\n  - team.md\n  - gone.md\n')
    const GH = 'https://api.github.com/repos/octo/app'
    const fake = (async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url === `${GH}/pulls/9`) return Response.json({ title: 't', body: '', user: { login: 'dev' }, state: 'open', draft: false, base: { ref: 'main', sha: 'b1', repo: { id: 1, full_name: 'octo/app' } }, head: { ref: 'f', sha: 'h1', repo: { id: 1, full_name: 'octo/app' } } })
      if (url.startsWith(`${GH}/compare/`)) return Response.json({ merge_base_commit: { sha: 'm1' } })
      if (url.includes('/files?') || url.includes('/reviews?') || url.includes('/comments?')) return Response.json([])
      return new Response('{}', { status: 404 })
    }) as typeof fetch
    let out = ''
    const env = { PR_REVIEWER_CONFIG: join(dir, 'config.yml') }
    await main(['review', 'octo/app#9', '--json'], { stdout: (t) => (out += t), stderr: () => {} }, {
      env,
      fetch: fake,
      credentials: new DefaultCredentialResolver({ env, keychain: async () => undefined, ghToken: async () => undefined }),
    })
    const report = JSON.parse(out)
    expect(report.rulesChecklist).toEqual(['No debug leftovers.', 'Errors are handled.'])
    expect(report.limitations.join('\n')).toContain('gone.md could not be read')
  })
})
