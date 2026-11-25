import { err, ok, type Result, type ReviewProvider, type ReviewRequest, type ReviewResponse, type Secret } from '@pr-reviewer/core'

/** OpenAI's public API; any compatible endpoint is set with `baseUrl` (FR-9a). */
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'

export interface OpenAiCompatibleOptions {
  /** Name from Configuration, used in messages and the Report (e.g. "openai", "openrouter", "ollama"). */
  name: string
  apiKey?: Secret | undefined
  /** Required: compatible endpoints have no common default model. */
  model: string
  baseUrl?: string | undefined
  /** Header carrying the key; default `Authorization: Bearer <key>`. Azure uses "api-key". */
  apiKeyHeader?: string | undefined
  /** json_schema (default) or json_object for endpoints without JSON-schema support; core re-validates either way. */
  responseFormat?: 'json_schema' | 'json_object' | undefined
  maxTokens?: number | undefined
  timeoutMs?: number | undefined
  fetch?: typeof fetch | undefined
}

/**
 * OpenAI Chat Completions adapter for OpenAI and every compatible endpoint (OpenRouter, Ollama, Azure OpenAI,
 * company gateways). Isomorphic: plain fetch, no SDK, no Node built-ins. One request, structured output, no
 * tools (AD-8).
 */
export class OpenAiCompatibleProvider implements ReviewProvider {
  readonly id: string
  readonly billing = 'METERED' as const
  readonly #o: OpenAiCompatibleOptions

  constructor(opts: OpenAiCompatibleOptions) {
    this.id = opts.name
    this.#o = opts
  }

  async complete(request: ReviewRequest): Promise<Result<ReviewResponse>> {
    const o = this.#o
    const base = (o.baseUrl ?? DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, '')
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' }
    if (o.apiKey) {
      if (o.apiKeyHeader && o.apiKeyHeader.toLowerCase() !== 'authorization') headers[o.apiKeyHeader] = o.apiKey.reveal()
      else headers.authorization = `Bearer ${o.apiKey.reveal()}`
    }
    const { $schema: _ignored, ...schema } = request.schema
    const objectMode = o.responseFormat === 'json_object'
    const body = {
      model: o.model,
      messages: [
        {
          role: 'system',
          content: objectMode ? `${request.system}\n\nAnswer with one JSON object matching this JSON Schema:\n${JSON.stringify(schema)}` : request.system,
        },
        { role: 'user', content: request.prompt },
      ],
      response_format: objectMode ? { type: 'json_object' } : { type: 'json_schema', json_schema: { name: 'review_findings', strict: true, schema } },
      ...(o.maxTokens ? { max_completion_tokens: o.maxTokens } : {}),
    }

    let res: Response
    try {
      res = await (o.fetch ?? globalThis.fetch)(`${base}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(o.timeoutMs ?? 600_000),
      })
    } catch (e) {
      const timeout = (e as Error).name === 'TimeoutError'
      return err(timeout ? 'ai_timeout' : 'ai_unreachable', timeout ? `${o.name} did not answer in time.` : `Could not reach ${o.name} at ${base}.`, true)
    }
    const text = await res.text().catch(() => '')
    if (!res.ok) return httpError(o.name, res.status, text)

    let data: ChatCompletion
    try {
      data = JSON.parse(text) as ChatCompletion
    } catch {
      return err('ai_invalid_json', `${o.name} returned a response that is not JSON.`)
    }
    const choice = data.choices?.[0]
    const usage = data.usage ? { inputTokens: data.usage.prompt_tokens ?? 0, outputTokens: data.usage.completion_tokens ?? 0 } : undefined
    if (!choice) return err('ai_invalid_response', `${o.name} returned no answer.`)
    if (choice.message?.refusal) return err('ai_refused', `The model declined to review this PR: ${choice.message.refusal}`)
    if (choice.finish_reason === 'length') return err('ai_truncated', 'The review was cut off at the output token limit.')
    const content = choice.message?.content
    if (typeof content !== 'string' || content.trim() === '') return err('ai_invalid_response', `${o.name} returned an empty answer.`)
    let output: unknown
    try {
      output = JSON.parse(stripFence(content))
    } catch {
      return err('ai_invalid_json', 'The model did not return valid JSON.')
    }
    return ok({ output, provider: o.name, model: data.model ?? o.model, usage })
  }
}

interface ChatCompletion {
  model?: string
  choices?: Array<{ finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

/** Some gateways wrap JSON in a Markdown fence in json_object mode. */
function stripFence(text: string): string {
  const m = /^\s*```(?:json)?\s*\n([\s\S]*?)\n```\s*$/.exec(text)
  return m ? m[1]! : text
}

function httpError(name: string, status: number, body: string): Result<never> {
  let detail = ''
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string }
    detail = typeof parsed.error === 'string' ? parsed.error : (parsed.error?.message ?? parsed.message ?? '')
  } catch {
    detail = ''
  }
  const suffix = detail ? `: ${detail.slice(0, 300)}` : ''
  if (status === 401) return err('ai_unauthorized', `${name} rejected the API key${suffix}`)
  if (status === 403) return err('ai_forbidden', `${name} refused access${suffix}`)
  if (status === 404) return err('ai_model_not_found', `${name} does not know this model or endpoint${suffix}`)
  if (status === 408) return err('ai_timeout', `${name} timed out${suffix}`, true)
  if (status === 429) return err('ai_rate_limited', `${name} rate limit or quota reached${suffix}`, true)
  if (status >= 500) return err('ai_error', `${name} server error ${status}${suffix}`, true)
  return err('ai_bad_request', `${name} rejected the request (HTTP ${status})${suffix}`)
}
