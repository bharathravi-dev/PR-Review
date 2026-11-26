// Tickets (roadmap item 11): Jira or Linear work items a PR names, found by key in its title, branch and description.

export interface Ticket {
  /** e.g. ENG-123 */
  key: string
  source: 'jira' | 'linear'
  title: string
  body: string
  url: string
}

/** At most this many tickets are fetched and shown to the AI. */
export const MAX_TICKETS = 3
const KEY = /\b([A-Z][A-Z0-9]{1,9})-(\d{1,7})\b/g
/** Prefixes that look like ticket keys but name standards, encodings or advisories. */
const NOT_TICKETS = new Set(['UTF', 'ISO', 'SHA', 'CVE', 'GHSA', 'RFC', 'HTTP', 'TLS', 'SSL', 'GPL', 'LGPL', 'MIT', 'BSD', 'ES', 'ECMA', 'IEEE', 'AES', 'RSA', 'MD', 'X'])

/** Ticket keys named in these texts, in order, without look-alikes; at most MAX_TICKETS. */
export function ticketKeys(...texts: string[]): string[] {
  const out: string[] = []
  for (const text of texts) {
    for (const m of text.matchAll(KEY)) {
      const key = `${m[1]}-${m[2]}`
      if (!NOT_TICKETS.has(m[1]!) && !out.includes(key)) out.push(key)
    }
  }
  return out.slice(0, MAX_TICKETS)
}
