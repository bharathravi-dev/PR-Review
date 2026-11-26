import { err, ok, type Result, type ReviewProvider, type ReviewRequest, type ReviewResponse } from '@pr-reviewer/core'

/** Where Ollama listens unless told otherwise. */
export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434'
/** Context window asked of Ollama at most, unless configured: enough for a large PR without exhausting memory. */
export const DEFAULT_OLLAMA_CONTEXT = 32_768
const MIN_CONTEXT = 8_192
/** Room kept for the answer (the findings JSON). */
const OUTPUT_ROOM = 4_096

export interface OllamaOptions {
  /** e.g. qwen3:8b, gemma4:26b (as `ollama list` shows it). */
  model: string
  baseUrl?: string | undefined
  /** Largest context window to ask for (tokens); the request asks only for what the prompt needs. */
  contextLength?: number | undefined
  timeoutMs?: number | undefined
  fetch?: typeof fetch | undefined
}

/** A model installed in Ollama, from `/api/tags`. */
export interface OllamaModel {
  name: string
  sizeBytes: number
  parameterSize?: string | undefined
  contextLength?: number | undefined
}

/** Rough token count for sizing the context window (about 3 characters per token for code). */
export const estimateTokens = (text: string) => Math.ceil(text.length / 3)

/** The context window to ask for: what the prompt needs plus room for the answer, within [8k, limit]. */
export function contextFor(promptTokens: number, limit = DEFAULT_OLLAMA_CONTEXT): number {
  const wanted = Math.ceil((promptTokens + OUTPUT_ROOM) / 1024) * 1024
  return Math.min(limit, Math.max(MIN_CONTEXT, wanted))
}

/** Lists the models installed in Ollama (for choosing one); errors are thrown as readable messages. */
export async function listOllamaModels(baseUrl: string = DEFAULT_OLLAMA_BASE_URL, fetchImpl: typeof fetch = globalThis.fetch): Promise<OllamaModel[]> {
  const base = baseUrl.replace(/\/+$/, '')
  let res: Response
  try {
    res = await fetchImpl(`${base}/api/tags`, { headers: { accept: 'application/json' } })
  } catch {
    throw new Error(`Could not reach Ollama at ${base}. Is Ollama running?`)
  }
  if (res.status === 403) throw new Error(`Ollama at ${base} refused this request (403): it only accepts requests from allowed origins.`)
  if (!res.ok) throw new Error(`Ollama at ${base} answered ${res.status}.`)
  const data = (await res.json().catch(() => ({}))) as { models?: Array<{ name?: string; size?: number; details?: { parameter_size?: string; context_length?: number } }> }
  return (data.models ?? [])
    .filter((m) => typeof m.name === 'string')
    .map((m) => ({ name: m.name!, sizeBytes: m.size ?? 0, parameterSize: m.details?.parameter_size, contextLength: m.details?.context_length }))
}

/**
 * A local model served by Ollama, through its native chat API: structured output with the findings schema, a
 * context window sized to the prompt (Ollama silently truncates prompts beyond it), and thinking off. Isomorphic.
 */
export class OllamaProvider implements ReviewProvider {
  readonly id = 'ollama'
  /** Larger PRs are reviewed with less context or in parts by core (planReviewRequests). */
  readonly maxPromptTokens: number
  readonly #o: OllamaOptions

  constructor(opts: OllamaOptions) {
    this.#o = opts
    this.maxPromptTokens = (opts.contextLength ?? DEFAULT_OLLAMA_CONTEXT) - OUTPUT_ROOM
  }

  async complete(request: ReviewRequest): Promise<Result<ReviewResponse>> {
    const o = this.#o
    const base = (o.baseUrl ?? DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, '')
    const { $schema: _ignored, ...schema } = request.schema
    const limit = o.contextLength ?? DEFAULT_OLLAMA_CONTEXT
    const promptTokens = estimateTokens(request.system) + estimateTokens(request.prompt) + estimateTokens(JSON.stringify(schema))
    if (promptTokens + OUTPUT_ROOM > limit) {
      return err('ai_context_too_small', `This PR needs about ${Math.round(promptTokens / 1000)}k tokens of context; Ollama is limited to ${Math.round(limit / 1000)}k here. Raise the context length, or review a smaller PR.`)
    }
    const body = {
      model: o.model,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.prompt },
      ],
      format: schema,
      stream: false,
      think: false,
      options: { num_ctx: contextFor(promptTokens, limit), temperature: 0.1 },
    }
    let res: Response
    try {
      res = await (o.fetch ?? globalThis.fetch)(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(o.timeoutMs ?? 900_000),
      })
    } catch (e) {
      const timeout = (e as Error).name === 'TimeoutError'
      return err(timeout ? 'ai_timeout' : 'ai_unreachable', timeout ? `Ollama (${o.model}) did not answer in time.` : `Could not reach Ollama at ${base}. Is Ollama running?`, true)
    }
    const text = await res.text().catch(() => '')
    const detail = (() => {
      try {
        return String((JSON.parse(text) as { error?: string }).error ?? '')
      } catch {
        return ''
      }
    })()
    if (!res.ok) {
      if (res.status === 404 || /not found/i.test(detail)) return err('ai_model_not_found', `Ollama does not have the model "${o.model}". Install it with: ollama pull ${o.model}`)
      if (res.status === 403) return err('ai_forbidden', `Ollama at ${base} refused this request (403): it only accepts requests from allowed origins.`)
      if (res.status >= 500) return err('ai_error', `Ollama failed (${res.status})${detail ? `: ${detail.slice(0, 300)}` : ''}`, true)
      return err('ai_bad_request', `Ollama rejected the request (${res.status})${detail ? `: ${detail.slice(0, 300)}` : ''}`)
    }
    let data: { model?: string; message?: { content?: string }; done_reason?: string; prompt_eval_count?: number; eval_count?: number }
    try {
      data = JSON.parse(text)
    } catch {
      return err('ai_invalid_json', 'Ollama returned a response that is not JSON.')
    }
    if (data.done_reason === 'length') return err('ai_truncated', 'The review was cut off at the context limit.')
    const content = data.message?.content
    if (typeof content !== 'string' || content.trim() === '') return err('ai_invalid_response', 'Ollama returned an empty answer.')
    let output: unknown
    try {
      output = JSON.parse(content)
    } catch {
      return err('ai_invalid_json', 'The model did not return valid JSON.')
    }
    return ok({ output, provider: 'ollama', model: data.model ?? o.model, usage: { inputTokens: data.prompt_eval_count ?? 0, outputTokens: data.eval_count ?? 0 } })
  }
}
