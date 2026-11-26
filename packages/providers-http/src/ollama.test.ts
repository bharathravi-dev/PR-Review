import { AI_REVIEW_JSON_SCHEMA } from '@pr-reviewer/core'
import { describe, expect, it } from 'vitest'
import { contextFor, listOllamaModels, OllamaProvider } from './ollama.js'

const request = { system: 'Review.', prompt: 'diff', schema: AI_REVIEW_JSON_SCHEMA, promptVersion: 6 }

describe('Ollama provider', () => {
  it('sizes the context window to the prompt, within 8k and the limit', () => {
    expect(contextFor(100)).toBe(8192)
    expect(contextFor(10_000)).toBe(14_336)
    expect(contextFor(100_000)).toBe(32_768)
    expect(contextFor(100_000, 131_072)).toBe(104_448)
  })

  it('calls the native chat API with the findings schema, thinking off and a sized context, and reads usage', async () => {
    let sent: Record<string, unknown> = {}
    let url = ''
    const fetchImpl = (async (u: string, init: RequestInit) => {
      url = u
      sent = JSON.parse(String(init.body))
      return Response.json({ model: 'qwen3:8b', message: { content: JSON.stringify({ findings: [] }) }, done_reason: 'stop', prompt_eval_count: 900, eval_count: 40 })
    }) as unknown as typeof fetch
    const r = await new OllamaProvider({ model: 'qwen3:8b', fetch: fetchImpl }).complete(request)
    expect(url).toBe('http://127.0.0.1:11434/api/chat')
    expect(sent).toMatchObject({ model: 'qwen3:8b', stream: false, think: false, options: { num_ctx: 8192 } })
    expect((sent.format as { type?: string }).type).toBe('object')
    expect(r.ok && r.value).toMatchObject({ output: { findings: [] }, provider: 'ollama', model: 'qwen3:8b', usage: { inputTokens: 900, outputTokens: 40 } })
  })

  it('says how to install a missing model, notices a stopped Ollama, and refuses a prompt larger than the context', async () => {
    const missing = (async () => Response.json({ error: "model 'qwen9' not found" }, { status: 404 })) as unknown as typeof fetch
    const r1 = await new OllamaProvider({ model: 'qwen9', fetch: missing }).complete(request)
    expect(!r1.ok && r1.error.message).toBe('Ollama does not have the model "qwen9". Install it with: ollama pull qwen9')
    const down = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const r2 = await new OllamaProvider({ model: 'm', fetch: down }).complete(request)
    expect(!r2.ok && r2.error.code).toBe('ai_unreachable')
    const r3 = await new OllamaProvider({ model: 'm', contextLength: 8192, fetch: down }).complete({ ...request, prompt: 'x'.repeat(60_000) })
    expect(!r3.ok && r3.error.code).toBe('ai_context_too_small')
    const cut = (async () => Response.json({ message: { content: '{"find' }, done_reason: 'length' })) as unknown as typeof fetch
    const r4 = await new OllamaProvider({ model: 'm', fetch: cut }).complete(request)
    expect(!r4.ok && r4.error.code).toBe('ai_truncated')
  })

  it('lists installed models with their size, and explains a 403', async () => {
    const tags = (async () => Response.json({ models: [{ name: 'qwen3:8b', size: 5, details: { parameter_size: '8.2B', context_length: 40960 } }] })) as unknown as typeof fetch
    expect(await listOllamaModels(undefined, tags)).toEqual([{ name: 'qwen3:8b', sizeBytes: 5, parameterSize: '8.2B', contextLength: 40960 }])
    const refused = (async () => new Response('', { status: 403 })) as unknown as typeof fetch
    await expect(listOllamaModels('http://127.0.0.1:11434/', refused)).rejects.toThrow('allowed origins')
  })
})
