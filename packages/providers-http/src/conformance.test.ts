// Provider conformance suite (Story 3.1): every built-in HTTP adapter must pass the same cases.
import { AI_REVIEW_JSON_SCHEMA, Secret, type ReviewProvider, type ReviewRequest } from '@pr-reviewer/core'
import { describe, expect, it } from 'vitest'
import { AnthropicProvider } from './anthropic.js'
import { OpenAiCompatibleProvider } from './openai-compatible.js'

const ANSWER = { findings: [{ category: 'CORRECTNESS', severity: 'MAJOR', confidence: 'HIGH', title: 't', description: 'd', impact: null, recommendation: null, path: 'a.ts', startLine: 1, endLine: 1 }] }
const REQUEST: ReviewRequest = { system: 'sys', prompt: 'review this', schema: AI_REVIEW_JSON_SCHEMA, promptVersion: 1 }

interface Fixture {
  name: string
  /** A successful reply carrying `text` as the model's answer, with 120 input / 30 output tokens. */
  success(text: string): Response
  error(status: number): Response
  make(fetch: typeof fetch): ReviewProvider
  /** Checks the outgoing request is a single, tool-less, schema-constrained call. */
  checkRequest(url: string, headers: Headers, body: Record<string, unknown>): void
}

const anthropic: Fixture = {
  name: 'anthropic',
  success: (text) =>
    Response.json({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 120, output_tokens: 30 } }),
  error: (status) => Response.json({ type: 'error', error: { type: 'x', message: 'nope' } }, { status }),
  make: (fetch) => new AnthropicProvider({ apiKey: new Secret('sk-ant-conformance-0000'), fetch, maxRetries: 0 }),
  checkRequest(url, headers, body) {
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(headers.get('authorization') ?? headers.get('x-api-key')).toContain('sk-ant-conformance-0000')
    expect(body.tools).toBeUndefined()
    expect(body.output_config).toMatchObject({ format: { type: 'json_schema' } })
  },
}

const openai: Fixture = {
  name: 'openai-compatible',
  success: (text) => Response.json({ id: 'c', model: 'gpt-test', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: text, refusal: null } }], usage: { prompt_tokens: 120, completion_tokens: 30 } }),
  error: (status) => Response.json({ error: { message: 'nope', type: 'x' } }, { status }),
  make: (fetch) => new OpenAiCompatibleProvider({ name: 'openai', apiKey: new Secret('sk-conformance-0000'), model: 'gpt-test', fetch }),
  checkRequest(url, headers, body) {
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(headers.get('authorization')).toBe('Bearer sk-conformance-0000')
    expect(body.tools).toBeUndefined()
    expect(body.response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true } })
    expect(JSON.stringify(body.response_format)).not.toContain('$schema')
  },
}

for (const fx of [anthropic, openai]) {
  describe(`provider conformance: ${fx.name}`, () => {
    it('sends one tool-less structured request and returns the parsed output with usage', async () => {
      const seen: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = []
      const p = fx.make((async (input: string | URL | Request, init?: RequestInit) => {
        const req = new Request(input, init)
        seen.push({ url: req.url, headers: req.headers, body: (await req.json()) as Record<string, unknown> })
        return fx.success(JSON.stringify(ANSWER))
      }) as typeof fetch)
      const res = await p.complete(REQUEST)
      expect(seen).toHaveLength(1)
      fx.checkRequest(seen[0]!.url, seen[0]!.headers, seen[0]!.body)
      expect(res).toMatchObject({ ok: true, value: { output: ANSWER, usage: { inputTokens: 120, outputTokens: 30 } } })
      expect(p.billing).toBe('METERED')
    })

    it('maps HTTP errors to typed errors with the right retryable flag', async () => {
      const cases: Array<[number, string, boolean]> = [
        [401, 'ai_unauthorized', false],
        [403, 'ai_forbidden', false],
        [404, 'ai_model_not_found', false],
        [429, 'ai_rate_limited', true],
        [500, 'ai_error', true],
      ]
      for (const [status, code, retryable] of cases) {
        const p = fx.make((async () => fx.error(status)) as typeof fetch)
        const res = await p.complete(REQUEST)
        expect(res.ok ? null : res.error, `HTTP ${status}`).toMatchObject({ code, retryable })
      }
    })

    it('treats an unreachable endpoint as retryable and invalid JSON as not', async () => {
      const down = await fx.make((async () => { throw new TypeError('fetch failed') }) as typeof fetch).complete(REQUEST)
      expect(down.ok ? null : down.error).toMatchObject({ code: 'ai_unreachable', retryable: true })
      const junk = await fx.make((async () => fx.success('not json')) as typeof fetch).complete(REQUEST)
      expect(junk.ok ? null : junk.error).toMatchObject({ code: 'ai_invalid_json', retryable: false })
    })
  })
}

describe('openai-compatible options', () => {
  it('supports a custom key header, base URL, and json_object mode for gateways', async () => {
    let seen: { url: string; headers: Headers; body: Record<string, unknown> } | undefined
    const p = new OpenAiCompatibleProvider({
      name: 'azure',
      apiKey: new Secret('azure-key-0000'),
      model: 'my-deployment',
      baseUrl: 'https://example.invalid/openai/v1/',
      apiKeyHeader: 'api-key',
      responseFormat: 'json_object',
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        const req = new Request(input, init)
        seen = { url: req.url, headers: req.headers, body: (await req.json()) as Record<string, unknown> }
        return openai.success(`\`\`\`json\n${JSON.stringify(ANSWER)}\n\`\`\``)
      }) as typeof fetch,
    })
    const res = await p.complete(REQUEST)
    expect(res).toMatchObject({ ok: true, value: { provider: 'azure', output: ANSWER } })
    expect(seen!.url).toBe('https://example.invalid/openai/v1/chat/completions')
    expect(seen!.headers.get('api-key')).toBe('azure-key-0000')
    expect(seen!.headers.get('authorization')).toBeNull()
    expect(seen!.body.response_format).toEqual({ type: 'json_object' })
    expect(JSON.stringify(seen!.body.messages)).toContain('JSON Schema')
  })

  it('reports refusals and truncation', async () => {
    const reply = (choice: unknown) => new OpenAiCompatibleProvider({ name: 'o', model: 'm', fetch: (async () => Response.json({ choices: [choice] })) as typeof fetch })
    const refused = await reply({ finish_reason: 'stop', message: { content: null, refusal: 'no' } }).complete(REQUEST)
    expect(refused.ok ? null : refused.error.code).toBe('ai_refused')
    const cut = await reply({ finish_reason: 'length', message: { content: '{"fin' } }).complete(REQUEST)
    expect(cut.ok ? null : cut.error.code).toBe('ai_truncated')
  })
})
