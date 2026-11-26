// Where the Review button goes in GitHub's PR header (UX-DR16). Only placement is read from the page; the PR comes
// from the URL. GitHub changes its markup, so several known places are tried; none found means no button.

/** Known containers for the PR header's actions, newest layouts first. */
export const PLACEMENT_SELECTORS = [
  '[data-component="PH_Actions"]',
  '[class*="PageHeader-Actions"]',
  '.gh-header-actions',
  '.gh-header-show .gh-header-actions',
  '#partial-discussion-header .gh-header-actions',
]

interface DocLike {
  querySelector(selector: string): unknown
}

/** The first matching container, or undefined. */
export function findPlacement(doc: DocLike): unknown {
  for (const s of PLACEMENT_SELECTORS) {
    const el = doc.querySelector(s)
    if (el) return el
  }
  return undefined
}

/** GitHub's colour mode from the page's own attributes; undefined when it cannot be read (fall back to the OS). */
export function githubTheme(attrs: { colorMode?: string | null; darkTheme?: string | null; lightTheme?: string | null }, prefersDark: boolean): 'light' | 'dark' | undefined {
  const mode = attrs.colorMode
  if (mode === 'light') return 'light'
  if (mode === 'dark') return 'dark'
  if (mode === 'auto') return prefersDark ? 'dark' : 'light'
  return undefined
}
