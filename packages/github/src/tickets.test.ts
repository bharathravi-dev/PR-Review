import { describe, expect, it } from 'vitest'
import { createTicketPort } from './tickets.js'

describe('Jira and Linear tickets', () => {
  it('reads Jira first, then Linear, and leaves out tickets it cannot read', async () => {
    const seen: Array<{ url: string; auth: string | null }> = []
    const fetchImpl = (async (url: string, init: RequestInit = {}) => {
      seen.push({ url, auth: new Headers(init.headers).get('authorization') })
      if (url.includes('/rest/api/2/issue/ENG-1')) return Response.json({ key: 'ENG-1', fields: { summary: 'Backoff', description: 'Retry with backoff.\r\n' } })
      if (url.includes('/rest/api/2/issue/')) return new Response('', { status: 404 })
      const { variables } = JSON.parse(String(init.body)) as { variables: { id: string } }
      return Response.json({ data: { issue: variables.id === 'LIN-2' ? { identifier: 'LIN-2', title: 'Docs', description: null, url: 'https://linear.app/x/issue/LIN-2' } : null } })
    }) as unknown as typeof fetch
    const port = createTicketPort({ fetch: fetchImpl, jira: { baseUrl: 'https://acme.atlassian.net/', email: 'a@b', token: 't0k' }, linear: { apiKey: 'lin_key' } })
    expect(await port(['ENG-1', 'LIN-2', 'NOPE-3'])).toEqual([
      { key: 'ENG-1', source: 'jira', title: 'Backoff', body: 'Retry with backoff.', url: 'https://acme.atlassian.net/browse/ENG-1' },
      { key: 'LIN-2', source: 'linear', title: 'Docs', body: '', url: 'https://linear.app/x/issue/LIN-2' },
    ])
    expect(seen[0]!.auth).toBe(`Basic ${Buffer.from('a@b:t0k').toString('base64')}`)
    expect(seen.find((s) => s.url.startsWith('https://api.linear.app'))!.auth).toBe('lin_key')
  })
})
