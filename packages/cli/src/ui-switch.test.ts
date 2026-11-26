import { describe, expect, it } from 'vitest'

const sw = (await import(new URL('../static/ui-switch.js', import.meta.url).href)) as {
  preferredUi: (s?: Storage) => 'classic' | 'v2' | undefined
  rememberUi: (ui: string, s?: Storage) => void
  redirectFor: (current: string, preferred: string | undefined, hash?: string) => string | undefined
  followPreference: (current: string, loc: { hash: string; replace: (u: string) => void }, s: Storage) => string | undefined
}

function memory(): Storage {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage
}

describe('choosing classic or v2 (Story 9.3)', () => {
  it("follows the browser's remembered choice and keeps the URL fragment", () => {
    const store = memory()
    expect(sw.preferredUi(store)).toBeUndefined()
    expect(sw.redirectFor('classic', undefined)).toBeUndefined()
    sw.rememberUi('v2', store)
    expect(sw.preferredUi(store)).toBe('v2')
    const went: string[] = []
    expect(sw.followPreference('classic', { hash: '#token=abc', replace: (u) => void went.push(u) }, store)).toBe('/v2/#token=abc')
    expect(went).toEqual(['/v2/#token=abc'])
    expect(sw.followPreference('v2', { hash: '', replace: (u) => void went.push(u) }, store)).toBeUndefined()
  })

  it('ignores unknown values and storage that throws', () => {
    const store = memory()
    store.setItem('pr-reviewer-ui', 'v9')
    expect(sw.preferredUi(store)).toBeUndefined()
    const broken = { getItem: () => { throw new Error('blocked') } } as unknown as Storage
    expect(sw.preferredUi(broken)).toBeUndefined()
  })
})
