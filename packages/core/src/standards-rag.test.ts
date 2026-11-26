import { describe, expect, it } from 'vitest'
import { buildReviewRequest } from './ai-review.js'
import type { ProjectInfo } from './detect.js'
import { redactContext } from './redact.js'
import type { PrContext } from './schemas.js'
import { retrieveLanguageStandards, validateYamlSyntax } from './standards-rag.js'

const prBase: PrContext = {
  host: 'github.com',
  repo: { owner: 'octo', name: 'app' },
  number: 1,
  title: 'Test PR',
  body: '',
  author: 'ann',
  state: 'OPEN',
  draft: false,
  baseRef: 'main',
  headRef: 'feat',
  baseSha: 'b1',
  headSha: 'h1',
  mergeBaseSha: 'b1',
  files: [{ path: 'src/Main.java', status: 'modified', additions: 2, deletions: 0, binary: false, patchTruncated: false, patch: '@@ -1,1 +1,2 @@\n+x' }],
  reviews: [],
  reviewComments: [],
  issueComments: [],
  commits: [{ sha: 'h1', message: 'msg' }],
  truncated: [],
}

describe('standards RAG retrieval', () => {
  it('retrieves checklists only for stacks present in projects or changed paths', () => {
    const javaProject: ProjectInfo = {
      path: '.',
      language: 'Java',
      support: 'supported',
      frameworks: [],
      packageManager: 'maven',
      configs: { maven: 'pom.xml' },
      dependencies: [],
      changedFiles: ['src/Service.java'],
    }
    const bundles = retrieveLanguageStandards({ projects: [javaProject], changedPaths: ['src/Service.java', '.github/workflows/ci.yml'] })
    expect(bundles.map((b) => b.stack)).toEqual(['Java', 'Config / CI / Containers'])
    expect(bundles.some((b) => b.stack === 'Python')).toBe(false)
  })

  it('includes framework standards when Angular or React are detected', () => {
    const ng: ProjectInfo = {
      path: '.',
      language: 'TypeScript',
      support: 'supported',
      frameworks: [{ name: 'Angular', version: '17.0.0', checks: true }],
      packageManager: 'npm',
      configs: {},
      dependencies: [],
      changedFiles: ['src/a.ts'],
    }
    const stacks = retrieveLanguageStandards({ projects: [ng], changedPaths: ['src/a.ts'] }).map((b) => b.stack)
    expect(stacks).toEqual(['TypeScript / JavaScript', 'Angular'])
  })

  it('injects <language_standards> into buildReviewRequest prompt', () => {
    const redacted = redactContext(prBase, { completed: true, values: [] })
    if (!redacted.ok) throw new Error('unexpected redact error')
    const req = buildReviewRequest(redacted.value, {
      languageStandards: retrieveLanguageStandards({ projects: [], changedPaths: ['src/Main.java'] }),
    })
    expect(req.prompt).toContain('<language_standards>')
    expect(req.prompt).toContain('[Java]')
    expect(req.system).toContain('<language_standards>')
  })
})

describe('validateYamlSyntax', () => {
  it('accepts valid YAML and rejects malformed YAML with line info', () => {
    expect(validateYamlSyntax('name: CI\non: [push]\n')).toEqual({ ok: true })
    const bad = validateYamlSyntax('name: CI\non:\n  - push\n  bad: [unclosed\n')
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.line).toBeGreaterThan(0)
  })
})
