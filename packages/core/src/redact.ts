import { err, ok, type Result } from './result.js'
import type { PrContext } from './schemas.js'
import { redactText, type Secret } from './secret.js'

declare const redacted: unique symbol

/**
 * PR context with every detected secret value removed. The only input from which an AI request may be
 * built (AD-3, AD-8, FR-6b): the brand cannot be produced except by `redactContext`.
 */
export type RedactedContext = PrContext & { readonly [redacted]: true }

/** Outcome of the secret-scanning layer that `redact` depends on. */
export interface SecretScanOutcome {
  /** False when the scanner did not run to completion; redaction then refuses. */
  completed: boolean
  /** Values to remove. Held as Secret so they can never be serialised by accident. */
  values: readonly Secret[]
}

/**
 * Pipeline stage `redact`: replaces every detected secret value in all text that could reach an
 * AI Provider (title, body, patches, file contents, reviews, comments). Refuses when scanning did not
 * complete, so the AI stage cannot run on unscanned context.
 */
export function redactContext(ctx: PrContext, scan: SecretScanOutcome): Result<RedactedContext> {
  if (!scan.completed) {
    return err('secret_scan_incomplete', 'Secret scanning did not complete; AI review is not allowed on unscanned context.')
  }
  const r = (t: string) => redactText(t, scan.values)
  const out: PrContext = {
    ...ctx,
    title: r(ctx.title),
    body: r(ctx.body),
    files: ctx.files.map((f) => ({
      ...f,
      ...(f.patch !== undefined ? { patch: r(f.patch) } : {}),
      ...(f.head ? { head: f.head.text !== undefined ? { ...f.head, text: r(f.head.text) } : f.head } : {}),
      ...(f.base ? { base: f.base.text !== undefined ? { ...f.base, text: r(f.base.text) } : f.base } : {}),
    })),
    reviews: ctx.reviews.map((x) => ({ ...x, body: r(x.body) })),
    reviewComments: ctx.reviewComments.map((x) => ({ ...x, body: r(x.body) })),
    issueComments: ctx.issueComments.map((x) => ({ ...x, body: r(x.body) })),
  }
  return ok(out as RedactedContext)
}
