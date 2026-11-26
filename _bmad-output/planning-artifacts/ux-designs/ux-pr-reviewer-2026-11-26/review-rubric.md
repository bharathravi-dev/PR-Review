# Spine Pair Review — pr-reviewer browser extension

## Overall verdict

The pair has the right shape and holds to its sources well. Every color token matches `packages/cli/static/app.css` exactly in light and dark, every `{token}` reference resolves, both files follow canonical section order, and the flows read as real journeys with named people and climaxes. It is not yet a clean contract for the Report and Post screens, though. Post has no visual spec. The on-page button is specified differently in the two files. Contrast targets are missing even though EXPERIENCE.md points to them, and the 60% opacity on a deselected card fails AA. Nothing decides what happens to a Standalone run when the panel follows the tab to another PR, and there is no whole-run failure state. Fix the 6 high findings before the Report and Post mockups are built on top.

## 1. Flow coverage — adequate

Checked: the relevant names in the EXPERIENCE.md `sources` (PRD UJ-4 Tom and its edge case, UJ-3 Meera and its edge case, FR-36, FR-37 and their consequences, FR-38, Epic 7 stories 7.1–7.3, AD-16, AD-23) against Key Flows 1–4. UJ-4 maps to Flow 1, which has a named protagonist, numbered steps, a climax and a failure path. UJ-3 maps to Flow 3, which also has all four. FR-36's follow-navigation consequence is covered by Flow 2 and the Review button pattern. FR-37 Standalone, Web App and companion (with confirm-before-post) are covered by Flows 1, 3 and 4. FR-38 (link to the line, post selected findings) is covered by Flow 1 steps 6–7. Stories 7.1–7.3 are all reached.

### Findings
- **medium** Flow 3's protagonist "Arjun" is the PRD's UJ-2 protagonist (a tech lead using Auto-Review who can't install apps in org repos). Here he is reused in a different role, as a member of Meera's team (EXPERIENCE.md Flow 3, line 167; PRD §2 UJ-2, line 52). A reader cross-checking against the PRD will think UJ-2 is being realized. *Fix:* use Meera herself, or a name not already in the PRD.
- **medium** Flow 4 (This computer) has no failure path, though pairing is the most fragile setup in the product. A wrong or expired code, the CLI not running, or Docker not running (so tool checks show SKIPPED) is never shown in a flow (EXPERIENCE.md Flow 4, lines 177–183). *Fix:* add a "Failure:" line, for example an expired pairing code with re-pair copy, or Docker off so compile and lint show SKIPPED with the reason.
- **low** Flow 2 has no failure path. An obvious one: the head moves again between Review again and Post, which leads to AD-23 `CANCELLED`/`SUPERSEDED` (EXPERIENCE.md Flow 2). *Fix:* add a one-line Failure.
- **low** Flows 2 and 4 cite no source name. Flow 2 realizes the FR-36/FR-38 navigation consequence; Flow 4 realizes the FR-37 companion consequence (EXPERIENCE.md lines 160, 177). *Fix:* add "(FR-36)" and "(FR-37)" to the headings so the flows can be traced to their sources.
- **low** No flow reaches the "Not a PR" surface. The memlog acknowledges this (line 26), and the surface is a fallback covered in State Patterns. *Fix:* none required. Optionally add one step to Flow 2 (Tom lands on the repo's Issues tab first).

## 2. Token completeness — adequate

Extracted: 36 color tokens (18 light, each with a `-dark` pair), 6 typography roles, 4 `rounded`, 8 `spacing`, and 12 `components`. Every `{path}` reference was checked: 21 in frontmatter components, 19 in DESIGN.md prose, and `{colors.focus}` in EXPERIENCE.md. All resolve. All color values match app.css (lines 2–44). No hex values or dark pairs are missing. Contrast targets are not stated anywhere. I computed the ratios for the load-bearing pairs (WCAG 2.x):

| Pair | Light | Dark |
|---|---|---|
| text / surface | 16.18 | 13.91 |
| muted / surface | 5.81 | 6.60 |
| muted / neutral-bg | 5.00 | 5.51 |
| accent-text / accent (primary button, page button) | 5.90 | 7.09 |
| ok / ok-bg | 4.69 | 7.67 |
| warn / warn-bg | 5.29 | 8.49 |
| bad / bad-bg | 5.38 | 6.95 |
| info / info-bg | 5.99 | 8.32 |
| focus / surface (non-text, 3:1) | 5.90 | 6.53 |
| border / surface (non-text, 3:1) | **1.31** | **1.36** |
| muted @ 60% (deselected card) / surface | **2.54** | 3.21 |
| bad, info, warn badge @ 60% | **2.97 / 2.78 / 2.61** | 3.61 / 4.16 / 4.47 |

### Findings
- **high** DESIGN.md states no contrast targets. EXPERIENCE.md Accessibility Floor (line 109) says "Visual contrast lives in `DESIGN.md` (… AA in light and dark)", so that cross-reference points at nothing. *Fix:* add a short contrast table to DESIGN.md Colors, using the ratios above, stating the AA target per pair (4.5:1 for text, 3:1 for non-text).
- **high** `finding-card.deselected-opacity: '0.6'` (DESIGN.md line 122; prose line 200) drops the meta line to 2.54:1 and the severity badges to about 2.6–3.0:1 in light mode. A deselected card is still active content, since the user can re-select it, so this breaks the WCAG 2.1 AA floor the spine commits to (EXPERIENCE.md line 111). The opacity is inherited from app.css `.finding.off`, but it is still a defect for the extension. *Fix:* show deselection with the unchecked box, a "Not posting" label in text, and a `{colors.bg}` card fill or dashed border. Keep text at full contrast.
- **medium** `border` on `surface` is 1.31:1 (dark 1.36:1). The Key field input and the finding checkboxes are identified only by that border, which fails WCAG 1.4.11's 3:1 for component boundaries (DESIGN.md Shapes line 193; EXPERIENCE.md line 76). *Fix:* add a `control-border` token (light and dark) at 3:1 or more for inputs and checkboxes, and leave `border` for card separation.
- **medium** Overall Status and layer statuses have no mapping to a tone. Colors (line 163) says status pairs are used for "check results", but which status gets which pair is defined only in `app.js` `STATUS_TONE` / `LAYER_TONE` (lines 448–449): PASSED→ok, PASSED_WITH_WARNINGS/INCOMPLETE/WARNING→warn, FAILED/ERROR/TIMEOUT→bad, SKIPPED/NOT_APPLICABLE/CANCELLED→neutral. The Report key screen depends on this mapping. `neutral-bg` is defined but referenced nowhere. *Fix:* add a status-badge mapping (frontmatter `status-badge-*` entries, or a prose table) and name `neutral-bg` as the SKIPPED/NOT_APPLICABLE tone.
- **medium** Spacing deltas from app.css are undeclared. Card padding is `{spacing.5}` 12px (app.css 16px), finding-card padding is 10/12 (app.css 12/14), buttons are `8px 14px` (app.css 9/16), and the gap between cards is 12px (app.css `.findings` 10px). Brand & Style (line 155) lists only the type ramp, the header and the page button as deltas, and the Do's say "Reuse the review page's tokens… Don't restyle a component just for the extension" (line 210). *Fix:* declare a "panel density" delta in Brand & Style, or revert to the app.css values.
- **medium** The theme of the injected page button is undefined. The panel follows the OS (line 164), but the button sits on GitHub's page, whose theme can differ. `accent-dark` (#7c9cf5) on GitHub's light background is 2.65:1. Light `accent` on GitHub dark (#0d1117) is 3.21:1. Reading GitHub's theme attribute would conflict with EXPERIENCE.md "never reading GitHub's page" (lines 26, 105). *Fix:* commit to one rule. "Always the light `accent`/`accent-text` pair" works on both GitHub themes at 3:1 or better.
- **low** `severity-badge-major` and `severity-badge-minor-info` omit `typography: '{typography.badge}'`, which `-blocker-critical` has. Button padding is a literal (`'8px 14px'`) rather than spacing tokens. `badge` typography has no lineHeight (DESIGN.md lines 67–71, 105, 111, 128–135). *Fix:* make the badge entries consistent and tokenize the padding.

## 3. Component coverage — thin

Extracted every component name from both files. DESIGN.md frontmatter has 12 entries; DESIGN.md Components prose has 8; EXPERIENCE.md Component Patterns has 9. Names used elsewhere include step list, settings button, severity badge, status badges, the confirmation dialog, Key field and input, the recent reviews list, review type, preview, result line, and the mode choices on Welcome. Only **Mode chip**, **Finding card** and **Outdated banner** have both a visual row and a behavioral row under the same name.

### Findings
- **high** Post panel has no visual spec. It has a behavioral row (EXPERIENCE.md line 74), but DESIGN.md defines no review-type control, preview block, primary post button label, or result line in either frontmatter or prose. Post is one of the two key screens about to be mocked. The app.css precedent exists (`pre.preview`: surface-2, mono, rounded 8px, max-height 420px, and `.result` with the status pairs). *Fix:* add a `post-panel` / `preview-block` / `result-line` spec to DESIGN.md Components and frontmatter.
- **high** The page review button is specified two ways. DESIGN.md (line 204) says it shows the logo mark and "Review". EXPERIENCE.md (line 68), together with memlog line 29 ("Supersedes the plain-'Review' assumption"), defines five labels: "Review", "Reviewing…", "3 findings", "No findings", "Outdated". DESIGN.md was never updated, so per-state visuals (does "Outdated" use `warn`?), width and truncation are undefined. EXPERIENCE.md line 112 also fixes the accessible name as "Review this PR with pr-reviewer" while the visible label changes, which fails WCAG 2.5.3 (Label in Name) in four of the five states. *Fix:* add the state table to DESIGN.md, and make the accessible name start with the visible label (for example "3 findings — open pr-reviewer").
- **medium** Names differ across files. "Page review button" (DESIGN.md line 204) vs "Review button (on the page)" (EXPERIENCE.md line 68) vs "Review button" (IA line 36) vs `page-review-button`. "Coverage line" (DESIGN.md line 202) vs "Coverage block" (EXPERIENCE.md line 72), and the two have different scope: the block includes the Overall Status. "Progress steps" (DESIGN.md line 201) vs "Step list" (EXPERIENCE.md lines 37, 88, Flow 1 step 5). *Fix:* pick one name for each and use it in both files and the frontmatter key.
- **medium** Some components have behavior but no visual spec. These are Findings toolbar, Details disclosure (including the checks table), Key field (no input or field token; Shapes only mentions "inputs") and the confirmation dialog (EXPERIENCE.md lines 43, 126). The dialog also contradicts DESIGN.md Elevation ("The only layered element is the fixed panel header", line 189). *Fix:* add visual rows. For the dialog, either specify an in-panel confirmation (not layered) or add it to Elevation.
- **medium** Some components have a visual spec but no behavioral row. The step list / progress steps has no rules for rendering from `RunEvent` `seq`, what Cancel does, or what a cancelled run leaves behind. Panel header is missing the settings-button behavior and the header's role in focus management. Overall Status badge appears in neither file. *Fix:* add a "Step list" row to Component Patterns (renders only from RunEvent, AD-16; Cancel → state; replay on reattach) and an Overall Status badge row to both.
- **medium** Some surfaces are built from parts specified nowhere: the three mode choices on Welcome, the device-code display, the pairing-code entry with computer-name confirm, the recent reviews list, and the quality-gate reasons block. The review page shows "Why it failed" (`.gate`, app.js line 486), but the Report here never mentions gate reasons. *Fix:* add brief rows, or state explicitly "Welcome mode choice = three `card`s with a `button-primary` each", and so on.

## 4. State coverage — thin

Walked all 10 IA surfaces. Covered: first open, not set up, not a PR, never reviewed, reviewed and current, head moved, running, reattach, panel closed in Standalone, AI layer error, sign-in expired, backend unreachable, posting refused, posted, no findings, private repo. Focus behavior is in Accessibility Floor. Gaps:

### Findings
- **high** A Standalone run conflicts with follow-the-tab. The panel is per window and always shows the active tab's PR (EXPERIENCE.md line 102). A Standalone run lives in the panel page (line 22, AD-16). Nothing says what happens to a running Standalone review when the user switches to another tab or PR in the same window: does it keep running unseen, get cancelled, or block the switch? And what does the page button show meanwhile? This decides the run lifecycle for story 7.1. *Fix:* commit to a rule. For example: "The run continues; the panel shows the other tab's PR with a 'Review of #42 running' strip; returning re-shows progress."
- **high** There is no whole-run failure state. Only the AI-layer error is covered (line 91). Not covered: a run ending in `ERROR` (GitHub API failure or rate limit, `CONFIG_UNSUPPORTED`, network loss mid-run in Standalone, a backend run that dies), or the outcome of Cancel. *Fix:* add "Run failed" (reason in plain words, Retry, keeps the last good Report) and "Cancelled" rows.
- **medium** Post states are missing. Nothing covers posting in progress (Post disabled, no double submit) or `SKIPPED_DUPLICATE`, for which the review page already has copy (app.js line 735). Also missing: a preview-digest 409 (the preview changed, so re-show it; AD-16), zero findings selected (summary-only post?), and the `maxInline` overflow going to the summary, which the preview should show (AD-23). *Fix:* add state rows reusing the review page's copy.
- **medium** The setup surfaces have almost no states. Missing: device code expired or denied, Test in progress, Web App URL invalid / not HTTPS / incompatible schema version (`Accept-Schema`, AD-22), pairing code wrong or expired, and Chrome host permission declined when adding an Enterprise host (EXPERIENCE.md line 127). That last one is a permission-denied state. *Fix:* add rows for each.
- **medium** No cold-load or loading states anywhere. PR home fetching PR metadata, the Report loading from storage or the backend, and the panel opening before the connection check finishes are all missing. Only the chip's "muted dot while checking" exists (DESIGN.md line 198). *Fix:* add a loading treatment (skeleton or a "Loading octo/app#42…" line) to State Patterns.
- **medium** Offline is not covered in any mode. *Fix:* add a global row (chip `bad`, Review disabled with reason, stored Reports still readable).
- **low** Edge states are missing: PR closed, merged or draft (can you review or post?), a PR on a host not added as an Enterprise host, an empty recent list on Not a PR, an empty filter result in the Report, and the Settings surface has no states at all (removing a key mid-run, switching mode). *Fix:* add rows where behavior isn't obvious.
- **low** The page button can go stale. After a Standalone run is stopped by closing the panel, the stored "Reviewing…" label has no defined successor (EXPERIENCE.md lines 68, 90). *Fix:* state the label after an interrupted run (back to "Review").

## 5. Visual reference coverage — pending

`imports/` is empty, and there are no `mockups/` or `wireframes/` directories. Mockups for Report and Post are planned after this review (memlog line 30). That is pending, not a defect. Once they exist, add a "→ Composition reference:" line under Information Architecture as the examples do, with "Spine wins on conflict."

## 6. Bloat & overspecification — strong

Both files are lean. The prose carries rationale, not repetition, and the Voice table and the rejected anti-patterns earn their space. The risk here is underspecification (sections 3–4), not bloat.

### Findings
- **low** The `< 360px` stacking rule appears in both DESIGN.md Layout (line 185) and EXPERIENCE.md Responsive & Platform (lines 131–134). *Fix:* keep the visual rule in DESIGN.md and have EXPERIENCE.md reference it, or the reverse. Don't keep two copies.
- **low** Some tokens are inherited but never used: the `card` component, `neutral-bg`, and spacing `1`–`3`, `6`, `7`. *Fix:* harmless as inherited; either mark them "inherited from app.css" or use `neutral-bg` per the status-mapping fix.

## 7. Inheritance discipline — adequate

All sources resolve. DESIGN.md: app.css, prd.md. EXPERIENCE.md: epics.md, prd.md, ARCHITECTURE-SPINE.md, `packages/cli/static/`, docs/web-app.md. AD-16 and AD-23 are cited correctly, and Release 4 / 4.x matches the FR-37 assumption. EXPERIENCE.md token references resolve to DESIGN.md names.

### Findings
- **medium** "WCAG 2.1 AA for the panel and the injected button (PRD)" (EXPERIENCE.md line 111) is misattributed. The PRD's only WCAG NFR is in §4.7 Web App ("for the app's own UI", prd.md line 408), and §4.8 has none. *Fix:* cite it as a UX decision extending the §4.7 NFR, and flag it for PRD back-propagation.
- **medium** Flow 4 has Priya using "her Claude subscription through Claude Code" from the extension. The PRD FR-10 matrix says Browser Extension: "Not available" for Claude subscriptions. The justification is that the companion runs as Channel `CLI` (ARCHITECTURE-SPINE AD-16 line 228; AD-8 adapters declare their Channels). It appears only in memlog line 22. *Fix:* cite AD-16 inline in Foundation ("This computer" bullet) and add an Open Question for PM confirmation.
- **medium** Assumptions are not tagged in the spines. The memlog (line 7) says the drafts carry `[ASSUMPTION]` tags, but neither file has any. So 14px body text, theme following the OS, 50 stored PRs, Alt+Shift+R, and `pr-reviewer serve --pair` all read as committed. The `--pair` flag does not exist in the architecture, which names only `pr-reviewer serve` (memlog line 27). *Fix:* tag each in place, or add an Assumptions list.
- **low** UJ names are not verbatim. Flow 1 is "Tom's first review from a pasted link (UJ-4)" against "Tom checks a PR link someone pasted in chat". Flow 3 is "(Meera's team, UJ-3)" against "Meera gives her team a review page". *Fix:* use the PRD wording after the UJ id.
- **low** Storing the last review for each of 50 PRs locally (EXPERIENCE.md line 187; memlog line 21) is a storage commitment the architecture leaves open: the extension cache is "none" (line 293) and storage choice is deferred to R4 (line 407). The stored Reports contain PR code excerpts, which the consent text doesn't mention. *Fix:* add it to the architecture handoff and to the Welcome consent copy.
- **low** Credentials and Consent omits two PRD §4.8 NFR terms: "encrypted at rest" and "sent only over HTTPS to its own service" (prd.md line 437). *Fix:* add both.
- **low** The skipped-layer wording drifts. Flow 1 has "SKIPPED (no Sandbox in Standalone)", Voice has "did not run (no Sandbox in Standalone)", and PRD §4.9 has "SKIPPED (no Sandbox)". *Fix:* use the engine's string and let the coverage headline do the explaining.

## 8. Shape fit — strong

DESIGN.md sections are in canonical order: Brand & Style → Colors → Typography → Layout & Spacing → Elevation & Depth → Shapes → Components → Do's and Don'ts. EXPERIENCE.md has every required default (Foundation, Information Architecture, Voice and Tone, Component Patterns, State Patterns, Interaction Primitives, Accessibility Floor, Key Flows) plus Responsive & Platform and Inspiration & Anti-patterns, matching the examples. The invented "Credentials and Consent" section earns its place: Chrome Web Store credential policy and the PRD §4.8 NFR make it part of the experience. Open Questions is appropriate for a draft.

### Findings
- **low** Information Architecture has no composition-reference pointer yet. *Fix:* add it when the Report and Post mockups land (see section 5).

## Mechanical notes

- **Name inconsistencies:** "Page review button" / "Review button (on the page)" / "Review button" / `page-review-button`; "Coverage line" / "Coverage block"; "Progress steps" / "Step list" / `progress-step-running`; "Post panel" (EXPERIENCE.md) has no DESIGN.md counterpart. Bare status names (`ok`, `bad`, `muted` in DESIGN.md lines 163, 198; `bad` in EXPERIENCE.md line 92) resolve informally. `{colors.ok}` form is preferred.
- **Broken cross-refs:** EXPERIENCE.md line 109 points to contrast in DESIGN.md, which has none. EXPERIENCE.md line 111 attributes WCAG to the PRD §4.8, which has no such NFR. DESIGN.md line 204 contradicts EXPERIENCE.md line 68 and memlog line 29 on the page button's label.
- **Frontmatter:** DESIGN.md has name, description, status, updated, sources and all token groups. EXPERIENCE.md has name, status, updated, `design: DESIGN.md` and sources, with no `description` (optional; the examples omit it too). Both `status: draft`. DESIGN.md `sources` omits ARCHITECTURE-SPINE, which is fine because no visual decision depends on it.
- **Component token gaps:** no frontmatter entries for post-panel/preview, findings-toolbar, coverage, key-field/input, dialog, status badges, or page-button states. `progress-step-running` exists without waiting, done or failed siblings, which are described in prose only.
- **Values verified:** all 36 color hexes match app.css lines 2–44. Radius 10/8/6 and the 7px chip dot match app.css. Disabled opacity of 0.55 matches `.btn:disabled`.
