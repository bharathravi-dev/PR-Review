import { describe, expect, it } from 'vitest'
import { DefaultCredentialResolver, envNamesFor } from './resolver.js'

describe('DefaultCredentialResolver', () => {
  it('prefers env vars, then keychain, then gh (github only)', async () => {
    const calls: string[] = []
    const r = new DefaultCredentialResolver({
      env: { GH_TOKEN: 'from-env' },
      keychain: async (a) => {
        calls.push(`kc:${a}`)
        return 'from-keychain'
      },
      ghToken: async (h) => {
        calls.push(`gh:${h}`)
        return 'from-gh'
      },
    })
    const env = await r.resolve('github')
    expect(env.ok && env.value.reveal()).toBe('from-env')
    expect(calls).toEqual([])

    const kc = await new DefaultCredentialResolver({ env: {}, keychain: async () => 'kc', ghToken: async () => 'gh' }).resolve('github')
    expect(kc.ok && kc.value.reveal()).toBe('kc')

    const gh = await new DefaultCredentialResolver({
      env: {},
      keychain: async () => undefined,
      ghToken: async (h) => `gh@${h}`,
    }).resolve('github', { host: 'ghe.example.com' })
    expect(gh.ok && gh.value.reveal()).toBe('gh@ghe.example.com')
  })

  it('never asks gh for provider keys and explains where to put a missing one', async () => {
    let ghCalled = false
    const r = new DefaultCredentialResolver({
      env: {},
      keychain: async () => undefined,
      ghToken: async () => {
        ghCalled = true
        return 'x'
      },
    })
    const res = await r.resolve('provider:work-llm')
    expect(ghCalled).toBe(false)
    expect(!res.ok && res.error.message).toContain('env PR_REVIEWER_WORK_LLM_API_KEY')
  })

  it('treats a throwing keychain as absent', async () => {
    const r = new DefaultCredentialResolver({
      env: {},
      keychain: async () => {
        throw new Error('locked')
      },
      ghToken: async () => undefined,
    })
    expect((await r.resolve('provider:anthropic')).ok).toBe(false)
  })

  it('maps references to documented env names', () => {
    expect(envNamesFor('github')).toEqual(['GITHUB_TOKEN', 'GH_TOKEN'])
    expect(envNamesFor('provider:anthropic')).toEqual(['ANTHROPIC_API_KEY'])
    expect(envNamesFor('provider:openai')).toEqual(['OPENAI_API_KEY'])
  })
})
