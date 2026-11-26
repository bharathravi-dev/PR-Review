# Accessibility Review — pr-reviewer browser extension

Reviewed: DESIGN.md, EXPERIENCE.md, .memlog.md (2026-11-26 drafts), checked against `packages/cli/static/app.css`, `index.html` and `app.js`. Target: WCAG 2.1 AA (PRD).

## Verdict

**Not ready for stories yet. Fix before build.** The base palette is sound: every text/status pair passes 4.5:1 in light and dark. The failures come from rules on top of that palette:

- 60% opacity on deselected cards.
- 1.3:1 input borders.
- A focus ring on the injected button that drops below 3:1 whenever the OS theme and GitHub's theme differ.

The behaviour spine has a bigger problem. Its Accessibility Floor is seven lines. It misses how focus behaves when the panel changes on its own (run finished, tab followed, path:line clicked), how often the progress live region speaks, status messages other than progress, the device-code time limit (2.2.1, Level A), and Label-in-Name for the button's changing label. A developer building from the current text would ship 2.5.3, 1.4.3, 1.4.11, 2.2.1 and 4.1.3 failures.

Counts: **0 critical, 9 high, 11 medium, 5 low.**

## Contrast table (light and dark)

Ratios use WCAG relative luminance. Opacity cases are composited over the layer underneath (`bg` for cards, `surface` for buttons). Thresholds: normal text 4.5:1 (11px badges and 12px labels count as normal text), UI and focus 3:1.

| Pair | Light | Dark | Result |
|---|---|---|---|
| text on bg / surface / surface-2 | 15.10 / 16.18 / 14.56 | 15.12 / 13.91 / 12.71 | Pass |
| muted on bg / surface / surface-2 | 5.42 / 5.81 / 5.23 | 7.17 / 6.60 / 6.03 | Pass |
| muted on neutral-bg (default badge) | 5.00 | 5.51 | Pass |
| accent-text on accent (primary button, page button) | 5.90 | 7.09 | Pass |
| accent links on surface / bg / surface-2 | 5.90 / 5.51 / 5.31 | 6.53 / 7.09 / 5.96 | Pass |
| accent links on ok / warn / bad / info -bg (result-box links) | 5.17 / 5.26 / 4.86 / 5.01 | 5.31 / 5.32 / 5.91 / 5.76 | Pass |
| ok on ok-bg | **4.69** | 7.67 | Pass. Light is the tightest pair in the set; do not lighten it. |
| warn on warn-bg | 5.29 | 8.49 | Pass |
| bad on bad-bg | 5.38 | 6.95 | Pass |
| info on info-bg | 5.99 | 8.32 | Pass |
| ok / bad glyph on surface (step ✓ ✕) | 5.35 / 6.54 | 9.43 / 7.67 | Pass |
| chip dot ok / bad / muted on surface-2 | 4.81 / 5.88 / 5.23 | 8.61 / 7.01 / 6.03 | Pass 3:1, but the dot is the only cue (see findings) |
| focus ring on surface / bg / surface-2 | 5.90 / 5.51 / 5.31 | 6.53 / 7.09 / 5.96 | Pass |
| **border on surface / bg / surface-2** (input boundary) | **1.31 / 1.22 / 1.18** | **1.36 / 1.47 / 1.24** | **Fail 1.4.11** |
| input fill (bg) vs surface card | 1.07 | 1.09 | Not an affordance; the border is the only one |
| **accent vs text** (link with no underline, 1.4.1 / G183) | **2.74** | **2.13** | **Fail**. An underline is required. |
| **accent vs muted** (path:line link inside the muted meta line) | **1.02** | **1.01** | **Fail**. Only the hue differs. |
| **Deselected card 60%: text** | **4.39** | 5.73 | **Light fails** |
| **Deselected 60%: muted meta** | **2.56** | **3.19** | **Fail** |
| **Deselected 60%: path:line link** | **2.71** | **3.15** | **Fail** |
| **Deselected 60%: bad / warn / info badge** | **2.73 / 2.47 / 2.56** | **3.34 / 4.04 / 3.90** | **Fail** |
| Deselected 60%: unchecked native checkbox (#767676) | 2.27 | — | Fail 1.4.11 |
| Disabled 55%: primary label / button fill vs surface | 2.42 / 2.42 | 3.04 / 2.90 | Exempt (inactive control), but see M3 |
| Disabled 55%: secondary label | 3.49 | 4.83 | Exempt |
| Page button fill or focus ring, OS light, on GitHub light #ffffff / #f6f8fa | 5.90 / 5.54 | — | Pass |
| **Page button fill or focus ring, OS light, on GitHub dark #0d1117 / #161b22** | **3.21 / 2.93** | — | **Fail on #161b22** |
| **Page button fill or focus ring, OS dark, on GitHub light #ffffff / #f6f8fa** | — | **2.65 / 2.49** | **Fail** |
| Page button fill or focus ring, OS dark, on GitHub dark #0d1117 / #161b22 | — | 7.15 / 6.53 | Pass |

Proposed fix values (verified):

- `border-strong: #7d8794`. Contrast 3.64 on surface, 3.40 on bg, 3.28 on surface-2.
- `border-strong-dark: #6e7681`. Contrast 3.76, 4.09 and 3.44 on the same backgrounds.

## Findings

- **[high]** **The page button's accessible name does not contain its visible label (2.5.3).** EXPERIENCE Accessibility Floor fixes the name as "Review this PR with pr-reviewer". The visible label also shows "3 findings", "No findings", "Outdated" and "Reviewing…". A speech user who says "click Outdated" gets nothing, and a screen reader user hears "Review this PR" on a button that will not start a review. *Fix:* replace the Floor bullet with: "The button's accessible name starts with its exact visible label, followed by the product: '3 findings, pr-reviewer'. In the Review state it is 'Review this PR, pr-reviewer'. Build it from visible text plus a visually hidden suffix, not `aria-label`, so the two cannot drift."

- **[high]** **The page button's focus ring fails 3:1 when the OS theme and GitHub's theme differ.** DESIGN Components (Page review button) plus the memlog decision to follow the OS theme. The 2px `{colors.focus}` ring with a 2px offset sits on GitHub's background: 2.49–2.65 for OS dark on GitHub light, 2.93 for OS light on GitHub dark #161b22. The fill also drops to 2.49 in the first case. That is allowed, because the text label identifies the control, but the ring is not. *Fix:* give the page button its own two-tone focus indicator (WCAG technique C40) instead of `{colors.focus}`: `outline: 2px solid #1c2128; outline-offset: 2px; box-shadow: 0 0 0 2px #ffffff;`. Either the white ring or the dark ring is ≥15:1 against any GitHub background. Add `page-button-focus` to DESIGN `components.page-review-button`.

- **[high]** **Keyboard and screen reader users get no feedback after activating the page button or the shortcut.** EXPERIENCE Interaction Primitives (Open the panel). Opening a side panel from a page click or a command does not move keyboard focus into it in Chrome (verify on 116+). The user hears nothing; in the Review state a paid review has quietly started; and nothing tells them how to reach the panel. *Fix:* add to the Floor: "Activating the page button triggers a polite announcement from a live region inside the button's own shadow root: 'Opened in the pr-reviewer side panel. Press F6 to move there.' (Use whichever key Chrome actually uses for pane cycling.) When the panel opens, it focuses its surface heading so arriving with F6 lands there. The Welcome surface states the key once."

- **[high]** **"Focus moves to the new surface's heading on every surface change" also fires on changes the user did not ask for.** EXPERIENCE Accessibility Floor, read against Follow the tab, Finding card and Flow 1 steps 5–6:
  - Run finishes and the panel goes from Run in progress to Report.
  - Setup completes and the review auto-starts.
  - The user switches tabs.
  - A path:line click navigates the tab to Files changed of the same PR.

  Each one yanks focus to the top heading. Moving through findings and opening each path:line would throw the user back to the heading every time (3.2.1/3.2.2, 2.4.3). *Fix:* replace the bullet with:
  - "Focus moves to the new surface's `h1` (tabindex=-1) only when the user's own action in the panel changed the surface."
  - "On automatic changes (run finished, tab followed, setup returning to a PR), focus stays where it is if that element still exists. Otherwise it moves to the new `h1`, and the change is announced in the status region."
  - "Navigation within the same PR (Conversation, Files changed, anchors) never re-renders the panel or moves focus."
  - "When the focused control is removed (for example, Cancel at the end of a run), focus goes to the new `h1`, never to `body`."

- **[high]** **The progress live region has no granularity rule, and the existing page's pattern is noisy.** EXPERIENCE Accessibility Floor (progress). `packages/cli/static/index.html:61` puts `aria-live="polite"` on the whole `#progress` section, so every RunEvent re-render re-queues the whole step list, plus the elapsed-time counter if it lives in that section. *Fix:* rule text: "The step list and elapsed time are not live. One visually hidden `role="status"` region per panel announces only layer start and finish ('AI review running', 'Compile: SKIPPED, no Sandbox'). It merges events that arrive within 3 s, never announces token or tool events, and gives the final status once. Errors that stop the run use `role="alert"`. Re-attaching to a backend run announces only the current state, not the replayed history."

- **[high]** **Status messages other than progress are not committed (4.1.3).** EXPERIENCE State Patterns, Component Patterns (Key field), Post. None of these is said to be announced:
  - Key "Test" result ("Works: claude-opus-5-5" or the provider's error).
  - Save.
  - Preview generated.
  - "Posted 2 inline comments…" and "Posting refused…".
  - Filter result counts.
  - Select all / none results.
  - "Showing octo/app#43" after the panel follows the tab.
  - Copy-code confirmation.

  *Fix:* add a Floor bullet that lists them: "Announced via the panel's `role="status"`: test success, save, preview ready, posted result, filter count ('Showing 2 of 5 findings'), selection count ('3 of 5 selected'), tab followed. Announced via `role="alert"`: test failure, posting refused, sign-in or key expired, backend unreachable."

- **[high]** **Deselected and dismissed finding cards at 60% opacity fail 1.4.3 and 1.4.11.** DESIGN `components.finding-card.deselected-opacity` and Components (Finding card). These cards stay interactive: re-tick, path:line, disclosure. In light mode, text drops to 4.39, meta to 2.56, the link to 2.71, badges to 2.47–2.73 and the checkbox to 2.27. Dark mode also fails for meta, link and badges. *Fix:* delete `deselected-opacity`. A deselected card keeps full-contrast content, changes its border to `1px dashed {colors.border-strong}`, and shows a "Not included" badge (`neutral-bg`/`muted`, 5.00/5.51). Dismissed and pre-existing cards use the same treatment plus their own label.

- **[high]** **Input boundaries fail 1.4.11.** DESIGN `colors.border` used for inputs ("rounded.md for buttons, inputs", app.css `input { border: 1px solid var(--border); background: var(--bg) }`). Input borders reach 1.31 (light) and 1.36 (dark) against the surface card, and the fill differs by only 1.07. The key, token, Web App URL and pairing-code fields are effectively invisible boxes. *Fix:* add `border-strong: '#7d8794'` and `border-strong-dark: '#6e7681'`. Add a rule: "Inputs, selects and textareas use `{colors.border-strong}`. `{colors.border}` is for decorative separation only."

- **[high]** **Device-code sign-in and the pairing code have time limits with no adjust or extend rule (2.2.1, Level A).** EXPERIENCE Credentials and Consent, Flow 1 step 3, Flow 4 step 2, Open Questions. GitHub device codes expire in about 15 minutes, and the pairing code's lifetime is undecided. Neither spine says what happens at expiry or how much time a user gets. *Fix:* add a Floor bullet:
  - "Codes show their expiry as text ('Expires at 14:32'). Two minutes before expiry, a polite announcement offers 'Get a new code'. After expiry the screen stays, says 'This code expired', and gets a new code in one action without losing anything already entered."
  - "The device code has a Copy button, and its accessible name spells the code character by character."
  - "The pairing code lives at least 10 minutes and can be re-issued by re-running the command."

- **[medium]** **The mode chip shows health through the dot colour alone (1.4.1).** DESIGN Components (Mode chip). "Standalone" looks identical with an `ok`, `bad` or `muted` dot. *Fix:* the chip text carries the state: "Standalone · signed out", "Web App · unreachable", "Checking…". Accessible name: "Connection: Standalone, sign-in expired. Open connection settings."

- **[medium]** **path:line links: purpose, behaviour and distinguishability.** EXPERIENCE Finding card, DESIGN Finding card meta line. Three problems:
  - The link drives a different document, so activating it is silent in the panel.
  - Inside the muted meta line it differs from the surrounding text only by hue (1.02).
  - "Enter opens the diff" does not say whether it is a link or a button.

  *Fix:*
  - Make it a real `<a href>` to the Files changed anchor, intercepted to update the active tab, so Ctrl/Cmd-click still works.
  - Always underline it.
  - Accessible name: "src/retry.ts line 42, open in the page".
  - After activation the status region says "Opened src/retry.ts:42 in the page".

- **[medium]** **Link-style buttons have no underline (1.4.1).** DESIGN Components (Buttons): "link-style buttons in accent without a border". app.css `.btn.link` has no underline, and accent against body text is 2.74 / 2.13. *Fix:* DESIGN rule: "Links and link-style buttons are always underlined. Hue is never the only cue."

- **[medium]** **Disabled controls hide their reason.** DESIGN Buttons ("Disabled at 55% opacity"), EXPERIENCE Outdated banner ("Posting… is disabled"). A native `disabled` Post button leaves the tab order, so screen reader users never learn why it is off. *Fix:*
  - "Disabled actions that have a reason use `aria-disabled="true"`, stay focusable, and point `aria-describedby` at the reason ('Posting is off: this review is of an older commit')."
  - "Under the 55% treatment, the reason text is always at full contrast."

- **[medium]** **Step-list states are carried by CSS pseudo-element glyphs and colour, and SKIPPED has no visual.** DESIGN Progress steps lists waiting, running, done and failed only. Standalone always shows SKIPPED steps. The running ring has no text, and `::before` content is read inconsistently. *Fix:*
  - Each step gets a visible or `sr-only` state word: Waiting, Running, Done, Failed, Skipped.
  - Glyphs get `aria-hidden`.
  - Add a skipped glyph ("–" in `muted`) to DESIGN.

- **[medium]** **Checkbox labels are ambiguous.** EXPERIENCE Accessibility Floor: "labelled by the finding title". Several findings can share a title, and the label omits severity and location. *Fix:* label is "Include in post: {SEVERITY} {title}, {path}:{line}", extending `app.js:566`. Wrap the checkbox column in `<label>` so the target is larger than the 18px box.

- **[medium]** **The keyboard model is underspecified and conflicts with native controls.** EXPERIENCE Interaction Primitives (Keyboard):
  - "Space toggles a finding's selection" suggests a focusable card with nested links and disclosures, which is an invalid nested interactive pattern.
  - Esc on Post or Settings can clash with Esc inside a `<select>`, a text field or the confirmation dialog.
  - Disclosure semantics are not stated.

  *Fix:*
  - "Selection toggles only through the native checkbox; cards are not focusable."
  - "Disclosures are native `<details>`/`<summary>` or a `<button aria-expanded aria-controls>`, with names unique per finding ('Recommendation for {title}')."
  - "Esc acts only when focus is not in a text field, select or dialog. In a dialog it cancels. On Run in progress it does nothing (never cancels a run)."

- **[medium]** **The confirmation dialogs' semantics are unstated.** EXPERIENCE IA ("No dialogs except…"), Flow 4 step 4. *Fix:* "The post confirmation and clear-data confirmation use `<dialog>` with `showModal()`. The dialog's text is its accessible description. Initial focus goes to Cancel, Esc cancels, and focus returns to the invoking button." Also consider requiring Preview before Post in every mode, since one keystroke publishes publicly under the user's name.

- **[medium]** **Reflow at 320px and 200% zoom is committed but not specified.** EXPERIENCE Accessibility Floor, DESIGN `panel-header.height: 44px`. 200% in a 320px panel gives 160 CSS px. A fixed 44px header with the logo, "PR Reviewer", a "Web App · review.team.example" chip and Settings cannot fit. Blocks that "scroll inside their own block" (mono suggestions, preview, the checks table) are unreachable by keyboard. *Fix:*
  - Header uses `min-height: 44px` and wraps.
  - The chip truncates its host visually but keeps the full text in its accessible name.
  - Every internal scroll container gets `tabindex="0"`, `role="region"` and an `aria-label`.
  - Breakpoints are in CSS px, so they fire under zoom.

- **[medium]** **Injected button: focus order and re-render stability are not stated.** EXPERIENCE Review button ("in the PR header; follows client-side navigation"). *Fix:*
  - "Inserted in DOM order next to GitHub's header actions, with no tabindex and no absolute positioning, so visual order matches tab order."
  - "Label changes update text in place without replacing the node, so focus is kept."
  - "If GitHub re-renders and the button had focus, focus returns to the new instance."
  - "Exactly one instance per page."
  - "No live region outside the button's own shadow root."

- **[medium]** **Setup errors are not tied to their fields (3.3.1, 3.3.3).** EXPERIENCE Key field, Setup surfaces. *Fix:* "A failed field gets `aria-invalid="true"` and `aria-describedby` pointing at the error text. Focus moves to the first failed field. Entered values (including the masked key) are kept. Errors start with the field name and say what to do ('AI key: Anthropic rejected it (401). Check the key or create a new one.'). The pairing-code field states its format and length and uses `autocomplete="off"`."

- **[low]** **Target size.** 28px passes 2.5.8 (24px, a WCAG 2.2 criterion) only if the width is also at least 24px. Several in-panel targets fall short: the chip (about 22px tall), the 18px checkbox, and `.btn.link` with no padding. *Fix:* "Minimum target 24×24 CSS px everywhere, including link-style buttons and the chip." 2.5.5 (44px, AAA) is not required.

- **[low]** **Reduced motion covers only the spinner.** DESIGN Progress steps. *Fix:* "Under `prefers-reduced-motion`, no transitions and `scrollIntoView({behavior:'auto'})`."

- **[low]** **No forced-colors rules.** In Windows High Contrast and other forced-colors modes:
  - The self-styled page button loses its fill and has no border.
  - The chip dot and logo disappear.
  - The logo's accent-to-ok gradient on an accent fill is nearly invisible anyway.

  *Fix:* `@media (forced-colors: active)`: button `border: 1px solid ButtonText`, focus `outline-color: Highlight`, logo `aria-hidden`, and the state text from the mode-chip finding.

- **[low]** **Type sizes are in px (11/12/12.5/14).** *Fix:* specify them in rem (0.6875 / 0.75 / 0.78 / 0.875rem) so Chrome's font-size setting scales them, not only page zoom.

- **[low]** **Landmarks and headings are not stated.** *Fix:* "The panel has `<header>` and `<main>`. Each surface has exactly one `h1` (the focus target). Finding titles are `h2`/`h3`. `document.title` updates per surface ('Report: octo/app#42, pr-reviewer')."
