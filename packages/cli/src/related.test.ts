import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DefaultCredentialResolver } from '@pr-reviewer/credentials'
import { afterEach, describe, expect, it } from 'vitest'
import { main } from './main.js'

const GH = 'https://api.github.com/repos/octo/app'
const TOKEN = ['gh-test-', 'token-abcdef'].join('')
const AI_KEY = ['sk-ant-', 'test-', 'key-0123456789abcdefghij'].join('')
const AWS = ['AK', 'IA', 'QWERTYUIOPASDFGH'].join('')
const PEM = ['-----BEGIN RSA PRIVATE', 'KEY-----'].join(' ')

const pull = {
  title: 'More retries',
  body: '',
  user: { login: 'dev' },
  state: 'open',
  draft: false,
  base: { ref: 'main', sha: 'base0001', repo: { full_name: 'octo/app' } },
  head: { ref: 'retry', sha: 'head0002', repo: { full_name: 'octo/app' } },
}
const HEAD: Record<string, string> = {
  'src/retry.ts': "import { fetchJson } from './net.js'\nexport const retries = 5\nexport const go = () => fetchJson('/x')\n",
  'src/net.ts': 'export async function fetchJson(url: string) {\n  return fetch(url)\n}\n',
  // A caller with a credential in it: it may be shown, but never with the credential.
  'src/client.ts': `import { retries } from './retry.js'\nconst awsKey = "${AWS}"\nexport const attempts = retries + 1\n`,
  // A caller holding a private key is left out entirely.
  'src/keys.ts': `import { retries } from './retry.js'\nexport const n = retries\nconst pem = \`${PEM}\nMIIEow\`\n`,
}
const patch = "@@ -1,2 +1,3 @@\n import { fetchJson } from './net.js'\n-export const retries = 3\n+export const retries = 5\n+export const go = () => fetchJson('/x')"

function fakeFetch(aiBodies: string[]) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init)
    const url = req.url
    if (url.startsWith('https://api.anthropic.com/')) {
      aiBodies.push(await req.text())
      return Response.json({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: JSON.stringify({ findings: [] }) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 9, output_tokens: 4 } })
    }
    if (url === `${GH}/git/trees/head0002?recursive=1`) return Response.json({ sha: 't', truncated: false, tree: Object.keys(HEAD).map((path, i) => ({ path, type: 'blob', sha: `b${i}` })) })
    const contents = /\/contents\/(.+)\?ref=(\w+)$/.exec(url)
    if (contents) {
      const [path, ref] = [decodeURIComponent(contents[1]!), contents[2]]
      if (ref === 'head0002' && HEAD[path]) return new Response(HEAD[path])
      if (ref === 'mb000003' && path === 'src/retry.ts') return new Response("import { fetchJson } from './net.js'\nexport const retries = 3\n")
    }
    const routes: Record<string, unknown> = {
      [`${GH}/pulls/9`]: pull,
      [`${GH}/compare/base0001...head0002?per_page=1`]: { merge_base_commit: { sha: 'mb000003' } },
      [`${GH}/pulls/9/files?per_page=100`]: [{ filename: 'src/retry.ts', status: 'modified', additions: 2, deletions: 1, changes: 3, patch }],
      [`${GH}/pulls/9/reviews?per_page=100`]: [],
      [`${GH}/pulls/9/comments?per_page=100`]: [],
      [`${GH}/issues/9/comments?per_page=100`]: [],
    }
    return url in routes ? Response.json(routes[url]) : new Response('{}', { status: 404 })
  }) as typeof fetch
}

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

async function review(config = 'version: 1\nsandbox: { enabled: false }\n') {
  const home = mkdtempSync(join(tmpdir(), 'prr-related-'))
  dirs.push(home)
  writeFileSync(join(home, 'config.yml'), config)
  const env = { GITHUB_TOKEN: TOKEN, ANTHROPIC_API_KEY: AI_KEY, PR_REVIEWER_CONFIG: join(home, 'config.yml'), PR_REVIEWER_CACHE_DIR: join(home, 'cache'), HOME: home }
  const aiBodies: string[] = []
  let out = ''
  await main(['review', 'octo/app#9'], { stdout: (t) => (out += t), stderr: () => undefined }, {
    env,
    fetch: fakeFetch(aiBodies),
    homedir: home,
    credentials: new DefaultCredentialResolver({ env, keychain: async () => undefined, ghToken: async () => undefined }),
  })
  return { out, prompt: aiBodies.map((b) => JSON.stringify(JSON.parse(b).messages)).join('\n') }
}

describe('related files, end to end', () => {
  it('shows the AI the imported module and callers, with their secrets redacted and private keys left out', async () => {
    const r = await review()
    expect(r.prompt).toContain('<related_file path=\\"src/net.ts\\" relation=\\"imported by src/retry.ts\\">')
    expect(r.prompt).toContain('<related_file path=\\"src/client.ts\\" relation=\\"imports src/retry.ts\\">')
    expect(r.prompt).toContain('3: export const attempts = retries + 1')
    expect(r.prompt).not.toContain(AWS)
    expect(r.prompt).toContain('[REDACTED')
    expect(r.prompt).not.toContain('src/keys.ts')
    expect(r.prompt).not.toContain('MIIEow')
    expect(r.out).toContain('_Related code shown to the AI: `src/net.ts` (imported by src/retry.ts), `src/client.ts` (imports src/retry.ts)._')
  })

  it('ai.relatedFiles: false keeps them out', async () => {
    const r = await review('version: 1\nsandbox: { enabled: false }\nai: { relatedFiles: false }\n')
    expect(r.prompt).not.toContain('<related_file')
    expect(r.out).not.toContain('Related code shown')
  })
})
