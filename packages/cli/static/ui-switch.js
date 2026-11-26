// Classic and v2 review pages side by side (Epic 9 Story 9.3). Which one opens: the browser's own choice
// (remembered here), then the server default (`serve --ui` or the Web App's PR_REVIEWER_DEFAULT_UI), which
// is classic until v2 passes the parity checklist (docs/review-page-v2.md).

const KEY = 'pr-reviewer-ui'
export const PATHS = { classic: '/classic/', v2: '/v2/' }

/** The page the browser asked for earlier, or undefined. */
export function preferredUi(storage = globalThis.localStorage) {
  try {
    const v = storage?.getItem(KEY)
    return v === 'classic' || v === 'v2' ? v : undefined
  } catch {
    return undefined
  }
}

export function rememberUi(ui, storage = globalThis.localStorage) {
  try {
    storage?.setItem(KEY, ui)
  } catch {}
}

/** Where to go instead of the current page, if the browser prefers the other one; otherwise undefined. */
export function redirectFor(current, preferred, hash = '') {
  if (!preferred || preferred === current) return undefined
  return `${PATHS[preferred]}${hash}`
}

/** Call first thing on each page: follows the browser's remembered choice (keeping the URL fragment, which may carry serve's key). */
export function followPreference(current, loc = globalThis.location, storage = globalThis.localStorage) {
  const to = redirectFor(current, preferredUi(storage), loc?.hash ?? '')
  if (to) loc.replace(to)
  return to
}

/** Switch pages and remember the choice for this browser. */
export function switchTo(ui, loc = globalThis.location, storage = globalThis.localStorage) {
  rememberUi(ui, storage)
  loc.assign(PATHS[ui])
}
