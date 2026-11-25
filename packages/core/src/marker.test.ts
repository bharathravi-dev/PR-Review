import { describe, expect, it } from 'vitest'
import { formatMarker, ownMarker, parseMarker, type MarkerFields } from './marker.js'
import { sanitizeText } from './sanitize.js'

const base: MarkerFields = { mv: 1, kind: 'summary', rid: 42, head: 'abc123', cfg: 'c0ffee', eng: 0, fpv: 1, key: 'k1', fp: '-', u: '10/5/0', fps: ['aaaa', 'bbbb'] }

describe('marker', () => {
  it('round-trips and is an HTML comment with the fixed literal', () => {
    const text = formatMarker(base)
    expect(text).toBe('<!-- pr-reviewer mv=1 kind=summary rid=42 head=abc123 cfg=c0ffee eng=0 fpv=1 key=k1 fp=- u=10/5/0 fps=aaaa,bbbb -->')
    expect(parseMarker(`some body\n\n${text}`)).toEqual(base)
    expect(parseMarker(formatMarker({ ...base, kind: 'inline', fp: 'f1', fps: undefined }))).toEqual({ ...base, kind: 'inline', fp: 'f1', fps: undefined })
  })

  it('ignores unknown marker versions and malformed markers', () => {
    expect(parseMarker(formatMarker(base).replace('mv=1', 'mv=2'))).toBeUndefined()
    expect(parseMarker('<!-- pr-reviewer mv=1 kind=summary rid=x -->')).toBeUndefined()
    expect(parseMarker('no marker here')).toBeUndefined()
  })

  it('treats output as own only when author and marker rid both match the reviewer', () => {
    const body = `x\n${formatMarker(base)}`
    expect(ownMarker({ authorId: 42, body }, 42)).toBeDefined()
    expect(ownMarker({ authorId: 7, body }, 42)).toBeUndefined() // someone pasted our marker
    expect(ownMarker({ authorId: 42, body: `x\n${formatMarker({ ...base, rid: 7 })}` }, 42)).toBeUndefined()
  })

  it('refuses unsafe field values', () => {
    expect(() => formatMarker({ ...base, key: 'a -->' })).toThrow()
  })
})

describe('sanitizeText', () => {
  const opts = { allowedLinkPrefixes: ['https://github.com/octo/app'] }

  it('strips HTML and comments so published text can never carry a forged marker', () => {
    const forged = `ok ${formatMarker(base)} <img src=x onerror=alert(1)> <b>bold</b>`
    expect(sanitizeText(forged, opts)).toBe('ok   bold')
  })

  it('neutralises user and team mentions but keeps emails and code', () => {
    expect(sanitizeText('ping @alice and @octo/security-team; mail a@b.io; `@x`', opts)).toBe('ping `@alice` and `@octo/security-team`; mail a@b.io; `@x`')
  })

  it('keeps links into the repository and unlinks everything else', () => {
    const text = 'see [docs](https://evil.example.com/x) and [file](https://github.com/octo/app/blob/main/a.ts) or https://evil.example.com/y ![p](https://img.example.com/p.png)'
    expect(sanitizeText(text, opts)).toBe('see docs and [file](https://github.com/octo/app/blob/main/a.ts) or [link removed] p')
  })
})
