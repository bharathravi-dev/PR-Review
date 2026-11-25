import { AI_REVIEW_JSON_SCHEMA, Secret, type ReviewRequest } from '@pr-reviewer/core'
import { describe, expect, it } from 'vitest'
import { AnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from './anthropic.js'

const REQUEST: ReviewRequest = { system: 'sys', prompt: 'review this', schema: AI_REVIEW_JSON_SCHEMA, promptVersion: 1 }
const KEY = new Secret(['sk-', 'test-', 'key-123'].join(''))

function message(over: Record<string, unknown> = {}) {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [{ type: 'text', text: JSON.stringify({ findings: [] }) }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1200, output_tokens: 80 },
    ...over,
  }
}

function fakeFetch(status: number, body: unknown, seen: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = []) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init)
    seen.push({ url: req.url, headers: req.headers, body: JSON.parse(await req.text()) })
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'request-id': 'req_1' } })
  }) as typeof fetch
}

describe('AnthropicProvider', () => {
  it('sends one tool-less, schema-constrained request with refusal fallbacks', async () => {
    const seen: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = []
    const p = new AnthropicProvider({ apiKey: KEY, fetch: fakeFetch(200, message(), seen), maxRetries: 0 })
    const r = await p.complete(REQUEST)
    expect(r).toEqual({ ok: true, value: { output: { findings: [] }, provider: 'anthropic', model: 'claude-opus-5-5', usage: { inputTokens: 1200, outputTokens: 80 } } })
    expect(seen).toHaveLength(1)
    const { body, headers, url } = seen[0]!
    expect(url).toContain('/v1/messages')
    // SDK 1.x sends the key as a Bearer token; older releases used x-api-key.
    expect(headers.get('x-api-key') ?? headers.get('authorization')?.replace(/^Bearer /, '')).toBe(KEY.reveal())
    expect(headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01')
    expect(body).toMatchObject({
      model: DEFAULT_ANTHROPIC_MODEL,
      max_tokens: 16000,
      fallbacks: 'default',
      system: 'sys',
      messages: [{ role: 'user', content: 'review this' }],
      output_config: { effort: 'high', format: { type: 'json_schema', schema: AI_REVIEW_JSON_SCHEMA } },
    })
    expect(body).not.toHaveProperty('tools')
    expect(body).not.toHaveProperty('tool_choice')
  })

  it('honours model, base URL, and effort from configuration', async () => {
    const seen: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = []
    const p = new AnthropicProvider({ apiKey: KEY, model: 'claude-sonnet-5-5', baseUrl: 'https://gateway.example.com', effort: 'medium', fetch: fakeFetch(200, message(), seen), maxRetries: 0 })
    await p.complete(REQUEST)
    expect(seen[0]?.url.startsWith('https://gateway.example.com/')).toBe(true)
    expect(seen[0]?.body).toMatchObject({ model: 'claude-sonnet-5-5', output_config: { effort: 'medium' } })
  })

  it('maps refusals, truncation, and non-JSON output to errors', async () => {
    const refused = await new AnthropicProvider({ apiKey: KEY, fetch: fakeFetch(200, message({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: null } })), maxRetries: 0 }).complete(REQUEST)
    expect(!refused.ok && refused.error).toMatchObject({ code: 'ai_refused', message: expect.stringContaining('cyber') })
    const truncated = await new AnthropicProvider({ apiKey: KEY, fetch: fakeFetch(200, message({ stop_reason: 'max_tokens' })), maxRetries: 0 }).complete(REQUEST)
    expect(!truncated.ok && truncated.error.code).toBe('ai_truncated')
    const prose = await new AnthropicProvider({ apiKey: KEY, fetch: fakeFetch(200, message({ content: [{ type: 'text', text: 'Looks good!' }] })), maxRetries: 0 }).complete(REQUEST)
    expect(!prose.ok && prose.error.code).toBe('ai_invalid_json')
  })

  it('maps API errors: auth is fatal, rate limits and overload are retryable', async () => {
    const errorBody = (type: string) => ({ type: 'error', error: { type, message: 'x' } })
    const auth = await new AnthropicProvider({ apiKey: KEY, fetch: fakeFetch(401, errorBody('authentication_error')), maxRetries: 0 }).complete(REQUEST)
    expect(!auth.ok && auth.error).toMatchObject({ code: 'ai_unauthorized', retryable: false })
    const limited = await new AnthropicProvider({ apiKey: KEY, fetch: fakeFetch(429, errorBody('rate_limit_error')), maxRetries: 0 }).complete(REQUEST)
    expect(!limited.ok && limited.error).toMatchObject({ code: 'ai_rate_limited', retryable: true })
    const overloaded = await new AnthropicProvider({ apiKey: KEY, fetch: fakeFetch(529, errorBody('overloaded_error')), maxRetries: 0 }).complete(REQUEST)
    expect(!overloaded.ok && overloaded.error).toMatchObject({ code: 'ai_error', retryable: true })
    expect(JSON.stringify([auth, limited, overloaded])).not.toContain(KEY.reveal())
  })
})
