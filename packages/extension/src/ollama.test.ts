import { describe, expect, it } from 'vitest'
import { ollamaOrigin, ollamaProblem, testAiKey } from './compose.js'
import { ollamaPermission, ollamaRule } from './ollama-access.js'

const EXT = 'abcdefghijklmnopabcdefghijklmnop'

describe('Standalone with Ollama', () => {
  it('accepts http on this computer or https elsewhere, and asks Chrome for the declared pattern', () => {
    expect(ollamaOrigin('')).toBe('http://127.0.0.1:11434')
    expect(ollamaOrigin('localhost:11434')).toBe('http://localhost:11434')
    expect(ollamaOrigin('http://gpu-box.lan:11434')).toBeUndefined()
    expect(ollamaOrigin('https://ollama.example.com')).toBe('https://ollama.example.com')
    expect(ollamaPermission('http://127.0.0.1:11434')).toBe('http://127.0.0.1/*')
    expect(ollamaPermission('https://ollama.example.com')).toBe('https://ollama.example.com/*')
  })

  it('rewrites the Origin only on this extension’s own requests to that Ollama', () => {
    expect(ollamaRule('http://127.0.0.1:11434', EXT)).toMatchObject({
      action: { type: 'modifyHeaders', requestHeaders: [{ header: 'origin', operation: 'set', value: 'http://127.0.0.1' }] },
      condition: { urlFilter: '|http://127.0.0.1:11434/', initiatorDomains: [EXT] },
    })
  })

  it('tests the setup without a key: Ollama running, the model installed', async () => {
    const tags = (async () => Response.json({ models: [{ name: 'qwen3:8b' }] })) as unknown as typeof fetch
    expect(await testAiKey({ type: 'ollama', apiKey: '', model: 'qwen3:8b' }, tags)).toMatchObject({ ok: true })
    expect(await testAiKey({ type: 'ollama', apiKey: '', model: 'gemma4:26b' }, tags)).toEqual({ ok: false, message: 'Model: Ollama does not have gemma4:26b. Install it with: ollama pull gemma4:26b' })
    const down = (async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    expect((await testAiKey({ type: 'ollama', apiKey: '', model: 'qwen3:8b' }, down)).message).toContain('Ollama isn’t running')
    expect(ollamaProblem('Ollama at x refused this request (403): it only accepts requests from allowed origins.')).toContain('OLLAMA_ORIGINS')
  })
})
