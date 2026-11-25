import { describe, expect, it } from 'vitest'
import { parseRulesChecklist } from './rules.js'

describe('parseRulesChecklist', () => {
  it('takes top-level list items as rules and ignores headings, prose, nested items, and code', () => {
    const md = [
      '# Team rules',
      'Applies to everything.',
      '',
      '- Correctness first: logic errors,',
      '  null and empty cases.',
      '  - nested detail is part of the parent',
      '* Security: no secrets in code.',
      '1. Public API changes are called out.',
      '```',
      '- not a rule',
      '```',
    ].join('\n')
    expect(parseRulesChecklist(md)).toEqual([
      'Correctness first: logic errors, null and empty cases.',
      'Security: no secrets in code.',
      'Public API changes are called out.',
    ])
  })
})
