import { redactContext, type PrContext } from '@pr-reviewer/core'
import { describe, expect, it } from 'vitest'
import { scanSecrets } from './secrets.js'

// Fake values assembled at runtime so no literal token shape sits in the repository.
const GH = ['gh', 'p_', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'].join('')
const AWS = ['AK', 'IA', 'ABCDEFGHIJKLMNOP'].join('')
const PEM = ['-----BEGIN RSA PRIVATE', ' KEY-----\nMIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX\n-----END RSA PRIVATE', ' KEY-----'].join('')
const PASSWORD = 'correct-horse-battery-staple'

function ctx(): PrContext {
  return {
    schemaVersion: 1,
    ref: { host: 'github.com', owner: 'o', repo: 'r', number: 1 },
    title: `rotate ${AWS}`,
    body: 'see diff',
    author: 'dev',
    state: 'open',
    draft: false,
    baseRef: 'main',
    headRef: 'f',
    baseSha: 'b',
    headSha: 'h',
    mergeBaseSha: 'm',
    fromFork: false,
    files: [
      {
        path: 'src/config.ts',
        status: 'modified',
        additions: 3,
        deletions: 1,
        binary: false,
        patchTruncated: false,
        patch: ['@@ -10,2 +10,4 @@ export const cfg = {', '   region: "x",', `-  token: "",`, `+  token: "${GH}",`, `+  password: "${PASSWORD}",`, '+  retries: 3,', ' }'].join('\n'),
        head: { text: `export const cfg = {\n  token: "${GH}",\n  password: "${PASSWORD}",\n}\n` },
        base: { text: 'export const cfg = {}\n' },
      },
      {
        path: 'keys/dev.pem',
        status: 'added',
        additions: 3,
        deletions: 0,
        binary: false,
        patchTruncated: false,
        patch: `@@ -0,0 +1,3 @@\n+${PEM.split('\n').join('\n+')}`,
        head: { text: PEM },
      },
    ],
    reviews: [],
    reviewComments: [],
    issueComments: [{ id: 1, author: 'x', body: `old key was ${AWS}`, createdAt: '2026-01-01T00:00:00Z' }],
    truncated: [],
  }
}

describe('scanSecrets', () => {
  it('reports added secrets by location only', () => {
    const r = scanSecrets(ctx())
    const ids = r.findings.map((f) => `${f.ruleId}@${f.location.path}:${f.location.startLine}`)
    expect(ids).toEqual([
      'secrets/github-token@src/config.ts:11',
      'secrets/generic-assignment@src/config.ts:12',
      'secrets/private-key@keys/dev.pem:1',
    ])
    expect(r.layer).toMatchObject({ layer: 'SECURITY', status: 'FAILED' })
    const serialized = JSON.stringify(r.findings)
    for (const v of [GH, AWS, PASSWORD, 'MIIBOgIBAAJBAKj34']) expect(serialized).not.toContain(v)
  })

  it('collects values from every part of the context, and they serialise masked', () => {
    const r = scanSecrets(ctx())
    const found = r.values.map((s) => s.reveal())
    // The private key appears twice: as file content and in diff form (every line prefixed with "+").
    expect(found.sort()).toEqual([AWS, GH, PASSWORD, PEM, PEM.split('\n').join('\n+')].sort())
    expect(JSON.stringify(r)).not.toContain(GH)
  })

  it('passes a clean PR', () => {
    const clean = { ...ctx(), title: 'x', files: [], issueComments: [] }
    const r = scanSecrets(clean)
    expect(r.findings).toEqual([])
    expect(r.layer.status).toBe('PASSED')
  })
})

describe('redactContext', () => {
  it('removes every detected value from everything an AI could see', () => {
    const original = ctx()
    const scan = scanSecrets(original)
    const red = redactContext(original, scan)
    expect(red.ok).toBe(true)
    if (!red.ok) return
    const text = JSON.stringify(red.value)
    for (const v of [GH, AWS, PASSWORD, 'MIIBOgIBAAJBAKj34']) expect(text).not.toContain(v)
    expect(red.value.files[0]?.patch).toContain('token: "[REDACTED]"')
    expect(red.value.title).toBe('rotate [REDACTED]')
    expect(JSON.stringify(original)).toContain(GH) // input is not mutated
  })

  it('refuses when scanning did not complete', () => {
    const red = redactContext(ctx(), { completed: false, values: [] })
    expect(!red.ok && red.error.code).toBe('secret_scan_incomplete')
  })
})
