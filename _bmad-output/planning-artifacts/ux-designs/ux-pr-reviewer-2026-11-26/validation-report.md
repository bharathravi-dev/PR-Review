# Validation Report — pr-reviewer browser extension

- **DESIGN.md:** `/Users/bharathkumarr/self/projects/POC/pr-review/pr-reviewer/_bmad-output/planning-artifacts/ux-designs/ux-pr-reviewer-2026-11-26/DESIGN.md`
- **EXPERIENCE.md:** `/Users/bharathkumarr/self/projects/POC/pr-review/pr-reviewer/_bmad-output/planning-artifacts/ux-designs/ux-pr-reviewer-2026-11-26/EXPERIENCE.md`
- **Run at:** 2026-11-26T04:14:27Z

## Overall verdict

The pair has the right shape and holds to its sources well. Every color token matches `packages/cli/static/app.css` exactly in light and dark, every `{token}` reference resolves, both files follow canonical section order, and the flows read as real journeys with named people and climaxes. It is not yet a clean contract for the Report and Post screens, though. Post has no visual spec. The on-page button is specified differently in the two files. Contrast targets are missing even though EXPERIENCE.md points to them, and the 60% opacity on a deselected card fails AA. Nothing decides what happens to a Standalone run when the panel follows the tab to another PR, and there is no whole-run failure state. Fix the 6 high findings before the Report and Post mockups are built on top.

**Not ready for stories yet. Fix before build.** The base palette is sound: every text/status pair passes 4.5:1 in light and dark. The failures come from rules on top of that palette:

**Resolution.** All high and medium findings below were applied to DESIGN.md and EXPERIENCE.md in the same session (see the [change] entries in .memlog.md). Most low findings were applied too; inherited tokens that are unused were left as they are (harmless), and storage and pairing details moved to the spines' Open Questions.

## Category verdicts

- Flow coverage — adequate
- Token completeness — adequate
- Component coverage — thin
- State coverage — thin
- Visual reference coverage — pending
- Bloat & overspecification — strong
- Inheritance discipline — adequate
- Shape fit — strong

## Findings by severity

### Critical (0)

### High (15)

**[Token completeness]** — DESIGN.md states no contrast targets (§ line 109)
DESIGN.md states no contrast targets. EXPERIENCE.md Accessibility Floor (line 109) says "Visual contrast lives in `DESIGN.md` (… AA in light and dark)", so that cross-reference points at nothing.
Fix: add a short contrast table to DESIGN.md Colors, using the ratios above, stating the AA target per pair (4.5:1 for text, 3:1 for non-text).
Status: resolved in the spines.

**[Token completeness]** — `finding-card.deselected-opacity: '0.6'` (DESIGN.md line 122; prose line 200) drops the meta line to 2.54:1 and the seve (§ DESIGN.md line 122; prose line 200)
`finding-card.deselected-opacity: '0.6'` (DESIGN.md line 122; prose line 200) drops the meta line to 2.54:1 and the severity badges to about 2.6–3.0:1 in light mode. A deselected card is still active content, since the user can re-select it, so this breaks the WCAG 2.1 AA floor the spine commits to (EXPERIENCE.md line 111). The opacity is inherited from app.css `.finding.off`, but it is still a defect for the extension.
Fix: show deselection with the unchecked box, a "Not posting" label in text, and a `{colors.bg}` card fill or dashed border. Keep text at full contrast.
Status: resolved in the spines.

**[Component coverage]** — Post panel has no visual spec (§ EXPERIENCE.md line 74)
Post panel has no visual spec. It has a behavioral row (EXPERIENCE.md line 74), but DESIGN.md defines no review-type control, preview block, primary post button label, or result line in either frontmatter or prose. Post is one of the two key screens about to be mocked. The app.css precedent exists (`pre.preview`: surface-2, mono, rounded 8px, max-height 420px, and `.result` with the status pairs).
Fix: add a `post-panel` / `preview-block` / `result-line` spec to DESIGN.md Components and frontmatter.
Status: resolved in the spines.

**[Component coverage]** — The page review button is specified two ways (§ line 204)
The page review button is specified two ways. DESIGN.md (line 204) says it shows the logo mark and "Review". EXPERIENCE.md (line 68), together with memlog line 29 ("Supersedes the plain-'Review' assumption"), defines five labels: "Review", "Reviewing…", "3 findings", "No findings", "Outdated". DESIGN.md was never updated, so per-state visuals (does "Outdated" use `warn`?), width and truncation are undefined. EXPERIENCE.md line 112 also fixes the accessible name as "Review this PR with pr-reviewer" while the visible label changes, which fails WCAG 2.5.3 (Label in Name) in four of the five states.
Fix: add the state table to DESIGN.md, and make the accessible name start with the visible label (for example "3 findings — open pr-reviewer").
Status: resolved in the spines.

**[State coverage]** — A Standalone run conflicts with follow-the-tab (§ EXPERIENCE.md line 102)
A Standalone run conflicts with follow-the-tab. The panel is per window and always shows the active tab's PR (EXPERIENCE.md line 102). A Standalone run lives in the panel page (line 22, AD-16). Nothing says what happens to a running Standalone review when the user switches to another tab or PR in the same window: does it keep running unseen, get cancelled, or block the switch? And what does the page button show meanwhile? This decides the run lifecycle for story 7.1.
Fix: commit to a rule. For example: "The run continues; the panel shows the other tab's PR with a 'Review of #42 running' strip; returning re-shows progress."
Status: resolved in the spines.

**[State coverage]** — There is no whole-run failure state (§ line 91)
There is no whole-run failure state. Only the AI-layer error is covered (line 91). Not covered: a run ending in `ERROR` (GitHub API failure or rate limit, `CONFIG_UNSUPPORTED`, network loss mid-run in Standalone, a backend run that dies), or the outcome of Cancel.
Fix: add "Run failed" (reason in plain words, Retry, keeps the last good Report) and "Cancelled" rows.
Status: resolved in the spines.

**[Accessibility]** — The page button's accessible name does not contain its visible label (2.5.3)
EXPERIENCE Accessibility Floor fixes the name as "Review this PR with pr-reviewer". The visible label also shows "3 findings", "No findings", "Outdated" and "Reviewing…". A speech user who says "click Outdated" gets nothing, and a screen reader user hears "Review this PR" on a button that will not start a review.
Fix: replace the Floor bullet with: "The button's accessible name starts with its exact visible label, followed by the product: '3 findings, pr-reviewer'. In the Review state it is 'Review this PR, pr-reviewer'. Build it from visible text plus a visually hidden suffix, not `aria-label`, so the two cannot drift."
Status: resolved in the spines.

**[Accessibility]** — The page button's focus ring fails 3:1 when the OS theme and GitHub's theme differ
DESIGN Components (Page review button) plus the memlog decision to follow the OS theme. The 2px `{colors.focus}` ring with a 2px offset sits on GitHub's background: 2.49–2.65 for OS dark on GitHub light, 2.93 for OS light on GitHub dark #161b22. The fill also drops to 2.49 in the first case. That is allowed, because the text label identifies the control, but the ring is not.
Fix: give the page button its own two-tone focus indicator (WCAG technique C40) instead of `{colors.focus}`: `outline: 2px solid #1c2128; outline-offset: 2px; box-shadow: 0 0 0 2px #ffffff;`. Either the white ring or the dark ring is ≥15:1 against any GitHub background. Add `page-button-focus` to DESIGN `components.page-review-button`.
Status: resolved in the spines.

**[Accessibility]** — Keyboard and screen reader users get no feedback after activating the page button or the shortcut
EXPERIENCE Interaction Primitives (Open the panel). Opening a side panel from a page click or a command does not move keyboard focus into it in Chrome (verify on 116+). The user hears nothing; in the Review state a paid review has quietly started; and nothing tells them how to reach the panel.
Fix: add to the Floor: "Activating the page button triggers a polite announcement from a live region inside the button's own shadow root: 'Opened in the pr-reviewer side panel. Press F6 to move there.' (Use whichever key Chrome actually uses for pane cycling.) When the panel opens, it focuses its surface heading so arriving with F6 lands there. The Welcome surface states the key once."
Status: resolved in the spines.

**[Accessibility]** — "Focus moves to the new surface's heading on every surface change" also fires on changes the user did not ask for
EXPERIENCE Accessibility Floor, read against Follow the tab, Finding card and Flow 1 steps 5–6:
  - Run finishes and the panel goes from Run in progress to Report.
  - Setup completes and the review auto-starts.
  - The user switches tabs.
  - A path:line click navigates the tab to Files changed of the same PR.

  Each one yanks focus to the top heading. Moving through findings and opening each path:line would throw the user back to the heading every time (3.2.1/3.2.2, 2.4.3).
Fix: replace the bullet with:
  - "Focus moves to the new surface's `h1` (tabindex=-1) only when the user's own action in the panel changed the surface."
  - "On automatic changes (run finished, tab followed, setup returning to a PR), focus stays where it is if that element still exists. Otherwise it moves to the new `h1`, and the change is announced in the status region."
  - "Navigation within the same PR (Conversation, Files changed, anchors) never re-renders the panel or moves focus."
  - "When the focused control is removed (for example, Cancel at the end of a run), focus goes to the new `h1`, never to `body`."
Status: resolved in the spines.

**[Accessibility]** — The progress live region has no granularity rule, and the existing page's pattern is noisy
EXPERIENCE Accessibility Floor (progress). `packages/cli/static/index.html:61` puts `aria-live="polite"` on the whole `#progress` section, so every RunEvent re-render re-queues the whole step list, plus the elapsed-time counter if it lives in that section.
Fix: rule text: "The step list and elapsed time are not live. One visually hidden `role="status"` region per panel announces only layer start and finish ('AI review running', 'Compile: SKIPPED, no Sandbox'). It merges events that arrive within 3 s, never announces token or tool events, and gives the final status once. Errors that stop the run use `role="alert"`. Re-attaching to a backend run announces only the current state, not the replayed history."
Status: resolved in the spines.

**[Accessibility]** — Status messages other than progress are not committed (4.1.3)
EXPERIENCE State Patterns, Component Patterns (Key field), Post. None of these is said to be announced:
  - Key "Test" result ("Works: claude-opus-5-5" or the provider's error).
  - Save.
  - Preview generated.
  - "Posted 2 inline comments…" and "Posting refused…".
  - Filter result counts.
  - Select all / none results.
  - "Showing octo/app#43" after the panel follows the tab.
  - Copy-code confirmation.
Fix: add a Floor bullet that lists them: "Announced via the panel's `role="status"`: test success, save, preview ready, posted result, filter count ('Showing 2 of 5 findings'), selection count ('3 of 5 selected'), tab followed. Announced via `role="alert"`: test failure, posting refused, sign-in or key expired, backend unreachable."
Status: resolved in the spines.

**[Accessibility]** — Deselected and dismissed finding cards at 60% opacity fail 1.4.3 and 1.4.11
DESIGN `components.finding-card.deselected-opacity` and Components (Finding card). These cards stay interactive: re-tick, path:line, disclosure. In light mode, text drops to 4.39, meta to 2.56, the link to 2.71, badges to 2.47–2.73 and the checkbox to 2.27. Dark mode also fails for meta, link and badges.
Fix: delete `deselected-opacity`. A deselected card keeps full-contrast content, changes its border to `1px dashed {colors.border-strong}`, and shows a "Not included" badge (`neutral-bg`/`muted`, 5.00/5.51). Dismissed and pre-existing cards use the same treatment plus their own label.
Status: resolved in the spines.

**[Accessibility]** — Input boundaries fail 1.4.11
DESIGN `colors.border` used for inputs ("rounded.md for buttons, inputs", app.css `input { border: 1px solid var(--border); background: var(--bg) }`). Input borders reach 1.31 (light) and 1.36 (dark) against the surface card, and the fill differs by only 1.07. The key, token, Web App URL and pairing-code fields are effectively invisible boxes.
Fix: add `border-strong: '#7d8794'` and `border-strong-dark: '#6e7681'`. Add a rule: "Inputs, selects and textareas use `{colors.border-strong}`. `{colors.border}` is for decorative separation only."
Status: resolved in the spines.

**[Accessibility]** — Device-code sign-in and the pairing code have time limits with no adjust or extend rule (2.2.1, Level A)
EXPERIENCE Credentials and Consent, Flow 1 step 3, Flow 4 step 2, Open Questions. GitHub device codes expire in about 15 minutes, and the pairing code's lifetime is undecided. Neither spine says what happens at expiry or how much time a user gets.
Fix: add a Floor bullet:
  - "Codes show their expiry as text ('Expires at 14:32'). Two minutes before expiry, a polite announcement offers 'Get a new code'. After expiry the screen stays, says 'This code expired', and gets a new code in one action without losing anything already entered."
  - "The device code has a Copy button, and its accessible name spells the code character by character."
  - "The pairing code lives at least 10 minutes and can be re-issued by re-running the command."
Status: resolved in the spines.

### Medium (28)

**[Flow coverage]** — Flow 3's protagonist "Arjun" is the PRD's UJ-2 protagonist (a tech lead using Auto-Review who can't install apps in org (§ EXPERIENCE.md Flow 3, line 167; PRD §2 UJ-2, line 52)
Flow 3's protagonist "Arjun" is the PRD's UJ-2 protagonist (a tech lead using Auto-Review who can't install apps in org repos). Here he is reused in a different role, as a member of Meera's team (EXPERIENCE.md Flow 3, line 167; PRD §2 UJ-2, line 52). A reader cross-checking against the PRD will think UJ-2 is being realized.
Fix: use Meera herself, or a name not already in the PRD.
Status: resolved in the spines.

**[Flow coverage]** — Flow 4 (This computer) has no failure path, though pairing is the most fragile setup in the product (§ EXPERIENCE.md Flow 4, lines 177–183)
Flow 4 (This computer) has no failure path, though pairing is the most fragile setup in the product. A wrong or expired code, the CLI not running, or Docker not running (so tool checks show SKIPPED) is never shown in a flow (EXPERIENCE.md Flow 4, lines 177–183).
Fix: add a "Failure:" line, for example an expired pairing code with re-pair copy, or Docker off so compile and lint show SKIPPED with the reason.
Status: resolved in the spines.

**[Token completeness]** — `border` on `surface` is 1.31:1 (dark 1.36:1) (§ DESIGN.md Shapes line 193; EXPERIENCE.md line 76)
`border` on `surface` is 1.31:1 (dark 1.36:1). The Key field input and the finding checkboxes are identified only by that border, which fails WCAG 1.4.11's 3:1 for component boundaries (DESIGN.md Shapes line 193; EXPERIENCE.md line 76).
Fix: add a `control-border` token (light and dark) at 3:1 or more for inputs and checkboxes, and leave `border` for card separation.
Status: resolved in the spines.

**[Token completeness]** — Overall Status and layer statuses have no mapping to a tone (§ line 163)
Overall Status and layer statuses have no mapping to a tone. Colors (line 163) says status pairs are used for "check results", but which status gets which pair is defined only in `app.js` `STATUS_TONE` / `LAYER_TONE` (lines 448–449): PASSED→ok, PASSED_WITH_WARNINGS/INCOMPLETE/WARNING→warn, FAILED/ERROR/TIMEOUT→bad, SKIPPED/NOT_APPLICABLE/CANCELLED→neutral. The Report key screen depends on this mapping. `neutral-bg` is defined but referenced nowhere.
Fix: add a status-badge mapping (frontmatter `status-badge-*` entries, or a prose table) and name `neutral-bg` as the SKIPPED/NOT_APPLICABLE tone.
Status: resolved in the spines.

**[Token completeness]** — Spacing deltas from app.css are undeclared (§ line 155)
Spacing deltas from app.css are undeclared. Card padding is `{spacing.5}` 12px (app.css 16px), finding-card padding is 10/12 (app.css 12/14), buttons are `8px 14px` (app.css 9/16), and the gap between cards is 12px (app.css `.findings` 10px). Brand & Style (line 155) lists only the type ramp, the header and the page button as deltas, and the Do's say "Reuse the review page's tokens… Don't restyle a component just for the extension" (line 210).
Fix: declare a "panel density" delta in Brand & Style, or revert to the app.css values.
Status: resolved in the spines.

**[Token completeness]** — The theme of the injected page button is undefined (§ line 164)
The theme of the injected page button is undefined. The panel follows the OS (line 164), but the button sits on GitHub's page, whose theme can differ. `accent-dark` (#7c9cf5) on GitHub's light background is 2.65:1. Light `accent` on GitHub dark (#0d1117) is 3.21:1. Reading GitHub's theme attribute would conflict with EXPERIENCE.md "never reading GitHub's page" (lines 26, 105).
Fix: commit to one rule. "Always the light `accent`/`accent-text` pair" works on both GitHub themes at 3:1 or better.
Status: resolved in the spines.

**[Component coverage]** — Names differ across files (§ DESIGN.md line 204)
Names differ across files. "Page review button" (DESIGN.md line 204) vs "Review button (on the page)" (EXPERIENCE.md line 68) vs "Review button" (IA line 36) vs `page-review-button`. "Coverage line" (DESIGN.md line 202) vs "Coverage block" (EXPERIENCE.md line 72), and the two have different scope: the block includes the Overall Status. "Progress steps" (DESIGN.md line 201) vs "Step list" (EXPERIENCE.md lines 37, 88, Flow 1 step 5).
Fix: pick one name for each and use it in both files and the frontmatter key.
Status: resolved in the spines.

**[Component coverage]** — Some components have behavior but no visual spec (§ EXPERIENCE.md lines 43, 126)
Some components have behavior but no visual spec. These are Findings toolbar, Details disclosure (including the checks table), Key field (no input or field token; Shapes only mentions "inputs") and the confirmation dialog (EXPERIENCE.md lines 43, 126). The dialog also contradicts DESIGN.md Elevation ("The only layered element is the fixed panel header", line 189).
Fix: add visual rows. For the dialog, either specify an in-panel confirmation (not layered) or add it to Elevation.
Status: resolved in the spines.

**[Component coverage]** — Some components have a visual spec but no behavioral row
Some components have a visual spec but no behavioral row. The step list / progress steps has no rules for rendering from `RunEvent` `seq`, what Cancel does, or what a cancelled run leaves behind. Panel header is missing the settings-button behavior and the header's role in focus management. Overall Status badge appears in neither file.
Fix: add a "Step list" row to Component Patterns (renders only from RunEvent, AD-16; Cancel → state; replay on reattach) and an Overall Status badge row to both.
Status: resolved in the spines.

**[Component coverage]** — Some surfaces are built from parts specified nowhere: the three mode choices on Welcome, the device-code display, the pa (§ `.gate`, app.js line 486)
Some surfaces are built from parts specified nowhere: the three mode choices on Welcome, the device-code display, the pairing-code entry with computer-name confirm, the recent reviews list, and the quality-gate reasons block. The review page shows "Why it failed" (`.gate`, app.js line 486), but the Report here never mentions gate reasons.
Fix: add brief rows, or state explicitly "Welcome mode choice = three `card`s with a `button-primary` each", and so on.
Status: resolved in the spines.

**[State coverage]** — Post states are missing (§ app.js line 735)
Post states are missing. Nothing covers posting in progress (Post disabled, no double submit) or `SKIPPED_DUPLICATE`, for which the review page already has copy (app.js line 735). Also missing: a preview-digest 409 (the preview changed, so re-show it; AD-16), zero findings selected (summary-only post?), and the `maxInline` overflow going to the summary, which the preview should show (AD-23).
Fix: add state rows reusing the review page's copy.
Status: resolved in the spines.

**[State coverage]** — The setup surfaces have almost no states (§ EXPERIENCE.md line 127)
The setup surfaces have almost no states. Missing: device code expired or denied, Test in progress, Web App URL invalid / not HTTPS / incompatible schema version (`Accept-Schema`, AD-22), pairing code wrong or expired, and Chrome host permission declined when adding an Enterprise host (EXPERIENCE.md line 127). That last one is a permission-denied state.
Fix: add rows for each.
Status: resolved in the spines.

**[State coverage]** — No cold-load or loading states anywhere (§ DESIGN.md line 198)
No cold-load or loading states anywhere. PR home fetching PR metadata, the Report loading from storage or the backend, and the panel opening before the connection check finishes are all missing. Only the chip's "muted dot while checking" exists (DESIGN.md line 198).
Fix: add a loading treatment (skeleton or a "Loading octo/app#42…" line) to State Patterns.
Status: resolved in the spines.

**[State coverage]** — Offline is not covered in any mode
Offline is not covered in any mode.
Fix: add a global row (chip `bad`, Review disabled with reason, stored Reports still readable).
Status: resolved in the spines.

**[Inheritance discipline]** — "WCAG 2.1 AA for the panel and the injected button (PRD)" (EXPERIENCE.md line 111) is misattributed (§ EXPERIENCE.md line 111)
"WCAG 2.1 AA for the panel and the injected button (PRD)" (EXPERIENCE.md line 111) is misattributed. The PRD's only WCAG NFR is in §4.7 Web App ("for the app's own UI", prd.md line 408), and §4.8 has none.
Fix: cite it as a UX decision extending the §4.7 NFR, and flag it for PRD back-propagation.
Status: resolved in the spines.

**[Inheritance discipline]** — Flow 4 has Priya using "her Claude subscription through Claude Code" from the extension (§ ARCHITECTURE-SPINE AD-16 line 228; AD-8 adapters declare their Channels)
Flow 4 has Priya using "her Claude subscription through Claude Code" from the extension. The PRD FR-10 matrix says Browser Extension: "Not available" for Claude subscriptions. The justification is that the companion runs as Channel `CLI` (ARCHITECTURE-SPINE AD-16 line 228; AD-8 adapters declare their Channels). It appears only in memlog line 22.
Fix: cite AD-16 inline in Foundation ("This computer" bullet) and add an Open Question for PM confirmation.
Status: resolved in the spines.

**[Inheritance discipline]** — Assumptions are not tagged in the spines (§ line 7)
Assumptions are not tagged in the spines. The memlog (line 7) says the drafts carry `[ASSUMPTION]` tags, but neither file has any. So 14px body text, theme following the OS, 50 stored PRs, Alt+Shift+R, and `pr-reviewer serve --pair` all read as committed. The `--pair` flag does not exist in the architecture, which names only `pr-reviewer serve` (memlog line 27).
Fix: tag each in place, or add an Assumptions list.
Status: resolved in the spines.

**[Accessibility]** — The mode chip shows health through the dot colour alone (1.4.1)
DESIGN Components (Mode chip). "Standalone" looks identical with an `ok`, `bad` or `muted` dot.
Fix: the chip text carries the state: "Standalone · signed out", "Web App · unreachable", "Checking…". Accessible name: "Connection: Standalone, sign-in expired. Open connection settings."
Status: resolved in the spines.

**[Accessibility]** — path:line links: purpose, behaviour and distinguishability
EXPERIENCE Finding card, DESIGN Finding card meta line. Three problems:
  - The link drives a different document, so activating it is silent in the panel.
  - Inside the muted meta line it differs from the surrounding text only by hue (1.02).
  - "Enter opens the diff" does not say whether it is a link or a button.
Fix: - Make it a real `<a href>` to the Files changed anchor, intercepted to update the active tab, so Ctrl/Cmd-click still works.
  - Always underline it.
  - Accessible name: "src/retry.ts line 42, open in the page".
  - After activation the status region says "Opened src/retry.ts:42 in the page".
Status: resolved in the spines.

**[Accessibility]** — Link-style buttons have no underline (1.4.1)
DESIGN Components (Buttons): "link-style buttons in accent without a border". app.css `.btn.link` has no underline, and accent against body text is 2.74 / 2.13.
Fix: DESIGN rule: "Links and link-style buttons are always underlined. Hue is never the only cue."
Status: resolved in the spines.

**[Accessibility]** — Disabled controls hide their reason
DESIGN Buttons ("Disabled at 55% opacity"), EXPERIENCE Outdated banner ("Posting… is disabled"). A native `disabled` Post button leaves the tab order, so screen reader users never learn why it is off.
Fix: - "Disabled actions that have a reason use `aria-disabled="true"`, stay focusable, and point `aria-describedby` at the reason ('Posting is off: this review is of an older commit')."
  - "Under the 55% treatment, the reason text is always at full contrast."
Status: resolved in the spines.

**[Accessibility]** — Step-list states are carried by CSS pseudo-element glyphs and colour, and SKIPPED has no visual
DESIGN Progress steps lists waiting, running, done and failed only. Standalone always shows SKIPPED steps. The running ring has no text, and `::before` content is read inconsistently.
Fix: - Each step gets a visible or `sr-only` state word: Waiting, Running, Done, Failed, Skipped.
  - Glyphs get `aria-hidden`.
  - Add a skipped glyph ("–" in `muted`) to DESIGN.
Status: resolved in the spines.

**[Accessibility]** — Checkbox labels are ambiguous
EXPERIENCE Accessibility Floor: "labelled by the finding title". Several findings can share a title, and the label omits severity and location.
Fix: label is "Include in post: {SEVERITY} {title}, {path}:{line}", extending `app.js:566`. Wrap the checkbox column in `<label>` so the target is larger than the 18px box.
Status: resolved in the spines.

**[Accessibility]** — The keyboard model is underspecified and conflicts with native controls
EXPERIENCE Interaction Primitives (Keyboard):
  - "Space toggles a finding's selection" suggests a focusable card with nested links and disclosures, which is an invalid nested interactive pattern.
  - Esc on Post or Settings can clash with Esc inside a `<select>`, a text field or the confirmation dialog.
  - Disclosure semantics are not stated.
Fix: - "Selection toggles only through the native checkbox; cards are not focusable."
  - "Disclosures are native `<details>`/`<summary>` or a `<button aria-expanded aria-controls>`, with names unique per finding ('Recommendation for {title}')."
  - "Esc acts only when focus is not in a text field, select or dialog. In a dialog it cancels. On Run in progress it does nothing (never cancels a run)."
Status: resolved in the spines.

**[Accessibility]** — The confirmation dialogs' semantics are unstated
EXPERIENCE IA ("No dialogs except…"), Flow 4 step 4.
Fix: "The post confirmation and clear-data confirmation use `<dialog>` with `showModal()`. The dialog's text is its accessible description. Initial focus goes to Cancel, Esc cancels, and focus returns to the invoking button." Also consider requiring Preview before Post in every mode, since one keystroke publishes publicly under the user's name.
Status: resolved in the spines.

**[Accessibility]** — Reflow at 320px and 200% zoom is committed but not specified
EXPERIENCE Accessibility Floor, DESIGN `panel-header.height: 44px`. 200% in a 320px panel gives 160 CSS px. A fixed 44px header with the logo, "PR Reviewer", a "Web App · review.team.example" chip and Settings cannot fit. Blocks that "scroll inside their own block" (mono suggestions, preview, the checks table) are unreachable by keyboard.
Fix: - Header uses `min-height: 44px` and wraps.
  - The chip truncates its host visually but keeps the full text in its accessible name.
  - Every internal scroll container gets `tabindex="0"`, `role="region"` and an `aria-label`.
  - Breakpoints are in CSS px, so they fire under zoom.
Status: resolved in the spines.

**[Accessibility]** — Injected button: focus order and re-render stability are not stated
EXPERIENCE Review button ("in the PR header; follows client-side navigation").
Fix: - "Inserted in DOM order next to GitHub's header actions, with no tabindex and no absolute positioning, so visual order matches tab order."
  - "Label changes update text in place without replacing the node, so focus is kept."
  - "If GitHub re-renders and the button had focus, focus returns to the new instance."
  - "Exactly one instance per page."
  - "No live region outside the button's own shadow root."
Status: resolved in the spines.

**[Accessibility]** — Setup errors are not tied to their fields (3.3.1, 3.3.3)
EXPERIENCE Key field, Setup surfaces.
Fix: "A failed field gets `aria-invalid="true"` and `aria-describedby` pointing at the error text. Focus moves to the first failed field. Entered values (including the masked key) are kept. Errors start with the field name and say what to do ('AI key: Anthropic rejected it (401). Check the key or create a new one.'). The pairing-code field states its format and length and uses `autocomplete="off"`."
Status: resolved in the spines.

### Low (18)

**[Flow coverage]** — Flow 2 has no failure path (§ EXPERIENCE.md Flow 2)
Flow 2 has no failure path. An obvious one: the head moves again between Review again and Post, which leads to AD-23 `CANCELLED`/`SUPERSEDED` (EXPERIENCE.md Flow 2).
Fix: add a one-line Failure.
Status: resolved in the spines.

**[Flow coverage]** — Flows 2 and 4 cite no source name (§ EXPERIENCE.md lines 160, 177)
Flows 2 and 4 cite no source name. Flow 2 realizes the FR-36/FR-38 navigation consequence; Flow 4 realizes the FR-37 companion consequence (EXPERIENCE.md lines 160, 177).
Fix: add "(FR-36)" and "(FR-37)" to the headings so the flows can be traced to their sources.
Status: resolved in the spines.

**[Flow coverage]** — No flow reaches the "Not a PR" surface (§ line 26)
No flow reaches the "Not a PR" surface. The memlog acknowledges this (line 26), and the surface is a fallback covered in State Patterns.
Fix: none required. Optionally add one step to Flow 2 (Tom lands on the repo's Issues tab first).
Status: resolved in the spines.

**[Token completeness]** — `severity-badge-major` and `severity-badge-minor-info` omit `typography: '{typography.badge}'`, which `-blocker-critical (§ DESIGN.md lines 67–71, 105, 111, 128–135)
`severity-badge-major` and `severity-badge-minor-info` omit `typography: '{typography.badge}'`, which `-blocker-critical` has. Button padding is a literal (`'8px 14px'`) rather than spacing tokens. `badge` typography has no lineHeight (DESIGN.md lines 67–71, 105, 111, 128–135).
Fix: make the badge entries consistent and tokenize the padding.
Status: resolved in the spines.

**[State coverage]** — Edge states are missing: PR closed, merged or draft (can you review or post?), a PR on a host not added as an Enterprise
Edge states are missing: PR closed, merged or draft (can you review or post?), a PR on a host not added as an Enterprise host, an empty recent list on Not a PR, an empty filter result in the Report, and the Settings surface has no states at all (removing a key mid-run, switching mode).
Fix: add rows where behavior isn't obvious.
Status: resolved in the spines.

**[State coverage]** — The page button can go stale (§ EXPERIENCE.md lines 68, 90)
The page button can go stale. After a Standalone run is stopped by closing the panel, the stored "Reviewing…" label has no defined successor (EXPERIENCE.md lines 68, 90).
Fix: state the label after an interrupted run (back to "Review").
Status: resolved in the spines.

**[Bloat & overspecification]** — The `< 360px` stacking rule appears in both DESIGN.md Layout (line 185) and EXPERIENCE.md Responsive & Platform (lines 1 (§ line 185)
The `< 360px` stacking rule appears in both DESIGN.md Layout (line 185) and EXPERIENCE.md Responsive & Platform (lines 131–134).
Fix: keep the visual rule in DESIGN.md and have EXPERIENCE.md reference it, or the reverse. Don't keep two copies.
Status: resolved in the spines.

**[Bloat & overspecification]** — Some tokens are inherited but never used: the `card` component, `neutral-bg`, and spacing `1`–`3`, `6`, `7`
Some tokens are inherited but never used: the `card` component, `neutral-bg`, and spacing `1`–`3`, `6`, `7`.
Fix: harmless as inherited; either mark them "inherited from app.css" or use `neutral-bg` per the status-mapping fix.
Status: resolved in the spines.

**[Inheritance discipline]** — UJ names are not verbatim
UJ names are not verbatim. Flow 1 is "Tom's first review from a pasted link (UJ-4)" against "Tom checks a PR link someone pasted in chat". Flow 3 is "(Meera's team, UJ-3)" against "Meera gives her team a review page".
Fix: use the PRD wording after the UJ id.
Status: resolved in the spines.

**[Inheritance discipline]** — Storing the last review for each of 50 PRs locally (EXPERIENCE.md line 187; memlog line 21) is a storage commitment the (§ EXPERIENCE.md line 187; memlog line 21)
Storing the last review for each of 50 PRs locally (EXPERIENCE.md line 187; memlog line 21) is a storage commitment the architecture leaves open: the extension cache is "none" (line 293) and storage choice is deferred to R4 (line 407). The stored Reports contain PR code excerpts, which the consent text doesn't mention.
Fix: add it to the architecture handoff and to the Welcome consent copy.
Status: resolved in the spines.

**[Inheritance discipline]** — Credentials and Consent omits two PRD §4.8 NFR terms: "encrypted at rest" and "sent only over HTTPS to its own service" (§ prd.md line 437)
Credentials and Consent omits two PRD §4.8 NFR terms: "encrypted at rest" and "sent only over HTTPS to its own service" (prd.md line 437).
Fix: add both.
Status: resolved in the spines.

**[Inheritance discipline]** — The skipped-layer wording drifts
The skipped-layer wording drifts. Flow 1 has "SKIPPED (no Sandbox in Standalone)", Voice has "did not run (no Sandbox in Standalone)", and PRD §4.9 has "SKIPPED (no Sandbox)".
Fix: use the engine's string and let the coverage headline do the explaining.
Status: resolved in the spines.

**[Shape fit]** — Information Architecture has no composition-reference pointer yet
Information Architecture has no composition-reference pointer yet.
Fix: add it when the Report and Post mockups land (see section 5).
Status: resolved in the spines.

**[Accessibility]** — Target size
28px passes 2.5.8 (24px, a WCAG 2.2 criterion) only if the width is also at least 24px. Several in-panel targets fall short: the chip (about 22px tall), the 18px checkbox, and `.btn.link` with no padding.
Fix: "Minimum target 24×24 CSS px everywhere, including link-style buttons and the chip." 2.5.5 (44px, AAA) is not required.
Status: resolved in the spines.

**[Accessibility]** — Reduced motion covers only the spinner
DESIGN Progress steps.
Fix: "Under `prefers-reduced-motion`, no transitions and `scrollIntoView({behavior:'auto'})`."
Status: resolved in the spines.

**[Accessibility]** — No forced-colors rules
In Windows High Contrast and other forced-colors modes:
  - The self-styled page button loses its fill and has no border.
  - The chip dot and logo disappear.
  - The logo's accent-to-ok gradient on an accent fill is nearly invisible anyway.
Fix: `@media (forced-colors: active)`: button `border: 1px solid ButtonText`, focus `outline-color: Highlight`, logo `aria-hidden`, and the state text from the mode-chip finding.
Status: resolved in the spines.

**[Accessibility]** — Type sizes are in px (11/12/12.5/14)

Fix: specify them in rem (0.6875 / 0.75 / 0.78 / 0.875rem) so Chrome's font-size setting scales them, not only page zoom.
Status: resolved in the spines.

**[Accessibility]** — Landmarks and headings are not stated

Fix: "The panel has `<header>` and `<main>`. Each surface has exactly one `h1` (the focus target). Finding titles are `h2`/`h3`. `document.title` updates per surface ('Report: octo/app#42, pr-reviewer')."
Status: resolved in the spines.

## Reviewer files

- `review-rubric.md`
- `review-accessibility.md`
