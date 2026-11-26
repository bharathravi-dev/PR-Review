// Jira and Linear tickets (roadmap item 11): the work item a PR implements, so the review can check the change
// against it. Keys come from the PR's title, branch and description; the ticket text is untrusted data.
import type { Ticket } from '@pr-reviewer/core'

export interface TicketOptions {
  fetch: typeof fetch
  jira?: { baseUrl: string; email: string; token: string } | undefined
  linear?: { apiKey: string } | undefined
}

const strip = (s: string) => s.replace(/\r\n/g, '\n').trim()

/** Fetches each key from Jira first, then Linear; tickets that can't be read are left out. */
export function createTicketPort(o: TicketOptions): (keys: readonly string[]) => Promise<Ticket[]> {
  const jira = async (key: string): Promise<Ticket | undefined> => {
    if (!o.jira) return undefined
    const base = o.jira.baseUrl.replace(/\/+$/, '')
    const res = await o
      .fetch(`${base}/rest/api/2/issue/${encodeURIComponent(key)}?fields=summary,description`, {
        headers: { accept: 'application/json', authorization: `Basic ${Buffer.from(`${o.jira.email}:${o.jira.token}`).toString('base64')}` },
      })
      .catch(() => undefined)
    if (!res?.ok) return undefined
    const d = (await res.json().catch(() => undefined)) as { key?: string; fields?: { summary?: string; description?: string | null } } | undefined
    return d?.fields?.summary ? { key: d.key ?? key, source: 'jira', title: d.fields.summary, body: strip(d.fields.description ?? ''), url: `${base}/browse/${d.key ?? key}` } : undefined
  }
  const linear = async (key: string): Promise<Ticket | undefined> => {
    if (!o.linear) return undefined
    const res = await o
      .fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: o.linear.apiKey },
        body: JSON.stringify({ query: 'query($id: String!) { issue(id: $id) { identifier title description url } }', variables: { id: key } }),
      })
      .catch(() => undefined)
    if (!res?.ok) return undefined
    const d = (await res.json().catch(() => undefined)) as { data?: { issue?: { identifier: string; title: string; description?: string | null; url: string } | null } } | undefined
    const i = d?.data?.issue
    return i ? { key: i.identifier, source: 'linear', title: i.title, body: strip(i.description ?? ''), url: i.url } : undefined
  }
  return async (keys) => {
    const out: Ticket[] = []
    for (const key of keys) {
      const t = (await jira(key)) ?? (await linear(key))
      if (t) out.push(t)
    }
    return out
  }
}
