import { describe, expect, it } from 'vitest'
import type { GitHubReader } from './ports.js'
import { ok } from './result.js'
import { changedSymbols, findUsages } from './usages.js'

const repo = { host: 'github.com', owner: 'acme', repo: 'api' }

describe('codebase context (roadmap item 17)', () => {
  it('finds the symbols a patch declares or edits, longest first, without common names', () => {
    const patch = [
      '@@ -10,6 +10,7 @@ export async function chargeCustomer(order: Order) {',
      '+export const retryPolicy = { max: 3 }',
      '+  const total = order.items.length',
      '@@ -40,3 +41,4 @@ def refund_payment(order):',
      '+class LedgerEntry:',
      '+export default function render() {}',
      '@@ -90,2 +92,2 @@ func (s *Server) HandleWebhook(w http.ResponseWriter) {',
    ].join('\n')
    expect(changedSymbols(patch)).toEqual(['chargeCustomer', 'refund_payment', 'HandleWebhook', 'retryPolicy', 'LedgerEntry'])
    expect(changedSymbols(undefined)).toEqual([])
  })

  it('shows code that uses them across the repository, and in other repositories when asked', async () => {
    const calls: unknown[] = []
    const reader = {
      searchCode: async (q: { repo?: unknown; owner?: string; symbol: string }) => {
        calls.push(q)
        if (q.repo) return ok([{ repo: 'acme/api', path: 'src/billing/invoice.ts', fragments: ['await chargeCustomer(order)'] }, { repo: 'acme/api', path: 'src/pay.ts', fragments: ['chargeCustomer'] }])
        return ok([{ repo: 'acme/web', path: 'app/checkout.ts', fragments: ['api.chargeCustomer(cart)'] }, { repo: 'acme/api', path: 'src/billing/invoice.ts', fragments: ['x'] }])
      },
    } as unknown as GitHubReader
    const out = await findUsages(reader, repo, ['chargeCustomer'], new Set(['src/pay.ts']), { crossRepo: true })
    expect(out.related).toEqual([
      { path: 'src/billing/invoice.ts', relation: 'uses chargeCustomer (repository search)', text: 'await chargeCustomer(order)', excerpt: true },
      { path: 'acme/web:app/checkout.ts', relation: 'uses chargeCustomer in acme/web (another repository)', text: 'api.chargeCustomer(cart)', excerpt: true },
    ])
    expect(out.notes).toEqual(['Changed code is used in other repositories: acme/web.'])
    expect(calls).toEqual([
      { repo, symbol: 'chargeCustomer', limit: 8 },
      { owner: 'acme', symbol: 'chargeCustomer', limit: 8 },
    ])
  })

  it('stays within its budget and says when search is unavailable', async () => {
    const many = { searchCode: async () => ok(Array.from({ length: 20 }, (_, i) => ({ repo: 'acme/api', path: `f${i}.ts`, fragments: ['x'.repeat(1500)] }))) } as unknown as GitHubReader
    const out = await findUsages(many, repo, ['alpha', 'betaa'], new Set())
    expect(out.related.length).toBeLessThanOrEqual(6)
    expect(out.related.reduce((n, r) => n + r.text.length, 0)).toBeLessThanOrEqual(12_000)
    const down = { searchCode: async () => ({ ok: false, error: { code: 'x', message: 'GitHub answered 403', retryable: false } }) } as unknown as GitHubReader
    expect((await findUsages(down, repo, ['alpha'], new Set())).notes).toEqual(['Repository search was not available: GitHub answered 403'])
    expect(await findUsages({} as GitHubReader, repo, ['alpha'], new Set())).toEqual({ related: [], notes: [] })
  })
})
