import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const build = new URL('../build/', import.meta.url)
const has = existsSync(new URL('manifest.json', build))

describe.skipIf(!has)('extension bundle (Story 7.1, NFR14)', () => {
  it('declares Manifest V3 with the side panel, minimal permissions, a strict CSP and the open-panel command', () => {
    const m = JSON.parse(readFileSync(new URL('manifest.json', build), 'utf8'))
    expect(m.manifest_version).toBe(3)
    expect(m.minimum_chrome_version).toBe('116')
    expect(m.side_panel.default_path).toBe('panel.html')
    expect(m.permissions.sort()).toEqual(['sidePanel', 'storage'])
    expect(m.permissions).not.toContain('tabs')
    expect(m.content_security_policy.extension_pages).toBe("script-src 'self'; object-src 'self'")
    expect(m.commands['open-panel'].suggested_key.default).toBe('Alt+Shift+R')
  })

  it('contains no eval, no new Function and no remotely loaded code', () => {
    const files = ['panel.js', 'background.js', ...readdirSync(new URL('chunks/', build)).map((f) => `chunks/${f}`)]
    for (const f of files) {
      const js = readFileSync(new URL(f, build), 'utf8')
      expect(js, f).not.toMatch(/[^\w.$]eval\(/)
      expect(js, f).not.toContain('new Function(')
      expect(js, f).not.toMatch(/import\(\s*["']https?:/)
    }
    const html = readFileSync(new URL('panel.html', build), 'utf8')
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/)
    expect(html).not.toMatch(/src=["']https?:/)
  })
})
