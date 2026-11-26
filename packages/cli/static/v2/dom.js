// Element building for review page v2. Text from GitHub, the PR or the AI is always set as text, never as HTML.

/** h('div', { class: 'x', onclick }, child, 'text', [more]) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v)
    else if (k === 'class') el.className = v
    else if (k === 'text') el.textContent = v
    else if (v === true) el.setAttribute(k, '')
    else if (k in el && typeof el[k] !== 'function' && !k.includes('-')) el[k] = v
    else el.setAttribute(k, String(v))
  }
  append(el, children)
  return el
}

/** Replaces an element's children, flattening arrays and skipping empty values (like h()). */
export function fill(el, ...children) {
  el.replaceChildren()
  append(el, children)
  return el
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === undefined || c === null || c === false || c === '') continue
    el.append(c instanceof Node ? c : document.createTextNode(String(c)))
  }
}

export const $ = (id) => document.getElementById(id)

/** A link to GitHub only (finding paths, PRs): https on the configured host; anything else becomes text. */
export function safeLink(href, label, host = 'github.com', attrs = {}) {
  const ok = typeof href === 'string' && (href.startsWith(`https://${host}/`) || href.startsWith('https://github.com/'))
  return ok ? h('a', { href, target: '_blank', rel: 'noopener noreferrer', ...attrs }, label) : h('span', {}, label)
}

/** Keyboard key glyphs, hidden from assistive technology (the control names its shortcut via aria-keyshortcuts). */
export const kbd = (...keys) => keys.map((k) => h('kbd', { 'aria-hidden': 'true' }, k))

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
