import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatMarker } from '@pr-reviewer/core'
import { DefaultCredentialResolver } from '@pr-reviewer/credentials'
import { describe, expect, it } from 'vitest'
import { cronFor, discoverWorkflow, reviewWorkflow } from './auto-workflows.js'
import type { CliDeps } from './deps.js'
import { main } from './main.js'

const ME = 4242
const SETUP = 'gho-setup-token-0000'
const REVIEW = 'github_pat_review_token_0000'

/** A fake GitHub covering the Auto-Review endpoints. */
function github(opts: { searchStatus?: number } = {}) {
  const state = {
    autoRepo: false,
    files: new Map<string, string>(),
    dispatches: [] as Array<{ workflow: string; inputs: Record<string, string> }>,
    issues: [] as Array<{ number: number; title: string; body: string; state: string }>,
    reviews: [] as Array<{ pr: string; event?: string; body: string }>,
    comments: [] as Array<{ pr: string; body: string }>,
    heads: new Map<string, string>([['me/app#1', 'a'.repeat(40)], ['me/app#2', 'b'.repeat(40)], ['acme/web#5', 'c'.repeat(40)], ['me/quiet#9', 'd'.repeat(40)]]),
    published: new Map<string, Array<{ id: number; user: { id: number }; body: string; state: string }>>(),
  }
  let next = 1
  const pull = (repo: string, n: number) => ({
    state: 'open',
    title: 'Change',
    body: '',
    draft: false,
    user: { login: 'dev', id: 7 },
    author_association: repo.startsWith('me/') && n === 2 ? 'NONE' : 'COLLABORATOR',
    requested_reviewers: repo === 'acme/web' ? [{ login: 'me' }] : [],
    base: { ref: 'main', sha: 'base0001', repo: { id: 99, full_name: repo } },
    head: { ref: 'f', sha: state.heads.get(`${repo}#${n}`)!, repo: { full_name: repo } },
  })
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init)
    const { url, method } = req
    const auth = req.headers.get('authorization') ?? ''
    if (url.startsWith('https://registry.npmjs.org/')) return new Response('{}', { status: 404 })
    if (url.startsWith('https://api.anthropic.com/')) {
      return Response.json({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: '{"findings":[]}' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } })
    }
    const path = url.replace('https://api.github.com', '')
    if (path === '/user') return auth.includes(SETUP) || auth.includes(REVIEW) ? Response.json({ id: ME, login: 'me' }) : new Response('{}', { status: 401 })
    if (path === '/repos/me/pr-reviewer-automation' && method === 'GET') return state.autoRepo ? Response.json({ private: true, default_branch: 'main' }) : new Response('{}', { status: 404 })
    if (path === '/user/repos' && method === 'POST') {
      const body = (await req.json()) as { private: boolean }
      state.autoRepo = body.private
      return Response.json({ html_url: 'https://github.com/me/pr-reviewer-automation', default_branch: 'main' })
    }
    const file = /^\/repos\/me\/pr-reviewer-automation\/contents\/(.+?)(\?ref=main)?$/.exec(path)
    if (file && method === 'GET') return state.files.has(decodeURIComponent(file[1]!)) ? Response.json({ sha: 's', content: Buffer.from(state.files.get(decodeURIComponent(file[1]!))!).toString('base64') }) : new Response('{}', { status: 404 })
    if (file && method === 'PUT') {
      state.files.set(decodeURIComponent(file[1]!), Buffer.from(((await req.json()) as { content: string }).content, 'base64').toString('utf8'))
      return Response.json({})
    }
    const dispatch = /^\/repos\/me\/pr-reviewer-automation\/actions\/workflows\/(.+)\/dispatches$/.exec(path)
    if (dispatch) {
      state.dispatches.push({ workflow: decodeURIComponent(dispatch[1]!), inputs: ((await req.json()) as { inputs: Record<string, string> }).inputs })
      return new Response(null, { status: 204 })
    }
    if (path.startsWith('/repos/me/pr-reviewer-automation/issues')) {
      if (method === 'GET') return Response.json(state.issues.filter((i) => i.state === 'open').map((i) => ({ number: i.number, body: i.body, html_url: `https://github.com/me/pr-reviewer-automation/issues/${i.number}` })))
      if (method === 'POST' && path.endsWith('/issues')) {
        const b = (await req.json()) as { title: string; body: string }
        const issue = { number: next++, ...b, state: 'open' }
        state.issues.push(issue)
        return Response.json({ number: issue.number, html_url: `https://github.com/me/pr-reviewer-automation/issues/${issue.number}` })
      }
      if (method === 'POST') return Response.json({})
      const closed = /\/issues\/(\d+)$/.exec(path)
      if (method === 'PATCH' && closed) {
        state.issues.find((i) => i.number === Number(closed[1]))!.state = 'closed'
        return Response.json({})
      }
    }
    if (path.startsWith('/search/issues')) {
      if (opts.searchStatus) return new Response('{"message":"Bad credentials"}', { status: opts.searchStatus })
      const q = decodeURIComponent(new URL(url).searchParams.get('q') ?? '')
      const items = q.includes('review-requested:me')
        ? [{ number: 5, repository_url: 'https://api.github.com/repos/acme/web', user: { login: 'dev' }, author_association: 'MEMBER' }]
        : [1, 2].map((n) => ({ number: n, repository_url: 'https://api.github.com/repos/me/app', user: { login: 'dev' }, author_association: n === 2 ? 'NONE' : 'COLLABORATOR' })).concat([{ number: 9, repository_url: 'https://api.github.com/repos/me/quiet', user: { login: 'dev' }, author_association: 'COLLABORATOR' }])
      return Response.json({ items })
    }
    const pr = /^\/repos\/([\w.-]+\/[\w.-]+)\/pulls\/(\d+)$/.exec(path)
    if (pr && method === 'GET') return Response.json(pull(pr[1]!, Number(pr[2])))
    const opt = /^\/repos\/([\w.-]+\/[\w.-]+)\/contents\/\.github\/pr-reviewer\.yml/.exec(path)
    if (opt) return opt[1] === 'me/quiet' ? new Response('version: 1\nautomatedReview: false\n') : new Response('{}', { status: 404 })
    const reviews = /^\/repos\/([\w.-]+\/[\w.-]+)\/pulls\/(\d+)\/reviews(\?per_page=100)?$/.exec(path)
    if (reviews && method === 'GET') return Response.json(state.published.get(`${reviews[1]}#${reviews[2]}`) ?? [])
    if (reviews && method === 'POST') {
      const b = (await req.json()) as { event?: string; body: string }
      state.reviews.push({ pr: `${reviews[1]}#${reviews[2]}`, ...b })
      return Response.json({ id: next++, html_url: 'https://github.com/x' })
    }
    if (/\/pulls\/\d+\/comments\?/.test(path) || /\/issues\/\d+\/comments\?/.test(path)) return Response.json([])
    const ic = /^\/repos\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)\/comments$/.exec(path)
    if (ic && method === 'POST') {
      state.comments.push({ pr: `${ic[1]}#${ic[2]}`, body: ((await req.json()) as { body: string }).body })
      return Response.json({ id: next++, html_url: 'https://github.com/x' })
    }
    if (/\/compare\//.test(path)) return Response.json({ merge_base_commit: { sha: 'mb' } })
    if (/\/pulls\/\d+\/files/.test(path)) return Response.json([{ filename: 'README.md', status: 'modified', additions: 1, deletions: 0, changes: 1, patch: '@@ -1 +1,2 @@\n x\n+y' }])
    if (/\/contents\/README\.md/.test(path)) return new Response('x\ny\n')
    if (/\/commits\/.+\/(check-runs|status)/.test(path)) return Response.json({ check_runs: [], statuses: [] })
    return new Response('{}', { status: 404 })
  }) as typeof fetch
  return { state, impl }
}

function setup(gh: ReturnType<typeof github>, env: Record<string, string>, configYaml = 'version: 1\n') {
  const dir = mkdtempSync(join(tmpdir(), 'prr-auto-'))
  writeFileSync(join(dir, 'config.yml'), configYaml)
  const fullEnv = { PR_REVIEWER_CONFIG: join(dir, 'config.yml'), PR_REVIEWER_STATE_DIR: join(dir, 'state'), PR_REVIEWER_CACHE_DIR: join(dir, 'cache'), ...env }
  const gh_calls: Array<{ args: readonly string[]; stdin?: string }> = []
  const run = async (argv: string[], over: Partial<CliDeps> = {}) => {
    let out = ''
    let err = ''
    const code = await main(argv, { stdout: (t) => (out += t), stderr: (t) => (err += t) }, {
      env: fullEnv,
      fetch: gh.impl,
      homedir: dir,
      isTTY: false,
      credentials: new DefaultCredentialResolver({ env: fullEnv, keychain: async () => undefined, ghToken: async () => undefined }),
      runGh: async (args, stdin) => (gh_calls.push({ args, stdin }), { code: 0, stdout: '', stderr: '' }),
      ...over,
    })
    return { code, out, err }
  }
  return { run, gh_calls, dir }
}

describe('Auto-Review workflows (AD-14)', () => {
  const base = { cli: { kind: 'git' as const, repo: 'someone/pr-reviewer', ref: 'f'.repeat(40) }, intervalMinutes: 60 as const, providerType: 'anthropic' as const, aiSecret: 'ANTHROPIC_API_KEY', aiEnv: 'ANTHROPIC_API_KEY' }
  it('pins every action by SHA and passes workflow inputs only through the environment', () => {
    for (const yml of [discoverWorkflow({ ...base, sandbox: false }), reviewWorkflow({ ...base, sandbox: false }), reviewWorkflow({ ...base, sandbox: true })]) {
      for (const uses of yml.match(/uses: \S+/g) ?? []) expect(uses).toMatch(/@[0-9a-f]{40}$/)
      for (const line of yml.split('\n').filter((l) => /^\s+run:|^\s{4,}(pr-reviewer|for|cd)/.test(l))) expect(line).not.toContain('${{ inputs')
      expect(yml).not.toContain('pull_request_target')
    }
    expect(cronFor(30)).toBe('7,37 * * * *')
    expect(discoverWorkflow({ ...base, sandbox: false })).toContain("cron: '7 * * * *'")
  })

  it('runs PR code only in a job with no permissions and no secrets, and deletes artefacts', () => {
    const yml = reviewWorkflow({ ...base, sandbox: true })
    const sandboxJob = yml.slice(yml.indexOf('  sandbox:'), yml.indexOf('  review:\n'))
    expect(sandboxJob).toContain('permissions: {}')
    expect(sandboxJob).not.toContain('secrets.')
    expect(sandboxJob).not.toContain('GH_TOKEN')
    expect(yml).toContain('retention-days: 1')
    expect(yml).toContain("Delete this run's artefacts")
    expect(yml).toContain('--sandbox-results sandbox-out/results.json')
  })
})

describe('pr-reviewer auto enable (Stories 5.1, 5.5)', () => {
  const git = ['--cli-repo', 'someone/pr-reviewer', '--cli-ref', 'f'.repeat(40)]

  it('creates nothing without a review token, an installable CLI, or the subscription opt-in', async () => {
    const gh = github()
    const { run } = setup(gh, { GITHUB_TOKEN: SETUP, ANTHROPIC_API_KEY: 'sk-ant-key-000000000000000000' })
    const noToken = await run(['auto', 'enable', '--yes', ...git])
    expect(noToken.code).toBe(78)
    expect(noToken.err).toContain('Pull requests: Read and write')
    const noNpm = await run(['auto', 'enable', '--yes'])
    expect(noNpm.err).toContain('is not on npm yet')
    const claude = setup(gh, { GITHUB_TOKEN: SETUP, PR_REVIEWER_REVIEW_TOKEN: REVIEW }, 'version: 1\ndefaultProvider: claude-code\n')
    const noOptIn = await claude.run(['auto', 'enable', '--yes', ...git])
    expect(noOptIn.code).toBe(78)
    expect(noOptIn.err).toContain('may not be what its terms intend')
    expect(gh.state.autoRepo).toBe(false)
  })

  it('creates a private repo with pinned workflows and secrets via gh, shows the budget, and starts discovery', async () => {
    const gh = github()
    const { run, gh_calls } = setup(gh, { GITHUB_TOKEN: SETUP, PR_REVIEWER_REVIEW_TOKEN: REVIEW, ANTHROPIC_API_KEY: 'sk-ant-key-000000000000000000' })
    const r = await run(['auto', 'enable', '--yes', ...git])
    expect(r.code).toBe(0)
    expect(r.err).toMatch(/about \d+ GitHub Actions minutes a month \(\d+% of 2000 free minutes/)
    expect(gh.state.autoRepo).toBe(true)
    expect([...gh.state.files.keys()].sort()).toEqual(['.github/workflows/discover.yml', '.github/workflows/review-pr.yml', '.pr-reviewer/config.yml', 'README.md'])
    const config = gh.state.files.get('.pr-reviewer/config.yml')!
    expect(config).toContain('intervalMinutes: 120')
    expect(config).not.toMatch(/sk-ant|github_pat/)
    expect(gh_calls.map((c) => c.args.join(' '))).toEqual(['secret set REVIEW_TOKEN --repo me/pr-reviewer-automation', 'secret set ANTHROPIC_API_KEY --repo me/pr-reviewer-automation'])
    expect(gh_calls.map((c) => c.stdin)).toEqual([REVIEW, 'sk-ant-key-000000000000000000'])
    expect(gh.state.dispatches).toEqual([{ workflow: 'discover.yml', inputs: {} }])
    expect(r.out + r.err).not.toContain(REVIEW)
  })
})

describe('pr-reviewer auto discover (Story 5.2)', () => {
  const autoConfig = 'version: 1\nautoReview:\n  maxPerRun: 10\n'

  it('starts one review per new head commit, skipping reviewed heads, opted-out repos, and outside contributors', async () => {
    const gh = github()
    gh.state.published.set('me/app#1', [{ id: 1, user: { id: ME }, body: formatMarker({ mv: 1, kind: 'review', rid: ME, head: 'a'.repeat(40), cfg: 'c', eng: 0, fpv: 1, key: 'k', fp: '-', u: '0/0/0' }), state: 'COMMENTED' }])
    const { run } = setup(gh, { GH_TOKEN: REVIEW, PR_REVIEWER_DISPATCH_TOKEN: SETUP, GITHUB_ACTIONS: 'true' }, autoConfig)
    gh.state.autoRepo = true
    const r = await run(['auto', 'discover', '--automation-repo', 'me/pr-reviewer-automation'])
    expect(r.code).toBe(0)
    expect(gh.state.dispatches).toEqual([{ workflow: 'review-pr.yml', inputs: { repo: 'acme/web', pr: '5', head: 'c'.repeat(40) } }])
    expect(r.out).toBe('Found 4 open PR(s); started reviews for 1; skipped: opted out 1, outside contributor 1, already reviewed 1.\n')
    expect(r.out).not.toContain('acme/web')
  })

  it('lists what it would review locally with --dry-run', async () => {
    const gh = github()
    const { run } = setup(gh, { GH_TOKEN: REVIEW }, autoConfig)
    const r = await run(['auto', 'discover', '--dry-run'])
    expect(gh.state.dispatches).toEqual([])
    expect(r.out).toContain('acme/web#5 @ ccccccc (review requested: pending draft)')
  })

  it('opens one health issue per cause and closes it when the cause clears', async () => {
    const broken = github({ searchStatus: 401 })
    broken.state.autoRepo = true
    const a = setup(broken, { GH_TOKEN: REVIEW, PR_REVIEWER_DISPATCH_TOKEN: SETUP }, autoConfig)
    expect((await a.run(['auto', 'discover', '--automation-repo', 'me/pr-reviewer-automation'])).code).toBe(4)
    await a.run(['auto', 'discover', '--automation-repo', 'me/pr-reviewer-automation'])
    expect(broken.state.issues.filter((i) => i.state === 'open').map((i) => i.title)).toEqual(['pr-reviewer: The GitHub token expired or was revoked'])
    expect(broken.state.issues[0]!.body).toContain('<!-- pr-reviewer health cause=TOKEN_INVALID -->')

    const fixed = github()
    fixed.state.autoRepo = true
    fixed.state.issues.push(...broken.state.issues)
    const b = setup(fixed, { GH_TOKEN: REVIEW, PR_REVIEWER_DISPATCH_TOKEN: SETUP }, autoConfig)
    await b.run(['auto', 'discover', '--automation-repo', 'me/pr-reviewer-automation'])
    expect(fixed.state.issues.every((i) => i.state === 'closed')).toBe(true)
  })
})

describe('pr-reviewer auto review (Story 5.3)', () => {
  it('leaves a pending draft where review was requested and posts no public summary', async () => {
    const gh = github()
    const { run } = setup(gh, { GH_TOKEN: REVIEW, ANTHROPIC_API_KEY: 'sk-ant-key-000000000000000000', GITHUB_ACTIONS: 'true' }, 'version: 1\nsandbox: { enabled: false }\n')
    const r = await run(['auto', 'review', '--repo', 'acme/web', '--pr', '5', '--head', 'c'.repeat(40)])
    expect(r.code).toBe(0)
    expect(gh.state.reviews).toHaveLength(1)
    expect(gh.state.reviews[0]!.event).toBeUndefined()
    expect(gh.state.comments).toEqual([])
    expect(r.out).toMatch(/^acme\/web#5: [A-Z_]+, \d+ finding\(s\); pending review published\.\n$/)
  })

  it('skips a superseded head and posts a normal review elsewhere', async () => {
    const gh = github()
    const { run } = setup(gh, { GH_TOKEN: REVIEW, ANTHROPIC_API_KEY: 'sk-ant-key-000000000000000000' }, 'version: 1\nsandbox: { enabled: false }\n')
    expect((await run(['auto', 'review', '--repo', 'me/app', '--pr', '1', '--head', 'e'.repeat(40)])).out).toContain('superseded by a newer commit')
    await run(['auto', 'review', '--repo', 'me/app', '--pr', '1', '--head', 'a'.repeat(40)])
    expect(gh.state.reviews.at(-1)!.event).toBe('COMMENT')
    expect(gh.state.comments).toHaveLength(1)
  })
})
