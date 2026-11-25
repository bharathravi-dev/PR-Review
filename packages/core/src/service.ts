import * as z from 'zod'
import { hashObject } from './canonical.js'
import type { PublishPreview } from './publish.js'

/**
 * `ReviewService v1` (AD-16): the HTTP contract every remote engine implements (the CLI companion behind
 * `pr-reviewer serve`, later the Web App server). Request shapes are defined once here.
 */
export const SERVICE_SCHEMA_VERSION = 1

/** `POST /v1/runs` */
export const CreateRunRequest = z.object({
  pr: z.string().trim().min(1).max(500),
  provider: z.string().trim().min(1).max(100).optional(),
  model: z.string().trim().min(1).max(200).optional(),
})
export type CreateRunRequest = z.infer<typeof CreateRunRequest>

/**
 * `POST /v1/runs/:id/publish`: only the user's choices. The engine derives Reviewer Identity, hunks, and prior
 * publication itself, so a client cannot misstate them (AD-16, AD-23).
 */
export const PublishRequest = z.object({
  event: z.enum(['COMMENT', 'REQUEST_CHANGES']).default('COMMENT'),
  /** Fingerprints of the Findings to post; omitted means every eligible Finding. */
  include: z.array(z.string().min(1).max(128)).max(2000).optional(),
  /** Render and return the preview without posting. */
  dryRun: z.boolean().optional(),
  /** Digest of the preview the user saw; required to post. */
  previewDigest: z.string().max(128).optional(),
  /** The user's wording changes per Finding fingerprint (Story 6.3); applied before rendering, so the digest covers them. */
  edits: z
    .record(
      z.string().max(128),
      z.object({ title: z.string().min(1).max(500).optional(), description: z.string().min(1).max(5000).optional(), recommendation: z.string().max(5000).optional() }),
    )
    .optional(),
})
export type PublishRequest = z.infer<typeof PublishRequest>

/** Digest binding a shown preview to the post (AD-23 "preview equals post" across HTTP). */
export function previewDigest(preview: PublishPreview): Promise<string> {
  return hashObject({
    event: preview.event,
    pending: preview.pending,
    reviewBody: preview.reviewBody,
    summaryBody: preview.summaryBody,
    inline: preview.inline.map((c) => ({ path: c.path, line: c.line, startLine: c.startLine ?? null, side: c.side, body: c.body })),
  })
}
