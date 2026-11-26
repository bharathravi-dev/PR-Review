// ReviewService v1 client for review page v2: the same contract and auth as classic (AD-16).

const TOKEN_KEY = 'pr-reviewer-token'
export const MODE = document.querySelector('meta[name="pr-reviewer-mode"]')?.content === 'web' ? 'web' : 'local'

function readToken() {
  const m = /(?:^#|&)token=([A-Za-z0-9_-]+)/.exec(location.hash)
  if (m) {
    try {
      sessionStorage.setItem(TOKEN_KEY, m[1])
    } catch {}
    history.replaceState(null, '', location.pathname + location.search)
    return m[1]
  }
  try {
    return sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export const token = MODE === 'local' ? readToken() : null
export const authHeaders = () => (MODE === 'local' ? { authorization: `Bearer ${token}`, 'accept-schema': '1' } : { 'accept-schema': '1' })

/** Called on 401: serve's key is gone (locked) or the Web App session ended (sign in). */
let onUnauthorized = () => {}
export const whenUnauthorized = (fn) => (onUnauthorized = fn)

export async function api(path, { method = 'GET', body } = {}) {
  const headers = authHeaders()
  if (body !== undefined) headers['content-type'] = 'application/json'
  let res
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    throw new Error(MODE === 'local' ? 'Cannot reach pr-reviewer. Is `pr-reviewer serve` still running?' : 'Cannot reach the review server.')
  }
  const text = await res.text()
  let data = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { text }
  }
  if (res.status === 401) {
    if (MODE === 'local') {
      try {
        sessionStorage.removeItem(TOKEN_KEY)
      } catch {}
    }
    onUnauthorized()
    throw new Error('unauthorized')
  }
  return { status: res.status, ok: res.ok, data }
}

export const errorText = (r) => r.data?.error?.message ?? `Request failed (HTTP ${r.status}).`

/** Reads a run's events (fetch-based SSE so the bearer token can be sent), resuming with Last-Event-ID. */
export async function streamEvents(runId, onEvent) {
  let last = 0
  for (let attempt = 0; attempt < 5; attempt++) {
    const headers = authHeaders()
    if (last) headers['last-event-id'] = String(last)
    let res
    try {
      res = await fetch(`/v1/runs/${runId}/events`, { headers })
    } catch {
      await new Promise((r) => setTimeout(r, 1000))
      continue
    }
    if (res.status === 401) {
      onUnauthorized()
      throw new Error('unauthorized')
    }
    if (!res.ok || !res.body) throw new Error(`Progress stream failed (HTTP ${res.status}).`)
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    let buf = ''
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += value
        let i
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i)
          buf = buf.slice(i + 2)
          const data = chunk.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n')
          if (!data) continue
          const ev = JSON.parse(data)
          last = ev.seq
          onEvent(ev)
          if (ev.type === 'DONE') return
        }
      }
    } catch {
      // Connection dropped; resume from the last event.
    }
  }
  throw new Error('Lost the connection while the review was running.')
}

export async function downloadMarkdown(runId) {
  const res = await fetch(`/v1/runs/${runId}/report?format=markdown`, { headers: authHeaders() })
  return res.ok ? res.text() : undefined
}
