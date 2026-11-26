---
name: pr-reviewer browser extension
status: final
updated: 2026-11-26
design: DESIGN.md
sources:
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/prds/prd-pr-reviewer-2026-11-24/prd.md
  - _bmad-output/planning-artifacts/architecture/architecture-pr-reviewer-2026-11-25/ARCHITECTURE-SPINE.md
  - packages/cli/static/
  - docs/web-app.md
---

# pr-reviewer browser extension — Experience Spine

## Foundation

A Chromium extension (Manifest V3, Side Panel API, Chrome 116+) for GitHub PR pages on github.com and on Enterprise hosts the user adds. Two surfaces: the **side panel**, where everything happens, and the **Review button** placed in the PR page header. No UI framework is assumed; the panel reuses the review page's components and tokens (`DESIGN.md`), and its Step list renders only from the engine's run events (AD-16).

Three ways to run a review, chosen in setup and shown in the header's Mode chip:

- **Standalone**: the engine runs inside the panel page with the user's own AI API key (Anthropic or OpenAI-compatible) and GitHub sign-in. Checks that need a Sandbox (compile, lint) do not run and are labelled. Ships first (Release 4).
- **Web App**: the user's team's self-hosted Web App runs the full review; the extension holds only a session for it and no AI key. (Release 4.x.)
- **This computer**: a paired local `pr-reviewer` CLI runs the full review with whatever AI the CLI is configured with. Because the run happens in the CLI Channel on the user's machine (AD-16: the companion is a remote engine), CLI rules apply, including the user's own Claude Code or Codex subscription; the extension never sees that login. The PRD's subscription table lists the extension as "Not available"; this reading is flagged for a PRD update (Open Questions). (Release 4.x.)

PR data always comes from the GitHub API or the backend, never from reading GitHub's page. Two cosmetic page reads are allowed: finding where to place the Review button, and GitHub's colour mode so the button matches it. If either fails, nothing breaks: the toolbar icon still works and the button falls back to the OS theme.

## Information Architecture

| Surface | Reached from | Purpose |
|---|---|---|
| Welcome and consent | First open of the panel | What the extension sends and stores where; choice of Standalone, Web App, or This computer |
| Setup: Standalone | Welcome, Settings | GitHub sign-in (device code, or a token), AI provider and key, test both |
| Setup: Web App | Welcome, Settings | Web App URL, sign in through it |
| Setup: This computer | Welcome, Settings | Pairing code from `pr-reviewer`, confirm the computer |
| PR home | Review button, toolbar icon, shortcut, following the tab | The PR in the current tab: Review, or its last review |
| Run in progress | Review | Step list, cancel |
| Report | Run finished, PR home | Coverage block, findings to select, Details disclosure |
| Post | Report ("Post to GitHub") | Review type, preview, post, result |
| Not a PR | Any non-PR tab | Says the panel works on PR pages; lists recent reviews |
| Settings | Header settings button | Mode and connection, GitHub identity, AI key, Enterprise hosts, stored reviews, privacy |

One surface at a time below the fixed header. Back returns from Post to Report and from Settings to where the user was. The only dialogs are the post confirmation in This computer mode (PRD FR-37) and the clear-stored-data confirmation.

→ Composition references: [mockups/key-welcome-setup.html](mockups/key-welcome-setup.html) (Welcome, Setup: Standalone), [mockups/key-run.html](mockups/key-run.html) (Run in progress), [mockups/key-report.html](mockups/key-report.html) (Report, current and outdated), [mockups/key-post.html](mockups/key-post.html) (Post, preview, posted, refused), [mockups/key-page-button.html](mockups/key-page-button.html) (Review button states). The spines win on conflict.

## Voice and Tone

Microcopy. Brand posture lives in `DESIGN.md`. Same voice as the review page: short, exact, no exclamation marks, says what happens and what does not.

| Do | Don't |
|---|---|
| "Review this PR" | "Let's review! ✨" |
| "Reviewing octo/app#42 with Anthropic (your key)" | "Working on it..." |
| "3 findings · compile, lint: SKIPPED (no Sandbox)" | "Review complete!" |
| "Nothing is posted until you press Post." | "Your review is ready to share!" |
| "Posted 2 inline comments and the summary as @tom." | "Success!" |
| "This review is of an older commit (9f3c2e1). Review again" | "Results may be stale." |
| "Closing this panel stops the review." | "Please don't close the panel." |
| "GitHub refused: the token can read this PR but not comment on it. It needs Pull requests: write." | "An error occurred." |
| "AI key: Anthropic rejected it (401). Check the key or create a new one." | "Invalid key." |

Statuses keep the engine's words and reasons (PASSED, FAILED, SKIPPED (no Sandbox)…), as the CLI and review page do; the coverage headline does the explaining.

## Component Patterns

Behavioral. Visual specs live in `DESIGN.md` Components under the same names.

| Component | Use | Behavioral rules |
|---|---|---|
| Review button | PR pages | Exactly one per page, inserted in DOM order beside GitHub's header actions (no tabindex, no absolute positioning); follows client-side navigation between PRs and tabs; within the same PR it is not re-rendered. Label from the extension's own stored data: "Review" (never reviewed, or the last run was stopped), "Reviewing…", "3 findings" / "No findings" (current review), "Outdated" (head moved). Label changes update the text in place so focus is kept. Click opens the panel and starts a review only in the "Review" state; otherwise it shows the run or the Report. If no place is found, nothing is shown and the toolbar icon still works. |
| Mode chip | Panel header | Always visible; text states mode and health. Click opens Settings at the connection section. |
| Step list | Run in progress | Renders only from run events in `seq` order (AD-16); re-attaching to a backend run replays them silently and shows the current state. Cancel asks nothing, stops the run, and leaves PR home with "Review cancelled. Review again". |
| Finding card | Report | Checkbox includes it in the post (all included by default, except dismissed and pre-existing, which come last, excluded and labelled). path:line is a real link to the Files changed anchor that the panel opens in the current tab (Ctrl/Cmd-click opens a new tab); the panel stays open and keeps focus. Recommendation and suggested change are behind a disclosure. Cards themselves are not focusable. |
| Findings toolbar | Report | Counts by severity, Select all / none, filter by severity. Selection survives filtering; an empty filter result says "No MAJOR findings" with a way to clear the filter. |
| Coverage block | Report | Overall Status, the coverage headline, checks that did not run with reasons (Standalone always names the Sandbox checks), and gate reasons when the gate failed. |
| Details disclosure | Report | Walkthrough, checks table, related code shown to the AI, learnings used, tokens and cost. Collapsed by default. |
| Post panel | Post | Review type (Comment, or Request changes only when allowed); "Preview post" builds the preview (inline comments, still open, resolved, findings moved to the summary over the inline limit, the summary); the Post button appears only after a preview and is labelled with the counts. Zero findings included posts the summary only, and the button says so. Never Approve. Posting disables the button ("Posting…"). Before posting, the head commit is re-read; if it moved, posting stops and offers Review again (AD-23). If the preview changed on the server since it was shown, the new preview is shown and Post waits for the user again. |
| Outdated banner | Report | Shown when the PR's head moved since the review; "Review again" is the primary action; posting is off, with the reason shown beside the button. |
| Input | Setup surfaces | Key, token, URL and code fields. Key "Test" makes one small call and reports success or the provider's error; saved only after a successful test. Errors are tied to their field; entered values are kept. |
| Device code | Setup: Standalone | Shows the code, a Copy button and the expiry time; opens github.com's device page in a new tab; polls until approved, denied or expired; "Get a new code" replaces it in one action. |

## State Patterns

| State | Surface | Treatment |
|---|---|---|
| First open | Welcome | Consent text and the three mode choices; nothing is stored until the user picks one. |
| Not set up, review asked | Review button / PR home | Panel opens on Welcome with "Set up to review octo/app#42"; after setup it returns to that PR and starts. |
| Loading | PR home, Report | "Loading octo/app#42…" in place of the content while PR details or a stored Report load; the Mode chip shows "Checking…" until the connection check ends. |
| Offline | All | Mode chip "Offline"; Review and Post off with the reason; stored Reports stay readable. |
| Not a PR page | Not a PR | "Open a pull request to review it." Below: recent reviews (PR, status, when), each opening the PR; with none, "No reviews yet." |
| PR never reviewed | PR home | PR title, author, head commit; "Review this PR" (primary). |
| PR closed, merged or draft | PR home | Same, with the PR's state shown; reviewing is allowed; Post says GitHub may refuse comments on a closed PR. |
| PR reviewed, current | PR home | Goes straight to that Report. |
| PR reviewed, head moved | Report | Outdated banner, posting off, "Review again". |
| Running | Run in progress | Step list, provider and model, elapsed time, Cancel. Standalone adds "Closing this panel stops the review." Web App / This computer: "You can close the panel; the review keeps running." |
| Standalone run, user switches tab or PR | Any | The run keeps going in the panel page. The panel follows the tab and shows a strip "Reviewing octo/app#42 in the background · Show"; the Review button on #42 reads "Reviewing…". Returning shows progress, or the Report when done. |
| Panel reopened during a backend run | Run in progress | Re-attaches and shows the current state. |
| Panel closed during a Standalone run | PR home (next open) | "The last review was stopped when the panel closed." Review again. The Review button returns to "Review". |
| Run cancelled | PR home | "Review cancelled." Review again; the previous Report, if any, stays available. |
| Run failed | PR home | The reason in plain words (GitHub unreachable or rate-limited until a time, network lost, the backend run ended, configuration not supported), Retry, and the previous Report if any. |
| AI layer failed or rate-limited | Report | AI layer shows ERROR with the reason (never PASSED); deterministic results are shown; Retry offered. |
| No findings | Report | "No findings." plus the Coverage block, so a clean result never hides checks that did not run. |
| Sign-in or key expired | Mode chip + PR home | Chip "Standalone · signed out"; PR home says what failed and links to the setup step that fixes it. |
| Backend unreachable | Mode chip + PR home | "Can't reach your Web App at review.team.example" / "pr-reviewer on this computer isn't running. Start it with: pr-reviewer serve --pair." Offers Standalone if it is set up. |
| Posting | Post | Button shows "Posting…" and is off; no second submission. |
| Posted | Post | Result line with links to the review and summary on GitHub; the Report marks posted findings. |
| Already posted | Post | "Already posted for this commit; nothing new was posted." with the link. |
| Posting refused | Post | GitHub's reason in plain words with the permission or authorisation needed; selection and preview kept; "Try posting again". |
| Device code waiting / expired / denied | Setup: Standalone | Waiting shows the expiry time; two minutes before expiry it offers a new code; expired: "This code expired. Get a new code"; denied: "Sign-in was declined on GitHub." with Try again and Use a token instead. |
| Testing key | Setup: Standalone | Test shows "Testing…" and is off until the answer. |
| Web App URL problems | Setup: Web App | Not HTTPS: refused with the reason; unreachable; not a pr-reviewer Web App; incompatible version ("This Web App runs pr-reviewer 3.x; the extension needs 4.x"). |
| Pairing code wrong or expired | Setup: This computer | "That code didn't match" / "That code expired. Run pr-reviewer serve --pair again." The field keeps focus. |
| Enterprise host permission declined | Settings | "Chrome did not allow access to github.example.com, so PRs there can't be reviewed." with Try again. |
| Private repository, Standalone | PR home | If the GitHub sign-in cannot read the repository, say which access is missing. |

## Interaction Primitives

- **Open the panel**: the Review button, the toolbar icon, or the keyboard shortcut (default Alt+Shift+R; changeable in Chrome's shortcut settings).
- **Follow the tab**: the panel shows the PR in the active tab of its window; switching tabs or PRs switches the panel. A Standalone run in progress continues in the background (State Patterns). Navigation within the same PR (Conversation, Files changed, anchors) never re-renders the panel.
- **Keyboard**: everything reachable by Tab in reading order. Selection toggles only through the native checkbox. path:line links open with Enter. Disclosures are native `<details>`/`<summary>` with names unique per finding ("Recommendation for Retries without backoff"). Esc closes a dialog (cancelling it) or returns from Post and Settings, only when focus is not in a text field or select; on Run in progress Esc does nothing.
- **One review at a time per PR**; starting another while one runs is not offered. Different PRs may run at once.
- **Preview before Post** in every mode; posting is never one keystroke from the Report.
- **Banned**: automatic posting, Approve, hover-only actions, reading GitHub's page beyond placing the button and reading its colour mode, opening windows or tabs except for sign-in and the diff link (and Ctrl/Cmd-click on it).

## Accessibility Floor

Behavioral. Visual contrast and targets live in `DESIGN.md` (Colors contrast table; Layout & Spacing). Target: WCAG 2.1 AA, a UX decision extending the PRD's Web App NFR (§4.7) to the extension; flagged for the PRD.

**Structure**
- The panel has `<header>` and `<main>`; each surface has exactly one `h1` (`tabindex="-1"`, the focus target); finding titles are headings below it. `document.title` names the surface ("Report: octo/app#42, pr-reviewer").
- Scroll containers inside the panel (suggested change, preview, checks table) are focusable regions with a name.

**Focus**
- Focus moves to the new surface's `h1` only when the user's own action in the panel changed the surface.
- On automatic changes (run finished, tab followed, setup returning to a PR), focus stays where it is if that element still exists; otherwise it moves to the new `h1`. The change is announced in the status region.
- When the focused control disappears (Cancel at the end of a run), focus goes to the new `h1`, never to the document body.
- Dialogs are native modal dialogs: initial focus on Cancel, Esc cancels, focus returns to the button that opened them.

**Announcements**
- One visually hidden status region per panel (`role="status"`). The Step list and elapsed time are not live. During a run it says only layer start and finish ("AI review running", "Compile: SKIPPED, no Sandbox"), merging events that arrive within 3 seconds, and the final result once ("Review finished: PASSED_WITH_WARNINGS, 3 findings"). Re-attaching announces only the current state.
- The status region also announces: key test success, save, preview ready, posted, filter results ("Showing 2 of 5 findings"), selection count ("3 of 5 included"), tab followed ("Showing octo/app#43"), code copied, opening a finding in the page ("Opened src/retry.ts:42 in the page").
- `role="alert"` for: run failed, key test failed, posting refused, sign-in or key expired, backend unreachable.

**Review button**
- A real `<button>`. Its accessible name starts with the visible label, followed by the product: "Review this PR, pr-reviewer", "3 findings, pr-reviewer", "Outdated, pr-reviewer". Built from the visible text plus a visually hidden suffix so the two cannot drift.
- On activation it announces, from a live region in its own shadow root: "Opened in the pr-reviewer side panel. Press F6 to move there." (the key Chrome uses for pane cycling, verified on 116+). Welcome states the key once. When the panel opens it puts focus on its `h1`, so arriving there lands on the heading.
- If GitHub re-renders the header while the button has focus, focus returns to the new instance.

**Controls and content**
- Finding checkboxes are labelled "Include in post: MAJOR Retries without backoff, src/retry.ts:42"; the label wraps the checkbox column so the target is larger than the box.
- path:line links: accessible name "src/retry.ts line 42, open in the page".
- Severity and status are always in text; the Mode chip states health in words.
- Steps carry a state word (Waiting, Running, Done, Failed, Skipped); glyphs are hidden from assistive technology.
- Disabled actions with a reason use `aria-disabled="true"`, stay focusable, and are described by their reason ("Posting is off: this review is of an older commit").
- Setup errors: the field gets `aria-invalid` and is described by the error, which starts with the field name and says what to do; focus moves to the first failed field; entered values are kept. The pairing-code field states its format and length and turns autocomplete off.

**Time limits**
- Codes show their expiry as text ("Expires at 14:32"). Two minutes before expiry, a polite announcement offers "Get a new code". After expiry the screen stays, says the code expired, and gets a new one in one action without losing anything entered.
- The device code's accessible name spells it character by character.

**Motion, zoom, forced colours**
- Under reduced motion: no transitions, the running ring is static, scrolling is instant.
- Works at 320px and at 200% zoom without horizontal scrolling; the header wraps and the chip truncates its host visually but keeps the full text in its name.
- In forced-colors mode, controls keep visible borders and focus (system colours), and the state text carries meaning without the dot or logo.

## Credentials and Consent

Product-specific: store policy and the PRD §4.8 credential NFR make this part of the experience.

- The Welcome screen states, before anything is entered: what is sent to GitHub, what is sent to the AI provider (the PR's diff and files, with detected secrets removed), that nothing goes anywhere else, that recent reviews (including short code excerpts) are kept in this browser until cleared, and a link to the privacy policy.
- Keys and tokens are entered only in the panel (never on the page), shown masked, stored where page scripts cannot read them, encrypted at rest, sent only over HTTPS to their own service, and removable in Settings with one action each.
- In Web App and This computer modes the extension never asks for an AI key.
- Pairing with This computer: the user runs `pr-reviewer serve --pair` [ASSUMPTION: command name; the CLI does not have it yet], which prints a short code valid for at least 10 minutes; the panel asks for it and shows the computer's name to confirm. Every post in this mode asks for confirmation in the panel (PRD FR-37).
- Adding an Enterprise host asks Chrome for permission for that host only, at the moment the user adds it.
- Settings → Stored reviews shows how many are kept and clears them (with confirmation).

## Responsive & Platform

Panel widths 320–640px, single column; the stacking rule below 360px is in `DESIGN.md` Layout & Spacing. Chromium browsers only in v1 (Chrome, Edge, Brave, Arc where the Side Panel API exists). Firefox and Safari are out of scope (PRD).

## Inspiration & Anti-patterns

- **Lifted from pr-reviewer's own review page**: the select-preview-post flow, the Step list, the Coverage block, honest statuses. The extension is that page in a narrower frame, not a new product.
- **Rejected: an overlay or comments drawn into GitHub's diff**: depends on GitHub's page structure (the PRD forbids it) and breaks with every redesign. Findings link to the diff instead.
- **Rejected: auto-review on page open**: costs the user's tokens without asking. A review starts only from a click.
- **Rejected: a chat box**: the panel shows a review; questions belong in the user's own coding agent (`pr-reviewer mcp`).

## Key Flows

### Flow 1 — Tom checks a PR link someone pasted in chat (UJ-4)

1. Tom, a backend developer, opens a PR link a teammate pasted in chat. He installed the extension yesterday and has not set it up.
2. The Review button sits in the PR header. He clicks it; the panel opens on Welcome: "Set up to review octo/app#42."
3. He reads what is sent and stored where and picks Standalone. "Sign in with GitHub" shows a code; he enters it on github.com in the tab that opens and approves.
4. He chooses Anthropic, pastes his API key, presses Test ("Works: claude-opus-5-5 answered"), and saves.
5. The panel returns to octo/app#42 and starts: the Step list fills in, AI review runs, "Compile and lint: SKIPPED (no Sandbox)".
6. The Report: PASSED_WITH_WARNINGS, 3 findings. He opens `src/retry.ts:42` on the first; the tab jumps to that line in Files changed while the panel keeps his place. He agrees with two and unticks the third.
7. He opens Post, presses Preview post, reads the two inline comments and the summary, and presses "Post 2 inline comments and the summary."
8. **Climax:** "Posted 2 inline comments and the summary as @tom." The two comments appear on the PR in the tab beside him, on the lines he checked, and he never left the page.

Failure: his token can read but not comment (an org SSO block). Posting stops with GitHub's reason and the authorisation needed; his selection is kept for after he fixes it.

### Flow 2 — Tom comes back to an updated PR (FR-36)

1. Two days later Tom switches to a tab with octo/app#42 again. The Review button reads "Outdated"; the author has pushed twice.
2. The panel follows the tab: the Report appears under the Outdated banner: "This review is of an older commit (9f3c2e1)."
3. Post is off, with the reason beside it. He presses Review again.
4. **Climax:** the new Report shows one earlier finding as resolved and nothing posted twice; the summary comment on GitHub will update in place when he posts.

Failure: the author pushes again between Tom's preview and Post. Posting stops ("The PR moved to b71d004 since this review") and offers Review again.

### Flow 3 — Sofia uses Meera's team Web App from the PR page (UJ-3, FR-37)

1. Sofia is on Meera's team, which self-hosts the Web App. In Settings she picks Web App, enters its URL, and signs in through it with GitHub; she enters no AI key in the extension.
2. On a PR she clicks Review. The Mode chip reads "Web App · review.team.example."
3. The Step list shows compile and lint running in the Web App's Sandbox. She closes the panel to read the diff.
4. She reopens it a minute later; it re-attaches and shows the finished run.
5. **Climax:** the Report includes a FAILED compile check with the compiler's message next to the AI findings: the full review the team's Web App gives, without leaving GitHub.

Failure: the Web App is down. The chip reads "Web App · unreachable"; PR home says it cannot reach the Web App and offers Standalone if she set it up.

### Flow 4 — Priya pairs the CLI on her laptop (FR-37)

1. Priya already uses `pr-reviewer` in her terminal with her Claude subscription through Claude Code. In the panel she picks This computer.
2. The panel tells her to run `pr-reviewer serve --pair`. The terminal prints a code; she types it into the panel, which shows her computer's name; she confirms.
3. She reviews a PR; the review runs in her CLI with her usual settings, including tool checks when Docker is running.
4. She includes four findings, previews, and presses Post; the panel asks "Post 4 inline comments as @priya from pr-reviewer on priya-mbp?" and she confirms.
5. **Climax:** the same review she would get in her terminal, started and posted from the PR page, with nothing about her AI login ever touching the browser.

Failure: she typed the code after it expired. "That code expired. Run pr-reviewer serve --pair again." She reruns it and pairs. Another day Docker is not running: compile and lint show SKIPPED (no Sandbox) with the reason, as in the terminal.

## Assumptions

Drafted on the fast path; each is open to correction (decision log in `.memlog.md`).

- Panel body text 0.875rem (the review page uses 15px) for density at panel width.
- The panel follows the OS theme; the Review button follows GitHub's.
- The last review of each of the 50 most recent PRs is kept locally.
- Keyboard shortcut Alt+Shift+R.
- Standalone providers: Anthropic and OpenAI-compatible API keys.
- `pr-reviewer serve --pair` as the pairing command; pairing code valid at least 10 minutes.
- F6 as Chrome's key for moving into the side panel (verify on Chrome 116+).

## Open Questions

- PRD update: the subscription table should say subscriptions are available through a paired local CLI (This computer), and WCAG 2.1 AA should be stated for the extension.
- Architecture: local storage of recent Reports (the architecture lists the extension cache as "none"); pairing protocol details (code length and lifetime, re-pairing after restarts).
