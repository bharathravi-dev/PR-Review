import { describe, expect, it } from 'vitest'
import { EXIT_CODES, SCHEMA_VERSION } from './index.js'

describe('core constants', () => {
  it('pins the artefact schema version', () => {
    expect(SCHEMA_VERSION).toBe(1)
  })

  it('maps each Overall Status to a distinct exit code and reserves 64 for usage errors', () => {
    const codes = Object.values(EXIT_CODES)
    expect(new Set(codes).size).toBe(codes.length)
    expect(EXIT_CODES.usage).toBe(64)
  })
})
