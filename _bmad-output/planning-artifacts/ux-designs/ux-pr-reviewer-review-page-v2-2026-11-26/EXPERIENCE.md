---
name: pr-reviewer review page v2
status: final
updated: 2026-11-26
design: DESIGN.md
sources:
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/prds/prd-pr-reviewer-2026-11-24/prd.md
  - _bmad-output/planning-artifacts/ux-designs/ux-pr-reviewer-2026-11-26/EXPERIENCE.md
  - packages/cli/static/
  - docs/web-app.md
---

# pr-reviewer review page v2 — Experience Spine

## Foundation

A desktop-first web page, served by `pr-reviewer serve` (one user, loopback, Epic 8) and by the self-hosted Web App (signed-in team members, Epic 6). Both serve the same page against `ReviewService v1`. No UI framework is assumed. v2 lives beside **classic** (`packages/cli/static`, with Epic 9 Stories 9.1 and 9.2 applied); Story 9.3 serves both and switches between them. Everything classic can do, v2 can do (Story 9.3's parity list); v2 adds structure, keyboard control, code in context, and the competitive features below.

**Inherited from the extension spine** (`ux-pr-reviewer-2026-11-26/EXPERIENCE.md`) **in full, unless overridden here:** the post rules (preview first, never Approve, head re-read before posting, already-posted and refused states), statuses in the engine's words, the excluded-finding treatment, and the whole Accessibility Floor (structure, focus, announcements, controls and content, time limits, motion, zoom, forced colours). This spine states only v2's additions and overrides.

**Every Report field is reachable (FR-32):** verdict and gate reasons on Overview; checks, detected projects and limitations on Checks; walkthrough, linked issues, related code, learnings, Review Rules checked, run details and downloads on Walkthrough; source, confidence, scope, advisory and "dismissed by" badges in the finding thread.

**Data:** everything comes from the Report, run events and existing routes, plus one additive read route, `GET /v1/runs/:id/hunks`: for each file with findings, the PR diff hunks overlapping the findings' line ranges with 3 lines of context, at most 400 lines per file and 4,000 per run, from the run's PR context the service already holds. If the route fails or the context is gone (a run from before a restart), threads degrade to "code unavailable" (State Patterns). UX-DR27 is amended to "ReviewService v1, additive read routes only".

## Information Architecture

| Surface | Reached from | Purpose |
|---|---|---|
| Locked (serve only) | Opening `serve`'s page without its one-time key | "Open this page from the link `pr-reviewer serve` printed." Nothing else |
| Start | Opening the page with no run; palette "New review"; `g n` | Large command field (the palette rendered inline): paste a PR link, or type owner/repo for its open PRs; recent reviews below |
| Command palette | ⌘K / Ctrl+K; the sidebar command field | Find PRs and recent reviews, run actions |
| Overview | A run starting, reattaching or finishing; `g o` | Verdict hero (with gate reasons when failed), "Since last review" strip, metric tiles, run timeline, "Needs attention" preview, "Earlier runs" (Web App) |
| Needs attention | `g a`, the new-findings tile, Enter on Overview | New findings: list + detail (finding under its diff hunk); "Fix with your agent" |
| Pre-existing | `g p`, the pre-existing tile, the "20 pre-existing · Show" row | Pre-existing findings, excluded by default; same list + detail |
| Checks | `g c` | Run timeline in full with each layer's detail and reason; detected projects; limitations |
| Walkthrough | `g w` | Summary, effort, changes by file, linked issues, related code, learnings used, Review Rules checked, run details, Download Markdown / JSON |
| Post drawer | `p`, "Preview post" | Review type, exact comments and summary, Post, result |
| Agent panel | "Fix … with your agent" | `pr-reviewer fix <pr>` and the combined prompt |
| Stats | Sidebar (Start state), palette "Show stats", `g s` | How posted findings fared (tiles, by severity and source, by PR) |
| Settings | Sidebar (Start state), identity menu, palette | Review (provider, model; Web App: endpoint and key), page (theme, default view), keyboard |
| Shortcuts sheet | `?`, palette "Keyboard shortcuts" | Current key bindings; link to Settings → Keyboard |
| Identity menu | The identity block at the bottom of the sidebar | Who is signed in, AI readiness, version, Settings, Switch to classic, Sign out (Web App) |

Sidebar contents: with no run, Start, Stats, Settings; with a run, Overview, Needs attention, Pre-existing, Checks, Walkthrough, the changed files (clicking one filters the lists; again clears), then Start, Stats, Settings below a divider. The identity block is always at the bottom.

→ Composition references: [mockups/key-start.html](mockups/key-start.html) (Start, palette), [mockups/key-v2.html](mockups/key-v2.html) (Overview, Needs attention, live run, dark, narrow), [mockups/key-post-edit.html](mockups/key-post-edit.html) (inline edit, post drawer), [mockups/key-checks-walkthrough.html](mockups/key-checks-walkthrough.html), [mockups/key-stats.html](mockups/key-stats.html), [mockups/key-shortcuts-settings.html](mockups/key-shortcuts-settings.html). Exploratory directions the choice was made from are in `mockups/directions/` (not contracts). The spines win on conflict.

## Voice and Tone

Same voice as classic and the extension: short, exact, no exclamation marks.

| Do | Don't |
|---|---|
| "Passed with warnings. Two minor issues to look at; nothing blocks merging." | "Great news! Your PR looks good 🎉" |
| "2 new findings · 20 pre-existing, not included" | "22 issues found" |
| "Review finished · 2 new findings · Show findings" | "Done!" |
| "Results appear here when the review finishes. You can leave this page; the review keeps running." | "Please wait…" |
| "Paste a PR link, or type owner/repo to see its open PRs" | "Enter input" |
| "GitHub can't show octo/private#3 to this token. It needs Pull requests: read on that repository." | "Error 404" |
| "Posted 2 inline comments and the summary as @anika." | "Success" |

The verdict sentence comes from the review's walkthrough summary; when there is none, it is built from the status and counts.

## Component Patterns

Behavioural. Visual specs in `DESIGN.md` Components.

| Component | Behavioural rules |
|---|---|
| Command field | The sidebar field opens the palette on focus or typing. Start's field is the palette rendered inline with the same parser and results. Enter on an invalid reference shows the error under the field and keeps the text. |
| Command palette | ⌘K / Ctrl+K opens it (ignored while the inline editor, drawer or shortcuts sheet is open). Typing filters; a pasted PR link offers "Review owner/repo#n" first; "owner/repo" lists that repo's open PRs with their reviewed state; actions include New review, Show stats, Settings, Keyboard shortcuts, Select all, Select none, Fix with your agent, Review with another AI provider (opens Settings → Review), Switch to classic, Theme. Enter runs the highlighted item; Esc closes and returns focus; a visible Close button. |
| Sidebar | Active item has `aria-current="page"`; counts as text; collapses to an icon rail between 800 and 1100px, each icon with an accessible name and the same active indicator. |
| Identity menu | A button showing "GitHub: @login · AI: <provider> ready" (or what is missing, in words); opens a menu with Settings, Switch to classic, version, and Sign out on the Web App. |
| Verdict hero | Status pill, verdict sentence; gate reasons listed when the gate failed; "Reviewing" while running. |
| Since last review | Shown on Overview when an earlier review of this PR exists: "Since 9f3c2e1: 1 resolved · 1 still open · 1 new", each part a link (resolved list, still-open findings, new findings). Computed from the same data as the post preview; hidden on a first review. |
| Metric tiles | New findings (→ Needs attention), pre-existing (→ Pre-existing), checks (→ Checks), tokens and model (→ Walkthrough run details); skeletons until known, replaced in place (same element). |
| Run timeline | One node per layer from run events in `seq` order, each with a state word (Waiting, Running, Done, Done with warnings, Failed, Skipped), its outcome and duration. The running ring animates for at most 5 seconds, then stays static. |
| Earlier runs (Web App) | On Overview, the PR's earlier runs (when, head, status, new / resolved / unchanged against the previous run); each opens that run's Report (FR-34). |
| Finding list | A list of rows; each row has a native checkbox ("Include in post: <SEVERITY> <title>, <path>:<lines>") and a title button (`aria-current` on the shown finding). j / k and ↓ / ↑ (focus in the list) move focus between title buttons and show that finding in the detail without moving focus; Enter moves focus to the detail's heading. x toggles the focused or shown row's checkbox. Select all / Select none in the list header (Select all = new findings only, Story 9.1). Filter chips (toggle buttons) by severity, confidence and "By file"; selection survives filtering; low-confidence findings start excluded with a "Low confidence" badge. |
| Pre-existing row | "20 pre-existing · Show" after the new findings; activating it opens the Pre-existing surface; findings there are excluded until ticked one by one. |
| Finding thread | Badges (severity, category, source and confidence, scope, advisory, dismissed by), the title, the path link (opens the line on GitHub in a new tab), the code box (the PR's hunk around the finding, from the hunk route), the comment (description, "Why it matters", recommendation), and the suggested change when present (posted as a committable suggestion). Actions: Edit wording (e), Exclude / Include (x), Copy agent prompt (c). |
| Inline editor | e (or the button) opens an editor in the thread for three fields, matching the publish API: title (one line), description (Markdown), recommendation (Markdown), each with a live preview. The suggested change is not editable and is posted as it is (the publish API edits title, description and recommendation only; build decision 2026-11-26). Save (⌘Enter / Ctrl+Enter) keeps the edits for posting and marks the finding "edited"; Cancel restores. Edits survive switching findings and are kept with the run. |
| Fix with your agent | In the Needs attention header and the post drawer: "Fix 2 included findings with your agent" opens the agent panel with `pr-reviewer fix <pr>` (Copy) and "Copy combined prompt"; per finding, Copy agent prompt (c). Nothing runs from the page. |
| Teaching hint | The first exclusion in a session says once: "Excluded from this post. To teach future reviews of this repository, react 👎 or reply /dismiss <why> on GitHub." |
| Post drawer | A modal dialog named "Post to GitHub" with a visible Close button. Opening it builds the preview (inline comments, still open, resolved, overflow to the summary, the summary); focus goes to its heading and "Preview ready: 2 inline comments and the summary" is announced. Post appears after the preview with the counts; review type Comment, or Request changes when allowed, never Approve; "Posting…" disables it; results per the inherited post rules; after posting, focus goes to the result line. Any change to inclusion or wording discards the preview; reopening rebuilds it. Full width below 800px. |
| Toast | Bottom right; never takes focus; info toasts dismiss after 8 seconds counted only while the page is visible; error toasts and toasts whose action has no other route stay until closed and have a Close button; F6 reaches the notifications region; every action is also available elsewhere (Show findings = `g a`; Retry on the surface). |
| Shortcuts sheet | A modal dialog listing the current bindings; closes the palette or drawer first if one is open; links to Settings → Keyboard. |
| Settings | Review — serve: provider and model from the pr-reviewer config (changes apply to the next run); Web App: provider, model, an allow-listed endpoint, masked API key, Test, Remove key (FR-35); Settings opens itself when AI is not ready. Page: theme (System / Light / Dark), default view (v2 / classic). Keyboard: single-key shortcuts On / Only when the list or detail has focus / Off, Edit shortcuts (remap; clashes refused inline; Reset). Stored per browser (serve) and per user (Web App). |
| View switch | "Switch to classic" in the palette and the identity menu; "Try v2" in classic. Precedence: the browser's own choice, then the server default (`serve --ui` or the Web App operator setting), then classic until Story 9.3's parity list passes. Switching mid-run continues the same run. |

## State Patterns

| State | Surface | Treatment |
|---|---|---|
| Locked | serve, opened without its key | Locked surface only. |
| Not signed in | Start (Web App) | "Sign in with GitHub" as the only action. |
| No GitHub token | Start (serve) | Identity says what is missing and how to fix it (`gh auth login` or GITHUB_TOKEN); reviewing is off with the reason. |
| AI not ready | Start, Overview | Says which provider and why; Web App opens Settings → Review; serve says which config to change. |
| No run yet | Start | Command field focused; recent reviews or "No reviews yet. Paste a PR link to start." |
| Invalid reference | Start / palette | "That isn't a PR link or owner/repo#number." under the field; text kept. |
| PR not readable | Start / palette | Names the repository and the missing permission; nothing starts (UJ-1 edge case). |
| Start refused | Start / palette | The service's reason in words (for example a run limit), with when to retry. |
| Palette states | Palette | Loading ("Looking up open PRs…"), no matches, no open PRs, repository not found or not readable (with the permission), reviewed state unknown (shown as "?"). |
| Running | Overview | Hero "Reviewing", skeleton tiles, live timeline, elapsed time (updated every 10s, not announced); Needs attention count shows "…". |
| Reload during or after a run | Overview | The last run reattaches (running) or its Report opens (finished); only the current state is announced (FR-31). |
| Finished with findings | Overview | Hero, strip, tiles, timeline, preview; toast if the user was elsewhere. |
| Finished, no new findings | Overview | "No new findings." in the hero; pre-existing and checks still shown. |
| Run failed | Overview | ERROR with the reason in plain words and Retry; the timeline shows where it stopped. |
| AI rate-limited or failed | Overview, Checks | AI node "Failed: provider rate-limited" (the engine's ERROR), never PASSED; deterministic results shown; Retry (UJ-3 edge case). |
| Outdated (head moved) | Post drawer | Found when posting (the head is re-read, AD-23): "Not posted (cancelled) … Review again to post on the new commit." A banner before posting needs a route that exposes the PR's current head (not in v1 yet; build decision 2026-11-26). |
| Not in this PR's diff | Finding thread | Whole-PR findings and findings outside the diff show the comment without code and with the file link. |
| Code unavailable | Finding thread | "The code for this finding could not be loaded." with the file link. |
| Stats | Stats | Loading; empty ("No posted findings in the last 30 days."); error with the reason. |
| Settings | Settings | Saving, saved (announced), error tied to the field; key Test success or the provider's error. |
| Posting / posted / refused / already posted | Post drawer | Per the inherited post rules. |
| Narrow (< 800px) | Needs attention, Pre-existing | Detail replaces the list with "← Needs attention" and "1 of 2". |

## Interaction Primitives

**Keyboard-first; mouse fully supported.** Every shortcut has a visible control too.

- Anywhere: `⌘K` / `Ctrl+K` palette · `?` shortcuts sheet · `F6` / `Shift+F6` cycle sidebar, list, detail, notifications.
- Go to: `g n` Start · `g o` Overview · `g a` Needs attention · `g p` Pre-existing · `g c` Checks · `g w` Walkthrough · `g s` Stats · `/` list filter.
- Findings (focus in the list or detail): `j` / `k` next / previous · `Enter` open · `x` include / exclude · `e` edit wording · `c` copy agent prompt · `p` preview post.

**Shortcut guard.** Single-key and `g` shortcuts are ignored when focus is in an input, textarea, select, contenteditable, or any combobox, textbox, searchbox, listbox, menu or option; while text is being composed (IME); while Ctrl, Alt or Meta is held (Shift only for `?`); and while a dialog (palette, drawer, shortcuts sheet) is open, where only that dialog's keys work. Controls with shortcuts expose `aria-keyshortcuts`; the key glyphs are hidden from assistive technology. Screen-reader browse-mode keys take precedence; the page never uses `role="application"`.

**Esc**, innermost first, one layer per press: an open native popup (select, autocomplete) → palette → shortcuts sheet → post drawer → inline editor → list filter text (clears) → narrow detail (back to the list). In the inline editor, Esc with unsaved changes keeps the draft, moves focus to Cancel and announces "Unsaved changes. Press Cancel to discard, or Save." Only Cancel discards.

**Motion:** 150–200ms pane, drawer and palette transitions; the running ring at most 5 seconds; skeletons do not shimmer; none of it under reduced motion. Banned: infinite scroll, drag and drop, hover-only actions, two overlays at once.

## Accessibility Floor

Inherits the extension's floor in full; v2's additions and overrides:

- **Structure:** a "Skip to findings" link first; landmarks for the sidebar (`nav`), and labelled regions for list and detail inside `main`; one `h1` per surface (the PR title on Overview); the shown finding's title is the detail's `h2` (`tabindex="-1"`).
- **Focus model:** DOM and Tab order sidebar → list → detail. F6 cycles regions. Selection moves with j / k without moving focus into the detail; Enter does. On narrow screens, back returns focus to the finding's row. If the focused row is filtered out, focus goes to the next row, else the previous, else the list heading, and "Showing 1 of 2" is announced. Automatic changes (run finished, reattach) never move focus; tiles update in place.
- **The list** is the committed row pattern in Component Patterns (no listbox, no `aria-activedescendant`).
- **Shortcuts** follow the guard and the Settings options (WCAG 2.1.4); "Off" disables every unmodified printable-key shortcut including `g` chords, `?` and `/`; ⌘K and Esc stay.
- **Diff:** a table with line numbers and a `+` / `−` column, and the change type in text ("added", "removed"); code blocks scroll inside themselves and are focusable regions with names.
- **Dialogs:** palette (combobox with a listbox), drawer and shortcuts sheet are modal dialogs with visible Close buttons; focus returns to the invoker.
- **Toasts:** as in Component Patterns; the status region speaks a toast once, and not twice when it repeats the run-result announcement.
- **State in text:** timeline state words; chips are toggle buttons with `aria-pressed`; the rail's active item has `aria-current="page"`; identity health in words.
- **Forced colours:** selection and active indicators are real borders (mapped to Highlight); boxes keep 1px borders; focus uses `outline`.
- **Zoom and reflow:** at 320px and 200% zoom the narrow layout applies; the drawer and palette are full width; no horizontal page scroll.

## Responsive & Platform

| Width (CSS px) | Layout |
|---|---|
| ≥ 1100 | Sidebar, list and detail (three panes); Start, Overview, Checks, Walkthrough, Stats, Settings in two |
| 800 – 1099 | Sidebar becomes an icon rail; list and detail side by side |
| < 800 | Icon rail; list or detail one at a time; drawer and palette full width |

Desktop browsers first (Chrome, Edge, Firefox, Safari current versions); usable on a tablet; phones get the narrow layout without being a design target.

## Coexistence with Classic

- Classic keeps working with Stories 9.1 and 9.2 applied; "Try v2" in classic, "Switch to classic" in v2.
- Default-view precedence as in Component Patterns (View switch).
- Same session, runs and Reports in both; switching mid-run continues the run.

## Inspiration & Anti-patterns

- **Base from Linear / Raycast (Direction A, Command)**: three panes, the command palette, single-key navigation.
- **Borrowed from Stripe / Notion (Direction B, Ledger)**: the verdict hero with a plain sentence and metric tiles.
- **Borrowed from GitHub (Direction C, Native)**: findings as review threads under their diff hunk, the suggested-change block.
- **Borrowed from Vercel / Geist (Direction D, Signal)**: the run as a timeline with durations.
- **Competitive parity (decided 2026-11-26)**: Fix with your agent for the included findings (Greptile "Fix All", CodeRabbit autofix) through the existing `pr-reviewer fix`; "Since last review" deltas (CodeRabbit incremental review); confidence filtering with low confidence excluded by default (Greptile confidence scores); visible learnings and a teaching hint (Bugbot learned rules).
- **Rejected:** a dashboard home (Start is a command field), a separate Post page (the drawer keeps the finding in view), in-page chat about a finding (questions belong in the user's coding agent via `pr-reviewer mcp`), auto-approve (pr-reviewer never approves).

## Key Flows

### Flow 1 — Anika reviews a teammate's PR on her laptop (UJ-1, Epic 8)

1. Anika runs `pr-reviewer serve --open`. Start shows the command field and her recent reviews.
2. She presses ⌘K, pastes `kb-igot/sunbird-cb-orgportal#796`, and presses Enter on "Review".
3. Overview fills in live: context, build config, TSLint, secrets; the AI node runs; the tiles are skeletons.
4. A toast says "Review finished · 2 new findings · Show findings". The hero reads "Passed with warnings. Two minor issues to look at; nothing blocks merging." The tiles show 2 new, 20 pre-existing, 4/5 checks.
5. She presses `g a`. The first finding shows under its diff hunk: the changed `*ngIf` and the progress line, then why it matters and the suggested change. She presses `j` for the second, then `e`, softens the description, and saves with ⌘Enter.
6. She presses `g p`, sees the `prefer-const` finding on a line next to her teammate's change, and ticks it into the post.
7. She presses `p`. The drawer shows three inline comments (one edited) and the summary; the other 19 pre-existing findings are not in it.
8. **Climax:** she presses Post. "Posted 3 inline comments and the summary as @anika." The comments that matter, none of the noise, after a minute of reading.

Failure: she pastes a PR from a private repository her token can't read. Start says which repository and that the token needs Pull requests: read; nothing starts.

### Flow 2 — Sofia reviews on Meera's team Web App (UJ-3, Epic 6)

1. Sofia opens the team's Web App and signs in with GitHub. Start shows the command field; her browser is 900px wide beside her editor, so the sidebar is an icon rail.
2. She pastes the PR link. Overview fills in; compile and lint run in the Web App's Sandbox.
3. The review finishes. "Earlier runs" shows Meera reviewed this PR yesterday; the "Since last review" strip says 2 resolved, 1 still open, 1 new.
4. In Needs attention she reads the findings by file, unticks one she disagrees with, and leaves two.
5. **Climax:** she posts two comments; the summary on GitHub updates in place with "2 resolved since the last review", and the run is kept in the PR's history for the next teammate.

Failure: the team's AI provider is rate-limited. The AI node reads "Failed: provider rate-limited", the overall status is never PASSED, the compile, lint and secrets results are shown, and Retry is on Overview.

### Flow 3 — Tom prefers the classic page for now (Story 9.3)

1. Tom opens the review page; v2 is the default on his team's Web App.
2. He opens the identity menu and picks "Switch to classic". The same run's Report appears in classic.
3. **Climax:** the next day the page opens in classic for him, with a quiet "Try v2" link. Nothing he relied on went away.

### Flow 4 — Priya's first review on the Web App (FR-35)

1. Priya signs in to the Web App for the first time. The identity block reads "AI: not set up", and Settings opens at Review.
2. She picks Anthropic, pastes her key, presses Test ("Works: claude-opus-5-5 answered"), and saves.
3. **Climax:** the palette opens with her cursor in it; she pastes a PR link and her first review starts, all within the page.

## Assumptions

- Shortcut set as listed; remappable.
- Recent reviews on Start come from the service (serve: this process; Web App: the user's history, Epic 6).
- Hunk route limits (3 lines of context, 400 lines per file, 4,000 per run) are a starting point for the build to tune.
- Desktop browsers first; phones not a design target.

## Open Questions

- Extension: whether it follows v2's look (an Update of its DESIGN.md) once v2 is the default.
