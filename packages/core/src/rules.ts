/**
 * Turns a Review Rules Markdown document into checklist items (AD-13): its top-level bullet or numbered
 * list items, with continuation lines joined. Headings and prose are context only and are not rules.
 */
export function parseRulesChecklist(markdown: string): string[] {
  const items: string[] = []
  let current: string | undefined
  let inFence = false
  for (const raw of markdown.replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const item = /^(?:[-*+]|\d+[.)])\s+(.+)$/.exec(raw)
    if (item) {
      if (current) items.push(current)
      current = item[1]!.trim()
    } else if (current && /^\s{2,}\S/.test(raw) && !/^\s*(?:[-*+]|\d+[.)])\s/.test(raw)) {
      current = `${current} ${raw.trim()}`
    } else if (current && raw.trim() === '') {
      items.push(current)
      current = undefined
    }
  }
  if (current) items.push(current)
  return items
}
