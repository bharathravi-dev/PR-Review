// Connected mode (Stories 7.7, 7.8): the panel drives a pr-reviewer backend over ReviewService v1 (AD-16).
// The backend holds the GitHub and AI credentials; the panel holds only a revocable token for that backend.
import type { PublishRecord, Report, RunEvent } from '@pr-reviewer/core'
import type { Edits } from './compose.js'

export const SCHEMA_VERSION = 1
export const LOCAL_PORT = 4747

export interface Connection {
  kind: 'web' | 'local'
  /** e.g. https://reviews.example.com or http://127.0.0.1:4747 */
  baseUrl: string
  token: string
  /** The computer's name, for This computer. */
  computer?: string
}

export class ServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body?: Record<string, unknown>,
  ) {
    super(message)
  }
}

/** The fetch failed before any answer: the backend is down or unreachable. */
export class UnreachableError extends Error {}

/** A preview in the shape the Post view shows, whichever mode produced it. */
export interface ShownPreview {
  inline: Array<{ path: string; line: number; body: string }>
  stillOpen: Array<{ title: string }>
  resolved: Array<{ title: string }>
  summaryBody: string
}

export function modeLabel(c: Connection): string {
  return c.kind === 'local' ? 'This computer' : `Web App · ${new URL(c.baseUrl).host}`
}

/** What the user typed as their Web App address, as an origin; https only (http just for this machine). */
export function webAppOrigin(typed: string): string | undefined {
  let url: URL
  try {
    url = new URL(/^[a-z]+:\/\//i.test(typed.trim()) ? typed.trim() : `https://${typed.trim()}`)
  } catch {
    return undefined
  }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return undefined
  if (url.username || url.password) return undefined
  return url.origin
}

export function randomState(): string {
  const b = new Uint8Array(24)
  crypto.getRandomValues(b)
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function webAppAuthUrl(origin: string, extensionId: string, state: string): string {
  return `${origin}/auth/extension?${new URLSearchParams({ ext: extensionId, state })}`
}

/** Reads the token from the chromiumapp.org redirect, checking it answers our own request. */
export function tokenFromRedirect(redirect: string | undefined, extensionId: string, state: string): string | undefined {
  if (!redirect) return undefined
  let url: URL
  try {
    url = new URL(redirect)
  } catch {
    return undefined
  }
  if (url.origin !== `https://${extensionId}.chromiumapp.org`) return undefined
  const params = new URLSearchParams(url.hash.slice(1))
  return params.get('state') === state ? (params.get('token') ?? undefined) : undefined
}

async function send(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(url, init)
  } catch (e) {
    throw new UnreachableError((e as Error).message)
  }
}

async function failure(res: Response): Promise<ServiceError> {
  const body = (await res.json().catch(() => undefined)) as { error?: { code?: string; message?: string } } & Record<string, unknown> | undefined
  return new ServiceError(res.status, body?.error?.code ?? `http_${res.status}`, body?.error?.message ?? `The server answered ${res.status}.`, body)
}

/** Exchanges the code printed by `pr-reviewer serve --pair` for a pairing token. */
export async function pairWithComputer(port: number, code: string, fetchImpl: typeof fetch): Promise<{ token: string; computer: string; port: number }> {
  const res = await send(fetchImpl, `http://127.0.0.1:${port}/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) })
  if (!res.ok) throw await failure(res)
  const body = (await res.json()) as { schemaVersion?: number; token?: string; computer?: string; port?: number }
  if (body.schemaVersion !== SCHEMA_VERSION || !body.token) throw new ServiceError(res.status, 'schema_unsupported', 'This version of pr-reviewer does not match the extension. Update both.')
  return { token: body.token, computer: body.computer ?? 'this computer', port: body.port ?? port }
}

/** Splits an SSE body into events; tolerant of chunk boundaries anywhere. */
export function sseParser(onEvent: (e: RunEvent) => void) {
  let buffer = ''
  return (chunk: string) => {
    buffer += chunk
    for (let i = buffer.indexOf('\n\n'); i >= 0; i = buffer.indexOf('\n\n')) {
      const block = buffer.slice(0, i)
      buffer = buffer.slice(i + 2)
      const data = block
        .split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => l.slice(6))
        .join('\n')
      if (data) onEvent(JSON.parse(data) as RunEvent)
    }
  }
}

export interface SessionInfo {
  schemaVersion: number
  github: { host: string; login?: string; error?: string }
  ai: { provider: string; model?: string; ready: boolean; reason?: string }
  user?: { login: string }
}

export function createClient(c: Connection, fetchImpl: typeof fetch) {
  const headers = (json = false): Record<string, string> => ({ authorization: `Bearer ${c.token}`, 'accept-schema': String(SCHEMA_VERSION), ...(json ? { 'content-type': 'application/json' } : {}) })
  const json = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const res = await send(fetchImpl, `${c.baseUrl}${path}`, { ...init, headers: headers(init.body !== undefined) })
    if (!res.ok) throw await failure(res)
    return (await res.json()) as T
  }
  return {
    async session(): Promise<SessionInfo> {
      const s = await json<SessionInfo>('/v1/session')
      if (s.schemaVersion !== SCHEMA_VERSION) throw new ServiceError(200, 'schema_unsupported', `The server speaks ReviewService v${s.schemaVersion}; this extension needs v${SCHEMA_VERSION}.`)
      return s
    },
    startRun: (pr: string) => json<{ id: string; pr: string }>('/v1/runs', { method: 'POST', body: JSON.stringify({ pr }) }),
    /** Streams a run's events until DONE (or the stream ends), resuming after `after` (Last-Event-ID). */
    async events(id: string, onEvent: (e: RunEvent) => void, opts: { after?: number; signal?: AbortSignal } = {}): Promise<void> {
      let last = opts.after ?? 0
      for (let attempt = 0; attempt < 5; attempt++) {
        let done = false
        const res = await send(fetchImpl, `${c.baseUrl}/v1/runs/${id}/events`, { headers: { ...headers(), ...(last ? { 'last-event-id': String(last) } : {}) }, ...(opts.signal ? { signal: opts.signal } : {}) })
        if (!res.ok) throw await failure(res)
        const feed = sseParser((e) => {
          last = Math.max(last, e.seq)
          if (e.type === 'DONE') done = true
          onEvent(e)
        })
        const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
        try {
          for (;;) {
            const { value, done: end } = await reader.read()
            if (end) break
            feed(value)
          }
        } catch (e) {
          if (opts.signal?.aborted) return
          // A dropped connection resumes from the last event seen.
          void e
        }
        if (done || opts.signal?.aborted) return
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
      }
      throw new UnreachableError('The connection to the review kept dropping.')
    },
    async report(id: string): Promise<Report> {
      return json<Report>(`/v1/runs/${id}/report`)
    },
    preview: (id: string, choice: { include?: string[] | undefined; edits?: Edits }) =>
      json<{ preview: RemotePreview; digest: string }>(`/v1/runs/${id}/publish`, { method: 'POST', body: JSON.stringify({ event: 'COMMENT', ...(choice.include ? { include: choice.include } : {}), ...(choice.edits && Object.keys(choice.edits).length ? { edits: choice.edits } : {}), dryRun: true }) }),
    apply: (id: string, fingerprint: string) => json<{ commitSha: string; url?: string }>(`/v1/runs/${id}/apply`, { method: 'POST', body: JSON.stringify({ fingerprint }) }),
    publish: (id: string, choice: { include?: string[] | undefined; edits?: Edits }, digest: string) =>
      json<{ record: PublishRecord }>(`/v1/runs/${id}/publish`, { method: 'POST', body: JSON.stringify({ event: 'COMMENT', ...(choice.include ? { include: choice.include } : {}), ...(choice.edits && Object.keys(choice.edits).length ? { edits: choice.edits } : {}), previewDigest: digest }) }).then((r) => r.record),
  }
}

export type Client = ReturnType<typeof createClient>

/** The preview as ReviewService v1 presents it. */
export interface RemotePreview {
  summaryBody: string
  inline: Array<{ path: string; line: number; body: string }>
  stillOpen: Array<{ title: string }>
  resolved: Array<{ title: string }>
}

export const remoteShown = (p: RemotePreview): ShownPreview => ({ inline: p.inline, stillOpen: p.stillOpen, resolved: p.resolved, summaryBody: p.summaryBody })

/** The sentence the panel shows for a failed Connected call (UX-DR8). */
export function connectionProblem(c: Connection, e: unknown): string {
  if (e instanceof UnreachableError) {
    return c.kind === 'local' ? "pr-reviewer on this computer isn't running. Start it with: pr-reviewer serve --pair." : `Can't reach your Web App at ${new URL(c.baseUrl).host}. Check the address or your network.`
  }
  if (e instanceof ServiceError && (e.status === 401 || e.status === 403)) {
    return c.kind === 'local' ? 'This computer no longer accepts the extension. Pair again with: pr-reviewer serve --pair.' : 'Your Web App sign-in for the extension expired or was revoked. Connect again in Settings.'
  }
  return (e as Error).message
}
