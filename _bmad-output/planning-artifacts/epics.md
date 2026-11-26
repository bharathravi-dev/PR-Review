---
status: final
stepsCompleted: [1, 2, 3, 4]
updateScope: 'Epic 7 stories (2026-11-26) from the extension UX contract; Epic 9 added from review-page feedback; Epics 1-6 and 8 unchanged'
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-pr-reviewer-2026-11-24/prd.md
  - _bmad-output/planning-artifacts/prds/prd-pr-reviewer-2026-11-24/addendum.md
  - _bmad-output/planning-artifacts/architecture/architecture-pr-reviewer-2026-11-25/ARCHITECTURE-SPINE.md
  - additional_info.md
  - _bmad-output/planning-artifacts/ux-designs/ux-pr-reviewer-2026-11-26/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-pr-reviewer-2026-11-26/EXPERIENCE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-pr-reviewer-review-page-v2-2026-11-26/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-pr-reviewer-review-page-v2-2026-11-26/EXPERIENCE.md
---

# PR Reviewer - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for PR Reviewer, decomposing the requirements from the PRD and the Architecture Spine into implementable stories. Release 1 is CLI-only. The Browser Extension (Epic 7, R4) has a UX design contract (`ux-designs/ux-pr-reviewer-2026-11-26/`: DESIGN.md, EXPERIENCE.md, mockups); its UX Design Requirements are listed below.

## Requirements Inventory

### Functional Requirements

FR1: Accept any GitHub PR reference (URL or owner/repo#n) on github.com or a configured Enterprise host; no hardcoded repo/org/host; missing permissions reported, no partial Publish.
FR2: Retrieve complete PR context (metadata, files, hunks, contents, reviews, rules, configs) with pagination, truncation, binary/renamed/deleted files, forks, private repos; pin to Head Commit; superseded runs don't Publish.
FR3: Detect languages, frameworks, versions, projects (monorepo-aware) from evidence; select Validators per project; version-aware rules (Angular 12+); labelled best-effort for unsupported tech.
FR4: Report each Validation Layer with a Layer Status; use repo tool configs or named defaults; only new/worsened code counts toward the gate; one Validator's failure degrades only its layer; Coverage in headline; per-Validator timeout and concurrency limit.
FR5: Reuse existing CI/static-analysis results for the same Head Commit; never from older commits.
FR6: AI contextual review with structured context and guardrails; no fabricated paths/lines; injection attempts reported not obeyed; LOW-confidence findings advisory; AI-only findings don't fail the gate by default.
FR6a: AI calls are text-in, schema-out, tool-less; agent CLIs run tool-less outside the checkout without repo agent config or Credentials; only the engine Publishes.
FR6b: Secret scanning before prompt building; secret values redacted from AI requests; reported by location only.
FR7: Normalise, deduplicate (stable fingerprints), prioritise Findings; evaluate Quality Gate to an Overall Status.
FR8: Report as Markdown and JSON (schema).
FR9: Supported AI Providers: Anthropic API, Claude Code subscription, OpenAI API, Codex subscription, Gemini (API key), OpenRouter, Azure OpenAI, Bedrock, Ollama; conformance suite.
FR9a: Custom OpenAI/Anthropic-compatible endpoints via Configuration only.
FR10: Subscription Providers only via the vendor's own CLI and only in permitted Channels (CLI yes; Auto-Review opt-in with warning; Web App/Extension no); never read/proxy subscription tokens.
FR11: Default provider/model, per-run override, ordered fallback; Report names provider/model per AI Finding.
FR12: Token usage and cost estimate per run; per-run and monthly ceilings; reaching one → AI layer SKIPPED (cost ceiling reached).
FR13: Layered Configuration (defaults → user → repo → per-run) with repo config limited to review-policy keys, read from base branch; mandatory settings only from user config; print resolved config with sources.
FR14: Review Rules from repo, user config, or URL/file; checklist in Report; repo rules untrusted, user rules win.
FR15: Credentials from keychain, env, or vendor CLI login; never in repo config, Reports, logs, prompts, comments; never exposed to Sandbox.
FR16: Guided setup detecting gh, Claude Code, Codex, env keys; validates each; writes user config.
FR16a: Migration from review.mjs (rules files, secret names, flag mapping).
FR17: Publish one review: summary (status, Coverage, technologies, layers, findings, skipped checks, disclosure) + inline comments on valid lines with §27 fields; sanitised output; max inline comments with overflow in summary.
FR18: COMMENT by default; REQUEST_CHANGES only in manual runs when enabled; never approve/merge.
FR19: Idempotent re-review: no duplicate per Head Commit; whole-PR gate; update own summary; list resolved; inline only new/changed; never touch human comments; recognise own output by hidden marker.
FR20: Reviewer Identity defaults to the user; optional bot identity.
FR20a: Review-requested PRs in Auto-Review get a pending (draft) review by default.
FR20b: Finding feedback (reaction/reply) honoured on later runs; counted for SM-2.
FR21: Optional commit status/check; never overrides branch protection.
FR22: Global npm install and run on macOS/Linux/Windows with supported Node LTS; per-layer progress; prints Report.
FR23: Preview before Publish with confirmation; non-interactive flag.
FR24: Markdown + JSON output to a location; documented exit codes per Overall Status.
FR25: List open PRs for a repo or Watch Scope and pick one; shows reviewed state.
FR25a: Local usage stats from GitHub data (no telemetry).
FR26: One-command Auto-Review enablement (CLI or gh extension) creating automation in the user's account; least-privilege expiring token; self-contained pinned automation; disable removes it.
FR27: Watch Scope (authored, owned repos, review-requested, listed orgs/repos) with filters; org scopes off by default; repo opt-out honoured; non-collaborator PRs on owned repos opt-in.
FR28: Discovery every 30 min by default (configurable); each Head Commit once; optional immediate review on owned repos; drafts skipped unless enabled.
FR29: Visible health via one issue per cause in the automation repo, auto-closed when cleared.
FR29a: Fits GitHub Free CI allowance at defaults; shows estimated usage; never writes PR content to logs/state.
FR30: Web App sign-in with GitHub; per-user privacy; sign-in allow-list; quotas on operator key; narrow OAuth scope; share by link.
FR31: Web App run with live per-layer progress; survives reload.
FR32: Web App Report view of every Report field.
FR33: Web App selective/edited Publish.
FR34: Web App run history and comparison.
FR35: Web App per-user API keys encrypted; no Subscription Providers.
FR36: Extension Review action on GitHub PR pages; side panel progress and Report.
FR37: Extension Standalone mode (own key, no server) and Connected mode (Web App or paired local CLI companion).
FR38: Extension findings link to diff lines; publish selected; independent of GitHub page structure.
FR39: PR code executes only in a Sandbox without Credentials or tokens; Sandbox output untrusted and schema-validated; tool-config changes flagged; Web App Sandboxes isolated.
FR40: Tool-free layers (parsing, secret scan, manifest/lockfile analysis, result reuse, AI) run without a Sandbox.

### NonFunctional Requirements

NFR1: Untrusted input — PR code, text, repo files, tool output never executed outside a Sandbox nor obeyed by the AI.
NFR2: No Credential in any Report, log, prompt, comment, or telemetry; secret values in PRs reported by location only.
NFR3: PR code sent only to the chosen AI Provider; no telemetry by default.
NFR4: Rate limits respected with backoff; incomplete runs end INCOMPLETE/ERROR, never false PASSED.
NFR5: Typical PR reviewed in ≤ 3 min without deterministic layers, ≤ 10 min with.
NFR6: CLI on supported Node LTS, macOS/Linux/Windows.
NFR7: New Validators/Providers/Channels via adapters without core changes.
NFR8: Deterministic layers and fingerprints identical across Channels and runs for the same inputs.
NFR9: Quick-start per Channel: install to first review in < 10 min.
NFR10: Audit record per Review Run (checks run/skipped, tool versions, resolved config, AI usage, gate inputs, what was Published); no source retained.
NFR11: Caching only on unchanged inputs; isolated per repo and user.
NFR12: Validation Capability Spec §36 scenarios within the v1 validator set are release criteria.
NFR13: Extension credentials — in Connected mode the extension stores no AI Provider keys; any Credential it holds (Standalone AI key, GitHub token, backend session) is unreadable by page scripts, encrypted at rest, sent only over HTTPS to its own service, and covered by in-UI consent and a published privacy policy. (PRD §4.8)
NFR14: Extension store policy — no remotely hosted code; configuration and data from a backend are treated as data only. (PRD §4.8)

### Additional Requirements

- No starter template: greenfield TypeScript monorepo inside the existing repository (brownfield `review.mjs` kept until CLI parity, then retired per FR16a). Epic 1 Story 1 sets up the workspace. (Spine Stack, Structural Seed)
- pnpm 12 workspaces; TypeScript 7.0 (`module: nodenext`); Node 26 for development, CLI `engines` ≥ 22; Vitest 5; Zod 4 in eval-free mode with generated JSON Schema (draft 2020-12). (Spine Stack)
- Hexagonal architecture: I/O-free isomorphic `core` with ports; lint-enforced import ban and a CSP test without `unsafe-eval`. (AD-1, AD-2)
- Fixed pipeline stages; only `gate` sets Overall Status. (AD-3)
- Single schema source in `core`, `schemaVersion` on artefacts, JSON Schemas published. (AD-4, AD-15)
- Validator contract and registry; sandbox-needing validators run only via SandboxPort. (AD-5)
- API-only context outside the Sandbox; clone only inside it. (AD-6)
- Container Sandbox (Docker/Podman), pinned toolchain image built in repo, install→analyze phases, `--network none` for analyze. (AD-7)
- Provider adapters: anthropic, openai-compatible, claude-code, codex with verified isolation flags and a vendor-CLI version check. (AD-8)
- Single GitHub writer, output sanitising. (AD-9)
- Credential references and redacted Secret objects; redacting logger. (AD-10, AD-17)
- Idempotency key and hidden marker; fingerprints and cache keys as specified. (AD-11, AD-12)
- Config files `$XDG_CONFIG_HOME/pr-reviewer/config.yml` and `.github/pr-reviewer.yml` (base branch), `version: 1`, repo allow-list. (AD-13)
- Auto-Review stateless (GitHub markers), private automation repo, discover → sandbox + review jobs. (AD-14)
- Thin Channels; `gh` extension is a shim; extension Standalone runs in the side panel page. (AD-16)
- CLI exit codes and naming conventions per spine Consistency Conventions.
- Extension: Chrome Manifest V3 with the Side Panel API (Chrome ≥ 116); package `extension/` with its own `src/compose.ts`. (Spine Stack, Structural Seed)
- Extension Standalone runs `core` with the HTTP providers inside the side panel page, not the service worker; `core` stays isomorphic and runs under a CSP without `unsafe-eval`. (AD-1, AD-16)
- Extension Connected mode talks to remote engines through `ReviewService v1` only: the Web App server and the CLI companion (`pr-reviewer serve`, Epic 8); progress renders from `RunEvent`s in `seq` order. (AD-16)
- Before any Publish the head SHA is re-read; a moved head cancels the post. (AD-23)
- Extension Credentials follow AD-10 (references, redacted Secret objects, no Credential in logs or Reports).
- Extension internals (UI framework, bundler, storage per token) are decided at Release 4 within AD-1, AD-10, AD-16 and PRD §4.8. (Spine Deferred)

### UX Design Requirements

Release 1 (CLI) has none; the Web App (Epic 6) was built without a separate UX contract, reusing the review page. The Browser Extension (Epic 7) requirements below come from `ux-designs/ux-pr-reviewer-2026-11-26/` (DESIGN.md = look, EXPERIENCE.md = behaviour; spines win over mockups).

UX-DR1: Panel design tokens — implement DESIGN.md tokens in light and dark (OS theme): the review page palette plus `border-strong` (#7d8794 / #6e7681) for every control edge and `focus-ring-outer`/`focus-ring-inner`; the rem type ramp (title 1rem, heading/body 0.875rem, label 0.75rem, badge 0.6875rem, mono 0.78rem); spacing incl. `panel-gutter` 12px and `target-min` 24px; every pair in the DESIGN.md contrast table meets its target.
UX-DR2: Status and severity mapping — badges per DESIGN.md: BLOCKER/CRITICAL bad, MAJOR warn, MINOR/INFO info; PASSED ok; PASSED_WITH_WARNINGS/INCOMPLETE/WARNING warn; FAILED/ERROR/TIMEOUT bad; SKIPPED/NOT_APPLICABLE/CANCELLED/"Not included" neutral; status always in words.
UX-DR3: Panel header — logo (decorative), "PR Reviewer", Mode chip, settings button; min 44px, wraps under zoom; Mode chip text states mode and health ("Standalone", "Standalone · signed out", "Web App · <host>", "Web App · unreachable", "This computer", "Checking…", "Offline"); chip click opens Settings at the connection section.
UX-DR4: Welcome and consent — before anything is entered: what goes to GitHub, what goes to the AI provider (diff and files with secrets removed), nothing else, recent reviews incl. short code excerpts kept in the browser until cleared, privacy policy link, F6 hint; three mode choice cards (Standalone / My team's Web App / This computer, radio semantics); nothing stored until a mode is chosen; "Set up to review <pr>" when opened from a PR, returning there and starting after setup.
UX-DR5: Setup: Standalone, GitHub — device-code sign-in (code in mono, Copy, "Expires at hh:mm", opens github.com device page, polls; two minutes before expiry a polite offer of a new code; expired and denied states with one-action recovery; code name spelled character by character) and "Use a token instead" (fine-grained token, exact permissions listed; required for Enterprise hosts).
UX-DR6: Setup: Standalone, AI — provider (Anthropic or OpenAI-compatible) and masked key Input; Test makes one small call ("Testing…", then "Works: <model> answered" or the provider's error tied to the field); saved only after a successful test.
UX-DR7: Setup: Web App — URL Input; HTTPS only; unreachable / not a pr-reviewer Web App / incompatible version states; sign-in through the Web App's GitHub sign-in; never asks for an AI key.
UX-DR8: Setup: This computer — instructs `pr-reviewer serve --pair` [assumed command]; pairing-code Input (format and length stated, autocomplete off); shows the computer's name to confirm; wrong and expired code states keep focus in the field.
UX-DR9: PR home and follow-the-tab — panel shows the PR of its window's active tab; navigation within the same PR never re-renders; states: Loading ("Loading <pr>…"), never reviewed ("Review this PR"), closed/merged/draft (state shown, posting caveat), current review (goes to Report), private repo access missing; Not a PR surface with recent reviews (or "No reviews yet.").
UX-DR10: Run in progress — Step list rendered only from RunEvents in seq order, each step with a state word and glyph (Waiting ·, Running ring, Done ✓, Failed ✕, Skipped –); provider, model, elapsed time; Cancel → PR home "Review cancelled."; Standalone note "Closing this panel stops the review." vs backend "You can close the panel; the review keeps running."; reattach to backend runs; "stopped when the panel closed" state; Run failed state (plain reason, Retry, previous Report kept).
UX-DR11: Background Standalone run — switching tab or PR keeps the run going; the panel follows the tab with a "Reviewing <pr> in the background · Show" strip; the PR's Review button reads "Reviewing…"; returning shows progress or the Report.
UX-DR12: Report — Coverage block (Overall Status badge, coverage headline, not-run list with reasons — Standalone always names Sandbox checks — and gate reasons when failed); Findings toolbar (severity counts, Select all / none, severity filter, selection survives filtering, empty filter result); Details disclosure (walkthrough, checks table, related code, learnings, tokens and cost; collapsed); "No findings." still shows the Coverage block; AI layer ERROR with Retry.
UX-DR13: Finding card — native checkbox labelled "Include in post: <SEVERITY> <title>, <path>:<line>" (label wraps the column); path:line is a real underlined link to the Files changed anchor opened in the current tab (Ctrl/Cmd-click new tab), panel keeps focus and announces it; Recommendation/suggested change in a native disclosure named per finding; excluded cards (unticked, dismissed, pre-existing) keep full contrast with a dashed `border-strong` edge and a "Not included" / "Dismissed" / "Pre-existing" badge; dismissed and pre-existing excluded by default and listed last.
UX-DR14: Outdated Report — Outdated banner when the head moved, "Review again" primary; Post shown off via aria-disabled with the reason beside it.
UX-DR15: Post panel — review type (Comment; Request changes only when allowed; never Approve); "Preview post" builds the preview (new inline, still open, resolved, findings moved to the summary over the inline limit, summary in a preview block); Post button appears only after a preview and is labelled with counts; zero included posts the summary only; "Posting…" disables it; head re-read before posting (moved → stop, Review again); preview changed on the server → new preview, wait for the user; result lines: posted (links), already posted for this commit, refused (GitHub's reason and the permission needed; selection and preview kept; "Try posting again"); in This computer mode a native confirmation dialog before posting.
UX-DR16: Review button on the PR page — one instance inserted in DOM order beside the header actions, follows client-side navigation, not re-rendered within the same PR; labels "Review" / "Reviewing…" / "<n> findings" / "No findings" / "Outdated" from stored data, updated in place; click starts a review only in "Review", else opens the run or Report; follows GitHub's colour mode (OS fallback); own styles only; two-tone focus ring; forced-colors border and outline; accessible name = visible label + ", pr-reviewer"; on activation announces "Opened in the pr-reviewer side panel. Press F6 to move there."; focus restored if GitHub re-renders; absent (toolbar icon still works) when no placement is found.
UX-DR17: Opening the panel — toolbar icon and a Chrome command (default Alt+Shift+R, user-changeable); the panel focuses its h1 when it opens.
UX-DR18: Settings — mode and connection, GitHub identity, remove AI key and tokens (one action each), Enterprise hosts (optional host permission requested at add time; declined state), stored reviews (count, clear with a native confirmation dialog), privacy policy.
UX-DR19: Local review store — the last review of each of the 50 most recent PRs kept in the browser (feeds follow-the-tab, the Review button label and Not a PR's recent list); cleared from Settings. [assumed size; architecture to confirm storage]
UX-DR20: Global states — Offline (chip "Offline", Review and Post off with reason, stored Reports readable); sign-in or key expired (chip, PR home links the fixing step); backend unreachable (message per backend kind, offer Standalone when set up).
UX-DR21: Accessibility structure and focus — header/main landmarks; one h1 per surface (tabindex -1) as focus target; document.title per surface; focus moves only on user-initiated surface changes, stays on automatic ones (else h1), never to body; focusable named scroll regions; native modal dialogs (initial focus Cancel, Esc cancels, focus returns).
UX-DR22: Announcements — one visually hidden role=status region: during runs only layer start/finish merged within 3 s plus the final result once (step list and timer not live; reattach announces current state only); also key test success, save, preview ready, posted, filter and selection counts, tab followed, code copied, finding opened; role=alert for run failed, key test failed, posting refused, sign-in/key expired, backend unreachable.
UX-DR23: Keyboard, motion, zoom — Tab in reading order; selection only via checkboxes; cards not focusable; Esc returns from Post/Settings or cancels a dialog, never in text fields/selects, never cancels a run; reduced motion (static ring, no transitions, instant scroll); 320px and 200% zoom without horizontal scroll (stacking below 360 CSS px); 24×24 px minimum targets; forced-colors support; underlined links everywhere.
UX-DR24: Voice and tone — microcopy per EXPERIENCE.md Voice and Tone; engine status words with reasons (e.g. "SKIPPED (no Sandbox)"); errors start with the field name and say what to do.
UX-DR25: Review page parity — adopt the extension's accessibility deltas in `packages/cli/static` (border-strong control edges, excluded finding card instead of opacity, underlined links) so both surfaces stay one product.

User feedback on the review page (2026-11-26, screenshot of `pr-reviewer serve` on a real PR with 22 findings): "looking dull, and not using the capabilities the UI brings; it should follow the latest UI trends. Keep this version, and add a version 2." Observed in that screenshot: 20 of 22 findings were pre-existing TSLint style rules shown first, ticked for posting, and labelled MAJOR, burying the 2 AI correctness findings.

UX-DR26: Signal before noise on the review page and Web App — new findings first, ordered by severity; pre-existing findings collapsed into one counted group ("20 pre-existing · show") and excluded from the post by default (as the extension already specifies in UX-DR13); the headline counts new findings separately from pre-existing ones.
UX-DR27: Review page v2 — a redesigned review page (and Web App page) following a new `bmad-ux` v2 pass whose visual direction the user chooses from rendered options; v1 ("classic", today's page) stays available and selectable; both use `ReviewService v1`, with additive read routes only (v2 adds `GET /v1/runs/:id/hunks`). Design contract: `ux-designs/ux-pr-reviewer-review-page-v2-2026-11-26/` (final).

### FR Coverage Map

FR1: Epic 1 - any PR reference, no hardcoded hosts
FR2: Epic 1 - complete PR context pinned to Head Commit
FR3: Epic 4 - technology and version detection
FR4: Epic 4 - layered validation with honest Layer Status and Coverage
FR5: Epic 4 - reuse existing CI / SonarQube results
FR6: Epic 1 - AI contextual review with guardrails
FR6a: Epic 1 - tool-less, schema-out AI calls (CLI-agent hardening in Epic 3)
FR6b: Epic 1 - secrets redacted before prompts
FR7: Epic 1 - normalise, dedupe, gate (fingerprints extended in Epic 4)
FR8: Epic 1 - Markdown + JSON Report
FR9: Epic 3 - supported AI Providers
FR9a: Epic 3 - custom endpoints via config
FR10: Epic 3 (CLI channel) / Epic 5 (Auto-Review opt-in) - subscription providers
FR11: Epic 3 - provider selection and fallback
FR12: Epic 3 - usage, cost, ceilings
FR13: Epic 1 (user config) / Epic 4 (repo config allow-list) - layered Configuration
FR14: Epic 4 - Review Rules and checklist
FR15: Epic 1 - Credential handling
FR16: Epic 3 - guided setup
FR16a: Epic 2 - migration from review.mjs
FR17: Epic 2 - publish summary + inline comments, sanitised
FR18: Epic 2 - safe review event
FR19: Epic 2 - idempotent re-review via markers
FR20: Epic 2 - Reviewer Identity
FR20a: Epic 5 - pending reviews for review-requested PRs
FR20b: Epic 2 - Finding feedback
FR21: Epic 2 - optional commit status
FR22: Epic 1 - install and run the CLI
FR23: Epic 2 - preview before Publish
FR24: Epic 1 - automation-friendly output and exit codes
FR25: Epic 2 - list and pick PRs
FR25a: Epic 2 - local usage stats
FR26: Epic 5 - one-command Auto-Review enablement
FR27: Epic 5 - Watch Scope
FR28: Epic 5 - discovery cadence
FR29: Epic 5 - visible health
FR29a: Epic 5 - free-tier fit, no PR content in logs
FR30: Epic 6 - Web App sign-in and isolation
FR31: Epic 6 - run and watch
FR32: Epic 6 - Report view
FR33: Epic 6 - selective Publish
FR34: Epic 6 - history
FR35: Epic 6 - server-side BYO keys
FR36: Epic 7 - review from the PR page
FR37: Epic 7 - Standalone and Connected modes
FR38: Epic 7 - findings in context
NFR13, NFR14: Epic 7 - extension credentials and store policy
UX-DR1–UX-DR24: Epic 7 - extension UX contract (ux-designs/ux-pr-reviewer-2026-11-26)
UX-DR25, UX-DR26, UX-DR27: Epic 9 - review page that shows what matters first; v2 alongside classic
FR39: Epic 4 - Sandbox-only execution
FR40: Epic 4 - tool-free layers

## Epic List

### Epic 1: Review a PR from my terminal (Release 1)
A user installs the CLI, points it at any GitHub PR, and gets a trustworthy Report (Markdown and JSON) from an AI review grounded in the PR's real context — with secrets redacted and the AI unable to act. Replaces today's `review.mjs` read path on the new architecture.
**FRs covered:** FR1, FR2, FR6, FR6a, FR6b, FR7, FR8, FR13 (user config), FR15, FR22, FR24

### Epic 2: Publish safe, non-duplicated reviews to GitHub (Release 1)
A user previews and posts the Report as one GitHub review with precise inline comments, re-runs on new pushes without duplicates, lists PRs with their reviewed state, sees which Findings were acted on, and migrates from the old tool.
**FRs covered:** FR16a, FR17, FR18, FR19, FR20, FR20b, FR21, FR23, FR25, FR25a

### Epic 3: Use whichever AI I already have (Release 1)
A user reviews with an API key from Anthropic or OpenAI, any OpenAI/Anthropic-compatible endpoint (OpenRouter, Ollama, Azure), or their own Claude Code / Codex subscription — set up in one guided flow, with fallback and cost ceilings.
**FRs covered:** FR9, FR9a, FR10 (CLI), FR11, FR12, FR16

### Epic 4: Real tool checks with honest status (Release 1)
A user gets compiler, lint, framework, secret, and dependency results for JS/TS, Angular 12+, and React PRs, run safely in a Sandbox, plus reuse of existing CI/SonarQube results — every check reported honestly, with repo-level rules and settings applied safely.
**FRs covered:** FR3, FR4, FR5, FR13 (repo config), FR14, FR39, FR40

### Epic 5: Automatic reviews on my GitHub (Release 2)
A user enables Auto-Review once and every PR in their Watch Scope — including org repos they don't administer — gets reviewed from their own GitHub account, safely, within free limits, with visible health.
**FRs covered:** FR10 (Auto-Review opt-in), FR20a, FR26, FR27, FR28, FR29, FR29a

### Epic 6: Review from a web page (Release 3)
A team self-hosts the Web App; members sign in with GitHub, paste a PR link, watch the run, read the Report in the page, and publish selected Findings.
**FRs covered:** FR30, FR31, FR32, FR33, FR34, FR35

### Epic 7: Review from the GitHub PR page (Release 4; Connected mode 4.x)
A user installs the browser extension and reviews the PR they're looking at. First Standalone with their own key: set up, review, read findings in context, and post selected ones from the side panel, in a store-ready extension. Then Connected to their team's Web App or their own paired `pr-reviewer`, for full reviews including tool checks; this includes the server-side changes that let the Web App and `pr-reviewer serve` accept the extension (token sign-in and pairing). Stories are ordered so the Standalone slice ships before any Connected story; UX-DR21–UX-DR24 apply to every story.
**FRs covered:** FR36, FR37, FR38 · **NFRs:** NFR13, NFR14 · **UX-DRs:** UX-DR1–UX-DR24

### Epic 8: Review from a local page on my machine (Release 1, pulled ahead by course correction 2026-11-25)
A user runs `pr-reviewer serve`, opens a page on their own machine, pastes a PR link or picks an open PR, watches the run, reads the Report, and posts the Findings they select — using the CLI's own credentials and configuration. The server is the CLI companion of AD-16 and implements `ReviewService v1`, so the extension's Connected mode (Story 7.3) reuses it.
**FRs covered:** FR23, FR25 (in the page), and the single-user local form of FR31, FR32, FR33

### Epic 9: A review page that shows what matters first (v2, classic kept)
A user reviewing a PR in `pr-reviewer serve` or the Web App sees the findings that matter first, with noise grouped away, on a redesigned v2 page, and can switch back to today's page ("classic") at any time.
**UX-DRs covered:** UX-DR25, UX-DR26, UX-DR27 · builds on Epics 6 and 8

## Epic 1: Review a PR from my terminal

A user installs the CLI, points it at any GitHub PR, and gets a trustworthy Report (Markdown and JSON) from an AI review grounded in the PR's real context — with secrets redacted and the AI unable to act.

### Story 1.1: Install and run the CLI skeleton

As a developer evaluating PR Reviewer,
I want to install the CLI and see its version and help,
So that I know the tool runs on my machine before configuring anything.

**Acceptance Criteria:**

**Given** a clean checkout of the repository
**When** the maintainer runs `pnpm install` and `pnpm build`
**Then** a pnpm 12 workspace builds packages `core`, `github`, `providers`, `credentials`, and `cli` with TypeScript 7 (`module: nodenext`) and Vitest 5 tests pass
**And** `core` has a lint rule banning Node built-ins, `fetch`, `process`, and runtime code generation (AD-1), and a dependency-direction check fails the build if an adapter imports another adapter (AD-2)

**Given** the CLI package is installed globally or run via `npx`
**When** the user runs `pr-reviewer --version` and `pr-reviewer --help`
**Then** the version and documented commands print, `engines` declares Node ≥ 22, and exit code is 0
**And** an unknown command exits with code 64 and a usage message

### Story 1.2: Fetch a PR's full context from GitHub

As a user,
I want the tool to load any PR I can read from its URL or `owner/repo#n`,
So that the review is grounded in the real change rather than a pasted diff.

**Acceptance Criteria:**

**Given** a PR URL or `owner/repo#n` and a GitHub Credential that can read it
**When** the user runs `pr-reviewer context <ref> --json`
**Then** the output contains PR metadata, base/head/merge-base SHAs, changed files with status (added/modified/renamed/deleted/binary), diff hunks, head and base contents for text files within size limits, and existing reviews and comments — fetched with pagination through `GitHubPort` only (AD-6)
**And** files over size limits are listed as "context truncated", not dropped (FR2)

**Given** the API base URL is set in user config
**When** the reference points to that host
**Then** requests go to the configured host; no host, repo, or org string exists in product defaults except the overridable public GitHub API URL (FR1, AD-13)

**Given** a PR the Credential cannot read
**When** the user runs the command
**Then** it exits non-zero with a message naming the missing permission or scope

### Story 1.3: User configuration and Credentials without leaks

As a user,
I want my settings and keys picked up from my config, environment, keychain, or `gh` login,
So that I never paste secrets into commands or files that get shared.

**Acceptance Criteria:**

**Given** a user config at `$XDG_CONFIG_HOME/pr-reviewer/config.yml` (or `%APPDATA%` on Windows) with `version: 1`
**When** any command runs
**Then** configuration resolves defaults → user config → per-run flags, validated by the Zod schema in `core`, and `pr-reviewer config show <ref>` prints each value with the layer that set it (FR13)
**And** an invalid config fails with the schema error path, never silently

**Given** Credential references `github` and `provider:anthropic`
**When** they are resolved
**Then** values come from env vars, the OS keychain, or `gh auth token`, wrapped in a `Secret` whose string/JSON forms print `[REDACTED]` (AD-10)
**And** a test injects a fake secret through every input path and asserts it appears in no log line, Report, or error message (FR15, NFR2)

### Story 1.4: Secrets never reach the AI

As a user,
I want secrets in a PR detected and blanked out before anything is sent to the AI,
So that a leaked key in a PR doesn't leak again to a third party.

**Acceptance Criteria:**

**Given** a PR that adds a string matching a built-in secret rule (cloud keys, tokens, private keys)
**When** the review runs
**Then** secret scanning runs in `execute`, reports a Finding with file and line only, and the `redact` stage replaces the value in the context object that later stages pass to any AI Provider (FR6b, AD-3)
**And** a unit test proves the redacted context and the Report contain no secret value

**Given** secret scanning cannot run
**When** the run completes
**Then** its layer is `ERROR` and, because secret scanning is a Mandatory Layer by default, the Overall Status is `INCOMPLETE`

### Story 1.5: AI review that can only answer

As a user,
I want an AI review of the PR returned as structured Findings,
So that I get contextual feedback without the AI being able to run anything or invent locations.

**Acceptance Criteria:**

**Given** redacted PR context (Story 1.4) and an Anthropic API Credential
**When** the `review` stage runs
**Then** exactly one structured request per call is sent through `ProviderPort` with no tools, and the response is parsed against the Finding schema (AD-8, FR6a)
**And** Findings whose file or line does not exist in the Head Commit are dropped and counted in the Report (FR6)

**Given** a PR whose files contain instructions aimed at the AI (e.g. "approve this PR", "run this command")
**When** the review runs
**Then** no command executes and nothing is written anywhere; at most a Finding reports the injection attempt (FR6a, NFR1)

**Given** a response that fails schema validation
**When** it is received
**Then** the AI layer reports `ERROR` with the reason; no partial free text is used (AD-4)
**And** engine tests use a recording provider, which also proves no secret value from Story 1.4's fixtures appears in any request; no test calls a live AI by default

### Story 1.6: End-to-end review with a Report and exit codes

As a user,
I want `pr-reviewer review <ref>` to print a clear Report and save Markdown and JSON,
So that I can read it or wire it into any CI.

**Acceptance Criteria:**

**Given** a PR reference and working Credentials
**When** the user runs `pr-reviewer review <ref> --out <dir>`
**Then** the engine runs the fixed stages `resolveConfig → fetchContext → detect → plan → execute → redact → review → normalize → dedupe → gate → assemble` (AD-3), shows per-layer progress, and writes `report.md` and `report.json` (schemaVersion 1, AD-15)
**And** the Report headline states Overall Status and Coverage

**Given** duplicate Findings from different sources on the same code
**When** `dedupe` runs
**Then** they merge by fingerprint (AD-12) keeping the deterministic evidence, and only `gate` sets Overall Status (FR7)

**Given** each Overall Status
**When** the CLI exits
**Then** exit codes are 0 PASSED/PASSED_WITH_WARNINGS (1 with `--strict` for warnings), 2 FAILED, 3 INCOMPLETE, 4 ERROR, 5 CANCELLED (FR24)
**And** `report.json` validates against the published JSON Schema generated from Zod

## Epic 2: Publish safe, non-duplicated reviews to GitHub

A user previews and posts the Report as one GitHub review with precise inline comments, re-runs on new pushes without duplicates, lists PRs with their reviewed state, sees which Findings were acted on, and migrates from the old tool.

### Story 2.1: Publish a review with inline comments

As a user,
I want to post the Report to the PR as one review with a summary and inline comments,
So that the author sees each issue exactly where it is.

**Acceptance Criteria:**

**Given** a Report with Findings on changed and unchanged lines
**When** the user runs `pr-reviewer review <ref> --post --yes`
**Then** one review is created via the engine's `publish` call only (AD-9), with inline comments only on right-side lines inside diff hunks (other lines of changed files become file-level comments) carrying severity, category, description, impact, evidence, recommendation, source, and confidence, and other Findings in the summary (FR17)
**And** text is sanitised before every comment and the summary get the hidden marker appended, ending with `<!-- pr-reviewer v1 key=… fp=… -->` (AD-11), and the summary discloses that PR Reviewer generated it and names the provider and model

**Given** AI text containing `@mentions`, external links, or HTML
**When** it is published
**Then** mentions are neutralised, links outside the repo and doc allow-list are removed, HTML and images are stripped

**Given** no event configured
**When** publishing
**Then** the review event is `COMMENT`; `REQUEST_CHANGES` is sent only when enabled in user config for manual runs; approve is impossible (FR18, FR20)
**And** inline comments beyond the configured maximum go to the summary

### Story 2.2: Preview before posting

As a user,
I want to see what will be posted and confirm,
So that nothing goes out under my name by accident.

**Acceptance Criteria:**

**Given** `--post` without `--yes`
**When** the review finishes
**Then** the CLI shows the summary and inline comment count and asks to confirm; declining posts nothing (FR23)
**And** in a non-interactive terminal without `--yes`, it refuses to post and exits 64

### Story 2.3: Re-review without duplicates

As a user,
I want re-running on the same or a newer commit to update rather than repeat the review,
So that PRs don't fill up with copies.

**Acceptance Criteria:**

**Given** a PR already reviewed at Head Commit X with the same Configuration
**When** the review runs again
**Then** no new review is created because a marker with the same idempotency key exists (FR19, AD-11)

**Given** a push that fixes one of three Findings
**When** the review runs on the new Head Commit
**Then** the previous summary is updated in place listing one resolved Finding, inline comments are posted only for new or changed Findings in a new review, and the gate is evaluated over the whole PR
**And** a human comment written by the same GitHub user (no marker) is never edited or deleted

### Story 2.4: List PRs and see what's been reviewed

As a user,
I want to list open PRs for a repo and see which head commits are already reviewed,
So that I can pick what to review next.

**Acceptance Criteria:**

**Given** a repository the user can read
**When** the user runs `pr-reviewer list <owner/repo>`
**Then** open PRs print with title, author, head SHA, and whether that head has a PR Reviewer marker (FR25)
**And** the user can pick one interactively to start a review

### Story 2.5: Finding feedback and local stats

As a user,
I want dismissed Findings not to come back and to see how useful reviews were,
So that the tool gets quieter and I can judge its value without telemetry.

**Acceptance Criteria:**

**Given** a published inline Finding that received a 👎 reaction or a reply starting with "dismiss"
**When** the next review runs and the anchored code is unchanged
**Then** that fingerprint is not re-posted (FR20b)

**Given** PRs reviewed by the user over a period
**When** the user runs `pr-reviewer stats --since <date>`
**Then** counts of Findings resolved (code at the anchor changed later), dismissed, and still open are computed from GitHub data only (FR25a)

### Story 2.6: Optional commit status

As a user,
I want an optional commit status reflecting the Quality Gate,
So that my own repos can show the result in the checks list.

**Acceptance Criteria:**

**Given** commit status enabled in user config and write permission on the repo
**When** a review completes
**Then** a commit status for the Head Commit maps Overall Status to success/failure/error (FR21)
**And** without permission it is skipped with a note in the Report; it is off by default

### Story 2.7: Migrate from review.mjs

As an existing user of the old tool,
I want my rules files and workflow to keep working on the new CLI,
So that I can switch without redoing setup.

**Acceptance Criteria:**

**Given** existing `rules/*.md` files
**When** the user points `reviewRules` at them in user config
**Then** they are applied as Review Rules and appear in the checklist (FR16a)

**Given** the existing `.github/workflows/review.yml`
**When** it is updated to call the new CLI
**Then** it accepts the same inputs (PR URL, post toggle) and secret names (`ANTHROPIC_API_KEY`, `GH_REVIEW_TOKEN`)
**And** `docs/migration.md` maps `--post`, `--event`, `--model`, `--rules`, `--dry-run`, `--list` to the new commands, the README drops repo-specific examples, and `review.mjs`/`test.mjs` and the repo-specific rules file are removed

## Epic 3: Use whichever AI I already have

A user reviews with an API key from Anthropic or OpenAI, any OpenAI/Anthropic-compatible endpoint, or their own Claude Code / Codex subscription — set up in one guided flow, with fallback and cost ceilings.

### Story 3.1: OpenAI and any compatible endpoint

As a user,
I want to use OpenAI, OpenRouter, Ollama, Azure OpenAI, or my company's gateway,
So that I'm not locked to one vendor.

**Acceptance Criteria:**

**Given** a provider entry in user config with `type: openai-compatible`, `baseUrl`, `credential`, and `model` (or `type: anthropic-compatible`)
**When** a review runs with that provider
**Then** the `openai-compatible` (or `anthropic`) adapter sends one schema-constrained request and the Findings validate like any other provider (FR9, FR9a, AD-8)
**And** a provider conformance suite (schema output, error mapping, usage reporting) passes for every built-in adapter and for a config-only provider against a local mock server

### Story 3.2: Choose provider and model, with fallback

As a user,
I want a default provider, per-run overrides, and a fallback,
So that a rate limit doesn't stop my review.

**Acceptance Criteria:**

**Given** a default provider, `--provider/--model` flags, and an ordered `fallback` list
**When** the primary fails with a retryable error
**Then** the run completes on the first working fallback and the Report names the failure and the provider and model used per AI Finding (FR11)

### Story 3.3: Use my Claude subscription through Claude Code

As a user with a Claude subscription,
I want the review to use my own logged-in Claude Code,
So that I don't need a separate API key.

**Acceptance Criteria:**

**Given** Claude Code installed and logged in
**When** the `claude-code` provider runs
**Then** it spawns `claude -p --safe-mode --tools "" --disallowedTools "mcp__*" --strict-mcp-config --no-session-persistence --output-format json --json-schema <draft-07 schema> --model <m>` in a fresh empty temp directory outside any git repo, with an environment stripped of GitHub and other Credentials, the request on stdin (FR10, AD-8)
**And** a test placing `CLAUDE.md`, `AGENTS.md`, and `.claude/settings.json` with hooks in the reviewed PR shows no effect on the call (the PR content is only passed as text)

**Given** Claude Code missing, logged out, or a version lacking the required flags
**When** the provider is selected
**Then** the CLI explains the problem and suggests the API-key route; it never reads Claude Code's credential files
**And** first use prints a one-time notice that headless use draws on the plan's usage credit

### Story 3.4: Use my ChatGPT subscription through Codex

As a user with a ChatGPT subscription,
I want the review to use my own logged-in Codex CLI,
So that I can use the plan I already pay for.

**Acceptance Criteria:**

**Given** Codex installed and logged in
**When** the `codex` provider runs
**Then** it spawns `codex exec --json --output-schema <file> --ignore-user-config --ignore-rules -s read-only --ephemeral --skip-git-repo-check -c web_search="disabled" --disable shell_tool --disable view_image --disable multi_agent --disable apps --disable unified_exec -m <m>` in a fresh empty temp directory with a Credential-free environment and a dedicated `CODEX_HOME` holding only Codex's login (spike; if infeasible, document a global AGENTS.md as accepted residual risk), and parses the final message as Findings (FR10, AD-8)
**And** missing/logged-out/old-version cases behave as in Story 3.3

### Story 3.5: Usage, cost, and ceilings

As a user,
I want to see tokens and estimated cost per review and set limits,
So that reviews never surprise me on my bill.

**Acceptance Criteria:**

**Given** a provider that reports usage
**When** a review completes
**Then** the Report shows input/output tokens and an estimated cost where pricing is configured, else "not reported" (FR12)

**Given** a per-run or monthly ceiling in user config
**When** a run would exceed it
**Then** the AI layer stops with `SKIPPED (cost ceiling reached)` and Findings so far are marked partial; monthly usage is tracked locally per user

### Story 3.6: Guided setup

As a first-time user,
I want one `pr-reviewer init` that finds what I already have,
So that I can review my first PR in minutes.

**Acceptance Criteria:**

**Given** a machine with `gh` logged in and Claude Code or Codex logged in, or provider keys in env
**When** the user runs `pr-reviewer init`
**Then** it detects them, asks only for missing values, validates each with a test call, and writes user config with Credential references only (FR16)
**And** an invalid key is reported at setup with the provider's error

## Epic 4: Real tool checks with honest status

A user gets compiler, lint, framework, secret, and dependency results for JS/TS, Angular 12+, and React PRs, run safely in a Sandbox, plus reuse of existing CI/SonarQube results — every check reported honestly.

### Story 4.1: Detect technologies and versions

As a user,
I want the Report to show which languages, frameworks, and versions each project uses,
So that checks and advice match my real stack.

**Acceptance Criteria:**

**Given** a PR in a repo with `package.json`, `angular.json`, `tsconfig.json`, or React dependencies (single project or monorepo)
**When** `detect` runs
**Then** each changed file maps to its owning project, and the Report lists language, framework, declared version, confidence, and evidence per project (FR3)
**And** a repo with no recognised stack gets "best-effort (unsupported technology)" labelling, not a guessed framework

### Story 4.2: Validator contract, honest Layer Status, and Coverage

As a user,
I want every check to report PASSED, FAILED, WARNING, SKIPPED, ERROR, TIMEOUT, or NOT_APPLICABLE with a reason,
So that a skipped check is never mistaken for a passed one.

**Acceptance Criteria:**

**Given** the Validator registry and the contract `{id, version, layers, supports, needsSandbox, inputs, run}` (AD-5)
**When** `execute` runs Validators in parallel with per-Validator timeouts and a concurrency limit
**Then** each layer gets exactly one Layer Status; a crash is `ERROR`, a timeout `TIMEOUT`; one failing Validator does not stop others (FR4)
**And** with no Sandbox available, `needsSandbox` Validators are recorded `SKIPPED (no Sandbox)` without being called, and the headline Coverage says build/tests were not run

**Given** a Mandatory Layer that did not run
**When** `gate` evaluates
**Then** Overall Status is `INCOMPLETE`, never `PASSED`

### Story 4.3: Reuse existing CI and SonarQube results

As a user,
I want results my CI already produced for this commit to be included,
So that the review doesn't redo work or contradict CI.

**Acceptance Criteria:**

**Given** check runs or commit statuses on the Head Commit (e.g. a SonarQube quality gate, test jobs)
**When** the reuse Validator runs
**Then** their results appear as layers with source links (FR5)
**And** results attached to any other commit are never used

### Story 4.4: Repository settings and Review Rules, safely

As a repository maintainer,
I want to keep review rules and thresholds in my repo,
So that everyone using PR Reviewer on it gets the same checks — without the repo being able to redirect their keys.

**Acceptance Criteria:**

**Given** `.github/pr-reviewer.yml` on the PR's base branch
**When** configuration resolves
**Then** only allow-listed keys (Review Rules, include/exclude paths, thresholds, comment limits, extra Validators) apply; provider, endpoint, Credential, event, Sandbox, Mandatory Layer, and unknown keys are ignored and listed in the Report (FR13, AD-13)
**And** a PR that edits this file does not change its own review's configuration

**Given** Review Rules from the repo and from user config
**When** the review runs
**Then** the checklist shows every rule with its source; repo rules are passed to the AI only as "things to check", and user rules win on conflict (FR14)

### Story 4.5: Run PR code only in a Sandbox

As a user,
I want builds and installs to run in an isolated container,
So that a malicious PR can't touch my machine or keys.

**Acceptance Criteria:**

**Given** Docker or Podman available
**When** a `needsSandbox` Validator runs
**Then** the engine clones the PR (shallow, head + merge-base) inside a container from the pinned toolchain image, runs `install` with registry-only network and `analyze` with `--network none`, mounts only the checkout and a scratch dir, passes no Credentials or tokens, and accepts only schema-valid JSON on stdout (FR39, AD-7)
**And** a test PR whose install script reads env vars and tries to reach the network finds no Credentials and no network in `analyze`

**Given** a PR that changes tool configs, build scripts, or CI workflows
**When** the review runs
**Then** a Finding says so (FR39)

### Story 4.6: TypeScript and lint checks with the repo's own config

As a user,
I want compiler and lint results using my repo's settings,
So that the review matches what my team enforces.

**Acceptance Criteria:**

**Given** a TS/JS project
**When** the `ts.tsc` and lint Validators run in the Sandbox
**Then** compiler errors and lint violations on new or worsened code become Findings; pre-existing ones are labelled pre-existing and excluded from the gate (FR4)
**And** with no ESLint/TSLint config in the repo, a named default ruleset compatible with the detected versions runs and the Report names it; the repo is never modified

### Story 4.7: Angular 12+ and React framework checks

As an Angular or React developer,
I want framework-aware checks that respect my framework version,
So that I don't get advice for features my version lacks.

**Acceptance Criteria:**

**Given** an Angular 12+ project
**When** the Angular Validator runs
**Then** it reports framework-standard issues (e.g. template method calls, missing `trackBy`/`track`, unmanaged subscriptions) and never recommends APIs newer than the detected Angular version (FR3)

**Given** a React project
**When** the React Validator runs
**Then** hooks rules and key/props issues are reported with version-appropriate guidance

**Given** an Angular version below 12
**When** detection runs
**Then** the Angular layer is `NOT_APPLICABLE (unsupported version)` and generic checks still run

### Story 4.8: Dependency audit and result caching

As a user,
I want known-vulnerable dependencies flagged and unchanged checks not re-run,
So that reviews are thorough and fast on new pushes.

**Acceptance Criteria:**

**Given** changes to `package.json` or a lockfile
**When** the dependency Validator runs
**Then** known vulnerabilities in added or upgraded packages are Findings labelled "reachability unknown" where applicable

**Given** a second run where a Validator's cache key (validator id+version, tool version, config subset, input blob/tree SHAs) is unchanged
**When** `execute` runs
**Then** the cached result is reused and the Report notes it; caches are namespaced per user and repository (NFR11, AD-12)

## Epic 5: Automatic reviews on my GitHub

A user enables Auto-Review once and every PR in their Watch Scope gets reviewed from their own GitHub account, safely, within free limits, with visible health. *(Release 2 — stories to be detailed before the release.)*

### Story 5.1: Enable Auto-Review in one command

As a user,
I want `pr-reviewer auto enable` (or `gh pr-reviewer auto enable`) to set everything up in my account,
So that reviews start without manual wiring.

**Acceptance Criteria:**

**Given** a logged-in `gh`
**When** the user enables Auto-Review
**Then** a private automation repo with pinned workflows is created, a least-privilege expiring token is stored as a secret, estimated monthly CI usage is shown, and a first discovery runs (FR26, FR29a, AD-14)

### Story 5.2: Watch Scope and discovery

As a user,
I want to choose which PRs are reviewed and have new pushes picked up,
So that coverage matches my work without reviewing strangers' PRs.

**Acceptance Criteria:**

**Given** a Watch Scope config
**When** the 30-minute discovery runs
**Then** matching PRs whose Head Commit has no marker are reviewed once; org scopes are off until enabled; repo opt-outs and non-collaborator rules are honoured (FR27, FR28)

### Story 5.3: Pending reviews for review requests

As a requested reviewer,
I want Auto-Review to leave a draft only I can see,
So that teammates don't think I've reviewed.

**Acceptance Criteria:**

**Given** a review-requested PR under default settings
**When** Auto-Review runs
**Then** a pending review is created and the review request stays open (FR20a)

### Story 5.4: Sandbox job and health reporting

As a user,
I want Auto-Review to run PR code in a secret-less job and tell me about problems once,
So that it's safe and I notice failures.

**Acceptance Criteria:**

**Given** a PR needing deterministic checks
**When** the workflow runs
**Then** a separate job with `permissions: {}` and no secrets runs the Sandbox; its artefacts are schema-validated by the review job (AD-7)
**And** expired tokens, SSO blocks, or quota problems open one issue per cause in the automation repo, auto-closed when cleared (FR29)

### Story 5.5: Subscription opt-in for Auto-Review

As a subscription user,
I want to opt in to using my Claude or ChatGPT plan in Auto-Review after a clear warning,
So that I choose the risk knowingly.

**Acceptance Criteria:**

**Given** a Subscription Provider selected for Auto-Review
**When** enabling it
**Then** a warning explains the vendor-terms grey area and the API-key alternative, and the user must confirm explicitly; without opt-in Auto-Review uses API Providers only (FR10)

## Epic 6: Review from a web page

A team self-hosts the Web App; members sign in with GitHub, paste a PR link, watch the run, read the Report, and publish selected Findings. *(Release 3 — requires a `bmad-ux` pass; stories outlined.)*

### Story 6.1: Self-host and sign in

As an operator,
I want to run the Web App with one command and restrict who can sign in,
So that my team can use it safely.

**Acceptance Criteria:**

**Given** the container image and compose file
**When** the operator starts it with an allow-list
**Then** only allow-listed GitHub users/orgs can sign in, with narrow OAuth scope and per-user isolation (FR30)

### Story 6.2: Run, watch, and read the Report

As a team member,
I want to paste a PR link and see progress and results in the page,
So that I don't need the terminal.

**Acceptance Criteria:**

**Given** a signed-in user with a configured API key
**When** they start a review
**Then** live per-layer progress survives reload and the page renders every Report field (FR31, FR32, FR35)

### Story 6.3: Selective Publish and history

As a team member,
I want to choose which Findings to post and see past runs,
So that I stay in control and can track progress.

**Acceptance Criteria:**

**Given** a completed run
**When** the user deselects or edits Findings and publishes
**Then** only the chosen Findings are posted, and history shows new/resolved/unchanged per PR (FR33, FR34)

## Epic 7: Review from the GitHub PR page

A user installs the browser extension and reviews the PR they're looking at. Stories 7.1–7.6 are the Standalone slice (Release 4) and ship before any Connected story; 7.7–7.8 add Connected mode (Release 4.x), including the server-side changes the Web App and `pr-reviewer serve` need. Review-page parity (UX-DR25) moved to Epic 9 as Story 9.2. Design contract: `ux-designs/ux-pr-reviewer-2026-11-26/` (DESIGN.md, EXPERIENCE.md, mockups; spines win over mockups). Every story's surfaces meet UX-DR21 (structure and focus), UX-DR22 (announcements), UX-DR23 (keyboard, motion, zoom) and UX-DR24 (voice); these are not repeated per story.

### Story 7.1: Review a PR from the side panel (walking skeleton)

As a developer with my own AI API key,
I want to open the pr-reviewer side panel on a GitHub PR and run a review there,
So that I get a Report beside the PR without running anything else.

**Acceptance Criteria:**

**Given** a new `packages/extension` Channel (Manifest V3, Side Panel API, Chrome ≥ 116) with its own `src/compose.ts`
**When** it is built and loaded unpacked
**Then** the toolbar icon and a Chrome command (default Alt+Shift+R, user-changeable) open the side panel, and the panel focuses its `h1` (UX-DR17)
**And** the boundary lint treats `extension` as a Channel, the bundle contains no remotely hosted code, and it runs under a CSP without `unsafe-eval` (AD-1, NFR14)

**Given** a GitHub token and an Anthropic or OpenAI-compatible key entered in a minimal settings form (guided setup is Story 7.2)
**When** the active tab is a PR on github.com
**Then** the panel shows that PR (identified from the tab URL; title and head from the GitHub API, never from the page) with "Review this PR"; any other tab shows "Open a pull request to review it." (FR36)

**Given** the user presses Review
**When** the run executes
**Then** `core` runs in the panel page (not the service worker) with the GitHub reader, the secret scanner and the HTTP providers, and AI calls succeed from the panel page (AD-1, AD-16)
**And** the Step list renders only from `RunEvent`s in `seq` order, each step with a state word and glyph (Waiting, Running, Done, Failed, Skipped), provider, model and elapsed time; Sandbox checks show `SKIPPED (no Sandbox)` (UX-DR10)
**And** a secret in the diff never appears in the provider request (test), and no Credential appears in any log or Report (NFR2, AD-10)

**Given** a finished run
**When** the Report shows
**Then** it has the Coverage block (Overall Status badge per the status mapping, coverage headline, checks not run with reasons) and the findings with severity badges, read-only (selection and posting are Story 7.3) (UX-DR2, UX-DR12)
**And** the panel uses the DESIGN.md tokens in light and dark (OS theme), and the header shows the logo, "PR Reviewer" and the Mode chip "Standalone" (UX-DR1, UX-DR3)

**Given** a run in progress
**When** the user presses Cancel, the run fails, or the panel is closed
**Then** PR home says "Review cancelled.", gives the failure reason in plain words with Retry, or on next open says "The last review was stopped when the panel closed."; the Standalone run shows "Closing this panel stops the review." while it runs (UX-DR10)
**And** whether F6 moves focus into the side panel on Chrome 116+ is verified and recorded; if not, the hint text used in later stories names the key that does

### Story 7.2: Welcome, consent, and Standalone setup

As a new user who just installed the extension from the store,
I want to be told what is sent where, sign in to GitHub, and add my AI key with a test,
So that my first review works and I know what I agreed to.

**Acceptance Criteria:**

**Given** the panel opens for the first time
**When** Welcome shows
**Then** before anything is entered it states what goes to GitHub, what goes to the AI provider (the diff and files with detected secrets removed), that nothing goes anywhere else, that recent reviews (including short code excerpts) stay in this browser until cleared, and links the privacy policy; it names the key that moves focus into the panel (UX-DR4)
**And** it offers three mode cards with radio semantics; until Stories 7.7 and 7.8 land, "My team's Web App" and "This computer" are shown as not available yet; nothing is stored until a mode is chosen

**Given** Standalone is chosen
**When** the user connects GitHub
**Then** "Use a token" accepts a fine-grained token, lists the exact permissions it needs, and verifies it (identity and read access); this route works for every host (UX-DR5)
**And** when a GitHub OAuth client ID is configured for github.com, "Sign in with GitHub" runs the device flow: the code in mono with Copy and "Expires at hh:mm", the github.com device page opened in a new tab, polling until approved; two minutes before expiry it offers a new code; expired and denied states recover in one action; the code's accessible name is spelled out

**Given** GitHub is connected
**When** the user picks Anthropic or OpenAI-compatible (with base URL) and enters a key
**Then** the key field is masked; Test shows "Testing…", then "Works: <model> answered." or the provider's error tied to the field (`aria-invalid`, described by the error, focus moved to it, value kept); the key is saved only after a successful test (UX-DR6, UX-DR24)

**Given** stored credentials
**When** they are saved, used or removed
**Then** they are held where page and content scripts cannot read them, encrypted at rest, sent only over HTTPS to their own service, never written to logs or Reports, and each is removable in Settings with one action (NFR13, AD-10, UX-DR18)
**And** an expired or rejected token or key turns the Mode chip to "Standalone · signed out" and PR home links the setup step that fixes it (UX-DR3, UX-DR20)

**Given** setup was started from a PR ("Set up to review <pr>")
**When** setup completes
**Then** the panel returns to that PR and starts the review; this replaces Story 7.1's minimal settings form

### Story 7.3: Choose findings, open them in the diff, and post

As a reviewer,
I want to open each finding at its line, untick the ones I disagree with, preview, and post the rest,
So that my review lands on the PR as I intended, from the PR page.

**Acceptance Criteria:**

**Given** a Report
**When** findings show
**Then** each Finding card has a native checkbox labelled "Include in post: <SEVERITY> <title>, <path>:<line>"; findings are included by default except dismissed and pre-existing ones, which are listed last; excluded cards keep full contrast with a dashed `border-strong` edge and a "Not included" / "Dismissed" / "Pre-existing" badge (UX-DR13)
**And** the Findings toolbar shows severity counts, Select all / none and a severity filter; selection survives filtering; an empty filter result says so with a way to clear it; the Details disclosure holds the walkthrough, checks table, related code, learnings, tokens and cost (UX-DR12)

**Given** a finding with a location
**When** the user activates its path:line
**Then** it is a real, underlined link to the Files changed anchor built from API data (not page structure), opened in the current tab (Ctrl/Cmd-click opens a new tab); the panel keeps focus and announces "Opened <path>:<line> in the page" (FR38, UX-DR13)

**Given** the PR's head moved since the review
**When** the Report shows
**Then** the Outdated banner offers "Review again" and Post is `aria-disabled` with the reason beside it (UX-DR14)

**Given** the Post panel
**When** the user prepares a post
**Then** review type is Comment, or Request changes only when allowed, never Approve; "Preview post" shows new inline comments, still open, resolved, findings moved to the summary over the inline limit, and the summary in a preview block; the Post button appears only after a preview and is labelled with the counts; zero included posts the summary only (UX-DR15)
**And** posting goes through the same engine publish path, single GitHub writer and sanitising as the CLI (AD-9); no publish logic lives in the extension

**Given** the user presses Post
**When** it runs
**Then** the button shows "Posting…" and cannot be pressed again; the head is re-read first and a moved head stops the post with "Review again" (AD-23); a changed preview is shown again and waits for the user
**And** the result line shows posted (links to the review and summary), already posted for this commit, or refused (GitHub's reason and the permission needed, selection and preview kept, "Try posting again"); the Report marks posted findings

### Story 7.4: Follow the tab, keep recent reviews, and work offline

As a reviewer moving between PRs,
I want the panel to show the PR in my current tab, remember recent reviews, and keep a review running when I switch away,
So that I never see the wrong PR's results and never lose a review.

**Acceptance Criteria:**

**Given** the panel is open
**When** the user switches tabs or navigates to another PR in the same window
**Then** the panel shows the active tab's PR, says so in the status region, and keeps focus where it was if that element still exists; navigation within the same PR (Conversation, Files changed, anchors) never re-renders the panel (UX-DR9, UX-DR21)
**And** loading shows "Loading <pr>…"; closed, merged and draft PRs show their state, with a note that GitHub may refuse comments on a closed PR; missing read access says which access is missing

**Given** finished reviews
**When** they are stored
**Then** the last review of each of the 50 most recent PRs is kept in extension storage, schema-validated on read (AD-4); a PR with a current review opens straight to its Report, one whose head moved opens the outdated Report; Not a PR lists recent reviews (or "No reviews yet."); Settings shows the count and clears them after a native confirmation dialog (UX-DR19, UX-DR18)

**Given** a Standalone run in progress
**When** the user switches to another tab or PR
**Then** the run continues; the panel follows the tab and shows "Reviewing <pr> in the background · Show"; returning shows the progress or the Report; one run at a time per PR, different PRs may run at once (UX-DR11)

**Given** the browser is offline
**When** the panel is used
**Then** the Mode chip reads "Offline", Review and Post are off with the reason, and stored Reports stay readable (UX-DR20)

### Story 7.5: The Review button on the PR page

As a reviewer,
I want a small button in the PR header that starts a review or shows its result,
So that I can see at a glance whether this PR has findings and act in one click.

**Acceptance Criteria:**

**Given** a GitHub PR page (including client-side navigation between PRs and tabs)
**When** the content script runs
**Then** exactly one button is inserted in DOM order beside the header actions (no tabindex, no absolute positioning), using its own styles only; it reads no PR data from the page; if no placement is found nothing is shown and the toolbar icon still works (FR36, UX-DR16)
**And** within the same PR it is not re-rendered; if GitHub re-renders the header while it has focus, focus returns to the new instance

**Given** the stored state of that PR (Story 7.4)
**When** the button renders
**Then** it reads "Review", "Reviewing…", "<n> findings" / "No findings" or "Outdated", updating the text in place; its accessible name is the visible label followed by ", pr-reviewer"
**And** pressing it opens the panel and starts a review only in the "Review" state, otherwise it shows the run or the Report; it announces from its own shadow root "Opened in the pr-reviewer side panel. Press <key> to move there." (the key verified in Story 7.1)

**Given** GitHub's light or dark colour mode
**When** the button renders
**Then** it uses the matching DESIGN.md tokens (OS theme if GitHub's mode cannot be read), the two-tone focus ring on any background, and a `ButtonText` border with `Highlight` focus in forced-colors mode
**And** tests cover several recorded GitHub header variants and a page with no placement

### Story 7.6: Store-ready Standalone release

As a developer who finds pr-reviewer in the Chrome Web Store,
I want an extension that asks only for the access it needs, explains its data use, and works with my Enterprise host,
So that I can install it with confidence.

**Acceptance Criteria:**

**Given** the manifest
**When** it is reviewed
**Then** required permissions are the minimum (side panel, storage, github.com and api.github.com, the default AI provider APIs); OpenAI-compatible endpoints and Enterprise hosts are optional host permissions requested only when the user adds them; each permission has a written justification (NFR14)

**Given** Settings → Enterprise hosts
**When** the user adds a host
**Then** Chrome is asked for that host only; a decline shows "Chrome did not allow access to <host>, so PRs there can't be reviewed." with Try again; token sign-in is used for that host (UX-DR18)

**Given** the privacy policy
**When** it is published
**Then** it lives in the repository, is linked from Welcome and the store listing, and matches what Welcome says is sent and stored (NFR13)

**Given** a release build
**When** CI packages it
**Then** the zip is reproducible, versioned in lockstep with `engineVersion`, and the store listing text and screenshots come from the mockups; the README gains an extension section

**Given** every panel surface and the Review button
**When** the accessibility audit runs
**Then** automated checks pass in light and dark at 320px and at 200% zoom, the DESIGN.md contrast table holds, and a keyboard and screen-reader checklist (focus rules, announcements, dialogs, time limits) passes (UX-DR21–UX-DR23)

### Story 7.7: Connect to my team's Web App

As a member of a team that self-hosts the Web App,
I want the extension to run reviews on our Web App without holding an AI key,
So that I get full reviews, including compile and lint, from the PR page.

**Acceptance Criteria:**

**Given** the Web App
**When** an administrator lists allowed extension IDs in its configuration (no ID is hardcoded)
**Then** a signed-in user can open an extension sign-in page, confirm "Allow the pr-reviewer extension to use your account?", and the extension receives a bearer token that is scoped to `ReviewService v1`, expires, is stored hashed, and can be revoked from the Web App page
**And** `/v1` accepts that token from an allowed extension origin only, still rejects cross-site requests otherwise, and cookie sessions and the existing CSRF rule are unchanged for the page

**Given** Setup: Web App in the panel
**When** the user enters a URL
**Then** only HTTPS is accepted; unreachable, not a pr-reviewer Web App, and incompatible version (via `Accept-Schema`) each have their own message; no AI key is requested or stored (UX-DR7, NFR13)

**Given** a connected panel
**When** the user reviews a PR
**Then** the Mode chip reads "Web App · <host>"; the run is created through `ReviewService v1`; the Step list renders from its event stream and re-attaches after the panel is reopened ("You can close the panel; the review keeps running."); Report and Post behave as in Story 7.3, posting through `/v1/runs/:id/publish` with the same preview step (AD-16, AD-23)
**And** an unreachable Web App shows "Web App · unreachable" and offers Standalone when it is set up (UX-DR20)

### Story 7.8: Pair the extension with pr-reviewer on this computer

As a developer who already uses the `pr-reviewer` CLI,
I want to pair the extension with it,
So that reviews from the PR page run with my CLI's settings, including my subscription and tool checks, without my AI login touching the browser.

**Acceptance Criteria:**

**Given** `pr-reviewer serve --pair` (the command name is settled in this story)
**When** it starts
**Then** it binds loopback only on a stable, configurable port, prints a short pairing code valid for at least 10 minutes, and exchanges a correct code for a long-lived pairing token stored hashed in the CLI's state, recording the extension's origin and showing the computer's name to confirm
**And** `/v1` then accepts that token from that origin only (CORS for exactly that origin, a deliberate change from Story 8.1); every other origin, Host, and missing or wrong token is still rejected; `pr-reviewer serve --unpair` revokes it

**Given** Setup: This computer in the panel
**When** the user enters the code
**Then** its format and length are stated and autocomplete is off; a wrong or expired code keeps focus in the field with "That code didn't match" / "That code expired. Run pr-reviewer serve --pair again." (UX-DR8)

**Given** a paired panel
**When** the user reviews and posts
**Then** the Mode chip reads "This computer"; the run uses the CLI's configuration and Credentials, including subscriptions, as Channel CLI (AD-16), and the extension never sees them; every post asks "Post <n> inline comments as @<login> from pr-reviewer on <computer>?" in a native dialog before publishing (FR37)
**And** when `serve` is not running, the panel says "pr-reviewer on this computer isn't running. Start it with: pr-reviewer serve --pair." and offers Standalone when it is set up

## Epic 8: Review from a local page on my machine

Course correction (2026-11-25): the user asked for a UI before Epics 3–4. A local page served by the CLI gives that without hosting, sign-in, or server-side keys (Epic 6 still covers the hosted Web App). Stories follow AD-16 (`ReviewService v1`, CLI companion rules) and AD-23 (preview equals post).

### Story 8.1: Start the local review page and run a review

As a user,
I want to run `pr-reviewer serve`, paste a PR link in a page, and watch the review,
So that I can review PRs without reading terminal output.

**Acceptance Criteria:**

**Given** `pr-reviewer serve [--port n] [--open]`
**When** it starts
**Then** it binds `127.0.0.1` only, creates a ≥ 128-bit token per launch, and prints the page URL carrying the token in the fragment
**And** every `/v1` request without the bearer token gets 401, a non-loopback Host or a foreign Origin gets 403, and no response carries CORS headers

**Given** the page and a PR reference
**When** the user starts a review
**Then** `POST /v1/runs` starts the same engine the `review` command runs, `GET /v1/runs/:id/events` streams core `RunEvent`s (resumable via `Last-Event-ID`), and `GET /v1/runs/:id/report` returns the Report (JSON or Markdown)
**And** the page shows the GitHub identity and AI provider readiness, layer progress, Overall Status, coverage, checks, Findings, and limitations, rendering untrusted text as text only, and every response is redacted of resolved Credentials

### Story 8.2: Pick Findings and post from the page

As a user,
I want to choose which Findings to post, preview exactly what will be posted, and post it,
So that only what I agree with reaches the PR.

**Acceptance Criteria:**

**Given** a finished run
**When** the user selects Findings and an event and asks for a preview
**Then** `POST /v1/runs/:id/publish` with `dryRun` returns the rendered preview and its digest; the server derives Reviewer Identity, hunks, and prior publication itself (the body carries only `event`, `include`, `dryRun`, `previewDigest`)

**Given** a preview
**When** the user posts
**Then** the server re-renders and publishes only if the digest still matches, else answers 409 with the new preview; the result links to the review and summary, and the commit status is set when configured
**And** REQUEST_CHANGES is offered only when `publish.allowRequestChanges` is set

### Story 8.3: Pick an open PR from the page

As a user,
I want to list a repository's open PRs in the page with whether I reviewed their latest commit,
So that I can start a review with one click.

**Acceptance Criteria:**

**Given** a repository reference
**When** the user lists it
**Then** `GET /v1/pulls?repo=` returns open PRs with their reviewed state (as `list` does), and choosing one starts a review

## Epic 9: A review page that shows what matters first (v2, classic kept)

From user feedback on 2026-11-26 (see UX-DR26, UX-DR27). Stories 9.1 and 9.2 fix today's page (noise, then contrast), so they help whichever version is used. Story 9.3 makes room for v2 without losing classic. Stories 9.4–9.9 build v2 from the `bmad-ux` v2 contract (`ux-designs/ux-pr-reviewer-review-page-v2-2026-11-26/`: the user chose Direction A · Command with borrowed elements, then delegated the remaining decisions); v2 becomes the default only in Story 9.9. Whether the extension (Epic 7) follows v2's look is an open question for a later `bmad-ux` Update of its DESIGN.md.

### Story 9.1: Show what matters first

As a reviewer reading a Report with many findings,
I want new problems first and pre-existing tool noise grouped and left out of the post by default,
So that the findings worth posting are the ones I see and select.

**Acceptance Criteria:**

**Given** a Report on the review page or the Web App
**When** findings show
**Then** NEW findings come first, ordered by severity; PRE_EXISTING findings are collapsed into one group with a count ("20 pre-existing · Show"), unticked, and listed after them; the summary line counts them separately ("2 new findings · 20 pre-existing") (UX-DR26)
**And** "Select all" selects new findings only; ticking a pre-existing one is still possible inside the group

**Given** ESLint or TSLint findings
**When** their severity is set
**Then** rules in the style category (formatting, whitespace, quotes, commas, ordering, naming) are MINOR at most, whatever the configured rule severity; other rules keep the current mapping; the gate and the published comments follow the new severities, and tests cover both linters

**Given** the PR from the feedback (20 pre-existing TSLint style findings, 2 AI findings)
**When** it is reviewed again
**Then** the page opens with the 2 AI findings visible and selected, and the 20 TSLint findings collapsed, unselected, and MINOR

### Story 9.2: Accessibility parity for the classic page

As a user of `pr-reviewer serve` or the Web App,
I want the review page to meet the same contrast rules as the extension,
So that it is readable for everyone and matches the extension.

**Acceptance Criteria:**

**Given** `packages/cli/static`
**When** the change lands
**Then** inputs, selects, checkboxes and secondary buttons use `border-strong`, excluded findings use the dashed edge and badge instead of 60% opacity, and links are underlined (UX-DR25)
**And** the review page and Web App tests still pass, and the change applies to the Web App page too

### Story 9.3: Keep the classic page while v2 is built

As a user who knows today's review page,
I want to keep using it while a new version arrives, and switch between them,
So that a redesign never takes away a page I rely on.

**Acceptance Criteria:**

**Given** `pr-reviewer serve` and the Web App
**When** they start
**Then** they serve both pages from the same `ReviewService v1`: classic (today's page, with Stories 9.1 and 9.2 applied) and v2; `serve --ui classic|v2` and a Web App setting choose the default (classic until v2 reaches parity), and each page has a "Switch to classic / v2" link that is remembered per browser
**And** a parity checklist (start a review, pick an open PR, stats, progress, Report, select, edit wording, preview, post, settings) is tracked in the repository, and v2 becomes the default only when every item passes

### Story 9.4: The v2 workspace: start a review from the command bar

As a reviewer opening the review page,
I want a workspace where I start reviews from a command bar and move with the keyboard,
So that reviewing feels fast and modern without losing anything classic does.

**Acceptance Criteria:**

**Given** the v2 page served behind Story 9.3's switch
**When** it opens with no run
**Then** it shows the sidebar (Start, Stats, Settings), the identity menu (GitHub and AI health in words, Settings, Switch to classic, version, Sign out on the Web App) and Start: a large command field with recent reviews or "No reviews yet. Paste a PR link to start."; `serve` opened without its key shows only the Locked surface (UX-DR27)
**And** the tokens, type ramp, focus rings and theme setting (System / Light / Dark) follow the v2 DESIGN.md

**Given** the command palette (⌘K / Ctrl+K, the sidebar field, or Start's inline field)
**When** the user pastes a PR link or types owner/repo
**Then** "Review owner/repo#n" is offered first, or that repository's open PRs are listed with their reviewed state; invalid references, unreadable PRs (naming the missing permission), refused starts, loading, no matches and no open PRs each have their own message; Enter starts the review and Esc closes and returns focus

**Given** a run started from v2
**When** the page is reloaded
**Then** the last run reattaches (running) or its Report opens (finished), announcing only the current state (FR31)

**Given** the keyboard model
**When** shortcuts are used
**Then** `g` chords, `?`, `/`, j/k, x, e, c, p work per the v2 EXPERIENCE.md map, never while focus is in a field, select, combobox, menu or open dialog or during IME composition; Esc closes one layer at a time, innermost first; the `?` sheet lists the current bindings; Settings → Keyboard offers On / Only when the list or detail has focus / Off and remapping (WCAG 2.1.4)
**And** the focus model holds: skip link, F6 regions, focus moves only on user-initiated surface changes

### Story 9.5: Overview: the verdict first, live while it runs

As a reviewer,
I want the result summarised in a sentence with the key numbers and the run as a live timeline,
So that I know in seconds whether a PR needs my attention.

**Acceptance Criteria:**

**Given** a running review
**When** Overview shows
**Then** the hero reads "Reviewing", tiles are skeletons replaced in place, and the run timeline fills from run events in seq order with a state word, outcome and duration per layer; the running ring animates at most 5 seconds; nothing shimmers; reduced motion removes all transitions

**Given** a finished review
**When** Overview shows
**Then** the hero shows the status pill, the verdict sentence (from the walkthrough summary, else built from status and counts) and gate reasons when the gate failed; four tiles (new findings, pre-existing, checks, tokens and model) each lead to their surface; "Needs attention" previews the new findings; a toast "Review finished · <n> new findings · Show findings" appears if the user was elsewhere, never takes focus, and its action is also `g a`
**And** when an earlier review of this PR exists, the "Since last review" strip shows resolved / still open / new, each a link; on the Web App, "Earlier runs" lists the PR's runs with new / resolved / unchanged against the previous one (FR34)

**Given** a failed run, a failed or rate-limited AI layer, or a moved head
**When** Overview shows
**Then** the reason is in plain words with Retry (the AI node reads "Failed: provider rate-limited" and the status is never PASSED), or the Outdated banner offers Review again and posting is off with the reason

### Story 9.6: Findings under their code

As a reviewer,
I want each finding shown under the lines of the PR it is about, with the fix beside it,
So that I can judge it without leaving the page.

**Acceptance Criteria:**

**Given** `ReviewService v1`
**When** this story lands
**Then** it serves `GET /v1/runs/:id/hunks` (additive): for each file with findings, the PR's diff hunks overlapping the findings' line ranges with 3 lines of context, at most 400 lines per file and 4,000 per run, from the run's PR context; a run without context returns a clear "unavailable" (UX-DR27 as amended)

**Given** Needs attention and Pre-existing
**When** they show
**Then** the list is rows of a native checkbox ("Include in post: <SEVERITY> <title>, <path>:<lines>") and a title button with `aria-current` on the shown finding; j/k move between rows and update the detail without moving focus, Enter moves focus to the detail heading, x toggles inclusion; Select all (new findings only) and Select none; filter chips (toggle buttons) by severity, confidence and file; low-confidence findings start excluded with a "Low confidence" badge; the "20 pre-existing · Show" row opens Pre-existing, where findings are excluded until ticked (UX-DR26)
**And** the detail shows the badges (severity, category, source, confidence, scope, advisory, dismissed by), the title, the GitHub link, the hunk as a table with line numbers and change type in text, the comment with "Why it matters" and the recommendation, and the suggested change; findings outside the diff show without code and with the file link; failed hunks show "The code for this finding could not be loaded."
**And** the first exclusion in a session shows the teaching hint (👎 or /dismiss on GitHub teaches future reviews)

**Given** widths of 800–1099px and below 800px
**When** the page is used
**Then** the sidebar becomes an icon rail with accessible names and the active indicator; below 800px the detail replaces the list with "← Needs attention" and "1 of n", and back returns focus to the row

### Story 9.7: Edit, preview, post, and fix with your agent

As a reviewer,
I want to reword a finding in place, see exactly what will be posted, post it, or hand the findings to my coding agent,
So that what reaches GitHub is what I mean, and fixing is one step away.

**Acceptance Criteria:**

**Given** a finding
**When** the user presses e
**Then** an editor opens in the thread for title, description and recommendation, each with a live Markdown preview, plus "Include the suggested change"; Save (⌘Enter / Ctrl+Enter) keeps the edits for posting and marks the finding "edited"; Esc with unsaved changes keeps the draft and moves focus to Cancel, and only Cancel discards (FR33)

**Given** the post drawer (p or "Preview post")
**When** it opens
**Then** it is a modal dialog with a visible Close; it builds the preview (inline comments, still open, resolved, overflow to the summary, the summary) and announces "Preview ready"; Post appears after the preview, labelled with the counts; review type Comment, or Request changes when allowed, never Approve; posting re-reads the head (AD-23), shows "Posting…", and ends in posted (links, focus on the result), already posted, or refused (reason and permission, selection kept); any change to inclusion or wording discards the preview; full width below 800px

**Given** included findings
**When** the user chooses "Fix <n> included findings with your agent" (Needs attention header or drawer)
**Then** the agent panel shows `pr-reviewer fix <pr>` with Copy and "Copy combined prompt"; per finding, c copies its agent prompt; nothing runs from the page

### Story 9.8: Checks, Walkthrough, Stats and Settings in v2

As a reviewer,
I want every part of the Report, my stats and my settings in v2,
So that I never need classic for anything.

**Acceptance Criteria:**

**Given** a Report
**When** Checks and Walkthrough show
**Then** Checks has the full timeline with each layer's detail and reason, detected projects and limitations; Walkthrough has the summary, effort, changes by file, linked issues, related code, learnings used (who and a link), Review Rules checked, run details, and Download Markdown / JSON; every Report field is reachable somewhere in v2 (FR32)

**Given** Stats (`g s`, sidebar, palette)
**When** it shows
**Then** tiles (posted, addressed, dismissed, still open) for 7 / 30 / 90 days, tables by severity and source and by PR, with loading, empty and error states

**Given** Settings
**When** it opens
**Then** on `serve` it shows provider and model from the config; on the Web App it adds an allow-listed endpoint, masked API key, Test and Remove key, and opens itself when AI is not ready (FR35); it also holds theme, default view and Keyboard; saving, saved and errors are announced and tied to fields

### Story 9.9: v2 accessibility audit and parity sign-off

As a maintainer,
I want proof that v2 is accessible and does everything classic does,
So that it can become the default safely.

**Acceptance Criteria:**

**Given** every v2 surface in light and dark, at 320px and 200% zoom, and in forced colours
**When** the audit runs
**Then** automated checks pass, the DESIGN.md contrast targets hold, and a keyboard and screen-reader checklist passes (list pattern, shortcut guard, Esc order, dialogs, focus model, announcements, toasts, state words)

**Given** Story 9.3's parity checklist
**When** every item passes in v2 on both `serve` and the Web App
**Then** the default view becomes v2 (the browser's own choice and the server setting still win), classic stays one click away, and the README and docs/web-app.md describe both
