// Keyboard model of review page v2 (EXPERIENCE.md Interaction Primitives). Pure: no DOM access beyond reading
// the event and the element it targets, so it is unit-tested.

/** Default bindings; Settings → Keyboard can remap each. "mod" is ⌘ on macOS and Ctrl elsewhere. */
export const DEFAULT_BINDINGS = {
  palette: 'mod+k',
  help: '?',
  goStart: 'g n',
  goOverview: 'g o',
  goAttention: 'g a',
  goPre: 'g p',
  goChecks: 'g c',
  goWalkthrough: 'g w',
  goStats: 'g s',
  filter: '/',
  next: 'j',
  prev: 'k',
  toggle: 'x',
  edit: 'e',
  copyPrompt: 'c',
  post: 'p',
}

/** Actions that work on the shown finding: only when focus is in the list or the detail. */
const FINDING_ACTIONS = new Set(['next', 'prev', 'toggle', 'edit', 'copyPrompt'])
const TYPING_ROLES = new Set(['combobox', 'textbox', 'searchbox', 'spinbutton', 'slider', 'listbox', 'menu', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option'])
const CHORD_MS = 1200

/** True when keys typed here belong to the control, never to page shortcuts. */
export function isTypingTarget(el) {
  if (!el || typeof el !== 'object') return false
  const tag = String(el.tagName ?? '').toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  if (el.isContentEditable) return true
  const role = typeof el.getAttribute === 'function' ? el.getAttribute('role') : null
  return role !== null && TYPING_ROLES.has(role)
}

/** The keys a binding names, for display ("mod+k" → ["⌘", "K"] on macOS). */
export function keyLabels(binding, mac = true) {
  return binding.split(/\s+/).flatMap((part) => part.split('+').map((k) => (k === 'mod' ? (mac ? '⌘' : 'Ctrl') : k.length === 1 ? k : k)))
}

/**
 * A keymap with chord memory. `handle(event, ctx)` returns an action name or null.
 * ctx: { inFindings: focus is in the list or detail; dialogOpen: palette, drawer or sheet is open }.
 * mode: 'on' (default), 'focus' (single keys only with focus in the list or detail), 'off' (no single-key shortcuts).
 */
export function createKeymap(bindings = DEFAULT_BINDINGS, mode = 'on') {
  const single = new Map()
  const chords = new Map()
  let modK = null
  for (const [action, b] of Object.entries(bindings)) {
    if (b === 'mod+k' || /^mod\+/.test(b)) modK = { action, key: b.slice(4).toLowerCase() }
    else if (b.includes(' ')) chords.set(b, action)
    else single.set(b, action)
  }
  let pending = null

  return {
    handle(event, ctx = {}) {
      if (event.isComposing) return null
      const key = event.key
      const mod = event.metaKey || event.ctrlKey
      if (mod && !event.altKey && modK && key.toLowerCase() === modK.key) {
        pending = null
        return ctx.dialogOpen ? null : modK.action
      }
      if (mod || event.altKey) return null
      if (ctx.dialogOpen || isTypingTarget(event.target) || mode === 'off') {
        pending = null
        return null
      }
      if (mode === 'focus' && !ctx.inFindings) return null
      if (pending && event.timeStamp - pending.at <= CHORD_MS) {
        const action = chords.get(`${pending.key} ${key}`)
        pending = null
        if (action) return action
      }
      pending = null
      if ([...chords.keys()].some((c) => c.startsWith(`${key} `))) {
        pending = { key, at: event.timeStamp }
        return null
      }
      if (event.shiftKey && key !== '?') return null
      const action = single.get(key)
      if (!action) return null
      if (FINDING_ACTIONS.has(action) && !ctx.inFindings) return null
      return action
    },
  }
}

/** Validates a remapping: no empty keys, no two actions on one binding, no shadowing of a chord's first key. */
export function bindingProblems(bindings) {
  const problems = []
  const seen = new Map()
  for (const [action, b] of Object.entries(bindings)) {
    if (!b || !b.trim()) problems.push(`${action}: no key`)
    else if (seen.has(b)) problems.push(`${action} and ${seen.get(b)} both use "${b}"`)
    else seen.set(b, action)
  }
  const firsts = new Set(Object.values(bindings).filter((b) => b.includes(' ')).map((b) => b.split(' ')[0]))
  for (const [action, b] of Object.entries(bindings)) if (!b.includes(' ') && firsts.has(b)) problems.push(`${action} uses "${b}", which starts a two-key shortcut`)
  return problems
}
