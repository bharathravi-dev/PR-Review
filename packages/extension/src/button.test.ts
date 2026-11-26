import { describe, expect, it } from 'vitest'
import { findPlacement, githubTheme, PLACEMENT_SELECTORS } from './placement.js'
import { buttonLabel } from './state.js'

const doc = (present: string[]) => ({ querySelector: (s: string) => (present.includes(s) ? { selector: s } : null) })

describe('the Review button on the PR page (Story 7.5)', () => {
  it('labels each state from stored data', () => {
    expect(buttonLabel(undefined)).toEqual({ label: 'AI review', state: 'review' })
    expect(buttonLabel({ status: 'running', findings: 0, headSha: '' })).toEqual({ label: 'Reviewing…', state: 'running' })
    expect(buttonLabel({ status: 'done', findings: 3, headSha: 'a' })).toEqual({ label: '3 findings', state: 'current' })
    expect(buttonLabel({ status: 'done', findings: 1, headSha: 'a' }).label).toBe('1 finding')
    expect(buttonLabel({ status: 'done', findings: 0, headSha: 'a' }).label).toBe('No findings')
    expect(buttonLabel({ status: 'done', findings: 2, headSha: 'a' }, 'b')).toEqual({ label: 'Outdated', state: 'outdated' })
  })

  it('tries the known header layouts in order and gives up quietly on an unknown one', () => {
    expect(findPlacement(doc(['.gh-header-actions']))).toEqual({ selector: '.gh-header-actions' })
    expect(findPlacement(doc(['.gh-header-actions', '[data-component="PH_Actions"]']))).toEqual({ selector: '[data-component="PH_Actions"]' })
    expect(findPlacement(doc(['[class*="PageHeader-Actions"]']))).toEqual({ selector: '[class*="PageHeader-Actions"]' })
    expect(findPlacement(doc([]))).toBeUndefined()
    expect(PLACEMENT_SELECTORS.length).toBeGreaterThan(2)
  })

  it("follows GitHub's colour mode and falls back to the OS", () => {
    expect(githubTheme({ colorMode: 'light' }, true)).toBe('light')
    expect(githubTheme({ colorMode: 'dark' }, false)).toBe('dark')
    expect(githubTheme({ colorMode: 'auto' }, true)).toBe('dark')
    expect(githubTheme({ colorMode: null }, true)).toBeUndefined()
  })
})
