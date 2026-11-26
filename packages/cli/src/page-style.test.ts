import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../static/app.css', import.meta.url), 'utf8')

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x! + 0.05) / (y! + 0.05)
}
/** A token's colour as hex; resolves `color-mix(in srgb, #a P%, #b)` the way browsers do (mixing sRGB values). */
const token = (name: string, dark = false, source = css) => {
  const block = dark ? source.slice(source.indexOf('prefers-color-scheme: dark')) : source
  const value = new RegExp(`--${name}:\\s*([^;]+);`, 'i').exec(block)![1]!.trim()
  const mix = /^color-mix\(in srgb, (#[0-9a-f]{6}) (\d+)%, (#[0-9a-f]{6})\)$/i.exec(value)
  if (!mix) return value
  const p = Number(mix[2]) / 100
  const ch = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16)
  return `#${[1, 3, 5].map((i) => Math.round(ch(mix[1]!, i) * p + ch(mix[3]!, i) * (1 - p)).toString(16).padStart(2, '0')).join('')}`
}

describe('classic review page contrast parity (Story 9.2)', () => {
  it('gives controls a border of at least 3:1 in light and dark', () => {
    for (const dark of [false, true]) {
      const edge = token('border-strong', dark)
      for (const bg of ['bg', 'surface', 'surface-2']) expect(contrast(edge, token(bg, dark))).toBeGreaterThanOrEqual(3)
    }
    expect(css).toMatch(/input\[type="text"\], select \{[^}]*border: 1px solid var\(--border-strong\)/)
    expect(css).toMatch(/\.btn \{[^}]*border: 1px solid var\(--border-strong\)/)
    expect(css).toMatch(/\.field select, \.field input, \.field textarea \{[^}]*var\(--border-strong\)/)
  })

  it('never fades excluded findings, and underlines links', () => {
    expect(css).not.toMatch(/\.finding\.off \{[^}]*opacity/)
    expect(css).toMatch(/\.finding\.off \{[^}]*dashed var\(--border-strong\)/)
    expect(css).toMatch(/^a \{[^}]*text-decoration: underline/m)
    expect(css).toMatch(/\.btn\.link \{[^}]*text-decoration: underline/)
  })
})

describe('BR.dev brand (docs/brand.md)', () => {
  const sheets = {
    classic: css,
    v2: readFileSync(new URL('../static/v2/app.css', import.meta.url), 'utf8'),
    panel: readFileSync(new URL('../../extension/src/panel.css', import.meta.url), 'utf8'),
  }
  const BRAND = ['bg', 'surface', 'border', 'text', 'muted', 'accent', 'accent-hover', 'accent-text', 'accent-soft', 'accent-line', 'link', 'focus']

  it('uses the same brand tokens on every surface, in light and dark', () => {
    for (const dark of [false, true]) for (const name of BRAND) expect(new Set(Object.values(sheets).map((s) => token(name, dark, s))).size, `${name}${dark ? ' (dark)' : ''}`).toBe(1)
    expect(token('accent')).toBe('#FF7B02')
    expect(token('bg', true)).toBe('#090A1A')
    for (const s of Object.values(sheets)) expect(s).toMatch(/font-family: 'Inter'/)
  })

  it('keeps text readable: 4.5:1 for text and links, 3:1 for focus and selected borders', () => {
    for (const dark of [false, true]) {
      for (const bg of ['bg', 'surface']) {
        expect(contrast(token('text', dark), token(bg, dark))).toBeGreaterThanOrEqual(4.5)
        expect(contrast(token('muted', dark), token(bg, dark))).toBeGreaterThanOrEqual(4.5)
        expect(contrast(token('link', dark), token(bg, dark))).toBeGreaterThanOrEqual(4.5)
        expect(contrast(token('focus', dark), token(bg, dark))).toBeGreaterThanOrEqual(3)
        expect(contrast(token('accent-line', dark), token(bg, dark))).toBeGreaterThanOrEqual(3)
      }
      expect(contrast(token('accent-text', dark), token('accent', dark))).toBeGreaterThanOrEqual(4.5)
    }
  })
})
