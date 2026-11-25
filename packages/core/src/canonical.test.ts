import { describe, expect, it } from 'vitest'
import { canonicalJson, hashObject, uuidv7 } from './canonical.js'

describe('canonicalJson (RFC 8785 subset)', () => {
  it('sorts keys, omits undefined members, and serialises numbers per ECMAScript', () => {
    expect(canonicalJson({ b: 1, a: [true, null, 'x'], c: undefined, d: { z: 0.5, y: 1e21 } })).toBe(
      '{"a":[true,null,"x"],"b":1,"d":{"y":1e+21,"z":0.5}}',
    )
    expect(canonicalJson({ é: 1, e: 2, E: 3 })).toBe('{"E":3,"e":2,"é":1}')
  })
})

describe('hashObject golden vectors (cross-platform pin, AD-12)', () => {
  it('is stable and independent of key order', async () => {
    const a = await hashObject({ fpv: 1, ruleId: 'secrets/aws-access-key-id', path: 'src/a.ts' })
    const b = await hashObject({ path: 'src/a.ts', ruleId: 'secrets/aws-access-key-id', fpv: 1 })
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    // sha256("{}") — the canonical form of an empty object.
    expect(await hashObject({})).toBe('44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a')
  })
})

describe('uuidv7', () => {
  it('encodes the timestamp and version bits', () => {
    const id = uuidv7(Date.UTC(2026, 10, 25))
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(Number.parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(Date.UTC(2026, 10, 25))
  })
})
