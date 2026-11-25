import { describe, expect, it } from 'vitest'
import { OsvAdvisories } from './osv.js'

describe('OsvAdvisories', () => {
  it('batches the query, fetches details, and extracts severity and the fixed version', async () => {
    const seen: string[] = []
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const req = new Request(input, init)
      seen.push(`${req.method} ${req.url}`)
      if (req.url.endsWith('/v1/querybatch')) {
        const body = (await req.json()) as { queries: Array<{ package: { name: string } }> }
        return Response.json({ results: body.queries.map((q) => (q.package.name === 'lodash' ? { vulns: [{ id: 'GHSA-35jh' }] } : {})) })
      }
      return Response.json({
        id: 'GHSA-35jh',
        summary: 'Command Injection in lodash',
        aliases: ['CVE-2021-23337'],
        database_specific: { severity: 'HIGH' },
        affected: [{ package: { name: 'lodash', ecosystem: 'npm' }, ranges: [{ events: [{ introduced: '0' }, { fixed: '4.17.21' }] }] }],
      })
    }) as typeof globalThis.fetch
    const osv = new OsvAdvisories({ fetch })
    const res = await osv.query([{ ecosystem: 'npm', name: 'lodash', version: '4.17.20' }, { ecosystem: 'npm', name: 'left-pad', version: '1.3.0' }])
    expect(res).toEqual({
      ok: true,
      value: [
        { name: 'lodash', version: '4.17.20', advisories: [{ id: 'GHSA-35jh', summary: 'Command Injection in lodash', severity: 'HIGH', aliases: ['CVE-2021-23337'], url: 'https://osv.dev/vulnerability/GHSA-35jh', fixedIn: '4.17.21' }] },
        { name: 'left-pad', version: '1.3.0', advisories: [] },
      ],
    })
    expect(seen).toEqual(['POST https://api.osv.dev/v1/querybatch', 'GET https://api.osv.dev/v1/vulns/GHSA-35jh'])
    expect(osv.source).toBe('OSV (osv.dev)')
  })

  it('reports an unreachable database as retryable', async () => {
    const osv = new OsvAdvisories({ url: 'https://osv.internal/', fetch: (async () => { throw new TypeError('fetch failed') }) as typeof fetch })
    expect(await osv.query([{ ecosystem: 'npm', name: 'a', version: '1.0.0' }])).toMatchObject({ ok: false, error: { retryable: true } })
  })
})
