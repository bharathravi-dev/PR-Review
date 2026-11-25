import * as z from 'zod'
import { err, ok, type Result } from './result.js'

/** Named Credential reference; values never live in Configuration (AD-10). */
export const CredentialRef = z.string().regex(/^(github|provider:[a-z0-9][a-z0-9-]*)$/, 'expected "github" or "provider:<id>"')

export const ProviderType = z.enum(['anthropic', 'anthropic-compatible', 'openai-compatible', 'claude-code', 'codex'])
export type ProviderType = z.infer<typeof ProviderType>

export const ProviderSettings = z.strictObject({
  type: ProviderType,
  model: z.string().optional(),
  /** API base URL for HTTP providers (FR-9a), e.g. an OpenRouter, Ollama, Azure, or company gateway URL. */
  baseUrl: z.string().optional(),
  credential: CredentialRef.optional(),
  /** Header that carries the key for openai-compatible gateways that don't use `Authorization: Bearer` (e.g. "api-key"). */
  apiKeyHeader: z.string().regex(/^[A-Za-z0-9-]+$/).optional(),
  /** Structured output mode for openai-compatible endpoints; json_object for gateways without JSON-schema support. */
  responseFormat: z.enum(['json_schema', 'json_object']).optional(),
  /** Path to the vendor CLI for claude-code / codex (default: found on PATH or in editor extensions). */
  command: z.string().optional(),
  /** USD per million tokens, used to estimate cost and enforce ceilings (FR-12). */
  pricing: z.strictObject({ inputPerMTok: z.number().nonnegative(), outputPerMTok: z.number().nonnegative() }).optional(),
  timeoutMs: z.number().int().positive().optional(),
})
export type ProviderSettings = z.infer<typeof ProviderSettings>

/** Settings shared by the top level of a user config and each named profile. */
export const Settings = z.strictObject({
  github: z
    .strictObject({
      host: z.string().optional(),
      apiUrl: z.string().optional(),
      credential: CredentialRef.optional(),
    })
    .optional(),
  defaultProvider: z.string().optional(),
  /** Providers tried in order after the default when it fails with a retryable error (FR-11). */
  fallback: z.array(z.string()).optional(),
  providers: z.record(z.string(), ProviderSettings).optional(),
  /** Spending limits for metered providers (FR-12). */
  limits: z
    .strictObject({
      maxCostPerRunUsd: z.number().positive().optional(),
      maxCostPerMonthUsd: z.number().positive().optional(),
    })
    .optional(),
  /** Review Rules sources: Markdown file paths (relative to the config file) or https:// URLs (AD-13). */
  reviewRules: z.array(z.string()).optional(),
  publish: z
    .strictObject({
      /** REQUEST_CHANGES is allowed only in manual runs and only when enabled here (FR-18). */
      allowRequestChanges: z.boolean().optional(),
      maxInlineComments: z.number().int().positive().optional(),
      /** Extra URL prefixes kept as links in published text (AD-9). */
      linkPrefixes: z.array(z.string()).optional(),
      /** Also set a `pr-reviewer` commit status on the head commit when posting (FR-21). Off by default. */
      commitStatus: z.boolean().optional(),
    })
    .optional(),
})
export type Settings = z.infer<typeof Settings>

export const USER_CONFIG_VERSION = 1

/** The user's own configuration file (AD-13). Unknown keys fail closed. */
export const UserConfig = Settings.extend({
  version: z.literal(USER_CONFIG_VERSION),
  profiles: z.record(z.string(), Settings).optional(),
})
export type UserConfig = z.infer<typeof UserConfig>

/** Product defaults: no repositories, orgs, or URLs beyond the overridable public GitHub host (AD-13). */
export const DEFAULT_SETTINGS: Settings = {
  github: { host: 'github.com', credential: 'github' },
}

export type ConfigSource = 'default' | 'user' | `profile:${string}` | 'run'

export interface ResolvedConfig {
  settings: Settings
  /** Which layer set each leaf value, keyed by dotted path. */
  sources: Record<string, ConfigSource>
}

/** Validates a parsed user config file; a newer `version` or any unknown key is an error. */
export function parseUserConfig(raw: unknown): Result<UserConfig> {
  if (raw && typeof raw === 'object' && 'version' in raw) {
    const v = (raw as { version: unknown }).version
    if (typeof v === 'number' && v > USER_CONFIG_VERSION) {
      return err('config_too_new', `Config version ${v} was written by a newer pr-reviewer; this version understands ${USER_CONFIG_VERSION}.`)
    }
  }
  const parsed = UserConfig.safeParse(raw)
  if (parsed.success) return ok(parsed.data)
  const issue = parsed.error.issues[0]
  const where = issue?.path.length ? issue.path.join('.') : '(root)'
  return err('config_invalid', `Invalid config at ${where}: ${issue?.message ?? 'unknown error'}`)
}

/** Merges defaults → user → profile → per-run overrides, recording each value's source. */
export function resolveSettings(input: {
  user?: UserConfig | undefined
  profile?: string | undefined
  overrides?: Settings | undefined
}): Result<ResolvedConfig> {
  const sources: Record<string, ConfigSource> = {}
  let merged: Record<string, unknown> = {}
  const apply = (layer: Settings | undefined, source: ConfigSource) => {
    if (layer) merged = mergeInto(merged, layer as Record<string, unknown>, source, sources, '')
  }
  apply(DEFAULT_SETTINGS, 'default')
  if (input.user) {
    const { version: _v, profiles: _p, ...top } = input.user
    apply(top, 'user')
  }
  if (input.profile) {
    const profile = input.user?.profiles?.[input.profile]
    if (!profile) return err('config_profile_missing', `Profile "${input.profile}" is not defined in the user config.`)
    apply(profile, `profile:${input.profile}`)
  }
  apply(input.overrides, 'run')
  const parsed = Settings.safeParse(merged)
  if (!parsed.success) return err('config_invalid', `Invalid merged config: ${parsed.error.issues[0]?.message ?? 'unknown'}`)
  return ok({ settings: parsed.data, sources })
}

function mergeInto(
  base: Record<string, unknown>,
  layer: Record<string, unknown>,
  source: ConfigSource,
  sources: Record<string, ConfigSource>,
  prefix: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(layer)) {
    if (value === undefined) continue
    const path = prefix ? `${prefix}.${key}` : key
    if (isPlainObject(value)) {
      const current = isPlainObject(out[key]) ? (out[key] as Record<string, unknown>) : {}
      out[key] = mergeInto(current, value, source, sources, path)
    } else {
      out[key] = value
      for (const k of Object.keys(sources)) if (k === path || k.startsWith(`${path}.`)) delete sources[k]
      sources[path] = source
    }
  }
  return out
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
