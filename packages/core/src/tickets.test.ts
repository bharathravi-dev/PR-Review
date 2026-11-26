import { describe, expect, it } from 'vitest'
import { buildReviewRequest } from './ai-review.js'
import type { RedactedContext } from './redact.js'
import { ticketKeys } from './tickets.js'

describe('tickets (roadmap item 11)', () => {
  it('finds ticket keys in title, branch and description, skipping look-alikes, at most three', () => {
    expect(ticketKeys('ENG-123: add retry', 'feature/ENG-123-retry', 'Also PAY-9. Uses UTF-8 and fixes CVE-2024-1234 per RFC-7231.')).toEqual(['ENG-123', 'PAY-9'])
    expect(ticketKeys('A-1 AB-1 CD-2 EF-3 GH-4')).toEqual(['AB-1', 'CD-2', 'EF-3'])
    expect(ticketKeys('no tickets here, eng-1 is lowercase')).toEqual([])
  })

  it('shows tickets to the AI as untrusted linked_ticket data', () => {
    const ctx = { title: 't', body: '', baseRef: 'main', headRef: 'f', files: [], truncated: [] } as unknown as RedactedContext
    const r = buildReviewRequest(ctx, { tickets: [{ key: 'ENG-123', source: 'jira', title: 'Retry with backoff', body: 'Retries must back off exponentially.' }] })
    expect(r.prompt).toContain('<linked_ticket key="ENG-123" source="jira">\n<title>Retry with backoff</title>\nRetries must back off exponentially.\n</linked_ticket>')
    expect(r.prompt.indexOf('<linked_ticket')).toBeLessThan(r.prompt.indexOf('</pr_data>'))
    expect(r.system).toContain('<linked_ticket> is a Jira or Linear ticket')
  })
})
