import { describe, expect, it } from 'vitest'
import { parseUserConfig, resolveSettings } from './config.js'
import { redactText, Secret } from './secret.js'

describe('parseUserConfig', () => {
  it('accepts a version 1 config with providers and profiles', () => {
    const r = parseUserConfig({
      version: 1,
      github: { host: 'ghe.example.com' },
      providers: { work: { type: 'openai-compatible', baseUrl: 'https://llm.internal/v1', model: 'm', credential: 'provider:work' } },
      ai: { verifyProvider: 'openai', verifyModel: 'gpt-4o' },
      profiles: { ci: { defaultProvider: 'work' } },
    })
    expect(r.ok).toBe(true)
  })

  it('fails closed on unknown keys, Credential values, and newer versions', () => {
    const unknown = parseUserConfig({ version: 1, githb: {} })
    expect(!unknown.ok && unknown.error.code).toBe('config_invalid')
    const value = parseUserConfig({ version: 1, github: { credential: 'ghp_abc' } })
    expect(!value.ok && value.error.message).toContain('github.credential')
    const newer = parseUserConfig({ version: 2 })
    expect(!newer.ok && newer.error.code).toBe('config_too_new')
    expect(parseUserConfig({}).ok).toBe(false)
  })
})

describe('resolveSettings', () => {
  it('merges defaults → user → profile → run and records sources', () => {
    const user = parseUserConfig({
      version: 1,
      github: { apiUrl: 'https://ghe.example.com/api/v3' },
      defaultProvider: 'a',
      profiles: { ci: { defaultProvider: 'b' } },
    })
    if (!user.ok) throw new Error('setup')
    const r = resolveSettings({ user: user.value, profile: 'ci', overrides: { github: { host: 'ghe.example.com' } } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.settings).toMatchObject({
      github: { host: 'ghe.example.com', apiUrl: 'https://ghe.example.com/api/v3', credential: 'github' },
      defaultProvider: 'b',
    })
    expect(r.value.sources).toMatchObject({
      'github.host': 'run',
      'github.apiUrl': 'user',
      'github.credential': 'default',
      defaultProvider: 'profile:ci',
    })
  })

  it('errors on an undefined profile', () => {
    const r = resolveSettings({ profile: 'nope' })
    expect(!r.ok && r.error.code).toBe('config_profile_missing')
  })
})

describe('Secret', () => {
  it('never prints its value', () => {
    const s = new Secret('sk-live-123456')
    expect(String(s)).toBe('[REDACTED]')
    expect(`${s}`).toBe('[REDACTED]')
    expect(JSON.stringify({ s })).toBe('{"s":"[REDACTED]"}')
    expect(s.reveal()).toBe('sk-live-123456')
    expect(redactText('token=sk-live-123456;again sk-live-123456', [s])).toBe('token=[REDACTED];again [REDACTED]')
  })
})
