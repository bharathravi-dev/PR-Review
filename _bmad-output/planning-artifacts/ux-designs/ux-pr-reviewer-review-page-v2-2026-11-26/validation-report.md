# Validation Report — pr-reviewer review page v2

- **DESIGN.md:** `/Users/bharathkumarr/self/projects/POC/pr-review/pr-reviewer/_bmad-output/planning-artifacts/ux-designs/ux-pr-reviewer-review-page-v2-2026-11-26/DESIGN.md`
- **EXPERIENCE.md:** `/Users/bharathkumarr/self/projects/POC/pr-review/pr-reviewer/_bmad-output/planning-artifacts/ux-designs/ux-pr-reviewer-review-page-v2-2026-11-26/EXPERIENCE.md`
- **Run at:** 2026-11-26T06:13:24Z

## Overall verdict

**Adequate for the core review loop; thin as the parity contract.** The pair is well shaped, lean, and every token reference resolves, so a consumer can build Overview, Needs attention, the finding thread, the inline editor and the post drawer from it with confidence. It is not yet safe to hand to story-dev for Story 9.3's parity checklist or for the Web App: several things classic does today have no v2 surface (the Web App's API key settings, per-PR history with comparison, Sign out, version, Select all / none, reattach after reload, gate reasons, limitations, rules checked). Start, the palette, Stats and Settings have almost no error or empty states. Two load-bearing decisions are still open: the hunk route, and what the inline editor edits. UJ-3 is represented by a flow that skips its core actions and its edge case.

Counts: 0 critical · 9 high · 20 medium · 19 low.

**Not ready for stories.** The palette holds up: every text pair in `DESIGN.md` passes 4.5:1 in light and dark, including the new v2 tokens (sidebar, accent-soft, diff backgrounds, toast). The failures are behavioural. The spine leaves its main interaction pattern open, and the option it offers first (a listbox whose rows contain real checkboxes) is invalid ARIA. The single-key shortcut guard is too narrow: `c`, `x` and `p` will fire while someone types in the review-type select or the palette. Esc does five jobs with no order of precedence, and one of those jobs throws away an edit. Toast actions can't be reached by keyboard within 8 seconds. Forced colours aren't mentioned, and the selection indicators are built entirely from things forced colours removes. The claim to inherit the extension's floor is nominal: v2 inherits only "announcement and time-limit rules", and the extension's time-limit rules cover pairing codes, which v2 doesn't have. Most of that floor (focus fallback, aria-disabled reasons, step state words, forced colours, the two-tone focus ring) isn't inherited. Two mockup defects would ship if copied as drawn: white-on-white `kbd` keys inside primary buttons (1.00:1), and an active state on the icon rail that's shown by hue alone.

**Resolution.** All critical and high findings, and the medium findings, were applied to DESIGN.md, EXPERIENCE.md and the mockups in the same session (see the [change] and delegated [decision] entries in .memlog.md). Low findings were applied where they touched the same rules; the rest are left for the build to settle.

## Category verdicts

- Flow coverage — thin
- Token completeness — adequate
- Component coverage — thin
- State coverage — thin
- Visual reference coverage — adequate
- Feature parity with classic — thin
- Bloat & overspecification — strong
- Inheritance discipline — adequate
- Shape fit — strong

## Findings by severity

### Critical (2)

**[Accessibility]** — The list pattern isn't decided, and the first option is invalid (§ EXPERIENCE.md, Accessibility Floor bullet 3: "listbox-like single tab stop … `aria-activedescendant`, or plain buttons in DOM order; the checkbox stays a real checkbox")
(EXPERIENCE.md, Accessibility Floor bullet 3: "listbox-like single tab stop … `aria-activedescendant`, or plain buttons in DOM order; the checkbox stays a real checkbox"). A `role="option"` must not contain interactive descendants. With `aria-activedescendant`, DOM focus stays on the listbox, so the "real checkbox" can never take focus, its state isn't announced as a checkbox, and NVDA/JAWS will flatten or ignore it. A listbox also models only one state, but each row has two: which finding is *shown* and whether it's *included*. Leaving the choice open means two developers will build two different, incompatible things.
Fix: replace the bullet with: "The finding list is a `<ul>` (labelled with the surface name and count). Each `<li>` holds, in order, a native `<input type="checkbox">` labelled 'Include in post: <SEVERITY> <title>, <path>:<lines>' (the label wraps the checkbox column for a ≥24px target), then a `<button>` with the title as its name and `aria-current="true"` on the finding shown in the detail. No listbox, no `aria-activedescendant`, no `role="application"`. j/k and ↓/↑ (when focus is in the list) move focus to the next or previous row's title button and show it in the detail. `x` toggles the checkbox of the focused or shown row. Severity badge text is part of the button's name, or is its description via `aria-describedby`." If single-tab-stop is required, commit to an APG `grid` instead (row per finding; checkbox cell and title cell; roving `tabindex`; ←/→ between cells; Space toggles, Enter opens) and write that key map into the spine. Don't use a listbox with checkboxes.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Accessibility]** — The single-key shortcut guard is too narrow; shortcuts will fire while people type (§ EXPERIENCE.md, Interaction Primitives: "act only when focus is not in a text field")
(EXPERIENCE.md, Interaction Primitives: "act only when focus is not in a text field"). Some controls take letter keys but aren't text fields: the drawer's review-type `<select>` (typeahead: "c" for Comment also triggers *Copy agent prompt*), the palette's combobox and its options, native checkboxes and buttons inside the open drawer, `contenteditable`, a pending IME composition, and macOS dead keys (Option+e). `x` (exclude) and `p` (open drawer) change state, so a stray keystroke is a silent data change. Modifier combinations aren't excluded either (Ctrl+C would run `c`).
Fix: add to Interaction Primitives: "Single-key and `g`-chord shortcuts are ignored when: focus is in `input`, `textarea`, `select`, `[contenteditable]`, or any element with role `combobox`, `textbox`, `searchbox`, `spinbutton`, `slider`, `listbox`, `menu`, `menuitem*`, `option`, `grid`-cell editors; `event.isComposing` is true; any of Ctrl/Alt/Meta is held (Shift only for `?`); or any dialog (palette, drawer, `?` sheet, Settings) is open, in which case only that dialog's own keys work. `x`, `e`, `c` act on the shown finding only when focus is in the list or detail region (WCAG 2.1.4 'active only on focus' as the default); `g` chords, `?`, `/` and `p` are page-wide." Also: "Every control with a shortcut has `aria-keyshortcuts`. Never use `role="application"`; screen-reader browse-mode quick keys (h, e, c, x, k, g, p in NVDA/JAWS) take precedence, and every shortcut has a visible control that does the same thing."

### High
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

### High (20)

**[Flow coverage]** — Flow 2 claims UJ-3 but leaves out what UJ-3 is about (§ EXPERIENCE.md Key Flows, Flow 2; PRD UJ-3)
Flow 2 claims UJ-3 but leaves out what UJ-3 is about. Nobody signs in, reads findings grouped by severity and file, unticks some, then posts or keeps the report in the app, and no past review for the PR is listed (EXPERIENCE.md Key Flows, Flow 2; PRD UJ-3). Its climax is a FAILED compile check, which is closer to the extension's Flow 3.
Fix: rewrite Flow 2 around a teammate on Meera's Web App: sign in, paste, watch, untick, post (or keep), and see the PR's earlier runs. Keep the narrow-window detail as a step.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Flow coverage]** — UJ-3's edge case (AI provider rate-limited: deterministic results shown, AI layer `ERROR (provider rate-limited)`, never
UJ-3's edge case (AI provider rate-limited: deterministic results shown, AI layer `ERROR (provider rate-limited)`, never PASSED, Retry) has no failure path in any flow. A state row exists ("AI layer failed"), but no flow uses it (Flow 2).
Fix: add it as Flow 2's failure path, quoting the engine words.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Component coverage]** — The Settings and Stats surfaces have no component vocabulary (§ DESIGN.md frontmatter `components`; Components)
The Settings and Stats surfaces have no component vocabulary. DESIGN.md defines no `input`, `select`, segmented control or toggle (the Settings mockup uses all four), and no table style for Stats or the history table. A consumer has to invent control styles, which is the exact drift UX-DR25 and Story 9.2 just fixed in classic (DESIGN.md frontmatter `components`; Components).
Fix: add `input`, `select`, `segmented`, `toggle` and `table` tokens, inheriting the extension's `input` (border-strong edge), plus one Components line each.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[State coverage]** — Start has no error states for its one job
Start has no error states for its one job. An invalid reference, a PR the token cannot read (UJ-1's edge case), and a refused start (quota) have no treatment (State Patterns).
Fix: add rows. Errors appear under the command field, start with what failed, and name the permission; the field keeps its text.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[State coverage]** — Reattach after reload is missing
Reattach after reload is missing. FR-31's testable consequence is "the run survives a page reload", and classic's `resume()` does it (State Patterns; PRD FR-31).
Fix: add a state row: on load, the last run reattaches to Overview (running) or opens its Report (finished), and announces the current state only.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Feature parity with classic]** — Web App users cannot set their own API key, endpoint or Remove key in v2 (§ EXPERIENCE.md IA Settings row; key-shortcuts-settings.html shows only the serve variant, "From your pr-reviewer config")
Web App users cannot set their own API key, endpoint or Remove key in v2. Settings lists only "AI provider and model". This is FR-35, and classic opens Settings automatically when AI is not ready (EXPERIENCE.md IA Settings row; key-shortcuts-settings.html shows only the serve variant, "From your pr-reviewer config"). Without it, v2 can never pass Story 9.3's parity item "settings" on the Web App.
Fix: split the Settings row by host. serve: provider and model from config. Web App: provider, model, allow-listed endpoint, masked key, Remove key, and opening automatically when AI is not ready.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Feature parity with classic]** — Per-PR history with the new / resolved / unchanged comparison (FR-34, shown by classic on the Web App) has no v2 surface (§ EXPERIENCE.md IA; PRD FR-34)
Per-PR history with the new / resolved / unchanged comparison (FR-34, shown by classic on the Web App) has no v2 surface. "Recent reviews" on Start is a different thing (EXPERIENCE.md IA; PRD FR-34).
Fix: add History, either a section of Overview ("Earlier runs of this PR") or a palette action, with its states.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Feature parity with classic]** — The inline editor's contract does not match what classic, the publish API and FR-33 support (§ EXPERIENCE.md Component Patterns: Inline editor; DESIGN.md `inline-editor`; key-post-edit.html)
The inline editor's contract does not match what classic, the publish API and FR-33 support. Classic edits three fields (title, description, recommendation) and posts `edits` per field. v2 shows one Markdown "Wording" body, and the mockup adds "The suggested change is kept." A consumer cannot tell which fields are editable or how one Markdown body maps to the API (EXPERIENCE.md Component Patterns: Inline editor; DESIGN.md `inline-editor`; key-post-edit.html).
Fix: commit the edited fields (for example title plus a Markdown body mapped to description; recommendation editable or explicitly not), and say whether the suggested change can be edited.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Inheritance discipline]** — The hunk route is load-bearing but uncommitted
The hunk route is load-bearing but uncommitted. "A finding under its diff hunk" is the main structural decision of v2 (the C borrow and the Do's table), yet the read route depends on relaxing UX-DR27's "ReviewService v1 unchanged" wording and on an open shape (Open Questions 1 and 2; Assumptions 1). Story-dev cannot size Needs attention until it is decided.
Fix: resolve it before story breakdown. Amend UX-DR27 to "ReviewService v1, additive read routes only" and commit the route shape (per run, per file with ranges, size cap), with "Hunks unavailable" as the degraded path.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Accessibility]** — The inheritance from the extension's Accessibility Floor is nominal (§ EXPERIENCE.md, Foundation para 2: inherits "the Accessibility Floor's announcement and time-limit rules")
(EXPERIENCE.md, Foundation para 2: inherits "the Accessibility Floor's announcement and time-limit rules"). The extension's time-limit rules are about pairing-code expiry, which v2 doesn't have, so nothing covers toast timing. v2 doesn't inherit, and doesn't restate: focus falling back to the `h1` when the focused element disappears on an automatic change; `h1` with `tabindex="-1"`; dialog initial focus; `aria-disabled` plus a described reason for disabled actions ("reviewing is off with the reason" / "posting off" are stated visually only); state words on steps (Waiting / Running / Done / Failed / Skipped); path-link accessible names; Settings form errors (`aria-invalid`, focus to first failed field); forced colours; the two-tone focus ring (`focus-ring-outer`/`-inner` exist in the extension's DESIGN.md but not here).
Fix: change the sentence to "inherits the extension's Accessibility Floor in full (Structure, Focus, Announcements, Controls and content, Motion/zoom/forced colours); this section lists only v2's additions and overrides". Then add the items in H3–H6 and H11 below, and add `focus-ring-outer` and `focus-ring-inner` to v2's `colors`.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Accessibility]** — Esc has five meanings, no order of precedence, and one of them destroys work
(EXPERIENCE.md, Interaction Primitives and Inline editor: "Cancel (Esc) restores"). Esc closes the palette, closes the drawer, cancels the editor, goes back on narrow screens, and must also dismiss tooltips on the icon rail (WCAG 1.4.13). At under 800px with the editor open, one Esc could cancel the edit and a second could leave the finding. JAWS (and NVDA's focus mode) users routinely press Esc to leave forms mode, so an Esc that discards a reworded comment is a data-loss trap.
Fix: add "Esc precedence, innermost first, one layer per press: open tooltip → native select/menu/autocomplete popup → palette → `?` sheet → post drawer → inline editor → list filter text (clears) → narrow detail (back). In the inline editor, Esc with unsaved changes keeps the draft and moves focus to the Cancel button with 'Unsaved changes. Press Cancel to discard, or Save.' announced; only the Cancel button discards. Esc never navigates while a text field has content."
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Accessibility]** — Toasts: 8s auto-dismiss, an action keyboard users can't reach, and error toasts that vanish (§ EXPERIENCE.md, Toast row; DESIGN.md, Toast)
(EXPERIENCE.md, Toast row; DESIGN.md, Toast). A keyboard user deep in the list can't Tab to a bottom-right toast inside 8s, and "unless hovered or focused" doesn't help them get there. 2.2.1 requires that time limits be turnable off, adjustable or extendable; pausing on hover isn't any of those. Errors "that need action" announced via `role="alert"` that then disappear leave no trace. Toasts can also cover the focused post bar or Post button (2.4.11 in WCAG 2.2).
Fix: "Toasts never take focus. Info toasts dismiss after 8s, and the timer runs only while the page is visible and focused (`visibilitychange`). Error toasts and any toast whose action has no other route don't dismiss automatically, and have a Close button. Settings has 'Keep notifications until dismissed'. F6 (and the palette command 'Go to notifications') moves focus to the newest toast. Every toast action is also reachable without the toast (Show = `g a`; Retry is on the surface). The toast region is placed so it never covers the focused element; the drawer and post bar get bottom padding equal to the stack height. The action label makes sense on its own ('Show findings', not 'Show'). The status region speaks the toast text once; when the toast duplicates the run-result announcement, only one is spoken."
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Accessibility]** — The single-colour focus ring fails on the toast and on accent fills (§ DESIGN.md, `focus: #2f5bd3` / `focus-dark: #7c9cf5`)
(DESIGN.md, `focus: #2f5bd3` / `focus-dark: #7c9cf5`). Focus on toast-bg is 2.74:1 (light) and 2.13:1 (dark). A focus ring touching a primary button or a checked checkbox is 1.00:1. No outline width or offset is specified.
Fix: in DESIGN.md `colors`, add `focus-ring-outer: '#1c2128'`, `focus-ring-inner: '#ffffff'` and the dark pair (`#e3e7ec` / `#0f1216`). Add a `focus` component: "2px solid {colors.focus} outline, 2px offset, on every focusable element; on the toast, the primary button, and anything on an accent fill, use the two-tone ring (2px {colors.focus-ring-outer} outline + 2px {colors.focus-ring-inner} inner ring), ≥3:1 against every background in this file." Implement the ring as `outline`, not `box-shadow`, so it survives forced colours.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Accessibility]** — Forced colours: the selected row and active nav vanish (§ DESIGN.md, `nav-item-active`, `finding-row.selected`; not mentioned anywhere in v2)
(DESIGN.md, `nav-item-active`, `finding-row.selected`; not mentioned anywhere in v2). Selection is drawn as a background plus `box-shadow: inset 2px 0 0 accent`. Forced-colours mode removes both. The mocked checkbox is a styled `<span>`, so it disappears. The diff tints go too. The toast has no border, only a shadow and a background, so it merges with the page. The why-box loses its fill.
Fix: add to the Accessibility Floor: "Forced colours: selection and active indicators use a real `border-left: 2px solid` (mapped to `Highlight`), not `box-shadow`; checkboxes are native (`accent-color`); toast, why-box, suggestion box, tiles and drawer keep a 1px border (`CanvasText`); focus uses `outline` (`Highlight`); the diff's change type is visible as a `+`/`−` gutter column and the selected or current state is also in text (`aria-current` plus a visually hidden 'shown')." In DESIGN.md `nav-item-active.indicator` and `finding-row.selected`, change "2px inset left" to "2px left border".
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Accessibility]** — Several states are shown by colour alone (§ key-v2.html frames 1, 3, 5; DESIGN.md `run-timeline`, `filter-chip.active`)
(key-v2.html frames 1, 3, 5; DESIGN.md `run-timeline`, `filter-chip.active`). Done-OK and done-with-warnings timeline nodes differ only by dot hue ("Lint · TSLint" with a warn dot). The waiting node is `border` at 1.31:1. The active icon on the icon rail is an accent glyph on accent-soft against muted glyphs on the sidebar: 1.02:1 between the two glyph colours and 1.02:1 between the fills in light, with no indicator bar. The active filter chip differs from an inactive one mostly by hue (accent vs muted text, 1.02:1). The identity line shows health only with "● " in ok colour.
Fix: run-timeline: "each node has a state word in text (Waiting, Running, Done, Done with warnings, Failed, Skipped) before its outcome; the dot is `aria-hidden`; the waiting node is a 9px ring in {colors.border-strong} (3.64/3.76:1)". Rail: "the active icon gets the same 2px left indicator as `nav-item-active`, plus `aria-current="page"`". Filter chip: "active chips are toggle buttons with `aria-pressed="true"` and a leading ✓ glyph, plus the accent border". Identity: "health in words ('GitHub: signed in as @x', 'AI: claude-code ready')".
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Accessibility]** — Focus management across the three panes isn't specified (§ EXPERIENCE.md, Accessibility Floor bullet 2 covers only surface changes and closing overlays)
(EXPERIENCE.md, Accessibility Floor bullet 2 covers only surface changes and closing overlays). Several questions are open. Do j/k move focus or only the detail? Does Enter move focus into the detail? How does a keyboard user get from sidebar to list to detail without tabbing through about 15 sidebar items? Where does focus go when the selected row is filtered out, when `x` on the Pre-existing surface moves the row, when narrow back returns, or when a focused skeleton tile is replaced as a run finishes?
Fix: add "Focus model: DOM and Tab order is sidebar → list → detail. F6 / Shift+F6 cycle the sidebar, list, detail and notifications regions, and a skip link 'Skip to findings' is first in the page. j/k and ↓/↑ move focus between list rows and update the detail without moving focus. Enter (or activating the title) moves focus to the detail's finding heading (`h2`, `tabindex="-1"`). On narrow screens the detail replaces the list: focus goes to the finding heading, and back (Esc / '← Needs attention') returns focus to that finding's row. If the focused row is filtered out or removed, focus goes to the nearest following row, else the previous, else the list heading; this is announced ('Showing 1 of 2'). When a run finishes, any element that has focus and still exists keeps it; replaced tiles keep their DOM node, so skeleton→value is an in-place update; otherwise focus goes to the surface `h1` (inherited rule). A finished run never switches surface on its own if the user has navigated since starting it."
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Accessibility]** — The post drawer can't be closed except with Esc; modal behaviour and narrow width aren't specified (§ key-post-edit.html frame 2 shows only a `kbd Esc` in the heading; EXPERIENCE.md Post drawer row)
(key-post-edit.html frame 2 shows only a `kbd Esc` in the heading; EXPERIENCE.md Post drawer row). Mouse, touch and switch users have no way out. The spec says focus is trapped but not that the rest of the page is inert. Initial focus isn't given. A 480px drawer over a 320px viewport isn't addressed. Behaviour when ⌘K, j/k or `p` is pressed while it's open isn't defined.
Fix: "The drawer is a modal dialog (`<dialog>` opened with `showModal()`, or `role="dialog" aria-modal="true"` with the rest of the page `inert`), named by its heading 'Post to GitHub'. It has a visible Close button (≥24px, accessible name 'Close'). Initial focus goes to the heading (`tabindex="-1"`) while the preview builds; 'Preview ready: 2 inline comments and the summary' is announced; focus never lands on Post automatically. Below 800px it is full-width (`width: min(480px, 100vw)`). While it is open, ⌘K and page shortcuts are ignored. After a successful post, focus moves to the result line, which has `tabindex="-1"`. Close returns focus to the invoker (the 'Preview post' button, or the list row if `p` was pressed there)." Apply the same Close button and `width: min(640px, 100vw - 32px)` to the palette.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Accessibility]** — Animation over 5 seconds needs a pause control even without a reduced-motion preference
(EXPERIENCE.md Run timeline: "a running node animates (static under reduced motion)"; Accessibility Floor last bullet). The running ring turns for the whole AI step (52s in the mockup), alongside other content. WCAG 2.2.2 (Level A) requires pause, stop or hide for any motion that starts automatically and lasts over 5s, whatever the OS setting. The ticking elapsed time ("0:41") is auto-updating content under the same criterion. Skeleton shimmer isn't specified either way.
Fix: "The running ring animates for at most 5s, then stays static; 'Running' is the state word. Skeletons don't shimmer. Elapsed time updates every 10s or less often, and is not a live region. Under `prefers-reduced-motion: reduce`, there are no transitions and no ring animation at all."
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Accessibility]** — Mockup: shortcut keys inside primary buttons are invisible
(key-v2.html "Preview post `p`", key-post-edit.html "Save `⌘↵`": `kbd` has `background: var(--surface)` with `color: inherit`). That's white on white in light (1.00:1) and 1.09:1 in dark. DESIGN.md says "every action that has a shortcut shows its key" but only defines `kbd` on neutral surfaces.
Fix: add `kbd-on-accent` to DESIGN.md components: "transparent background, 1px border in {colors.accent-text} at 60% mixed onto accent, foreground {colors.accent-text}". The text then reads 5.90 / 7.09:1. Fix the two mockups. Hide the key glyph from screen readers (`aria-hidden`) and expose it through `aria-keyshortcuts`, so names read "Preview post", not "Preview post p".
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Accessibility]** — WCAG 2.1.4 compliance is a claim, not a spec (§ EXPERIENCE.md, Accessibility Floor: "Shortcuts can be turned off or remapped in Settings")
(EXPERIENCE.md, Accessibility Floor: "Shortcuts can be turned off or remapped in Settings"). Several things are unstated. Does "off" cover the `g` chords, `?` and `/`? (It must, because they're printable characters.) Where is the setting stored: per browser, per Web App user, or both? What does the remap UI do when two shortcuts collide, and is there a reset? Is the `?` sheet a dialog, and can you remap from it? The palette's "Show stats" carries a `g s` key (key-start.html) that's missing from the shortcut list.
Fix: "Settings → Keyboard: 'Single-key shortcuts' On (default) / Only when the list or detail has focus / Off. Off disables every unmodified printable-key shortcut, including `g` chords, `?`, `/`, j/k, x, e, c, p; ⌘K/Ctrl+K and Esc stay. Each shortcut can be remapped to a different key or a modifier combination; collisions are refused inline; Reset restores the defaults. Stored per browser (serve) and per user (Web App). The `?` sheet is a modal dialog that lists the current bindings and links to this setting." Add `g s` to the list or remove it from the mockup.

### Medium
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

### Medium (30)

**[Flow coverage]** — UJ-1's edge case (private repo the token cannot read: say which permission is missing, post nothing) is not covered
UJ-1's edge case (private repo the token cannot read: say which permission is missing, post nothing) is not covered. Flow 1's failure path is head-moved instead (Flow 1; PRD UJ-1).
Fix: add a second failure line to Flow 1 that uses a new Start state (see §4).
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Flow coverage]** — No flow covers Stats, Settings (for example "AI provider not ready → set it up → review"), or Pre-existing (ticking one
No flow covers Stats, Settings (for example "AI provider not ready → set it up → review"), or Pre-existing (ticking one pre-existing finding into the post, which Story 9.1's AC requires). Story 9.4+ makes each surface its own story, so these stories would have no flow to take acceptance criteria from (Key Flows).
Fix: add a short Flow 4 for first use on the Web App (Settings, then key, then review) and one step in Flow 1 where Anika ticks one pre-existing finding.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Token completeness]** — `{colors.focus}` is defined but never used
`{colors.focus}` is defined but never used. DESIGN.md has no focus-indicator spec: no width, no offset, no rule for focus on `button-primary`, where focus = accent = fill (1.00:1), and no rule for focus inside a selected `accent-soft` row (frontmatter `focus`; Components; Do's and Don'ts). The extension spine gives focus a token and a two-tone ring.
Fix: add a `focus-ring` component token (for example `2px solid {colors.focus}, 2px offset on {colors.surface}`) and a sentence in Components saying every focusable element uses it.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Token completeness]** — Nothing says how the `-dark` tokens are chosen (§ DESIGN.md Colors; EXPERIENCE.md IA Settings row)
Nothing says how the `-dark` tokens are chosen. EXPERIENCE.md has a "theme" action and setting, and the Settings mockup shows System / Light / Dark, but DESIGN.md never says that the OS preference applies by default, that a user override wins, or where the choice is stored (DESIGN.md Colors; EXPERIENCE.md IA Settings row).
Fix: one line in Colors: "-dark values apply under the theme setting (System by default = prefers-color-scheme; Light / Dark override, remembered per browser)."
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Component coverage]** — The Outdated banner is load-bearing (it turns posting off) but has no visual spec, while the extension has `banner-outda (§ EXPERIENCE.md State Patterns "Outdated"; DESIGN.md Components)
The Outdated banner is load-bearing (it turns posting off) but has no visual spec, while the extension has `banner-outdated` (EXPERIENCE.md State Patterns "Outdated"; DESIGN.md Components).
Fix: add `banner` to the frontmatter (warn pair, placement above the hero and the list) and a Components line.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Component coverage]** — "Identity menu" is a navigation target for Settings and the View switch, yet neither spine says what it contains (identi (§ EXPERIENCE.md IA Settings row, Component Patterns View switch; DESIGN.md Sidebar)
"Identity menu" is a navigation target for Settings and the View switch, yet neither spine says what it contains (identity, AI readiness, Settings, Switch to classic, Sign out on the Web App) or how it opens (EXPERIENCE.md IA Settings row, Component Patterns View switch; DESIGN.md Sidebar).
Fix: add an "Identity menu" row to both files.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Component coverage]** — The Command field has no behavioural row (§ DESIGN.md "Command field and palette"; EXPERIENCE.md Component Patterns.)
The Command field has no behavioural row. Does focusing or typing in the sidebar field open the palette? Is Start's large field the palette inline or a separate input with the same parser? What does Enter do with an invalid reference? (DESIGN.md "Command field and palette"; EXPERIENCE.md Component Patterns.)
Fix: add a "Command field" row: the sidebar field opens the palette, and Start's field is the palette rendered inline with the same rules.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Component coverage]** — The shortcuts sheet (`?`) is referenced by Interaction Primitives and Accessibility Floor and has a mockup, but has no I (§ EXPERIENCE.md Interaction Primitives, Accessibility Floor)
The shortcuts sheet (`?`) is referenced by Interaction Primitives and Accessibility Floor and has a mockup, but has no IA row and no component row in either file. Its modal semantics also matter for the "never deeper than one" rule (EXPERIENCE.md Interaction Primitives, Accessibility Floor).
Fix: add IA and component rows, and state that it is a dialog that closes the palette or drawer first.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[State coverage]** — The command palette has no empty or error states, although it now carries the open-PR list that classic showed with expl
The command palette has no empty or error states, although it now carries the open-PR list that classic showed with explicit "No open PRs" and error messages (State Patterns).
Fix: add rows for no matches, no open PRs, repo not found or no access, loading, and reviewed state unknown.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[State coverage]** — Stats and Settings have no states at all, even though both are on Story 9.3's parity list (State Patterns)
Stats and Settings have no states at all, even though both are on Story 9.3's parity list (State Patterns).
Fix: add loading, empty and error for Stats; save, saved and error for Settings.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[State coverage]** — The post drawer does not say that a preview is valid only for the exact selection and edits it was built from (classic c
The post drawer does not say that a preview is valid only for the exact selection and edits it was built from (classic clears the preview on any change). "Esc closes it without losing the preview" invites posting a stale preview after the user ticks something else (Component Patterns: Post drawer).
Fix: "Any change to inclusion or wording discards the preview; reopening rebuilds it."
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[State coverage]** — Findings that cannot sit under a hunk (no location, whole-PR, or outside the diff, which includes many pre-existing lint
Findings that cannot sit under a hunk (no location, whole-PR, or outside the diff, which includes many pre-existing lint findings) are treated only as "hunks unavailable", which is a different cause with a different message (State Patterns; Component Patterns: Finding thread).
Fix: add a row: "Not in this PR's diff: the comment shows without code and with the file link."
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Visual reference coverage]** — The mockups show capabilities the spines do not specify (§ key-start.html, key-stats.html, key-checks-walkthrough.html vs EXPERIENCE.md IA and Interaction Primitives.)
The mockups show capabilities the spines do not specify. Because the spines win on conflict, a consumer will drop them, though they look intended:
  - Start and Stats show sidebar nav items "Start / Stats / Settings"; the spine reaches these only through the palette.
  - The palette shows "Show stats for this repository `g s`", and `g s` is not in Interaction Primitives.
  - The palette shows "Review with another AI provider…", a per-run override (FR-31) that is not in the spine.
  - Checks shows a "Projects" line.
  - Stats periods are 7 / 30 / 90 days, where classic offers 30 / 90 / 365 plus a repository filter.

  (key-start.html, key-stats.html, key-checks-walkthrough.html vs EXPERIENCE.md IA and Interaction Primitives.)
Fix: bring each into the spine or mark it as a mockup-only exploration.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Feature parity with classic]** — Select all / Select none is missing, and Story 9.1 defines it ("Select all selects new findings only") (Component Patter
Select all / Select none is missing, and Story 9.1 defines it ("Select all selects new findings only") (Component Patterns: Finding list; epics.md Story 9.1 AC).
Fix: add palette actions and list-header buttons, with Story 9.1's rule.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Feature parity with classic]** — The gate's "Why it failed" reasons, Limitations, Review Rules checked, detected projects, and advisory and dismissed-by
The gate's "Why it failed" reasons, Limitations, Review Rules checked, detected projects, and advisory and dismissed-by badges have no v2 home. FR-32 requires every JSON Report field to be reachable from the UI (IA; PRD FR-32).
Fix: add a line to Foundation committing to FR-32, and place each item (gate reasons in the hero, projects and limitations in Checks, rules checked in Walkthrough, badges in the thread).
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Feature parity with classic]** — Sign out (Web App), the version label, and the serve one-time-key "locked" page are dropped without saying so (State Pat (§ State Patterns; DESIGN.md Sidebar)
Sign out (Web App), the version label, and the serve one-time-key "locked" page are dropped without saying so (State Patterns; DESIGN.md Sidebar).
Fix: put Sign out and the version in the identity menu, and add a locked state for serve opened without its key.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Inheritance discipline]** — The Pre-existing group contradicts itself across the spines (§ DESIGN.md Components; EXPERIENCE.md Component Patterns; epics.md UX-DR26)
The Pre-existing group contradicts itself across the spines. DESIGN.md calls it "expandable". EXPERIENCE.md says "activating it opens Pre-existing" (a separate surface). UX-DR26 and Story 9.1 describe a collapsed group with "· Show" listed after the new findings (DESIGN.md Components; EXPERIENCE.md Component Patterns; epics.md UX-DR26).
Fix: choose one (navigate to Pre-existing, or expand in place) and use Story 9.1's label ("20 pre-existing · Show").
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Inheritance discipline]** — The default-view mechanism has four inputs and no order of precedence: `serve --ui classic|v2`, the Web App setting (Sto (§ EXPERIENCE.md IA)
The default-view mechanism has four inputs and no order of precedence: `serve --ui classic|v2`, the Web App setting (Story 9.3), Settings "default view" (EXPERIENCE.md IA), and "remembered per browser" (View switch) (Coexistence with Classic).
Fix: one line: per-browser choice, then server default (`--ui` or the Web App operator setting), then classic until parity.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Inheritance discipline]** — The finding list's accessibility pattern is left open: "listbox-like single tab stop … or plain buttons in DOM order"
The finding list's accessibility pattern is left open: "listbox-like single tab stop … or plain buttons in DOM order". The listbox option also contains a real checkbox, which puts interactive content inside an option, and ARIA does not allow that (Accessibility Floor, third bullet). The extension's UX-DR23 chose "selection only via checkboxes; cards not focusable". v2 deliberately departs from that and should say so.
Fix: commit one pattern. For example, a list of rows where each row is a button that opens the finding and has a sibling checkbox, with j/k moving focus between the row buttons.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Inheritance discipline]** — Forced-colors is neither inherited nor stated (§ EXPERIENCE.md Foundation, Accessibility Floor)
Forced-colors is neither inherited nor stated. Foundation inherits only the "announcement and time-limit rules". v2 relies on fills for selection (`accent-soft`) and the diff, and the extension spine has an explicit forced-colors rule (EXPERIENCE.md Foundation, Accessibility Floor).
Fix: inherit the extension's Motion, zoom and forced-colours rules and add "selected row keeps a visible border in forced colors".
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Accessibility]** — Diff semantics are one line in the spec, and the mockup contradicts it (§ EXPERIENCE.md, Accessibility Floor: "The diff is a table with line numbers and change type read as text"; key-v2.html uses a `div` grid)
(EXPERIENCE.md, Accessibility Floor: "The diff is a table with line numbers and change type read as text"; key-v2.html uses a `div` grid). The spec leaves open the columns and headers, how the `+`/`−` in the code is handled (otherwise it's read twice: "added, plus …"), how the hunk header row reads, how the commented range is marked, whether the suggestion block uses the same table, and how long lines behave.
Fix: "Each code box is a `<table>` with a visually hidden caption '<path>, lines 68–73, this PR's change' and visually hidden column headers Old line, New line, Change, Code. The Change cell holds 'added', 'removed' or nothing for context lines, in visually hidden text; the visible `+`/`−` gutter is `aria-hidden`. The hunk header is a full-width row with the `@@` text. Lines the finding is about carry a visually hidden 'commented line' and a visible left marker in {colors.border-strong}. The suggested change uses the same table with the caption 'Suggested change'. Syntax colours, if added, are checked at ≥4.5:1 against surface, diff-add, diff-del and diff-hunk in both themes. The table sits in a `role="region"` scroll container with `tabindex="0"` and an `aria-label` (the caption text); a 'Wrap lines' toggle (remembered) removes horizontal scrolling for people who zoom."
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Accessibility]** — The icon rail is icon-only with unclear glyphs and hides the counts (§ EXPERIENCE.md Sidebar; key-v2.html frame 5: ⌕ ◎ ! ≡ ✓)
(EXPERIENCE.md Sidebar; key-v2.html frame 5: ⌕ ◎ ! ≡ ✓). "Names as tooltips and accessible names" passes 4.1.2, but nothing says how the tooltip behaves under 1.4.13 (hoverable, persistent, Esc-dismissable, which collides with Esc = back). The counts ("Needs attention 2") disappear from the rail. The glyph for Needs attention is "!".
Fix: "Rail items are links with `aria-current="page"` on the active one and an accessible name that includes the count ('Needs attention, 2'). The count shows as a small badge on the icon. Tooltips appear on hover and focus, stay while hovered, dismiss on Esc (top of the Esc order), and are `aria-hidden` (the name is on the link). A rail toggle 'Show labels' (remembered) expands the sidebar to full width at any viewport ≥ 600px. Icons come from one set with real metaphors, not punctuation."
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Accessibility]** — The live-region rules are only partly restated (§ EXPERIENCE.md, Accessibility Floor bullet 5)
(EXPERIENCE.md, Accessibility Floor bullet 5). The extension's "Step list and elapsed time are not live" and "Re-attaching announces only the current state" (switching classic↔v2 mid-run) weren't carried over. The filter count isn't debounced, so typing in `/` filter announces on every key. Skeleton tiles have no busy state, and the nav count "…" has no name. The outcomes of x / e-save / c, the drawer's "Preview ready", and posting results don't say whether they're status or alert.
Fix: add "Not live: the timeline, elapsed time, tiles, nav counts. Tiles region has `aria-busy="true"` while any tile is a skeleton; skeleton blocks are `aria-hidden`, and each tile's name is '<caption>: loading'; the nav count '…' is named 'counting'. Filter results announce 500ms after the last keystroke. Status messages: 'Excluded from post. 1 of 2 included', 'Saved. Marked edited', 'Copied agent prompt', 'Preview ready…', 'Posted…'. Alert: run failed, posting refused, head moved while posting, backend unreachable, sign-in expired. At most one status message per 1.5s, the newest replacing older queued ones, except the final run result."
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Accessibility]** — Command palette: the combobox details are missing, and the sidebar field is a trap (§ EXPERIENCE.md Command palette row; Accessibility Floor bullet 7; key-start.html)
(EXPERIENCE.md Command palette row; Accessibility Floor bullet 7; key-start.html). The spec doesn't say how groups are exposed, how async loading ("owner/repo lists its open PRs" is a network fetch) and empty results are announced, or whether focus returns to the invoker or goes to the new `h1` after an action that switches surface. If the sidebar's "Search or run a command" field is a real `<input>` that opens a dialog on focus, that's a 3.2.1 (On Focus) failure.
Fix: "The palette is a modal dialog ('Command palette') containing an APG combobox: `input role="combobox" aria-expanded aria-controls aria-activedescendant aria-autocomplete="list"`; the listbox has `role="group"` sections labelled by their group headings; each option's shortcut is in `aria-keyshortcuts` and its status text ('reviewed, 6e53c3e is current') is part of the name. 'Loading open PRs…', 'No matches' and the result count ('5 results') are announced politely after a 300ms debounce. Actions that change the surface move focus to the new `h1`; Esc and Close return focus to the invoker. The sidebar's command field is a `<button>` styled as a field, named 'Search or run a command' with `aria-keyshortcuts="Meta+K Control+K"`; it opens the palette on activation, not on focus."
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Accessibility]** — `g` chords have no timing or feedback rules (§ EXPERIENCE.md Interaction Primitives)
(EXPERIENCE.md Interaction Primitives). If `g` times out quickly, a slow typist pressing `g` then `p` gets the post drawer instead of Pre-existing. If it never times out, a stray `g` hijacks the next key.
Fix: "After `g`, a visible 'g …' indicator appears near the shortcut hints, and the next key completes the chord; the chord is cancelled by Esc, by any non-chord key (which is then swallowed, not run), or after 2s. The timeout is configurable or can be turned off in Settings → Keyboard."
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Accessibility]** — The inline editor needs naming, a quiet preview, and a decision on Markdown (§ EXPERIENCE.md Inline editor; DESIGN.md `inline-editor`; key-post-edit.html frame 1)
(EXPERIENCE.md Inline editor; DESIGN.md `inline-editor`; key-post-edit.html frame 1). The source shows an uppercase "Wording (Markdown)" div rather than a `<label>`. Nothing says the preview mustn't be a live region; if it is, it will talk on every keystroke. Rendered Markdown can insert `h1`–`h3` into the page's heading outline. The extension's floor says finding text "never renders as rich HTML", which contradicts this preview and isn't reconciled.
Fix: "The source is a `<textarea>` with a `<label>` 'Comment wording for <finding title>'. The preview is a named region ('Preview'), is not live, and is focusable when it scrolls; rendered headings are demoted to start below the detail's heading level (or rendered as bold text); links in the preview are underlined and inert. Save (⌘/Ctrl+Enter) announces 'Saved. Marked edited' and returns focus to 'Edit wording'. The 'edited' tag is text ('edited'), also included in the row button's name." Record in Foundation that v2 deliberately overrides the extension's plain-text rule for the editor preview only.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Accessibility]** — The heading and landmark structure in the mockups doesn't match the rule (§ EXPERIENCE.md Accessibility Floor bullet 1; key-v2.html uses `h2` for the hero and `h3` for the finding with no `h1`)
(EXPERIENCE.md Accessibility Floor bullet 1; key-v2.html uses `h2` for the hero and `h3` for the finding with no `h1`). The spine doesn't name the `h1` for Needs attention, Pre-existing, Checks, Walkthrough or Start. It doesn't say whether `document.title` follows j/k.
Fix: "`h1` per surface: Start 'Review a pull request'; Overview the PR title; Needs attention / Pre-existing / Checks / Walkthrough the surface name (the PR is in the crumb and `document.title`). The list heading and the detail's finding title are `h2`; sections inside the finding (Why it matters, Suggested change) are `h3`. `document.title` = '<Surface> · <owner/repo#n> · PR Reviewer' and doesn't change on j/k. Regions: `nav` 'Review navigation', `main` with `section`s labelled 'Findings' and 'Finding detail'."
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Accessibility]** — Target sizes break the spine's own 24px rule (§ DESIGN.md `finding-row.checkbox: 14px`, `spacing.target-min: 24px`; key-v2.html chips about 18px tall; sidebar file rows about 24px)
(DESIGN.md `finding-row.checkbox: 14px`, `spacing.target-min: 24px`; key-v2.html chips about 18px tall; sidebar file rows about 24px). WCAG 2.1 AA has no target-size criterion (2.5.5 is AAA), but the spine sets 24px and then doesn't meet it. The extension's rule that "the label wraps the checkbox column so the target is larger than the box" wasn't carried over.
Fix: "`finding-row.checkbox`: the visible box stays 14px, inside a `<label>` hit area at least 24×24px (the full row height of the checkbox column). Filter chips: min-height {spacing.target-min}. Sidebar file rows and nav items: min-height {spacing.target-min}. Toast action and Close: ≥24px."
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Accessibility]** — Reflow at 320px / 400% zoom is only partly worked out (§ EXPERIENCE.md Responsive table and Accessibility Floor bullet 8)
(EXPERIENCE.md Responsive table and Accessibility Floor bullet 8). At 320px the 56px rail leaves 264px for content. The tiles are mocked 4-up with no wrap rule. Drawer (480px) and palette (640px) widths are fixed. List titles are truncated with "…" in key-post-edit.html. `.sev` uses a fixed `height: 18px` (it'll clip under 1.4.12 text spacing).
Fix: "Below 600px the rail becomes a top bar with a menu button ('Navigation', `aria-expanded`). Tiles wrap at 2-up below 800px and 1-up below 480px. Drawer and palette `max-width: 100vw` (full-screen below 600px). Finding titles wrap; they're never ellipsised (or the full title is in the accessible name and a tooltip). No fixed heights on badges, pills or rows; use min-height. The summary preview uses `white-space: pre-wrap` (as mocked). Test at 1280px with 400% zoom and with text spacing 1.5/0.12em/0.16em/2.0."
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Accessibility]** — Targeting WCAG 2.1 in 2026 misses criteria that would catch these exact issues (§ EXPERIENCE.md Accessibility Floor, first paragraph)
(EXPERIENCE.md Accessibility Floor, first paragraph). WCAG 2.2 (2023) adds 2.4.11 Focus Not Obscured (toasts, the sticky post bar), 2.5.8 Target Size Minimum (the 14px checkbox, chips) and 3.2.6 Consistent Help.
Fix: "Target WCAG 2.2 AA; flagged for the PRD (§4.7)". At minimum, add 2.4.11 and 2.5.8 to the floor as v2 rules.

### Low
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

### Low (24)

**[Flow coverage]** — Flow 3 has no failure path
Flow 3 has no failure path. Switching mid-run is the case Coexistence promises ("switching mid-run continues the same run") and is worth one line (Flow 3; Coexistence with Classic).
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Flow coverage]** — Protagonists are borrowed from the extension spine (Sofia, Tom), not from the PRD journeys they cite
Protagonists are borrowed from the extension spine (Sofia, Tom), not from the PRD journeys they cite. That is acceptable for Flows 2 and 3, but Flow 2's title should name UJ-3's actor (a teammate on Meera's Web App) to keep the names verbatim (Flow 2 title).
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Token completeness]** — Contrast is stated as targets plus "new v2 pairs to verify at build" instead of measured values (§ DESIGN.md Colors, last paragraph)
Contrast is stated as targets plus "new v2 pairs to verify at build" instead of measured values. The extension spine commits a measured table (DESIGN.md Colors, last paragraph).
Fix: paste the table above (it all passes) so build checks a number, not a to-do. Note that border-strong on accent-soft (3.14) is now the tightest control pair.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Token completeness]** — Spacing tokens `'1'`, `'3'` and `'6'` are defined but never referenced (frontmatter `spacing`)
Spacing tokens `'1'`, `'3'` and `'6'` are defined but never referenced (frontmatter `spacing`). Harmless. Either use them or drop them.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Component coverage]** — The same component has different names: "Finding row" (DESIGN.md) and "Finding list" (EXPERIENCE.md) (§ DESIGN.md)
The same component has different names: "Finding row" (DESIGN.md) and "Finding list" (EXPERIENCE.md).
Fix: use one name, for example "Finding list" with "row" as its anatomy.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Component coverage]** — View switch, Post bar, Needs attention preview, Recent reviews list and the narrow back control are named but not specif
View switch, Post bar, Needs attention preview, Recent reviews list and the narrow back control are named but not specified on one side or the other (see table). Each needs about one line.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[State coverage]** — The empty states for Needs attention (no new findings), Pre-existing (none) and Walkthrough (no AI walkthrough) are miss
The empty states for Needs attention (no new findings), Pre-existing (none) and Walkthrough (no AI walkthrough) are missing. One line each.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Visual reference coverage]** — DESIGN.md Colors still points to "the exploratory direction mocks in `.working/`", but they now live in `mockups/directi (§ DESIGN.md Colors, status pairs bullet)
DESIGN.md Colors still points to "the exploratory direction mocks in `.working/`", but they now live in `mockups/directions/` and `.working/` is empty (DESIGN.md Colors, status pairs bullet).
Fix: update the path, or move that note to the memlog.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Visual reference coverage]** — DESIGN.md Components links only the directory (`[mockups/](mockups/)`), with an outdated list that omits Checks, Walkthr (§ DESIGN.md Components, first line)
DESIGN.md Components links only the directory (`[mockups/](mockups/)`), with an outdated list that omits Checks, Walkthrough, Stats, shortcuts and Settings (DESIGN.md Components, first line).
Fix: link the files per component, or point to EXPERIENCE.md IA.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Visual reference coverage]** — `imports/classic-report-dark-2026-11-26.png` is not referenced by either spine (orphan, cited only in the memlog) (§ orphan, cited only in the memlog)
`imports/classic-report-dark-2026-11-26.png` is not referenced by either spine (orphan, cited only in the memlog).
Fix: cite it in Foundation or Coexistence as the "before" for the parity check.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Feature parity with classic]** — Download Markdown / JSON lives only at the bottom of Walkthrough, which is the AI narrative surface
Download Markdown / JSON lives only at the bottom of Walkthrough, which is the AI narrative surface. It also has no palette action, unlike every other action (IA Walkthrough row).
Fix: add "Download Markdown" and "Download JSON" palette actions.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Feature parity with classic]** — The commit-status result line ("Commit status set / skipped (no permission)") is not mentioned in the post result (Compo
The commit-status result line ("Commit status set / skipped (no permission)") is not mentioned in the post result (Component Patterns: Post drawer).
Fix: name it as part of the result lines.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Bloat & overspecification]** — The decision-history aside in DESIGN.md Colors ("The exploratory direction mocks in `.working/` showed MINOR in amber; t
The decision-history aside in DESIGN.md Colors ("The exploratory direction mocks in `.working/` showed MINOR in amber; the key-screen mockups follow this mapping") belongs in the memlog, not the contract.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Bloat & overspecification]** — DESIGN.md Colors restates the extension's full status mapping
DESIGN.md Colors restates the extension's full status mapping. It is acceptable because tokens need it, but a pointer ("the extension's mapping, unchanged") would keep one source of truth.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Bloat & overspecification]** — "Main-area padding is `{spacing.9}`–`{spacing.10}`" is a range, not a decision (DESIGN.md Layout & Spacing) (§ DESIGN.md Layout & Spacing)
"Main-area padding is `{spacing.9}`–`{spacing.10}`" is a range, not a decision (DESIGN.md Layout & Spacing).
Fix: pick one, or say which applies at which width.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Inheritance discipline]** — The inherited "time-limit rules" concern device-code expiry, which v2 does not have
The inherited "time-limit rules" concern device-code expiry, which v2 does not have. v2's own timer is the 8s toast.
Fix: drop the time-limit inheritance, or say it covers only that toasts never carry information on their own.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Inheritance discipline]** — The vocabulary drifts
The vocabulary drifts. "Selection" means the focused row in v2 but means inclusion in classic, the extension and Story 9.1 ("Select all", "2 of 22 selected"). Reviewed-state wording also differs across classic ("new commits"), the mockup ("reviewed an older commit") and Flow 2 ("not reviewed at this commit").
Fix: add a two-line glossary (selected = shown in detail; included = will be posted) and use the classic wording for reviewed state.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Inheritance discipline]** — Responsive widths are not inherited by the overlays (§ DESIGN.md `command-palette`, `post-drawer`; EXPERIENCE.md Responsive)
Responsive widths are not inherited by the overlays. The palette (640px) and drawer (480px) have fixed widths, with no rule below 800px or at 320px, where both exceed the viewport (DESIGN.md `command-palette`, `post-drawer`; EXPERIENCE.md Responsive).
Fix: "Below 800px the palette and drawer are full width."
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Shape fit]** — The Component Patterns table has no "Use / surface" column, unlike the examples
The Component Patterns table has no "Use / surface" column, unlike the examples. Surfaces are only implied (Component Patterns). Optional, but it helps per-surface story extraction.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Accessibility]** — Skeletons are 1.21 / 1.19:1 on surface (§ DESIGN.md `skeleton`)
(DESIGN.md `skeleton`). That's acceptable only if they're decorative.
Fix: keep the value and state in the floor that "loading is conveyed in text ('loading' in the tile's name, `aria-busy`), never by the skeleton alone."
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Accessibility]** — Tight pairs that a later tweak could break
: border-strong on accent-soft 3.14 (unticked checkbox on a selected row), border-strong on sidebar 3.19, muted on neutral-bg 5.00, muted on accent-soft 5.01, ok on ok-bg 4.69 (light).
Fix: add a contrast table to v2's DESIGN.md (the one above), naming these as "never lighten" locks, and replace the "verify at build" sentence (Colors, last paragraph) with the measured values.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Accessibility]** — Browser key conflicts
: Ctrl+K (Windows/Linux Chrome, Edge and Firefox focus the browser's search) and `/` (Firefox Quick Find) are handled only if the page calls `preventDefault`.
Fix: "⌘K/Ctrl+K and `/` call `preventDefault` only when the page has focus and no text field is focused; the palette is also reachable from the sidebar button."
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Accessibility]** — Links and decorative glyphs
: the path link is drawn as `<a>` without `href` (not focusable), and "open on GitHub ↗" doesn't say it opens a new tab. The "●" and "◌" in status pills and "▸" in the group row will be read aloud.
Fix: "Path link: `href` to GitHub, name '<path> lines 71 to 73, opens GitHub in a new tab'. Decorative glyphs (●, ◌, ▸, ↗, ⌕) are `aria-hidden`. The pre-existing group is a button with `aria-expanded` (or a link to Pre-existing), named '20 pre-existing findings, not included'."
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

**[Accessibility]** — Hover, active and disabled visuals aren't defined (§ DESIGN.md components)
for nav items, rows, chips and buttons (DESIGN.md components).
Fix: add hover and disabled values per component. Disabled controls stay at full-contrast text, with the reason next to them, and use `aria-disabled` (the extension's rule), with no opacity on anything a user can still act on.
Status: addressed in the spines (critical, high, medium); low findings per the resolution note.

## Reviewer files

- `review-rubric.md`
- `review-accessibility.md`
