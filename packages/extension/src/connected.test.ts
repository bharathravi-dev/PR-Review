import type { RunEvent } from '@pr-reviewer/core'
import { describe, expect, it } from 'vitest'
import { connectionProblem, createClient, pairWithComputer, ServiceError, sseParser, tokenFromRedirect, UnreachableError, webAppAuthUrl, webAppOrigin, type Connection } from './connected.js'

const EXT = 'abcdefghijklmnopabcdefghijklmnop'
const ev = (seq: number, type = 'STAGE_STARTED'): RunEvent => ({ schemaVersion: 1, runId: 'r1', seq, at: '2026-11-26T00:00:00Z', type, payload: {} }) as unknown as RunEvent
const sse = (events: RunEvent[]) => events.map((e) => `id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('')

/** A body that arrives in awkward pieces, then optionally drops. */
function body(text: string, pieces: number[], drop = false): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text)
  let at = 0
  return new ReadableStream({
    pull(c) {
      const n = pieces.shift()
      if (n === undefined) return drop ? c.error(new Error('reset')) : c.close()
      c.enqueue(bytes.slice(at, at + n))
      at += n
    },
  })
}

describe('Connected mode client (Stories 7.7, 7.8)', () => {
  it('accepts https Web App addresses (http only on this machine) and checks the sign-in redirect', () => {
    expect(webAppOrigin('reviews.example.com/some/page')).toBe('https://reviews.example.com')
    expect(webAppOrigin('http://reviews.example.com')).toBeUndefined()
    expect(webAppOrigin('http://localhost:8080')).toBe('http://localhost:8080')
    expect(webAppOrigin('https://u:p@reviews.example.com')).toBeUndefined()
    expect(webAppOrigin('not a url at all')).toBeUndefined()
    expect(webAppAuthUrl('https://r.example', EXT, 'st')).toBe(`https://r.example/auth/extension?ext=${EXT}&state=st`)
    expect(tokenFromRedirect(`https://${EXT}.chromiumapp.org/#token=tok&state=st`, EXT, 'st')).toBe('tok')
    expect(tokenFromRedirect(`https://${EXT}.chromiumapp.org/#token=tok&state=other`, EXT, 'st')).toBeUndefined()
    expect(tokenFromRedirect(`https://evil.example/#token=tok&state=st`, EXT, 'st')).toBeUndefined()
    expect(tokenFromRedirect(undefined, EXT, 'st')).toBeUndefined()
  })

  it('parses events split anywhere across chunks', () => {
    const got: number[] = []
    const feed = sseParser((e) => got.push(e.seq))
    const text = `: ping\n\n${sse([ev(1), ev(2), ev(3)])}`
    for (let i = 0; i < text.length; i += 7) feed(text.slice(i, i + 7))
    expect(got).toEqual([1, 2, 3])
  })

  it('pairs with a code and reports a wrong code, an expired one, and a computer that is not running', async () => {
    const calls: Array<{ url: string; body: string }> = []
    const ok = (async (url: string, init: RequestInit) => (calls.push({ url, body: String(init.body) }), Response.json({ schemaVersion: 1, token: 't', computer: 'devbox', port: 4747 }))) as unknown as typeof fetch
    expect(await pairWithComputer(4747, 'ABCD-2345', ok)).toEqual({ token: 't', computer: 'devbox', port: 4747 })
    expect(calls[0]).toEqual({ url: 'http://127.0.0.1:4747/pair', body: '{"code":"ABCD-2345"}' })
    const answer = (status: number, code: string) => (async () => Response.json({ error: { code, message: 'm' } }, { status })) as unknown as typeof fetch
    await expect(pairWithComputer(4747, 'x', answer(400, 'pair_code_wrong'))).rejects.toMatchObject({ code: 'pair_code_wrong' })
    await expect(pairWithComputer(4747, 'x', answer(410, 'pair_code_expired'))).rejects.toMatchObject({ code: 'pair_code_expired' })
    const down = (async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    const e = await pairWithComputer(4747, 'x', down).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(UnreachableError)
    const local: Connection = { kind: 'local', baseUrl: 'http://127.0.0.1:4747', token: 't' }
    expect(connectionProblem(local, e)).toBe("pr-reviewer on this computer isn't running. Start it with: pr-reviewer serve --pair.")
    expect(connectionProblem({ kind: 'web', baseUrl: 'https://r.example', token: 't' }, new ServiceError(401, 'unauthorized', 'x'))).toContain('Connect again in Settings')
  })

  it('sends its token and schema, resumes a dropped event stream after the last event, and posts with the preview digest', async () => {
    const seen: Array<{ url: string; method: string; auth: string | null; schema: string | null; last: string | null; body?: unknown }> = []
    let stream = 0
    const impl = (async (url: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers)
      seen.push({ url, method: init.method ?? 'GET', auth: headers.get('authorization'), schema: headers.get('accept-schema'), last: headers.get('last-event-id'), ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) })
      if (url.endsWith('/v1/session')) return Response.json({ schemaVersion: 1, github: { host: 'github.com', login: 'me' }, ai: { provider: 'claude-code', ready: true } })
      if (url.endsWith('/v1/runs')) return Response.json({ id: 'r1', pr: 'o/r#1' }, { status: 202 })
      if (url.endsWith('/events')) {
        stream++
        if (stream === 1) return new Response(body(sse([ev(1), ev(2)]), [30, 400], true))
        return new Response(body(sse([ev(3), ev(4, 'DONE')]), [1000]))
      }
      if (url.endsWith('/publish')) {
        const b = JSON.parse(String(init.body)) as { dryRun?: boolean }
        if (b.dryRun) return Response.json({ preview: { summaryBody: 's', inline: [], stillOpen: [], resolved: [] }, digest: 'd1' })
        return Response.json({ record: { status: 'PUBLISHED' } })
      }
      return Response.json({ error: { code: 'not_found', message: 'Not found.' } }, { status: 404 })
    }) as unknown as typeof fetch
    const client = createClient({ kind: 'local', baseUrl: 'http://127.0.0.1:4747', token: 'tok' }, impl)
    expect((await client.session()).github.login).toBe('me')
    expect((await client.startRun('o/r#1')).id).toBe('r1')
    const got: number[] = []
    await client.events('r1', (e) => got.push(e.seq))
    expect(got).toEqual([1, 2, 3, 4])
    expect(seen.filter((s) => s.url.endsWith('/events')).map((s) => s.last)).toEqual([null, '2'])
    expect(seen.every((s) => s.auth === 'Bearer tok' && s.schema === '1')).toBe(true)
    const p = await client.preview('r1', { include: ['fp1'] })
    expect(p.digest).toBe('d1')
    expect((await client.publish('r1', { include: ['fp1'] }, p.digest)).status).toBe('PUBLISHED')
    expect(seen.at(-1)!.body).toEqual({ event: 'COMMENT', include: ['fp1'], previewDigest: 'd1' })
    await expect(client.report('missing')).rejects.toBeInstanceOf(ServiceError)
  })

  it('refuses a server that speaks another schema', async () => {
    const impl = (async () => Response.json({ schemaVersion: 2, github: { host: 'github.com' }, ai: { provider: 'x', ready: true } })) as unknown as typeof fetch
    await expect(createClient({ kind: 'web', baseUrl: 'https://r.example', token: 't' }, impl).session()).rejects.toMatchObject({ code: 'schema_unsupported' })
  })
})
