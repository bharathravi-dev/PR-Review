---
status: final
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-pr-reviewer-2026-11-24/prd.md
  - _bmad-output/planning-artifacts/prds/prd-pr-reviewer-2026-11-24/addendum.md
  - _bmad-output/planning-artifacts/architecture/architecture-pr-reviewer-2026-11-25/ARCHITECTURE-SPINE.md
  - additional_info.md
---

# PR Reviewer - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for PR Reviewer, decomposing the requirements from the PRD and the Architecture Spine into implementable stories. There is no UX design contract yet; Release 1 is CLI-only, and UX work for the Web App (R3) and Browser Extension (R4) is planned before those releases.

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

### UX Design Requirements

None for Release 1 (CLI). Web App (Epic 6) and Browser Extension (Epic 7) require a `bmad-ux` pass before their stories are detailed.

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

### Epic 7: Review from the GitHub PR page (Release 4)
A user installs the browser extension and reviews the PR they're looking at — Standalone with their own key, or Connected to their Web App or local CLI.
**FRs covered:** FR36, FR37, FR38

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

A user installs the browser extension and reviews the PR they're looking at — Standalone with their own key, or Connected. *(Release 4 — requires a `bmad-ux` pass; stories outlined.)*

### Story 7.1: Standalone review from the side panel

As a user,
I want to install the extension, add my API key, and click Review on a PR,
So that I get a review without running anything else.

**Acceptance Criteria:**

**Given** the extension installed with an API key and GitHub sign-in
**When** the user clicks Review on a PR page
**Then** the side panel runs `core` with HTTP providers in the panel page (not the service worker), shows progress and Findings, and labels skipped Sandbox layers (FR36, FR37, AD-16)

### Story 7.2: Findings in context and Publish

As a user,
I want each Finding linked to its diff line and to post selected ones,
So that I can act on them from the PR page.

**Acceptance Criteria:**

**Given** a completed review in the panel
**When** the user clicks a Finding or publishes selected ones
**Then** it navigates to the diff line using API data (not page structure) and publishes via the engine (FR38)

### Story 7.3: Connected mode

As a user,
I want to connect the extension to my Web App or a paired local CLI,
So that I get full reviews including tool checks.

**Acceptance Criteria:**

**Given** a backend URL or a paired local CLI companion (loopback, pairing token, origin check)
**When** the user reviews in Connected mode
**Then** the backend runs the full engine and the panel shows the same Report (FR37)
