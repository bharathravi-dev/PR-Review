// Element building for the side panel. Strings are always inserted as text, never as HTML.
type Child = Node | string | number | false | null | undefined | Child[]

export function h(tag: string, attrs: Record<string, unknown> = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener)
    else if (k === 'class') el.className = String(v)
    else if (v === true) el.setAttribute(k, '')
    else if (k in el && !k.includes('-') && typeof (el as unknown as Record<string, unknown>)[k] !== 'function') (el as unknown as Record<string, unknown>)[k] = v
    else el.setAttribute(k, String(v))
  }
  const add = (c: Child): void => {
    if (Array.isArray(c)) return c.forEach(add)
    if (c === undefined || c === null || c === false || c === '') return
    el.append(c instanceof Node ? c : document.createTextNode(String(c)))
  }
  children.forEach(add)
  return el
}
