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
const token = (name: string, dark = false) => {
  const block = dark ? css.slice(css.indexOf('prefers-color-scheme: dark')) : css
  return new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(block)![1]!
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
