// The Review button in a GitHub PR header (Story 7.5). Self-styled inside a shadow root; reads no PR data from the page
// (the PR comes from the URL); label from the panel's stored state; follows GitHub's colour mode.
import { findPlacement, githubTheme } from './placement.js'
import { buttonLabel, prKey, type PrState } from './state.js'

const HOST_ID = 'pr-reviewer-review-button'
const CSS = `
:host { all: initial; display: inline-flex; margin-left: 8px; vertical-align: middle; }
button { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px; height: 28px; min-width: 24px; padding: 0 10px; border-radius: 8px; font: 600 12px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; cursor: pointer; white-space: nowrap; background: var(--accent); color: var(--accent-text); border: 1px solid var(--accent); }
button.outdated { background: var(--warn-bg); color: var(--warn); border-color: var(--warn); }
button:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
button.outdated:hover { background: var(--warn-bg); border-color: var(--warn); }
button:focus-visible { outline: 2px solid var(--ring-outer); outline-offset: 2px; box-shadow: 0 0 0 2px var(--ring-inner); }
.mark { width: 16px; height: 16px; flex: none; display: block; }
.ring { width: 10px; height: 10px; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.light { --accent: #FF7B02; --accent-hover: #E66A00; --accent-text: #111827; --ok: #1d7a46; --warn: #8a5a00; --warn-bg: #fdf1d6; --ring-outer: #111827; --ring-inner: #FFFFFF; }
.dark { --accent: #FF7B02; --accent-hover: #E66A00; --accent-text: #090A1A; --ok: #28A08C; --warn: #f0c35a; --warn-bg: #352a12; --ring-outer: #FFFFFF; --ring-inner: #090A1A; }
@media (forced-colors: active) { button { border: 1px solid ButtonText; } button:focus-visible { outline-color: Highlight; } }
`

function currentPr(): string | undefined {
  const m = /^\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:\/|$)/.exec(location.pathname)
  return m ? `${m[1]}/${m[2]}#${m[3]}` : undefined
}

let button: HTMLButtonElement | undefined
let live: HTMLElement | undefined
let shownFor: string | undefined

async function stateFor(pr: string): Promise<PrState | undefined> {
  const all = ((await chrome.storage.local.get('pr-state'))['pr-state'] as Record<string, PrState> | undefined) ?? {}
  return all[prKey(pr)]
}

function theme(): 'light' | 'dark' {
  const d = document.documentElement
  return githubTheme({ colorMode: d.getAttribute('data-color-mode'), darkTheme: d.getAttribute('data-dark-theme'), lightTheme: d.getAttribute('data-light-theme') }, matchMedia('(prefers-color-scheme: dark)').matches) ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
}

const SVG = 'http://www.w3.org/2000/svg'
function reviewIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.6')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  for (const d of ['M2.5 3h11v7.5h-6.2L4.2 13v-2.5H2.5z', 'M5.6 6.9l1.6 1.6 3.2-3.2']) {
    const path = document.createElementNS(SVG, 'path')
    path.setAttribute('d', d)
    svg.append(path)
  }
  return svg
}

async function paint(pr: string): Promise<void> {
  if (!button) return
  const { label, state } = buttonLabel(await stateFor(pr))
  const glyph = state === 'running' ? 'ring' : 'mark'
  // Update in place so focus is kept (UX-DR16).
  button.className = state === 'outdated' ? 'outdated' : ''
  button.replaceChildren()
  // A vector icon (a review bubble with a check) stays sharp at any zoom; tiny text did not.
  const g = glyph === 'mark' ? reviewIcon() : document.createElement('span')
  g.setAttribute('class', glyph)
  g.setAttribute('aria-hidden', 'true')
  const text = document.createElement('span')
  text.textContent = label
  const suffix = document.createElement('span')
  suffix.className = 'sr'
  suffix.textContent = state === 'review' ? ' this PR, pr-reviewer' : ', pr-reviewer'
  button.append(g, text, suffix)
  button.dataset.state = state
  const wrap = button.parentElement
  if (wrap) wrap.className = theme()
}

function mount(): void {
  const pr = currentPr()
  const existing = document.getElementById(HOST_ID)
  if (!pr) {
    existing?.remove()
    shownFor = undefined
    return
  }
  const place = findPlacement(document) as HTMLElement | undefined
  if (existing && existing.isConnected && shownFor === pr) return
  if (!place) return
  const hadFocus = existing?.shadowRoot?.activeElement === button
  existing?.remove()
  const host = document.createElement('span')
  host.id = HOST_ID
  const root = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = CSS
  const wrap = document.createElement('span')
  wrap.className = theme()
  button = document.createElement('button')
  button.type = 'button'
  live = document.createElement('span')
  live.className = 'sr'
  live.setAttribute('role', 'status')
  button.addEventListener('click', () => {
    void chrome.runtime.sendMessage({ type: 'open-panel', pr, start: button?.dataset.state === 'review' })
    if (live) {
      live.textContent = ''
      setTimeout(() => live && (live.textContent = 'Opened in the pr-reviewer side panel. Press F6 to move there.'), 50)
    }
  })
  wrap.append(button)
  root.append(style, wrap, live)
  place.append(host)
  shownFor = pr
  void paint(pr)
  if (hadFocus) button.focus()
}

chrome.storage.onChanged?.addListener((changes) => {
  if (changes['pr-state'] && shownFor) void paint(shownFor)
})

// GitHub navigates client-side: re-check on its navigation events and on DOM changes, cheaply.
let queued = false
const check = () => {
  if (queued) return
  queued = true
  requestAnimationFrame(() => {
    queued = false
    mount()
  })
}
for (const ev of ['turbo:load', 'turbo:render', 'pjax:end', 'popstate']) addEventListener(ev, check)
new MutationObserver(check).observe(document.documentElement, { childList: true, subtree: true })
check()
