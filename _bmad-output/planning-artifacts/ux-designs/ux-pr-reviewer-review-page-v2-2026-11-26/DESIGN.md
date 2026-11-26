---
name: pr-reviewer review page v2
description: v2 of the review page served by `pr-reviewer serve` and the self-hosted Web App. A three-pane, keyboard-first workspace in pr-reviewer's own palette. Classic (packages/cli/static) stays available; the browser extension shares the token base.
status: final
updated: 2026-11-26
sources:
  - packages/cli/static/app.css
  - _bmad-output/planning-artifacts/ux-designs/ux-pr-reviewer-2026-11-26/DESIGN.md
  - _bmad-output/planning-artifacts/epics.md
colors:
  # Shared base: same values as classic and the extension DESIGN.md (border-strong from the extension pass).
  bg: '#f6f7f9'
  sidebar: '#eef0f3'
  surface: '#ffffff'
  surface-2: '#f1f3f6'
  border: '#dde1e7'
  border-strong: '#7d8794'
  text: '#1c2128'
  muted: '#5d6673'
  accent: '#2f5bd3'
  accent-text: '#ffffff'
  accent-soft: '#e9eefb'
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
  diff-add: '#e6f6ec'
  diff-del: '#fdecea'
  diff-hunk: '#eaf1fd'
  skeleton: '#e7eaee'
  toast-bg: '#1c2128'
  toast-text: '#f6f7f9'
  bg-dark: '#0f1216'
  sidebar-dark: '#0c0f13'
  surface-dark: '#171b21'
  surface-2-dark: '#1e232b'
  border-dark: '#2c333d'
  border-strong-dark: '#6e7681'
  text-dark: '#e3e7ec'
  muted-dark: '#97a1ad'
  accent-dark: '#7c9cf5'
  accent-text-dark: '#0f1216'
  accent-soft-dark: '#1c2640'
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
  diff-add-dark: '#12301e'
  diff-del-dark: '#3a1a18'
  diff-hunk-dark: '#172238'
  skeleton-dark: '#232a33'
  toast-bg-dark: '#e3e7ec'
  toast-text-dark: '#0f1216'
  # Two-tone focus ring (WCAG C40) for accent fills, toasts and anything a single ring cannot contrast with.
  focus-ring-outer: '#1c2128'
  focus-ring-inner: '#ffffff'
  focus-ring-outer-dark: '#e3e7ec'
  focus-ring-inner-dark: '#0f1216'
typography:
  body:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: 0.875rem
    lineHeight: '1.5'
  display:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: 1.375rem
    fontWeight: '650'
    lineHeight: '1.2'
    letterSpacing: -0.01em
  title:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: 1rem
    fontWeight: '650'
    lineHeight: '1.3'
  metric:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: 1.375rem
    fontWeight: '650'
    lineHeight: '1.15'
    letterSpacing: -0.01em
  label:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: 0.75rem
    fontWeight: '550'
    lineHeight: '1.35'
  overline:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: 0.6875rem
    fontWeight: '600'
    letterSpacing: 0.06em
  badge:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: 0.6875rem
    fontWeight: '650'
    lineHeight: '1.4'
    letterSpacing: 0.02em
  mono:
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
    fontSize: 0.78rem
    lineHeight: '1.6'
rounded:
  xs: 4px
  sm: 6px
  md: 8px
  DEFAULT: 10px
  lg: 12px
  xl: 14px
  full: 9999px
spacing:
  '1': 4px
  '2': 6px
  '3': 8px
  '4': 10px
  '5': 12px
  '6': 14px
  '7': 16px
  '8': 18px
  '9': 22px
  '10': 28px
  sidebar-width: 216px
  list-width: 380px
  sidebar-rail: 56px
  drawer-width: 480px
  target-min: 24px
components:
  sidebar:
    background: '{colors.sidebar}'
    border-right: '1px solid {colors.border}'
    width: '{spacing.sidebar-width}'
  nav-item-active:
    background: '{colors.accent-soft}'
    foreground: '{colors.text}'
    indicator: '2px solid left border in {colors.accent} (a real border, so it survives forced colours)'
    radius: '{rounded.sm}'
  command-field:
    background: '{colors.surface}'
    border: '1px solid {colors.border-strong}'
    radius: '{rounded.md}'
    shortcut: '{components.kbd}'
  command-palette:
    background: '{colors.surface}'
    border: '1px solid {colors.border}'
    radius: '{rounded.lg}'
    elevation: '0 16px 48px rgba(16,20,28,0.18)'
    width: 640px
  kbd:
    typography: '{typography.mono}'
    border: '1px solid {colors.border}, 2px bottom'
    radius: '{rounded.xs}'
    foreground: '{colors.muted}'
  kbd-on-accent:
    background: transparent
    border: '1px solid {colors.accent-text} at 60% over {colors.accent}'
    foreground: '{colors.accent-text}'
  focus-ring:
    default: '2px solid {colors.focus} outline, 2px offset'
    two-tone: '2px {colors.focus-ring-outer} outline + 2px {colors.focus-ring-inner} inner ring; on button-primary, toasts, accent-soft rows and checked checkboxes'
  input:
    background: '{colors.bg}'
    border: '1px solid {colors.border-strong}'
    radius: '{rounded.md}'
    padding: '{spacing.2} {spacing.4}'
  select:
    inherits: '{components.input}'
    affordance: 'chevron at the right'
  segmented:
    border: '1px solid {colors.border-strong}'
    radius: '{rounded.md}'
    active: '{colors.accent} text on {colors.accent-soft}, with a leading check glyph'
  toggle:
    track-on: '{colors.accent}'
    track-off: '{colors.border-strong}'
    size: '34 x 20px, thumb 14px, with the state as text beside it'
  table:
    header: '{typography.overline} in {colors.muted}'
    row-divider: '1px {colors.border}'
    numbers: 'right-aligned, tabular figures'
  banner:
    background: '{colors.warn-bg}'
    foreground: '{colors.warn}'
    radius: '{rounded.md}'
    placement: 'above the hero on Overview and above the list on Needs attention'
  identity-menu:
    trigger: '{typography.label}, health in words'
    menu: '{colors.surface}, 1px {colors.border}, {rounded.md}, palette elevation'
  verdict-hero:
    background: '{colors.surface}'
    border: '1px solid {colors.border}'
    radius: '{rounded.xl}'
    top-rule: '3px gradient from the status colour to {colors.accent}'
    title: '{typography.display}'
  status-pill:
    radius: '{rounded.full}'
    typography: '{typography.label}'
    tones: 'status pair per the mapping in Colors; Reviewing uses {colors.accent} on {colors.accent-soft}'
  metric-tile:
    background: '{colors.surface}'
    border: '1px solid {colors.border}'
    radius: '{rounded.lg}'
    value: '{typography.metric}'
    caption: '{typography.label} in {colors.muted}'
    emphasis: 'border {colors.accent} plus 3px {colors.accent-soft} ring for the tile that leads to work'
  skeleton:
    background: '{colors.skeleton}'
    radius: '{rounded.sm}'
    motion: none (no shimmer)
  run-timeline:
    node-done: '9px dot in the step status colour'
    node-running: '10px ring in {colors.accent}, open on one side'
    node-waiting: '9px ring in {colors.border-strong}'
    connector: '1px {colors.border}'
    duration: '{typography.mono} in {colors.muted}'
  finding-row:
    padding: '{spacing.4} {spacing.7}'
    divider: '1px {colors.border}'
    selected: 'background {colors.accent-soft}, 2px solid left border {colors.accent}'
    checkbox: '14px, 1.5px {colors.border-strong}, filled {colors.accent} when included'
  pre-existing-group:
    border-bottom: '1px dashed {colors.border-strong}'
    foreground: '{colors.muted}'
  finding-thread:
    container: '1px {colors.border}, {rounded.DEFAULT}, {colors.surface}'
    file-header: '{colors.surface-2}, {typography.mono}'
    diff-line-add: '{colors.diff-add}'
    diff-line-del: '{colors.diff-del}'
    diff-hunk-header: '{colors.diff-hunk}'
    why-box: '{colors.accent-soft}, {rounded.md}'
    suggestion-box: '1px {colors.border}, header on {colors.surface-2}'
  since-strip:
    background: '{colors.surface-2}'
    border: '1px solid {colors.border}'
    radius: '{rounded.DEFAULT}'
    typography: '{typography.label}'
    parts: 'resolved in {colors.ok}, still open in {colors.warn}, new in {colors.accent}; each underlined'
  agent-panel:
    background: '{colors.surface}'
    border: '1px solid {colors.border}'
    radius: '{rounded.lg}'
    command: '{typography.mono} on {colors.surface-2}, with a Copy button'
  inline-editor:
    border: '1px solid {colors.border-strong}'
    radius: '{rounded.md}'
    split: 'Markdown source left (or top below 800px), rendered preview right'
  post-drawer:
    background: '{colors.surface}'
    border-left: '1px solid {colors.border}'
    width: '{spacing.drawer-width}'
    elevation: '-12px 0 40px rgba(16,20,28,0.16)'
  toast:
    background: '{colors.toast-bg}'
    foreground: '{colors.toast-text}'
    radius: '{rounded.DEFAULT}'
    elevation: '0 8px 24px rgba(0,0,0,0.2)'
  button-primary:
    background: '{colors.accent}'
    foreground: '{colors.accent-text}'
    radius: '{rounded.md}'
    padding: '{spacing.2} {spacing.5}'
  button:
    background: '{colors.surface}'
    foreground: '{colors.text}'
    border: '1px solid {colors.border-strong}'
    radius: '{rounded.md}'
    padding: '{spacing.2} {spacing.5}'
  filter-chip:
    border: '1px solid {colors.border-strong}'
    radius: '{rounded.full}'
    active: '{colors.accent} border and text on {colors.accent-soft}'
---

## Brand & Style

v2 is the same careful tool as classic, made fast and legible for people who review many PRs. Its register is a focused workspace rather than a document: a quiet sidebar, a list you move through with the keyboard, and one place where the code and the finding meet. The verdict comes first and is said in a sentence; everything below it is evidence. Colour still means something every time it appears.

It keeps pr-reviewer's palette (light first, dark derived) so classic, v2 and the browser extension read as one product. What v2 adds is structure and motion, not new hues: a three-pane layout, a command bar, a verdict hero with metric tiles, a run timeline, and findings shown under the code they are about.

## Colors

The base palette is classic's, with the extension's `{colors.border-strong}` for control edges.

- **Neutrals**: `{colors.bg}` behind everything, `{colors.sidebar}` for the navigation pane, `{colors.surface}` for panes and cards, `{colors.surface-2}` for file headers and secondary fills. `{colors.border}` separates; `{colors.border-strong}` outlines controls.
- **Accent** (`{colors.accent}`, pr-reviewer blue): the primary action, the selected nav item and row (`{colors.accent-soft}` fill with an accent edge), links (underlined), included checkboxes, the running timeline node, and the tile that leads to work. Never a status.
- **Status pairs** keep the extension's mapping: BLOCKER/CRITICAL and FAILED/ERROR/TIMEOUT `bad`; MAJOR and PASSED_WITH_WARNINGS/INCOMPLETE/WARNING `warn`; MINOR/INFO `info`; PASSED `ok`; SKIPPED/NOT_APPLICABLE/CANCELLED/"Not included" `{colors.muted}` on `{colors.neutral-bg}`. (The exploratory direction mocks in `.working/` showed MINOR in amber; the key-screen mockups follow this mapping.)
- **Diff colours** (`{colors.diff-add}`, `{colors.diff-del}`, `{colors.diff-hunk}`) appear only inside code blocks.
- **Toast** inverts the theme (`{colors.toast-bg}`) so it stands apart from panes without a new hue.
- **Theme:** the `-dark` values apply under the theme setting: System (default, `prefers-color-scheme`), Light or Dark, remembered per browser (serve) or per user (Web App).
- **Focus:** `{components.focus-ring}`: a single `{colors.focus}` ring by default; the two-tone ring on accent fills, toasts and selected rows, at least 3:1 against every background here.

Contrast targets are the extension's (DESIGN.md of `ux-pr-reviewer-2026-11-26`, Colors): text 4.5:1, controls and focus 3:1, measured for every pair above in light and dark. New v2 pairs to verify at build: `{colors.text}` on `{colors.accent-soft}` and on `{colors.sidebar}`, `{colors.muted}` on `{colors.sidebar}`, diff text on each diff colour.

## Typography

One system font stack, in rem. `{typography.display}` (1.375rem) is used once per screen, for the PR title in the verdict hero; `{typography.metric}` for tile values; `{typography.title}` for pane and finding titles; `{typography.body}` for prose; `{typography.label}` for meta lines, nav and chips; `{typography.overline}` for section labels (uppercase, tracked); `{typography.badge}` for severity and status; `{typography.mono}` for paths, line numbers, code, durations, counts in the run and shortcut keys.

## Layout & Spacing

Three panes at 1100 CSS px and wider: sidebar (`{spacing.sidebar-width}`), list (`{spacing.list-width}`), detail (the rest). Overview, Checks, Walkthrough and Start use two panes (sidebar + main). Between 800 and 1100px the sidebar becomes an icon rail (`{spacing.sidebar-rail}`). Below 800px list and detail stack: the detail opens over the list with a back control. Panes scroll independently; the page itself never scrolls sideways. Main-area padding is `{spacing.9}`–`{spacing.10}`; gaps between blocks `{spacing.8}`. Every target is at least `{spacing.target-min}`.

## Elevation & Depth

Mostly flat, separated by borders and the bg → sidebar → surface steps. Three elevated layers only: the command palette (`{components.command-palette}`), the post drawer (`{components.post-drawer}`), and toasts. Nothing else casts a shadow.

## Shapes

`{rounded.xl}` for the verdict hero, `{rounded.lg}` for tiles and the command palette, `{rounded.DEFAULT}` for finding threads and panels, `{rounded.md}` for buttons, inputs and code blocks, `{rounded.sm}` for nav items and badges, `{rounded.xs}` for keys, `{rounded.full}` for chips and status pills.

## Components

Visual references: [mockups/](mockups/) (Start, Overview, Needs attention, live run, post drawer, inline edit, dark, narrow). The spines win on conflict.

- **Sidebar**: logo and "PR Reviewer"; the command field; nav items (Overview, Needs attention, Pre-existing, Checks, Walkthrough) with count badges; the changed files with finding counts; the shortcut hints; identity and AI readiness at the bottom. Active item per `nav-item-active`.
- **Command field and palette**: the field in the sidebar shows "Search or run a command ⌘K"; the palette opens centred over the page with a search input, grouped results (PRs, repositories' open PRs, actions, recent reviews) and the shortcut for each action.
- **Verdict hero**: top rule in the status colour fading to accent; the repo, PR number and head in `{typography.mono}` above; the PR title in `{typography.display}`; the status pill; one plain-language sentence from the review's walkthrough summary.
- **Metric tiles**: four in a row (new findings, pre-existing, checks, tokens and model); skeletons while running; the "new findings" tile carries the accent emphasis when there is work.
- **Run timeline**: one node per layer with its name, a one-line outcome and its duration; running node per `run-timeline`.
- **Finding row**: checkbox, title, `path:lines · source · confidence` in mono, severity badge on the right.
- **Pre-existing row**: one dashed-edged row after the new findings, "20 pre-existing · Show", that opens the Pre-existing surface; rows there use the excluded style from the extension spec (full contrast, "Not included" badge).
- **Finding thread** (detail pane): badges (severity, category, source and confidence); the title; the underlined path link; a code box with the file header, the PR's diff hunk around the finding (hunk header, line numbers, added and removed lines) and, beneath it, the comment: description, "Why it matters" box, and the "Suggested change" box when there is one; then actions (Edit wording, Exclude, Copy agent prompt) and the post bar.
- **Since-last-review strip**: one line under the verdict hero on `{colors.surface-2}`: "Since 9f3c2e1: 1 resolved · 1 still open · 1 new", each count in its status colour and underlined.
- **Agent panel**: a small anchored panel (not a modal) with the `pr-reviewer fix <pr>` command in mono and Copy, plus "Copy combined prompt".
- **Inline editor**: replaces the comment text in place; Markdown source with a live preview beside it (stacked below 800px); Save (primary) and Cancel.
- **Post drawer**: slides in from the right over the detail pane: review type, "who it posts as", the exact inline comments (each expandable) and the summary in mono, then Post (primary); result lines use the status pairs.
- **Toast**: bottom right, one line with an action ("Review finished · 2 new findings · Show"); stacks at most three.
- **Buttons, chips, keys**: per frontmatter; every action that has a shortcut shows its key (`kbd-on-accent` inside primary buttons, hidden from assistive technology). Filter chips are toggle buttons with a check glyph when active.
- **Controls** (Settings, Stats, drawer): `input`, `select`, `segmented`, `toggle` and `table` per frontmatter; errors in `{colors.bad}` below the field.
- **Banner**: the outdated banner (and other page-level warnings) per `banner`, with its action as a primary button.
- **Identity menu**: the sidebar's bottom block as a button showing GitHub and AI health in words; opens a small menu (Settings, Switch to classic, version, Sign out on the Web App).
- **Agent panel** and **since strip**: per frontmatter.
- **Drawer, palette and sheet** each have a visible Close button (at least 24px) and go full width below 800px.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Lead every result with the verdict sentence and the tiles | Open on a long list of findings |
| Show a finding under the code it is about | Describe code without showing it when the hunk is available |
| Keep pre-existing findings in one collapsed, unticked group | Mix pre-existing noise into the work list |
| Give every frequent action a key and show it | Hide actions behind hover only |
| Use pr-reviewer blue for action and selection only | Introduce new hues or use accent for status |
| Elevate only the palette, the drawer, the shortcuts sheet, menus and toasts | Shadows on cards and panes |
| Draw selection and focus with borders and outlines | Inset box-shadows that vanish in forced colours |
| Move with short, purposeful transitions (150–200ms), none under reduced motion | Decorative animation |
