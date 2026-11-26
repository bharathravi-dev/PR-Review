# Spine Pair Review — pr-reviewer review page v2

Reviewer lens: rubric walker. Reviewed: DESIGN.md (11:30) and EXPERIENCE.md (11:36 revision, which added the Checks/Walkthrough, Stats and Shortcuts/Settings mockup links and "run details, Download Markdown / JSON" in the Walkthrough row). Sources checked: epics.md (UX-DR25–27, Epic 9, Stories 9.1–9.4+), PRD UJ-1, UJ-3 and §4.7 (FR-30–FR-35), the extension spines (`ux-pr-reviewer-2026-11-26`), `packages/cli/static/index.html` and `app.js`, `docs/web-app.md`, all mockups, `.memlog.md`.

## Overall verdict

**Adequate for the core review loop; thin as the parity contract.** The pair is well shaped, lean, and every token reference resolves, so a consumer can build Overview, Needs attention, the finding thread, the inline editor and the post drawer from it with confidence. It is not yet safe to hand to story-dev for Story 9.3's parity checklist or for the Web App: several things classic does today have no v2 surface (the Web App's API key settings, per-PR history with comparison, Sign out, version, Select all / none, reattach after reload, gate reasons, limitations, rules checked). Start, the palette, Stats and Settings have almost no error or empty states. Two load-bearing decisions are still open: the hunk route, and what the inline editor edits. UJ-3 is represented by a flow that skips its core actions and its edge case.

Counts: 0 critical · 9 high · 20 medium · 19 low.

## 1. Flow coverage — thin

Requirement names extracted: UJ-1, UJ-3, UX-DR25, UX-DR26, UX-DR27, Stories 9.1, 9.2, 9.3, 9.4+ (start surface, progress, Report, editing and posting, settings), FR-30–FR-35 (UJ-3's Web App FRs).

| Requirement | Flow | Protagonist | Steps | Climax | Failure path |
|---|---|---|---|---|---|
| UJ-1 (via Epic 8 serve) | Flow 1 | Anika | yes | yes | yes (head moved); UJ-1's own edge case (missing permission) absent |
| UJ-3 | Flow 2 | Sofia (not UJ-3's Meera or "teammates") | yes | yes | **none**; UJ-3's edge case (AI rate-limited) absent |
| UX-DR26 / Story 9.1 | Flow 1 steps 4 and 6 | — | — | — | — |
| UX-DR27 / Story 9.3 | Flow 3 | Tom | yes | yes | none (mid-run switch would be the natural one) |
| UX-DR25 / Story 9.2 | classic only, correctly out of scope (Coexistence) | — | — | — | — |
| Story 9.4+ surfaces: Stats, Settings, Checks, Pre-existing | no flow | — | — | — | — |

### Findings
- **[high]** Flow 2 claims UJ-3 but leaves out what UJ-3 is about. Nobody signs in, reads findings grouped by severity and file, unticks some, then posts or keeps the report in the app, and no past review for the PR is listed (EXPERIENCE.md Key Flows, Flow 2; PRD UJ-3). Its climax is a FAILED compile check, which is closer to the extension's Flow 3. *Fix:* rewrite Flow 2 around a teammate on Meera's Web App: sign in, paste, watch, untick, post (or keep), and see the PR's earlier runs. Keep the narrow-window detail as a step.
- **[high]** UJ-3's edge case (AI provider rate-limited: deterministic results shown, AI layer `ERROR (provider rate-limited)`, never PASSED, Retry) has no failure path in any flow. A state row exists ("AI layer failed"), but no flow uses it (Flow 2). *Fix:* add it as Flow 2's failure path, quoting the engine words.
- **[medium]** UJ-1's edge case (private repo the token cannot read: say which permission is missing, post nothing) is not covered. Flow 1's failure path is head-moved instead (Flow 1; PRD UJ-1). *Fix:* add a second failure line to Flow 1 that uses a new Start state (see §4).
- **[medium]** No flow covers Stats, Settings (for example "AI provider not ready → set it up → review"), or Pre-existing (ticking one pre-existing finding into the post, which Story 9.1's AC requires). Story 9.4+ makes each surface its own story, so these stories would have no flow to take acceptance criteria from (Key Flows). *Fix:* add a short Flow 4 for first use on the Web App (Settings, then key, then review) and one step in Flow 1 where Anika ticks one pre-existing finding.
- **[low]** Flow 3 has no failure path. Switching mid-run is the case Coexistence promises ("switching mid-run continues the same run") and is worth one line (Flow 3; Coexistence with Classic).
- **[low]** Protagonists are borrowed from the extension spine (Sofia, Tom), not from the PRD journeys they cite. That is acceptable for Flows 2 and 3, but Flow 2's title should name UJ-3's actor (a teammate on Meera's Web App) to keep the names verbatim (Flow 2 title).

## 2. Token completeness — adequate

Mechanical results: all 48 `{path.to.token}` references in both files resolve. All 27 light colour tokens have a `-dark` pair, and there are no orphan dark tokens. The typography, rounded and spacing groups are complete. Every component token references existing tokens.

WCAG ratios computed for the new v2 pairs (light / dark; target):

| Pair | Light | Dark | Target | Result |
|---|---|---|---|---|
| text on sidebar | 14.18 | 15.46 | 4.5 | pass |
| muted on sidebar | 5.09 | 7.33 | 4.5 | pass |
| accent on sidebar (links, active edge) | 5.17 | 7.25 | 4.5 | pass |
| text on accent-soft | 13.94 | 12.07 | 4.5 | pass |
| muted on accent-soft (meta line in selected row) | 5.01 | 5.72 | 4.5 | pass |
| accent on accent-soft (chip active, Reviewing pill, inset edge) | 5.08 | 5.66 | 4.5 | pass |
| toast-text on toast-bg | 15.10 | 15.12 | 4.5 | pass |
| text on diff-add / diff-del / diff-hunk | 14.46 / 14.15 / 14.26 | 11.52 / 12.61 / 12.79 | 4.5 | pass |
| muted on diff-add / diff-del / diff-hunk (line numbers, hunk header) | 5.19 / 5.08 / 5.12 | 5.46 / 5.98 / 6.06 | 4.5 | pass |
| border-strong on sidebar (command field edge) | 3.19 | 4.18 | 3 | pass |
| border-strong on accent-soft (checkbox in selected row) | 3.14 | 3.26 | 3 | pass (tight) |
| focus on accent-soft | 5.08 | 5.66 | 3 | pass |
| focus ring against button-primary fill (same hue) | 1.00 | 1.00 | 3 | **fails unless offset** |
| accent-soft fill vs surface (selected row without its edge) | 1.16 | 1.15 | 3 | the 2px accent edge carries it; never drop the edge |

### Findings
- **[medium]** `{colors.focus}` is defined but never used. DESIGN.md has no focus-indicator spec: no width, no offset, no rule for focus on `button-primary`, where focus = accent = fill (1.00:1), and no rule for focus inside a selected `accent-soft` row (frontmatter `focus`; Components; Do's and Don'ts). The extension spine gives focus a token and a two-tone ring. *Fix:* add a `focus-ring` component token (for example `2px solid {colors.focus}, 2px offset on {colors.surface}`) and a sentence in Components saying every focusable element uses it.
- **[medium]** Nothing says how the `-dark` tokens are chosen. EXPERIENCE.md has a "theme" action and setting, and the Settings mockup shows System / Light / Dark, but DESIGN.md never says that the OS preference applies by default, that a user override wins, or where the choice is stored (DESIGN.md Colors; EXPERIENCE.md IA Settings row). *Fix:* one line in Colors: "-dark values apply under the theme setting (System by default = prefers-color-scheme; Light / Dark override, remembered per browser)."
- **[low]** Contrast is stated as targets plus "new v2 pairs to verify at build" instead of measured values. The extension spine commits a measured table (DESIGN.md Colors, last paragraph). *Fix:* paste the table above (it all passes) so build checks a number, not a to-do. Note that border-strong on accent-soft (3.14) is now the tightest control pair.
- **[low]** Spacing tokens `'1'`, `'3'` and `'6'` are defined but never referenced (frontmatter `spacing`). Harmless. Either use them or drop them.

## 3. Component coverage — thin

| Component | DESIGN.md (visual) | EXPERIENCE.md (behavioural) |
|---|---|---|
| Sidebar | yes | yes |
| Command field | yes (with palette) | **no**: how the field relates to the palette and to Start's large field is unstated |
| Command palette | yes | yes |
| Verdict hero / Status pill | yes | yes (in hero) |
| Metric tiles / Skeleton | yes | yes |
| Run timeline | yes | yes |
| Finding row (DESIGN) vs **Finding list** (EXPERIENCE) | name differs | name differs |
| Filter chip | token only | in Finding list |
| Pre-existing group | yes | yes (contradicts DESIGN, see §8) |
| Finding thread | yes | yes |
| Inline editor | yes | yes |
| Post drawer | yes | yes |
| Toast | yes | yes |
| View switch | **no** | yes |
| Outdated banner | **no** | state row only |
| Identity menu (holds Settings, Switch to classic) | **no** (sidebar "identity" only) | **no** |
| Post bar (in Finding thread) | named, not specified | **no** |
| "Needs attention" preview (Overview) | **no** | **no** |
| Recent reviews list (Start) | **no** | **no** |
| Open-PR result row with reviewed state (palette) | **no** | partly (palette row) |
| Shortcuts sheet (`?`) | **no** | **no** (not in IA either) |
| Stats tiles and table | **no** | **no** |
| Settings controls (input, select, segmented, toggle) | **no** (no `input` token) | **no** |
| Checks layer row, Walkthrough sections | **no** | **no** |
| Back control and "1 of 2" (narrow) | **no** | state row only |

### Findings
- **[high]** The Settings and Stats surfaces have no component vocabulary. DESIGN.md defines no `input`, `select`, segmented control or toggle (the Settings mockup uses all four), and no table style for Stats or the history table. A consumer has to invent control styles, which is the exact drift UX-DR25 and Story 9.2 just fixed in classic (DESIGN.md frontmatter `components`; Components). *Fix:* add `input`, `select`, `segmented`, `toggle` and `table` tokens, inheriting the extension's `input` (border-strong edge), plus one Components line each.
- **[medium]** The Outdated banner is load-bearing (it turns posting off) but has no visual spec, while the extension has `banner-outdated` (EXPERIENCE.md State Patterns "Outdated"; DESIGN.md Components). *Fix:* add `banner` to the frontmatter (warn pair, placement above the hero and the list) and a Components line.
- **[medium]** "Identity menu" is a navigation target for Settings and the View switch, yet neither spine says what it contains (identity, AI readiness, Settings, Switch to classic, Sign out on the Web App) or how it opens (EXPERIENCE.md IA Settings row, Component Patterns View switch; DESIGN.md Sidebar). *Fix:* add an "Identity menu" row to both files.
- **[medium]** The Command field has no behavioural row. Does focusing or typing in the sidebar field open the palette? Is Start's large field the palette inline or a separate input with the same parser? What does Enter do with an invalid reference? (DESIGN.md "Command field and palette"; EXPERIENCE.md Component Patterns.) *Fix:* add a "Command field" row: the sidebar field opens the palette, and Start's field is the palette rendered inline with the same rules.
- **[medium]** The shortcuts sheet (`?`) is referenced by Interaction Primitives and Accessibility Floor and has a mockup, but has no IA row and no component row in either file. Its modal semantics also matter for the "never deeper than one" rule (EXPERIENCE.md Interaction Primitives, Accessibility Floor). *Fix:* add IA and component rows, and state that it is a dialog that closes the palette or drawer first.
- **[low]** The same component has different names: "Finding row" (DESIGN.md) and "Finding list" (EXPERIENCE.md). *Fix:* use one name, for example "Finding list" with "row" as its anatomy.
- **[low]** View switch, Post bar, Needs attention preview, Recent reviews list and the narrow back control are named but not specified on one side or the other (see table). Each needs about one line.

## 4. State coverage — thin

| Surface | Covered | Missing |
|---|---|---|
| Start | no run; not signed in / no token; AI not ready | invalid PR reference; PR not found or not readable, naming the missing permission (UJ-1 edge); run start refused (Web App per-user quota, FR-30); `serve` opened without its one-time key (classic's "Open this page from your terminal"); session expired or signed out (Web App 401); recent reviews loading; `?pr=` prefill (fills, never auto-starts) |
| Command palette | — | no matches; repo has no open PRs; repo not found or no access; open-PR list loading; reviewed state unknown without a token (classic: "Reviewed state needs a GitHub token"); draft PRs |
| Overview | running; finished with and without findings; run failed; AI failed; outdated | page reloaded mid-run (reattach, FR-31); FAILED by gate, with "Why it failed" reasons; INCOMPLETE; CANCELLED; earlier runs of this PR (FR-34) |
| Needs attention | hunks unavailable; narrow | no new findings (what the surface shows); filter result empty; finding with no location ("whole PR") or outside the diff; finding without fingerprint (classic disables its checkbox); dismissed and advisory findings; hunk loading |
| Pre-existing | — | none in this run (group and nav hidden or zero?); a pre-existing finding ticked into the post |
| Checks | — | while running; SKIPPED / NOT_APPLICABLE treatment (classic hides NOT_APPLICABLE) |
| Walkthrough | — | no walkthrough (AI failed or absent); no linked issues, related code or learnings |
| Post drawer | inherited post rules | no GitHub token ("Posting needs a GitHub token…"); preview made stale by a later selection or edit change while the drawer was closed; commit-status result line (classic shows it) |
| Stats | — | loading ("Reading your reviewed PRs from GitHub…"); none since date; error; per-repo filter |
| Settings | — | Web App API key saved / removed / invalid; serve mode where the provider comes from config; save result |

### Findings
- **[high]** Start has no error states for its one job. An invalid reference, a PR the token cannot read (UJ-1's edge case), and a refused start (quota) have no treatment (State Patterns). *Fix:* add rows. Errors appear under the command field, start with what failed, and name the permission; the field keeps its text.
- **[high]** Reattach after reload is missing. FR-31's testable consequence is "the run survives a page reload", and classic's `resume()` does it (State Patterns; PRD FR-31). *Fix:* add a state row: on load, the last run reattaches to Overview (running) or opens its Report (finished), and announces the current state only.
- **[medium]** The command palette has no empty or error states, although it now carries the open-PR list that classic showed with explicit "No open PRs" and error messages (State Patterns). *Fix:* add rows for no matches, no open PRs, repo not found or no access, loading, and reviewed state unknown.
- **[medium]** Stats and Settings have no states at all, even though both are on Story 9.3's parity list (State Patterns). *Fix:* add loading, empty and error for Stats; save, saved and error for Settings.
- **[medium]** The post drawer does not say that a preview is valid only for the exact selection and edits it was built from (classic clears the preview on any change). "Esc closes it without losing the preview" invites posting a stale preview after the user ticks something else (Component Patterns: Post drawer). *Fix:* "Any change to inclusion or wording discards the preview; reopening rebuilds it."
- **[medium]** Findings that cannot sit under a hunk (no location, whole-PR, or outside the diff, which includes many pre-existing lint findings) are treated only as "hunks unavailable", which is a different cause with a different message (State Patterns; Component Patterns: Finding thread). *Fix:* add a row: "Not in this PR's diff: the comment shows without code and with the file link."
- **[low]** The empty states for Needs attention (no new findings), Pre-existing (none) and Walkthrough (no AI walkthrough) are missing. One line each.

## 5. Visual reference coverage — adequate

Files: `mockups/key-start.html`, `key-v2.html`, `key-post-edit.html`, `key-checks-walkthrough.html`, `key-stats.html`, `key-shortcuts-settings.html`; `mockups/directions/direction-a-command.html`, `-b-ledger`, `-c-native`, `-d-signal`; `imports/classic-report-dark-2026-11-26.png`.

EXPERIENCE.md IA links all six key mockups, each with what it illustrates, refers to `mockups/directions/` as "not contracts", and states once that the spines win. The last three key mockups were added during this review and were linked in the 11:36 revision.

### Findings
- **[medium]** The mockups show capabilities the spines do not specify. Because the spines win on conflict, a consumer will drop them, though they look intended:
  - Start and Stats show sidebar nav items "Start / Stats / Settings"; the spine reaches these only through the palette.
  - The palette shows "Show stats for this repository `g s`", and `g s` is not in Interaction Primitives.
  - The palette shows "Review with another AI provider…", a per-run override (FR-31) that is not in the spine.
  - Checks shows a "Projects" line.
  - Stats periods are 7 / 30 / 90 days, where classic offers 30 / 90 / 365 plus a repository filter.

  (key-start.html, key-stats.html, key-checks-walkthrough.html vs EXPERIENCE.md IA and Interaction Primitives.) *Fix:* bring each into the spine or mark it as a mockup-only exploration.
- **[low]** DESIGN.md Colors still points to "the exploratory direction mocks in `.working/`", but they now live in `mockups/directions/` and `.working/` is empty (DESIGN.md Colors, status pairs bullet). *Fix:* update the path, or move that note to the memlog.
- **[low]** DESIGN.md Components links only the directory (`[mockups/](mockups/)`), with an outdated list that omits Checks, Walkthrough, Stats, shortcuts and Settings (DESIGN.md Components, first line). *Fix:* link the files per component, or point to EXPERIENCE.md IA.
- **[low]** `imports/classic-report-dark-2026-11-26.png` is not referenced by either spine (orphan, cited only in the memlog). *Fix:* cite it in Foundation or Coexistence as the "before" for the parity check.

## 6. Feature parity with classic — thin

| Classic capability (`index.html`, `app.js`) | v2 surface | Status |
|---|---|---|
| Review a PR (link or `owner/repo#n`) | Start, palette | covered |
| List a repo's open PRs with reviewed state, draft badge, author | palette | covered (reviewed state); draft and author unstated |
| Stats: period and optional repository | Stats (palette) | covered; repository filter only in a mockup action; periods differ |
| Settings: provider type, model, endpoint (allow-listed), API key, Remove key (Web App) | Settings: "AI provider and model, theme, default view, classic" | **missing**: API key, endpoint, Remove key |
| Progress per stage, elapsed time, provider and model on the AI step | Overview timeline | covered |
| Resume a run after reload | — | **missing** (§4) |
| Report head: PR link, head SHA, status, coverage headline | verdict hero | covered (the coverage headline is not named) |
| Projects / detected technologies (FR-32) | — (Checks mockup only) | **missing in spine** |
| Gate "Why it failed" rules | — | **missing** |
| Checks table: layer, validator, status, reason | Checks | covered |
| AI attempts, provider, model, tokens | tokens tile, Walkthrough run details | covered |
| Findings with severity counts; source, category, confidence | finding row and thread | covered |
| Scope, advisory, "dismissed by" badges | inherited "excluded styling" only | **partial**: advisory and dismissed-by display unstated |
| Select all / Select none (Story 9.1: Select all = new only) | — | **missing** |
| Tick or untick per finding | `x`, checkbox | covered |
| Edit wording: title, description, recommendation | inline editor: one Markdown body | **conflict** (see finding) |
| Preview, then post; Comment or Request changes; never Approve | post drawer | covered |
| Result: posted with links, duplicate, refused, commit status | inherited post rules | covered except the commit-status line |
| Download Markdown / JSON | Walkthrough | covered (11:36 revision); discoverability low |
| Limitations; Review Rules checked | — | **missing** |
| Per-PR history with new / resolved / unchanged (Web App, FR-34) | "recent reviews" on Start | **missing** |
| Identity: GitHub login and avatar, AI readiness | sidebar bottom | covered |
| Sign out (Web App) | — | **missing** |
| Version (`v<version>`) | — | **missing** |
| Locked page (serve without key) / Sign in with GitHub (Web App) | "Not signed in" state | **partial**: the serve one-time-key case is not covered |
| Footer privacy line ("Nothing is posted until you press Post") | — | dropped silently |

### Findings
- **[high]** Web App users cannot set their own API key, endpoint or Remove key in v2. Settings lists only "AI provider and model". This is FR-35, and classic opens Settings automatically when AI is not ready (EXPERIENCE.md IA Settings row; key-shortcuts-settings.html shows only the serve variant, "From your pr-reviewer config"). Without it, v2 can never pass Story 9.3's parity item "settings" on the Web App. *Fix:* split the Settings row by host. serve: provider and model from config. Web App: provider, model, allow-listed endpoint, masked key, Remove key, and opening automatically when AI is not ready.
- **[high]** Per-PR history with the new / resolved / unchanged comparison (FR-34, shown by classic on the Web App) has no v2 surface. "Recent reviews" on Start is a different thing (EXPERIENCE.md IA; PRD FR-34). *Fix:* add History, either a section of Overview ("Earlier runs of this PR") or a palette action, with its states.
- **[high]** The inline editor's contract does not match what classic, the publish API and FR-33 support. Classic edits three fields (title, description, recommendation) and posts `edits` per field. v2 shows one Markdown "Wording" body, and the mockup adds "The suggested change is kept." A consumer cannot tell which fields are editable or how one Markdown body maps to the API (EXPERIENCE.md Component Patterns: Inline editor; DESIGN.md `inline-editor`; key-post-edit.html). *Fix:* commit the edited fields (for example title plus a Markdown body mapped to description; recommendation editable or explicitly not), and say whether the suggested change can be edited.
- **[medium]** Select all / Select none is missing, and Story 9.1 defines it ("Select all selects new findings only") (Component Patterns: Finding list; epics.md Story 9.1 AC). *Fix:* add palette actions and list-header buttons, with Story 9.1's rule.
- **[medium]** The gate's "Why it failed" reasons, Limitations, Review Rules checked, detected projects, and advisory and dismissed-by badges have no v2 home. FR-32 requires every JSON Report field to be reachable from the UI (IA; PRD FR-32). *Fix:* add a line to Foundation committing to FR-32, and place each item (gate reasons in the hero, projects and limitations in Checks, rules checked in Walkthrough, badges in the thread).
- **[medium]** Sign out (Web App), the version label, and the serve one-time-key "locked" page are dropped without saying so (State Patterns; DESIGN.md Sidebar). *Fix:* put Sign out and the version in the identity menu, and add a locked state for serve opened without its key.
- **[low]** Download Markdown / JSON lives only at the bottom of Walkthrough, which is the AI narrative surface. It also has no palette action, unlike every other action (IA Walkthrough row). *Fix:* add "Download Markdown" and "Download JSON" palette actions.
- **[low]** The commit-status result line ("Commit status set / skipped (no permission)") is not mentioned in the post result (Component Patterns: Post drawer). *Fix:* name it as part of the result lines.

## 7. Bloat & overspecification — strong

Both files are lean. EXPERIENCE.md uses tables where tables fit, and DESIGN.md prose carries voice without narrative padding.

### Findings
- **[low]** The decision-history aside in DESIGN.md Colors ("The exploratory direction mocks in `.working/` showed MINOR in amber; the key-screen mockups follow this mapping") belongs in the memlog, not the contract.
- **[low]** DESIGN.md Colors restates the extension's full status mapping. It is acceptable because tokens need it, but a pointer ("the extension's mapping, unchanged") would keep one source of truth.
- **[low]** "Main-area padding is `{spacing.9}`–`{spacing.10}`" is a range, not a decision (DESIGN.md Layout & Spacing). *Fix:* pick one, or say which applies at which width.

## 8. Inheritance discipline — adequate

Sources resolve. UX-DR and story IDs are verbatim, and the UX-DR27 "unchanged" conflict is flagged honestly in Open Questions and in the memlog. WCAG 2.1 AA matches PRD §4.7.

### Findings
- **[high]** The hunk route is load-bearing but uncommitted. "A finding under its diff hunk" is the main structural decision of v2 (the C borrow and the Do's table), yet the read route depends on relaxing UX-DR27's "ReviewService v1 unchanged" wording and on an open shape (Open Questions 1 and 2; Assumptions 1). Story-dev cannot size Needs attention until it is decided. *Fix:* resolve it before story breakdown. Amend UX-DR27 to "ReviewService v1, additive read routes only" and commit the route shape (per run, per file with ranges, size cap), with "Hunks unavailable" as the degraded path.
- **[medium]** The Pre-existing group contradicts itself across the spines. DESIGN.md calls it "expandable". EXPERIENCE.md says "activating it opens Pre-existing" (a separate surface). UX-DR26 and Story 9.1 describe a collapsed group with "· Show" listed after the new findings (DESIGN.md Components; EXPERIENCE.md Component Patterns; epics.md UX-DR26). *Fix:* choose one (navigate to Pre-existing, or expand in place) and use Story 9.1's label ("20 pre-existing · Show").
- **[medium]** The default-view mechanism has four inputs and no order of precedence: `serve --ui classic|v2`, the Web App setting (Story 9.3), Settings "default view" (EXPERIENCE.md IA), and "remembered per browser" (View switch) (Coexistence with Classic). *Fix:* one line: per-browser choice, then server default (`--ui` or the Web App operator setting), then classic until parity.
- **[medium]** The finding list's accessibility pattern is left open: "listbox-like single tab stop … or plain buttons in DOM order". The listbox option also contains a real checkbox, which puts interactive content inside an option, and ARIA does not allow that (Accessibility Floor, third bullet). The extension's UX-DR23 chose "selection only via checkboxes; cards not focusable". v2 deliberately departs from that and should say so. *Fix:* commit one pattern. For example, a list of rows where each row is a button that opens the finding and has a sibling checkbox, with j/k moving focus between the row buttons.
- **[medium]** Forced-colors is neither inherited nor stated. Foundation inherits only the "announcement and time-limit rules". v2 relies on fills for selection (`accent-soft`) and the diff, and the extension spine has an explicit forced-colors rule (EXPERIENCE.md Foundation, Accessibility Floor). *Fix:* inherit the extension's Motion, zoom and forced-colours rules and add "selected row keeps a visible border in forced colors".
- **[low]** The inherited "time-limit rules" concern device-code expiry, which v2 does not have. v2's own timer is the 8s toast. *Fix:* drop the time-limit inheritance, or say it covers only that toasts never carry information on their own.
- **[low]** The vocabulary drifts. "Selection" means the focused row in v2 but means inclusion in classic, the extension and Story 9.1 ("Select all", "2 of 22 selected"). Reviewed-state wording also differs across classic ("new commits"), the mockup ("reviewed an older commit") and Flow 2 ("not reviewed at this commit"). *Fix:* add a two-line glossary (selected = shown in detail; included = will be posted) and use the classic wording for reviewed state.
- **[low]** Responsive widths are not inherited by the overlays. The palette (640px) and drawer (480px) have fixed widths, with no rule below 800px or at 320px, where both exceed the viewport (DESIGN.md `command-palette`, `post-drawer`; EXPERIENCE.md Responsive). *Fix:* "Below 800px the palette and drawer are full width."

## 9. Shape fit — strong

DESIGN.md follows the canonical order: Brand & Style → Colors → Typography → Layout & Spacing → Elevation & Depth → Shapes → Components → Do's and Don'ts. The frontmatter types match the spec. EXPERIENCE.md has every required default: Foundation, Information Architecture, Voice and Tone, Component Patterns, State Patterns, Interaction Primitives, Accessibility Floor and Key Flows. It also has the triggered sections Responsive & Platform and Inspiration & Anti-patterns, plus Assumptions and Open Questions. The invented "Coexistence with Classic" earns its place because it carries Story 9.3's rules.

### Findings
- **[low]** The Component Patterns table has no "Use / surface" column, unlike the examples. Surfaces are only implied (Component Patterns). Optional, but it helps per-surface story extraction.

## Mechanical notes

- Token references: 48 unique `{…}` references across both files; 0 unresolved. 27 light colours with 27 `-dark` pairs; 0 orphan. Unused: `spacing.1`, `spacing.3`, `spacing.6`, and `colors.focus` (never referenced; see §2).
- Contrast was computed with the WCAG 2.x relative-luminance formula. All text pairs in the brief pass 4.5:1 in light and dark (the lowest is muted on accent-soft at 5.01, light). Control pairs pass 3:1 (the lowest is border-strong on accent-soft at 3.14, light). The only failure is the undefined focus ring on `button-primary` (1.00:1 without an offset).
- Component names: 19 frontmatter components and 12 prose component headings in DESIGN.md; 12 Component Patterns rows in EXPERIENCE.md. Cross-matched in §3.
- EXPERIENCE.md changed during the review (11:36): the IA Walkthrough row gained "run details, Download Markdown / JSON", and the composition-reference line gained the three new mockups and `mockups/directions/`. This review reflects that revision. DESIGN.md was unchanged (11:30).
- Interaction Primitives vs mockups: the palette mockup shows `g s` (stats), which is not in the primitive list. Every other shortcut in the shortcuts-sheet mockup matches the spine.
- Classic files checked: `packages/cli/static/index.html` (locked, start, browse, stats, settings, progress, report, publish, footer) and `app.js` (loadSession, toggleSettings, listPulls, loadStats, renderProgress, resume, loadHistory, renderReport, renderFinding, editor, selectAll, renderPublish, doPublish, boot).
