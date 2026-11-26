---
name: pr-reviewer browser extension
description: Side panel and one Review button on GitHub PR pages for pr-reviewer. Inherits the visual language of the local review page and Web App (packages/cli/static/app.css); this file states those tokens and the extension's deltas.
status: final
updated: 2026-11-26
sources:
  - packages/cli/static/app.css
  - _bmad-output/planning-artifacts/prds/prd-pr-reviewer-2026-11-24/prd.md
colors:
  # Same values as the review page's CSS custom properties, plus border-strong (new, for control boundaries).
  # -dark variants apply under prefers-color-scheme: dark in the panel; see Review button for the page.
  bg: '#f6f7f9'
  surface: '#ffffff'
  surface-2: '#f1f3f6'
  border: '#dde1e7'
  border-strong: '#7d8794'
  text: '#1c2128'
  muted: '#5d6673'
  accent: '#2f5bd3'
  accent-text: '#ffffff'
  ok: '#1d7a46'
  ok-bg: '#e3f4ea'
  warn: '#8a5a00'
  warn-bg: '#fdf1d6'
  bad: '#b3261e'
  bad-bg: '#fbe4e2'
  info: '#3d5a80'
  info-bg: '#e6edf6'
  neutral-bg: '#eceef1'
  focus: '#2f5bd3'
  bg-dark: '#0f1216'
  surface-dark: '#171b21'
  surface-2-dark: '#1e232b'
  border-dark: '#2c333d'
  border-strong-dark: '#6e7681'
  text-dark: '#e3e7ec'
  muted-dark: '#97a1ad'
  accent-dark: '#7c9cf5'
  accent-text-dark: '#0f1216'
  ok-dark: '#6fd39a'
  ok-bg-dark: '#16311f'
  warn-dark: '#f0c35a'
  warn-bg-dark: '#352a12'
  bad-dark: '#ff8c82'
  bad-bg-dark: '#3a1a18'
  info-dark: '#a9c1e6'
  info-bg-dark: '#1b2636'
  neutral-bg-dark: '#242a33'
  focus-dark: '#7c9cf5'
  # Two-tone focus ring for the Review button on GitHub's page (WCAG technique C40); theme-independent.
  focus-ring-outer: '#1c2128'
  focus-ring-inner: '#ffffff'
typography:
  # rem so Chrome's font-size setting scales the panel, not only zoom (1rem = 16px by default).
  body:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: 0.875rem
    lineHeight: '1.5'
  title:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: 1rem
    fontWeight: '650'
    lineHeight: '1.25'
  heading:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: 0.875rem
    fontWeight: '600'
    lineHeight: '1.3'
  label:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: 0.75rem
    fontWeight: '550'
    lineHeight: '1.35'
  badge:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: 0.6875rem
    fontWeight: '650'
    lineHeight: '1.4'
    letterSpacing: 0.02em
  mono:
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
    fontSize: 0.78rem
    lineHeight: '1.45'
rounded:
  sm: 6px
  md: 8px
  DEFAULT: 10px
  full: 9999px
spacing:
  '1': 4px
  '2': 6px
  '3': 8px
  '4': 10px
  '5': 12px
  '6': 14px
  '7': 16px
  '8': 20px
  panel-gutter: 12px
  target-min: 24px
components:
  panel-header:
    background: '{colors.surface}'
    border-bottom: '1px solid {colors.border}'
    min-height: 44px
    padding: '0 {spacing.panel-gutter}'
  mode-chip:
    background: '{colors.surface-2}'
    border: '1px solid {colors.border}'
    radius: '{rounded.full}'
    typography: '{typography.label}'
    min-height: '{spacing.target-min}'
  button-primary:
    background: '{colors.accent}'
    foreground: '{colors.accent-text}'
    radius: '{rounded.md}'
    padding: '{spacing.3} {spacing.6}'
  button:
    background: '{colors.surface-2}'
    foreground: '{colors.text}'
    border: '1px solid {colors.border-strong}'
    radius: '{rounded.md}'
    padding: '{spacing.3} {spacing.6}'
  link-button:
    foreground: '{colors.accent}'
    text-decoration: underline
    min-height: '{spacing.target-min}'
  input:
    background: '{colors.bg}'
    foreground: '{colors.text}'
    border: '1px solid {colors.border-strong}'
    radius: '{rounded.md}'
    padding: '{spacing.3} {spacing.4}'
  card:
    background: '{colors.surface}'
    border: '1px solid {colors.border}'
    radius: '{rounded.DEFAULT}'
    padding: '{spacing.5}'
  finding-card:
    background: '{colors.surface}'
    border: '1px solid {colors.border}'
    radius: '{rounded.DEFAULT}'
    padding: '{spacing.4} {spacing.5}'
  finding-card-excluded:
    background: '{colors.surface}'
    border: '1px dashed {colors.border-strong}'
    badge: '{components.status-badge-neutral}'
  severity-badge-blocker-critical:
    background: '{colors.bad-bg}'
    foreground: '{colors.bad}'
    radius: '{rounded.sm}'
    typography: '{typography.badge}'
  severity-badge-major:
    background: '{colors.warn-bg}'
    foreground: '{colors.warn}'
    radius: '{rounded.sm}'
    typography: '{typography.badge}'
  severity-badge-minor-info:
    background: '{colors.info-bg}'
    foreground: '{colors.info}'
    radius: '{rounded.sm}'
    typography: '{typography.badge}'
  status-badge-ok:
    background: '{colors.ok-bg}'
    foreground: '{colors.ok}'
    radius: '{rounded.sm}'
    typography: '{typography.badge}'
  status-badge-warn:
    background: '{colors.warn-bg}'
    foreground: '{colors.warn}'
    radius: '{rounded.sm}'
    typography: '{typography.badge}'
  status-badge-bad:
    background: '{colors.bad-bg}'
    foreground: '{colors.bad}'
    radius: '{rounded.sm}'
    typography: '{typography.badge}'
  status-badge-neutral:
    background: '{colors.neutral-bg}'
    foreground: '{colors.muted}'
    radius: '{rounded.sm}'
    typography: '{typography.badge}'
  banner-outdated:
    background: '{colors.warn-bg}'
    foreground: '{colors.warn}'
    radius: '{rounded.md}'
    padding: '{spacing.4} {spacing.5}'
  step-list:
    gap: '{spacing.2}'
    waiting: 'middle dot in {colors.muted}'
    running: '2px ring in {colors.accent}, open on one side, rotating (static under reduced motion)'
    done: 'check in {colors.ok}'
    failed: 'cross in {colors.bad}'
    skipped: 'en dash in {colors.muted}'
  preview-block:
    background: '{colors.surface-2}'
    border: '1px solid {colors.border}'
    radius: '{rounded.md}'
    typography: '{typography.mono}'
    max-height: 420px
  result-line:
    radius: '{rounded.md}'
    padding: '{spacing.4} {spacing.5}'
    tones: 'status pairs: ok for posted, bad for refused, warn for partly posted or duplicate'
  review-button:
    background: '{colors.accent}'
    foreground: '{colors.accent-text}'
    radius: '{rounded.md}'
    height: 28px
    padding: '0 {spacing.4}'
    typography: '{typography.label}'
    mark: 'logo square, 12px'
    focus: '2px solid {colors.focus-ring-outer} outline, 2px offset, plus 2px {colors.focus-ring-inner} ring'
  review-button-outdated:
    background: '{colors.warn-bg}'
    foreground: '{colors.warn}'
    border: '1px solid {colors.warn}'
---

## Brand & Style

The extension is the same pr-reviewer people meet in the terminal's review page and in a team's Web App, moved into a narrow panel beside the PR. It is a careful tool, not a mascot: plain neutrals, one blue accent for the action that matters, and colour only where it carries meaning (how serious a finding is, whether a check passed). It should read as calm and exact. A reviewer is deciding what to say to a colleague, so nothing in the panel shouts.

Everything inherits from the review page's stylesheet (`packages/cli/static/app.css`). The extension's deltas, all deliberate:

- **Panel density**: a type ramp one step smaller, card padding `{spacing.5}` instead of 16px, button padding `{spacing.3}`/`{spacing.6}` instead of 9/16px, for a 320–640px panel.
- **Accessibility fixes the review page should also adopt**: `{colors.border-strong}` for control boundaries, an "excluded" finding card instead of 60% opacity, and underlined links.
- **The fixed panel header** with the mode chip, and the **Review button** placed on GitHub's page.

## Colors

The palette is the review page's, in light and dark, plus one token.

- **Neutrals** (`{colors.bg}`, `{colors.surface}`, `{colors.surface-2}`, `{colors.border}`, `{colors.text}`, `{colors.muted}`) carry the layout. Cards are `{colors.surface}` on `{colors.bg}`; secondary buttons and chips sit on `{colors.surface-2}`. `{colors.border}` separates cards and is decorative only.
- **Control boundary** (`{colors.border-strong}`, new) outlines every input, select, checkbox and secondary button, and the dashed edge of an excluded finding card, so controls meet 3:1 against any panel background.
- **Accent** (`{colors.accent}`) marks the one primary action on a screen, links (always underlined), checkbox fill, and the running step. Never used for status.
- **Status pairs** (`ok`, `warn`, `bad`, `info`, each with a `-bg`, and `{colors.neutral-bg}` with `{colors.muted}`) are used only for meaning. Mapping, the same as the review page's:

| Meaning | Pair |
|---|---|
| Severity BLOCKER, CRITICAL | `{colors.bad}` on `{colors.bad-bg}` |
| Severity MAJOR | `{colors.warn}` on `{colors.warn-bg}` |
| Severity MINOR, INFO | `{colors.info}` on `{colors.info-bg}` |
| PASSED | `{colors.ok}` on `{colors.ok-bg}` |
| PASSED_WITH_WARNINGS, INCOMPLETE, WARNING | `{colors.warn}` on `{colors.warn-bg}` |
| FAILED, ERROR, TIMEOUT | `{colors.bad}` on `{colors.bad-bg}` |
| SKIPPED, NOT_APPLICABLE, CANCELLED, "Not included" | `{colors.muted}` on `{colors.neutral-bg}` |

- **Dark mode** in the panel uses the `-dark` values and follows the operating system, as the review page does. The Review button on GitHub's page follows GitHub's theme instead (see Components).

**Contrast targets (WCAG 2.1 AA; measured):**

| Pair | Light | Dark | Target |
|---|---|---|---|
| text on bg / surface / surface-2 | 15.10 / 16.18 / 14.56 | 15.12 / 13.91 / 12.71 | 4.5 |
| muted on bg / surface / surface-2 / neutral-bg | 5.42 / 5.81 / 5.23 / 5.00 | 7.17 / 6.60 / 6.03 / 5.51 | 4.5 |
| accent-text on accent | 5.90 | 7.09 | 4.5 |
| accent link on surface / bg / surface-2 | 5.90 / 5.51 / 5.31 | 6.53 / 7.09 / 5.96 | 4.5 |
| ok / warn / bad / info on their -bg | 4.69 / 5.29 / 5.38 / 5.99 | 7.67 / 8.49 / 6.95 / 8.32 | 4.5 |
| border-strong on surface / bg / surface-2 | 3.64 / 3.40 / 3.28 | 3.76 / 4.09 / 3.44 | 3 |
| focus on surface / bg / surface-2 | 5.90 / 5.51 / 5.31 | 6.53 / 7.09 / 5.96 | 3 |

`ok` on `ok-bg` in light (4.69) is the tightest pair: never lighten either. Accent differs from body text by hue and 2.7:1 only, so links are always underlined.

## Typography

One system font stack, as on the review page, with a ramp one step smaller for the panel, in rem so the browser's font-size setting scales it:

- `{typography.title}` (1rem, 650): the surface's single `h1` (PR title or screen title).
- `{typography.heading}` (0.875rem, 600): section headings and finding titles.
- `{typography.body}` (0.875rem): descriptions, recommendations, help text.
- `{typography.label}` (0.75rem, 550): field labels, meta lines (file:line, source, confidence), chips, the Review button.
- `{typography.badge}` (0.6875rem, 650, slight tracking): severity and status badges.
- `{typography.mono}` (0.78rem): file paths, line numbers, codes, suggested changes, the post preview.

Finding text is shown as plain text with line breaks preserved; it never renders as rich HTML.

## Layout & Spacing

A single column at every width, with `{spacing.panel-gutter}` side padding and `{spacing.5}` between cards. Nothing scrolls sideways: long paths and suggestions wrap, or scroll inside their own block (which is then keyboard-focusable, see EXPERIENCE.md). The panel header is fixed with a minimum height and wraps its contents when space runs out; the area below scrolls. Action bars wrap onto a second line rather than shrinking text.

Below 360 CSS px (including 320px at 200% zoom, where breakpoints still fire), two-part rows (field + button) stack vertically and buttons go full width except link buttons. This rule lives here only. Every interactive target is at least `{spacing.target-min}` square.

## Elevation & Depth

Flat. Separation comes from borders and the `{colors.bg}` / `{colors.surface}` step, never shadows. Layered elements: the fixed panel header (separated by its bottom border) and the two confirmation dialogs (post in This computer mode, clear stored data), which are native modal dialogs on `{colors.surface}` with a `{colors.border-strong}` edge over a dimmed panel.

## Shapes

`{rounded.DEFAULT}` (10px) for cards and finding cards, `{rounded.md}` (8px) for buttons, inputs, banners, preview blocks and result lines, `{rounded.sm}` (6px) for badges, `{rounded.full}` for chips. The logo mark is a 5px-radius square with the accent-to-ok gradient, decorative only.

## Components

Visual references: [mockups/](mockups/) (Report, Post, Welcome and setup, Run in progress, Review button). The spines win on conflict.

- **Panel header**: `{colors.surface}`, bottom border, min 44px. Left: logo mark (decorative) and "PR Reviewer". Right: the mode chip and a settings button (icon with an accessible name). Wraps under zoom.
- **Mode chip**: pill on `{colors.surface-2}` with a 7px dot and text that states the health in words: "Standalone", "Standalone · signed out", "Web App · review.team.example", "Web App · unreachable", "This computer", "Checking…". Dot `{colors.ok}` healthy, `{colors.bad}` broken, `{colors.muted}` checking; the dot is never the only cue. A long host truncates visually.
- **Buttons**: `button-primary` for the single main action per screen, `button` for the rest, `link-button` (accent, underlined, no border) for minor actions ("Use a token instead"). Disabled controls keep their reason visible next to them at full contrast; the control itself drops to 55% opacity.
- **Input**: `{colors.bg}` fill, `{colors.border-strong}` edge, `{rounded.md}`; masked keys and codes in `{typography.mono}`. An invalid field gets a `{colors.bad}` edge and its error text below in `{colors.bad}`.
- **Finding card**: checkbox column plus content column. Severity badge, the title in `{typography.heading}`, a meta line in `{typography.label}` and `{colors.muted}` (path:line as an underlined accent link, source, confidence), then the description. Recommendation and suggested change behind a disclosure.
- **Finding card, excluded** (unticked, dismissed, or pre-existing): full-contrast content, dashed `{colors.border-strong}` edge, and a "Not included" badge (or "Dismissed" / "Pre-existing") in the neutral pair. No opacity.
- **Findings toolbar**: severity count badges on the left, "Select all" / "Select none" link buttons and a severity filter on the right; wraps.
- **Coverage block**: the Overall Status badge (status mapping), the engine's coverage headline in `{colors.muted}`, the "Not run" list, and, when the gate failed, its reasons in a `{colors.bad}` on `{colors.bad-bg}` box (as the review page's "Why it failed").
- **Details disclosure**: collapsed by default; inside, the walkthrough, a checks table (`{typography.label}` headers, rows separated by `{colors.border}`, scrolls inside its block at narrow widths), related code, learnings, tokens and cost.
- **Step list**: the review page's list: waiting, running, done, failed, skipped glyphs per `step-list`, each with a state word, and the detail in `{colors.muted}`.
- **Outdated banner**: `banner-outdated` across the top of a Report, with "Review again" as `button-primary`.
- **Post panel**: a `card` with the `h1` "Post to GitHub", who it posts as in `{colors.muted}`, the review type `input` (select), "Preview post" (`button`), then "Post N inline comments and the summary" (`button-primary`, present only after a preview). Below it, a `card` with the preview: lists of new inline comments, still open, resolved, and the summary comment in a `preview-block`.
- **Result line**: `result-line` in the status pair for the outcome, with links underlined in the same colour.
- **Welcome mode choice**: three selectable cards (radio semantics), the selected one with a 2px `{colors.accent}` edge; each has a title, a one-line description, and "full checks" in `{colors.muted}` where it applies.
- **Device code**: the code in `{typography.mono}` at 1.375rem, letter-spaced, on `{colors.surface-2}` with `{rounded.md}`, a "Copy code" `button`, and the expiry time in text.
- **Review button** (on GitHub's page): 28px high, at least 24px wide, `{colors.accent}` fill with the logo mark and its state label in `{typography.label}`: "Review", "Reviewing…" (ring instead of mark), "3 findings" / "No findings", or "Outdated" (`review-button-outdated`). It follows **GitHub's theme** (light `accent`/`accent-text` on GitHub light, `-dark` on GitHub dark, the OS theme if GitHub's cannot be read) and always uses the two-tone focus ring (`{colors.focus-ring-outer}` outline with a `{colors.focus-ring-inner}` inner ring), which is at least 3:1 on any GitHub background. Its own styles only (no GitHub classes), so it looks the same whatever GitHub changes and is recognisably pr-reviewer's. In forced-colors mode it gets a `ButtonText` border and a `Highlight` focus outline.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Reuse the review page's tokens; take density and accessibility deltas from this file | Restyle a component beyond the deltas listed in Brand & Style |
| One `button-primary` per screen | Two accent buttons competing side by side |
| Colour only for severity and status, always with a word | A dot, colour or icon as the only cue |
| `{colors.border-strong}` on every control edge | `{colors.border}` on inputs or checkboxes |
| Excluded findings at full contrast with a dashed edge and a badge | Opacity on anything a user can still act on |
| Underline every link | Links distinguished by hue alone |
| Wrap long paths and code inside their block | Horizontal scrolling of the panel |
| Keep the Review button small, self-styled and theme-matched to GitHub | Copy GitHub's button look or rely on GitHub's CSS |
| Show finding text as plain text | Render model output as HTML or markdown with links |
