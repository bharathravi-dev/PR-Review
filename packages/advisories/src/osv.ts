import { err, ok, type Advisory, type AdvisoryEcosystem, type AdvisoryPort, type Result } from '@pr-reviewer/core'

/** The public OSV database; overridable with `advisories.url` in the user config. */
export const DEFAULT_OSV_URL = 'https://api.osv.dev'

interface OsvVuln {
  id: string
  summary?: string
  details?: string
  aliases?: string[]
  database_specific?: { severity?: string }
  references?: Array<{ type?: string; url: string }>
  affected?: Array<{ package?: { name?: string; ecosystem?: string }; ranges?: Array<{ events?: Array<{ fixed?: string }> }> }>
}

/** AdvisoryPort over OSV (https://osv.dev): one batch query, then details per vulnerability. Isomorphic (fetch only). */
export class OsvAdvisories implements AdvisoryPort {
  readonly source: string
  readonly #base: string
  readonly #fetch: typeof fetch

  constructor(opts: { url?: string | undefined; fetch: typeof fetch }) {
    this.#base = (opts.url ?? DEFAULT_OSV_URL).replace(/\/+$/, '')
    this.#fetch = opts.fetch
    this.source = this.#base === DEFAULT_OSV_URL ? 'OSV (osv.dev)' : `OSV (${this.#base})`
  }

  async query(packages: Array<{ ecosystem: AdvisoryEcosystem; name: string; version: string }>): Promise<Result<Array<{ name: string; version: string; advisories: Advisory[] }>>> {
    if (packages.length === 0) return ok([])
    const batch = await this.#json<{ results: Array<{ vulns?: Array<{ id: string }> }> }>('/v1/querybatch', {
      queries: packages.map((p) => ({ package: { ecosystem: p.ecosystem, name: p.name }, version: p.version })),
    })
    if (!batch.ok) return batch
    const ids = [...new Set(batch.value.results.flatMap((r) => (r.vulns ?? []).map((v) => v.id)))].slice(0, 200)
    const details = new Map<string, OsvVuln>()
    let next = 0
    let failure: string | undefined
    const worker = async () => {
      while (next < ids.length) {
        const id = ids[next++]!
        const v = await this.#json<OsvVuln>(`/v1/vulns/${encodeURIComponent(id)}`)
        if (v.ok) details.set(id, v.value)
        else failure = v.error.message
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, ids.length) }, worker))
    if (failure && details.size === 0) return err('advisories_unavailable', failure, true)

    return ok(
      packages.map((p, i) => ({
        name: p.name,
        version: p.version,
        advisories: (batch.value.results[i]?.vulns ?? []).flatMap((ref) => {
          const v = details.get(ref.id)
          if (!v) return []
          const fixed = v.affected
            ?.filter((a) => a.package?.name === p.name)
            .flatMap((a) => a.ranges ?? [])
            .flatMap((r) => r.events ?? [])
            .map((e) => e.fixed)
            .find((f): f is string => typeof f === 'string')
          return [
            {
              id: v.id,
              summary: v.summary ?? v.details?.split('\n')[0]?.slice(0, 200) ?? '',
              ...(v.database_specific?.severity ? { severity: v.database_specific.severity } : {}),
              aliases: v.aliases ?? [],
              url: v.references?.find((r) => r.type === 'ADVISORY')?.url ?? `https://osv.dev/vulnerability/${encodeURIComponent(v.id)}`,
              ...(fixed ? { fixedIn: fixed } : {}),
            },
          ]
        }),
      })),
    )
  }

  async #json<T>(path: string, body?: unknown): Promise<Result<T>> {
    let res: Response
    try {
      res = await this.#fetch(`${this.#base}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'content-type': 'application/json' } : {},
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30_000),
      })
    } catch (e) {
      return err('advisories_unreachable', `Could not reach ${this.#base}: ${(e as Error).message}`, true)
    }
    if (!res.ok) return err('advisories_error', `${this.#base} returned HTTP ${res.status}`, res.status >= 500)
    try {
      return ok((await res.json()) as T)
    } catch {
      return err('advisories_error', `${this.#base} returned invalid JSON`)
    }
  }
}
