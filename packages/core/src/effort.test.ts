import { describe, expect, it } from 'vitest'
import { chooseEffort, effortRule } from './effort.js'
import type { Finding } from './findings.js'

const files = (...items: Array<[string, number]>) => ({ files: items.map(([path, lines]) => ({ path, additions: lines, deletions: 0 })) }) as Parameters<typeof chooseEffort>[0]

describe('adaptive effort (roadmap item 5)', () => {
  it('looks lightly at documentation, small changes, and small test-only changes', () => {
    expect(chooseEffort(files(['README.md', 400], ['docs/a.png', 1]), [])).toEqual({ level: 'light', reasons: ['documentation only'] })
    expect(chooseEffort(files(['src/a.ts', 12]), []).level).toBe('light')
    expect(chooseEffort(files(['src/a.test.ts', 90], ['README.md', 10]), []).level).toBe('light')
  })

  it('looks deeper at sensitive files or when the checks found something serious', () => {
    expect(chooseEffort(files(['src/auth/session.ts', 5]), [])).toMatchObject({ level: 'deep', reasons: [expect.stringContaining('src/auth/session.ts')] })
    expect(chooseEffort(files(['.github/workflows/ci.yml', 3]), []).level).toBe('deep')
    expect(chooseEffort(files(['db/migrations/0042_users.sql', 30]), []).level).toBe('deep')
    expect(chooseEffort(files(['Dockerfile', 2]), []).level).toBe('deep')
    const critical = { severity: 'CRITICAL', scope: 'NEW' } as Finding
    expect(chooseEffort(files(['src/a.ts', 5]), [critical]).level).toBe('deep')
    expect(chooseEffort(files(['src/a.ts', 5]), [{ ...critical, scope: 'PRE_EXISTING' }]).level).toBe('light')
  })

  it('reviews everything else at standard depth, without extra instructions', () => {
    const c = chooseEffort(files(['src/a.ts', 120], ['src/b.ts', 80]), [])
    expect(c).toEqual({ level: 'standard', reasons: ['2 file(s), 200 line(s)'] })
    expect(effortRule(c)).toBeUndefined()
    expect(effortRule({ level: 'light', reasons: ['x'] })).toContain('Report only clear defects')
    expect(effortRule({ level: 'deep', reasons: ['x'] })).toContain('authentication and authorisation')
  })

  it('does not mistake ordinary names for sensitive ones', () => {
    expect(chooseEffort(files(['src/author-card.tsx', 60], ['src/tokenizer-ui/list.ts', 60]), []).level).toBe('standard')
  })
})
