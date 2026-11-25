import { describe, expect, it } from 'vitest'
import { formatPrRef, parsePrRef } from './pr-ref.js'

describe('parsePrRef', () => {
  it('parses github.com and Enterprise URLs, including sub-pages', () => {
    expect(parsePrRef('https://github.com/Octo/hello.git/pull/12/files', 'github.com')).toEqual({
      ok: true,
      value: { host: 'github.com', owner: 'Octo', repo: 'hello', number: 12 },
    })
    const ghe = parsePrRef('https://GHE.Example.com/team/app/pull/7', 'github.com')
    expect(ghe.ok && ghe.value.host).toBe('ghe.example.com')
  })

  it('parses owner/repo#n against the configured default host', () => {
    const r = parsePrRef(' octo/repo#3 ', 'ghe.example.com')
    expect(r.ok && r.value).toEqual({ host: 'ghe.example.com', owner: 'octo', repo: 'repo', number: 3 })
    expect(r.ok && formatPrRef(r.value)).toBe('octo/repo#3')
  })

  it('rejects anything that is not a PR', () => {
    for (const bad of ['', 'octo/repo', 'octo/repo#0', 'https://github.com/octo/repo/issues/3', 'ftp://x/y/z/pull/1', 'nope']) {
      const r = parsePrRef(bad, 'github.com')
      expect(r.ok, bad).toBe(false)
    }
  })
})
