import Anthropic from '@anthropic-ai/sdk'
import { err, ok, type Result, type ReviewProvider, type ReviewRequest, type ReviewResponse, type Secret } from '@pr-reviewer/core'

/** Default model when the user's Configuration names none. */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5'

export interface AnthropicProviderOptions {
  apiKey: Secret
  model?: string | undefined
  /** For Anthropic-compatible gateways (FR-9a). */
  baseUrl?: string | undefined
  /** Thinking depth; code review is intelligence-sensitive, so the default is "high". */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  maxTokens?: number
  /** Injected in tests and the browser extension. */
  fetch?: typeof fetch
  /** Only for the extension's Standalone mode with the user's own key (AD-16). */
  browser?: boolean
  /** SDK retries for 408/409/429/5xx and connection errors (default 2). */
  maxRetries?: number
}

/**
 * Anthropic Messages API adapter (isomorphic: no Node built-ins). One non-streaming request per review,
 * structured JSON output, no tools (AD-8), server-side refusal fallbacks enabled.
 */
export class AnthropicProvider implements ReviewProvider {
  readonly id = 'anthropic'
  readonly #client: Anthropic
  readonly #model: string
  readonly #effort: NonNullable<AnthropicProviderOptions['effort']>
  readonly #maxTokens: number

  constructor(opts: AnthropicProviderOptions) {
    this.#client = new Anthropic({
      apiKey: opts.apiKey.reveal(),
      ...(opts.baseUrl ? { baseURL: opts.baseUrl } : {}),
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
      ...(opts.browser ? { dangerouslyAllowBrowser: true } : {}),
      maxRetries: opts.maxRetries ?? 2,
    })
    this.#model = opts.model ?? DEFAULT_ANTHROPIC_MODEL
    this.#effort = opts.effort ?? 'high'
    this.#maxTokens = opts.maxTokens ?? 16_000
  }

  async complete(request: ReviewRequest): Promise<Result<ReviewResponse>> {
    let message
    try {
      message = await this.#client.beta.messages.create({
        model: this.#model,
        max_tokens: this.#maxTokens,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: request.system,
        messages: [{ role: 'user', content: request.prompt }],
        output_config: {
          effort: this.#effort,
          format: { type: 'json_schema', schema: request.schema },
        },
      })
    } catch (e) {
      return describeError(e)
    }

    const usage = { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens }
    if (message.stop_reason === 'refusal') {
      return err('ai_refused', `The model declined to review this PR${message.stop_details?.category ? ` (${message.stop_details.category})` : ''}.`)
    }
    if (message.stop_reason === 'max_tokens') {
      return err('ai_truncated', `The review exceeded ${this.#maxTokens} output tokens and was cut off.`)
    }
    const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
    let output: unknown
    try {
      output = JSON.parse(text)
    } catch {
      return err('ai_invalid_json', 'The model did not return valid JSON.')
    }
    return ok({ output, provider: this.id, model: message.model, usage })
  }
}

function describeError(e: unknown): Result<never> {
  if (e instanceof Anthropic.AuthenticationError) return err('ai_unauthorized', 'The Anthropic API key was rejected.')
  if (e instanceof Anthropic.PermissionDeniedError) return err('ai_forbidden', 'The Anthropic API key is not allowed to use this model.')
  if (e instanceof Anthropic.NotFoundError) return err('ai_model_not_found', 'The configured model was not found.')
  if (e instanceof Anthropic.BadRequestError) return err('ai_bad_request', `Anthropic rejected the request: ${e.message}`)
  if (e instanceof Anthropic.RateLimitError) return err('ai_rate_limited', 'Anthropic rate limit reached; try again later.', true)
  if (e instanceof Anthropic.APIConnectionError) return err('ai_unreachable', 'Could not reach the Anthropic API.', true)
  if (e instanceof Anthropic.APIError) return err('ai_error', `Anthropic API error ${e.status ?? ''}`.trim(), (e.status ?? 500) >= 500)
  return err('ai_error', `Unexpected error calling Anthropic: ${(e as Error).message}`)
}
