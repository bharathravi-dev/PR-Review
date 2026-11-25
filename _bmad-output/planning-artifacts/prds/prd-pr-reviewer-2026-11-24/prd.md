---
title: "PRD: PR Reviewer — multi-channel automated PR validation"
status: final
created: 2026-11-24
updated: 2026-11-24
---

# PRD: PR Reviewer
*Working title — confirm.*

## 0. Document Purpose

This PRD defines what PR Reviewer must do as an open-source product that anyone can install and use. It evolves the existing single-user tool (`review.mjs` plus a manually triggered GitHub Actions workflow) into one Review Engine reachable through four Channels. It is written for the maintainer and for the downstream BMAD workflows (UX, architecture, epics and stories).

It builds on, and does not duplicate, the **Validation Capability Spec** (`additional_info.md`), which details *how thoroughly* a PR must be validated (validation layers, tool registry, finding schema, severity, deduplication, quality gates, isolation). This PRD defines *who uses it, through which channels, with which AI, and what "done" means*. Where the two overlap, this PRD's FRs reference the spec section rather than restating it.

Terms are anchored in §3 Glossary. Features are grouped in §4 with globally numbered FRs. Inferred items are tagged `[ASSUMPTION]` inline and indexed in §10. Technology and mechanism choices live in `addendum.md`.

## 1. Vision

Code review is the last cheap place to catch a bad change, and it is where reviewers are most rushed. PR Reviewer gives every pull request a first, thorough review before a human spends time on it: it reads the change in the context of the whole repository, runs the checks that can be run deterministically (compile, lint, tests, static analysis), adds AI judgement for what tools can't see (logic, architecture, performance, regression risk), and posts the result where the work happens — on the PR itself — as precise inline comments and a summary.

It is for any developer, not just its author. You bring your own AI (a Claude or ChatGPT subscription you already pay for, an API key from any major provider, or a local model) and your own GitHub identity. Nothing about a repository, organisation, URL, or model is baked in; every behaviour comes from configuration that the user or the repository supplies.

It meets people where they already are: a command you run against a PR link, a web page you paste a link into, a reviewer that quietly checks every PR you open or are asked to review — including in organisations where you can't install anything — and a button on the GitHub PR page. One engine, one set of rules, the same findings, whichever door you came in through.

**Why this, given what exists.** Commercial reviewers (CodeRabbit, GitHub Copilot review, Greptile, Graphite, Bito) sell their own model per seat or per credit and need an org-level install. The open-source ones (PR-Agent, PRScope) let you bring a model but each offers essentially one channel. None lets an individual reuse a subscription they already pay for, review in orgs they don't administer, and get the same deterministic-first, honest-status review from a terminal, a web page, automation, and the PR page alike. That combination is the gap. *(Sources: `research-digest.md`.)*

## 2. Target User

### 2.1 Jobs To Be Done

- **Functional:** When a PR is opened or I'm asked to review one, get a trustworthy first-pass review — real tool results plus contextual AI findings — on the PR within minutes, so my own review time goes to judgement, not hunting.
- **Functional:** Use the AI I already pay for (subscription or API key, any provider) instead of being locked to one vendor or paying twice.
- **Functional:** Have it happen without me remembering to run it, across my own repos *and* the org repos I contribute to but don't administer.
- **Contextual:** Trigger a review from wherever I am — terminal, browser tab, the PR page itself, or my phone (via GitHub).
- **Emotional:** Merge with confidence; don't be the reviewer who approved the PR that broke production.
- **Social:** Leave review comments that are precise and evidence-backed, so they read as helpful rather than as bot noise to teammates.

### 2.2 Non-Users (v1)

- Organisations wanting a centrally administered, org-wide installed review bot with seat management and billing. *(The product works per user; org-wide admin is not a v1 goal.)*
- Teams on GitLab, Bitbucket, or Azure DevOps. `[ASSUMPTION: GitHub (github.com, and GitHub Enterprise Server via configurable host) only in v1]`
- People who want the tool to approve or merge PRs on their behalf.
- Non-technical users who want a ready-made hosted web page: v1 has no public hosted instance; they can use the CLI, the extension's Standalone mode, or a teammate's self-hosted Web App.

### 2.3 Key User Journeys

- **UJ-1. Anika reviews a PR from her terminal with the subscription she already has.**
  Anika, a freelance TypeScript developer, has a Claude subscription and Claude Code installed. She installs PR Reviewer globally from npm, runs its setup once (it detects the logged-in Claude Code and her GitHub CLI login, and asks nothing else), then runs a review against a PR link a client sent. She sees progress per validation layer, then a Report: Overall Status, Findings by severity, which checks ran and which were skipped and why. She posts it; the CLI shows a preview and asks to confirm, then prints the review link. **Edge case:** the PR is in a private repo her token can't read — the CLI says exactly which permission is missing and how to grant it, and posts nothing.

- **UJ-2. Arjun stops manually reviewing every PR he's tagged on.**
  Arjun is a tech lead who contributes to an organisation's repos (he can't install apps there) and owns a few personal repos. He runs the Auto-Review setup once; it creates the automation inside his own GitHub account. From then on, whenever he opens a PR, someone opens a PR on his repos, or he is requested as a reviewer anywhere, a review appears on that PR under his name within the discovery interval (30 minutes by default). Where he is a requested reviewer, it arrives as a pending review that only he can see until he submits it. On each new push, the review comments only on what is new or changed and updates the existing summary instead of adding another. **Edge case:** an org enforces SSO on tokens — the automation reports "authorise this token for org X" once, as an issue in his automation repository and in the run summary, rather than failing silently on every run.

- **UJ-3. Meera gives her team a review page.**
  Meera runs a small team and self-hosts the PR Reviewer Web App with one command. Teammates sign in with GitHub, paste a PR link, watch the review run, read the Findings in the page (grouped by severity and file, with evidence), untick anything they disagree with, and post the rest to GitHub — or just keep the report in the page. Past reviews stay listed per PR. **Edge case:** the configured AI Provider is rate-limited — the run shows the deterministic results it has, reports the AI layer as `ERROR (provider rate-limited)` (never `PASSED`), and offers a retry.

- **UJ-4. Tom checks a PR link someone pasted in chat.**
  Tom opens a PR link from a chat message. The PR Reviewer extension adds a "Review" button to the PR page; he clicks it, and a side panel shows progress and then the Findings, each linked to its line in the diff. He posts two of them as comments from the panel. **Edge case:** the extension isn't set up yet — instead of erroring, the panel walks him through either adding his own AI API key and GitHub sign-in for a Standalone review, or connecting it to a backend (his self-hosted Web App or a local CLI companion).

## 3. Glossary

- **Review Engine** — The single component that performs a Review Run. All Channels use the same Review Engine and produce the same Findings for the same inputs.
- **Channel** — A way to start a Review Run and receive its Report: the **CLI**, the **Web App**, **Auto-Review**, or the **Browser Extension**.
- **Review Run** — One execution of the Review Engine against one PR at one Head Commit with one resolved Configuration. Has exactly one **Overall Status**: the Quality Gate result (`PASSED`, `PASSED_WITH_WARNINGS`, `FAILED`) when the gate could be evaluated, otherwise `INCOMPLETE` (a mandatory layer did not run), `ERROR`, or `CANCELLED` (including superseded by a newer Head Commit).
- **Coverage** — The set of Validation Layers that actually executed in a Review Run, stated in the Report headline (e.g. "AI review + static checks; build and tests not run — no Sandbox") so a reader never mistakes a partial review for a full one.
- **Mandatory Layer** — A Validation Layer whose non-execution makes the Overall Status `INCOMPLETE`. Set in user configuration (or a Channel profile); never by repository configuration. By default only secret scanning and PR-context retrieval are mandatory; Sandbox-dependent layers are optional unless the user marks them mandatory (e.g. in their Auto-Review or CI profile).
- **Head Commit** — The exact PR commit SHA a Review Run analyses. All Findings are tied to it.
- **Validation Layer** — One independently reported stage of validation (e.g. compile, lint, framework standards, static analysis, security, AI contextual review), as defined in the Validation Capability Spec §7. Each layer reports its own **Layer Status**.
- **Layer Status** — One of `PASSED`, `FAILED`, `WARNING`, `SKIPPED`, `ERROR`, `TIMEOUT`, `NOT_APPLICABLE` (Validation Capability Spec §33). `SKIPPED`, `ERROR`, and `TIMEOUT` always carry a reason and are never displayed or counted as `PASSED`. A validation failure (e.g. a compile error, which is a Finding) is distinct from an infrastructure failure (e.g. the compiler could not run, which is `ERROR`).
- **Validator** — A pluggable unit that implements one or more Validation Layers for specific technologies or tools (Validation Capability Spec §22).
- **Finding** — One issue produced by a Validator, in the common finding schema (Validation Capability Spec §23): severity, category, confidence, source, file and line range, evidence, recommendation, new-code classification.
- **Report** — The consolidated output of a Review Run: Overall Status, detected technologies, each layer's Layer Status, Quality Gate result, Findings, skipped checks and reasons.
- **Publish** — Posting a Report to GitHub as a PR review (summary + inline comments on valid diff lines), and optionally a commit status / check.
- **Quality Gate** — The configurable pass/fail policy evaluated over a Report (Validation Capability Spec §26). Its result is the Review Run's Overall Status when evaluable.
- **AI Provider** — A source of model inference. Two kinds: **API Provider** (authenticated by an API key or cloud credential: Anthropic, OpenAI, Google Gemini, OpenRouter, Azure OpenAI, AWS Bedrock, local Ollama) and **Subscription Provider** (inference performed by a vendor's own, unmodified, user-logged-in agent CLI on the user's subscription: Claude Code, OpenAI Codex CLI). Subscription Providers are available only in some Channels (FR-10).
- **Credential** — Any secret the product uses: an AI Provider key or login, or a GitHub token. Credentials are never hardcoded, never written to Reports, logs, or prompts.
- **Reviewer Identity** — The GitHub identity a Publish appears under. `[ASSUMPTION: default is the user's own GitHub account; a bot identity is optional]`
- **Configuration** — The fully resolved set of settings for a Review Run, merged from Configuration Layers in a fixed precedence order. Contains no product-shipped repo names, URLs, or org names.
- **Configuration Layer** — One source of settings: product defaults → user configuration → repository configuration (a file in the reviewed repo) → per-run overrides (flags, environment, UI choices).
- **Review Rules** — Human-written, repo-specific review guidance (today's `rules/*.md`), supplied through Configuration — never bundled for a specific repo.
- **Watch Scope** — The set of PRs Auto-Review covers for a user: PRs the user authored, PRs on repos the user owns, PRs where the user is a requested reviewer, and PRs in listed orgs/repos the user does not administer — each independently enabled, with include/exclude filters.
- **Sandbox** — An isolated, ephemeral environment in which PR code may be checked out, installed, built, and tested (Validation Capability Spec §29).
- **Validation Capability Spec** — `additional_info.md`: the detailed requirements for validation depth and behaviour that this PRD references.

## 4. Features

### 4.1 Review Engine

**Description:** The Review Engine takes a PR reference and a Configuration and produces a Report. It fetches the PR context (metadata, changed files, diff hunks, full file contents, existing reviews and comments, repo rules and project configs), detects technologies per project in the repository, selects Validators, runs Validation Layers (deterministic where a tool exists, AI where context or judgement is needed), normalises and deduplicates Findings, evaluates the Quality Gate, and assembles the Report. Every Channel calls the same engine. Realizes UJ-1 through UJ-4. The validation depth and rules are specified in the Validation Capability Spec §5–§26 and are not restated here.

**Functional Requirements:**

#### FR-1: Accept any GitHub PR reference
A user can start a Review Run with a PR URL or `owner/repo#number` for any repository their GitHub Credential can read, on github.com or a configured GitHub Enterprise host. Realizes UJ-1, UJ-3, UJ-4.

**Consequences (testable):**
- No repository, organisation, or host name is present in product code or bundled defaults; a repo-scan test fails the build if one is added.
- The GitHub API base URL is taken from Configuration (default github.com).
- An unreadable PR produces an error naming the missing permission or scope; no partial Publish occurs.

#### FR-2: Complete and faithful PR context
The engine retrieves PR context as listed in Validation Capability Spec §5, handling pagination, truncated or missing patches, binary, renamed, and deleted files, forks, and private repositories, and pins the run to the Head Commit.

**Consequences (testable):**
- If the PR head moves during a run, the run is marked superseded and does not Publish (Validation Capability Spec §28).
- Files over configured size limits are listed in the Report as "context truncated", not silently dropped.

#### FR-3: Technology-aware validator selection
The engine detects languages, frameworks, versions, and project boundaries (monorepo-aware) from evidence and selects applicable Validators per affected project (Validation Capability Spec §6). It never guesses a framework without evidence.

**Consequences (testable):**
- The Report lists detected technologies with confidence and evidence, including detected framework and language versions.
- Rules are selected for the detected version: e.g. the Angular validator supports Angular 12 and later and never recommends features newer than the project's Angular version (Validation Capability Spec §6.2). `[ASSUMPTION: Angular 12+ is the supported range for v1]`
- Unsupported technologies get clearly labelled best-effort review, not silence.

#### FR-4: Layered validation with honest status
Each Validation Layer reports a Layer Status. Deterministic layers use the repository's own tool configurations where present (e.g. the repo's lint config), and only Findings on new or worsened code count toward the Quality Gate by default (Validation Capability Spec §7, §21, §33). A failure of one Validator degrades that layer only; the run continues with the others.

**Consequences (testable):**
- A layer that did not execute is never displayed or counted as `PASSED`; a Mandatory Layer that did not execute makes the Overall Status `INCOMPLETE`, never `PASSED`.
- Every Report headline states its Coverage. A CLI run on a machine without a Sandbox completes (it is not `INCOMPLETE` by default) and its headline says build, test, and install-dependent checks did not run.
- Each Validator runs under a configurable timeout (exceeding it yields `TIMEOUT`), and the number of Validators running concurrently is configurable.
- Pre-existing issues are labelled as such and excluded from the Quality Gate unless the PR worsened them (base vs head comparison).
- A tool crash is reported as `ERROR` with the cause, not as a Finding against the PR.
- When a repository has no configuration for a lint or style tool (e.g. no ESLint or TSLint config), the layer still runs with a named default ruleset compatible with the detected versions, and the Report says which default was applied. The product never edits the repository's configuration (Validation Capability Spec §8).

#### FR-5: Reuse existing CI and static-analysis results
When the PR already has results from CI or static analysis (e.g. a SonarQube quality gate, a CI test run) for the same Head Commit, the engine reads and includes them instead of re-running, and never reuses results from an older commit (Validation Capability Spec §10.3).

#### FR-6: AI contextual review with guardrails
The AI layer receives structured context (detected stack, diff, related code, deterministic results, Review Rules) and follows the restrictions in Validation Capability Spec §20.3 — no fabricated tool results, paths, or line numbers; repository and PR content treated as untrusted data; confidence assigned to every Finding. AI-only Findings cannot fail the Quality Gate by default.

**Consequences (testable):**
- Every AI Finding's file and line exists in the Head Commit; Findings that don't validate are dropped and counted in the Report.
- A PR containing instructions aimed at the AI ("approve this") is reported as a Finding, not obeyed.
- `LOW`-confidence AI Findings go to a separate advisory section of the Report and are not published inline unless configured (Validation Capability Spec §20.4).

#### FR-6a: AI cannot act, only answer
Every AI call is text-in, schema-validated-out: a single structured request per call, never an agent loop. The AI never receives tools that can execute commands, write files, access the network beyond its own provider, or call GitHub. When a Subscription Provider's agent CLI is used, it runs with tools disabled, outside any checkout of the PR, in an empty working directory that contains no repository agent-configuration files (e.g. `CLAUDE.md`, `AGENTS.md`, `.claude/` settings or hooks), with project-level configuration loading disabled where the CLI allows, and with no GitHub or other Credentials in its environment. Only the Review Engine Publishes (Validation Capability Spec §30).

**Consequences (testable):**
- A test PR whose files instruct the AI to run a shell command, edit a file, or post a comment produces no command execution, no file change, and no GitHub write — only, at most, a Finding about the injection attempt.
- A test PR that adds a `CLAUDE.md`, `AGENTS.md`, or `.claude/settings.json` with hooks has no effect on the Subscription Provider's behaviour.
- AI output that fails schema validation is rejected and the AI layer reports `ERROR`, not partial free text.

#### FR-6b: No secrets to the AI
Secret scanning runs on the PR context before any prompt is built; detected secret values are redacted from everything sent to the AI Provider and reported by location only (Validation Capability Spec §13).

**Consequences (testable):**
- A PR adding a fake key results in a secret Finding, and the key's value appears in no request sent to the AI Provider (verified by a recording provider in tests).

#### FR-7: Deduplicated, prioritised Findings and a Quality Gate
Findings from all Validators are normalised, deduplicated with stable fingerprints, prioritised by severity, and evaluated against the configured Quality Gate, producing one of `PASSED`, `PASSED_WITH_WARNINGS`, `FAILED`, `INCOMPLETE`, `ERROR`, `CANCELLED` (Validation Capability Spec §23–§26).

#### FR-8: Machine-readable Report
Every Report is available as human-readable Markdown and as structured JSON matching the finding schema, so any Channel or external tool can consume it. `[ASSUMPTION: SARIF export is a v1.x addition, not v1]`

**Notes:** The full layer catalogue (L1–L14) is not a v1 commitment for every technology; see §6.1 for the v1 validator set.

### 4.2 AI Provider Layer

**Description:** Users choose which AI powers the AI Validation Layers. The product supports both API Providers and Subscription Providers behind one interface, so the Review Engine and Channels don't change when a user switches. Users can set a default provider and model, override per run, and configure a fallback. Realizes UJ-1, UJ-3.

**Functional Requirements:**

#### FR-9: Supported AI Providers
A user can run reviews with any of: Anthropic API, Claude subscription via the user's logged-in Claude Code, OpenAI API, ChatGPT subscription via the user's logged-in OpenAI Codex CLI, Google Gemini (API key), OpenRouter, Azure OpenAI, AWS Bedrock, and local models via Ollama. Adding another provider requires only a new provider adapter registered with the engine.

**Consequences (testable):**
- The same PR reviewed with two different providers yields Reports with identical deterministic layers; only AI-layer Findings differ.
- A conformance test suite runs against every provider adapter, including schema-valid structured output.

#### FR-9a: Custom endpoints without code
A user can add an AI Provider purely through Configuration by giving an OpenAI-compatible or Anthropic-compatible endpoint (base URL, Credential reference, model name), covering self-hosted gateways, company proxies, and new vendors. Realizes "anyone's AI" without a product release.

**Consequences (testable):**
- A provider defined only in user configuration passes the same conformance suite as built-in adapters.

**Out of Scope (FR-9, FR-9a):**
- GitHub Models (retired 2026-07-30), GitHub Copilot subscriptions (no sanctioned third-party route), and Gemini via a personal Google login (no longer supported by Google for third-party CLIs).

#### FR-10: Subscription Providers only where the vendor permits
Subscription Providers are used only by invoking the vendor's own unmodified CLI that the user installed and logged into, and only in Channels where the vendor's terms allow it. The product never offers a vendor login of its own, and never extracts, reads, proxies, or transmits subscription session tokens. One exception applies, to the Auto-Review opt-in below: there the user generates the vendor's own long-lived CLI token with the vendor's tool and stores it as a secret in their own automation; the product only passes that secret, unread, to the vendor CLI's environment.

| Subscription | CLI | Auto-Review (user's own runner) | Web App | Browser Extension |
|---|---|---|---|---|
| Claude (Pro/Max) via Claude Code | Allowed (user's own unmodified Claude Code) | Opt-in with warning (grey area under vendor terms) | Not available (third-party routing of subscription credentials is not permitted) | Not available |
| ChatGPT (Plus/Pro) via Codex CLI | Allowed (user's own Codex login) | Opt-in with warning (grey area under vendor terms) | Not in v1 (requires OpenAI's approved "Sign in with ChatGPT" programme) | Not available |

**Consequences (testable):**
- If the vendor CLI is missing or logged out, setup and runs say so and offer the API-key route.
- No file written by the product contains a vendor session token.
- Selecting a Subscription Provider in a Channel where it isn't available is refused with an explanation, not silently swapped.
- Setup tells Claude subscription users that headless use draws on their plan's separate usage credit and may be billed at API rates beyond it (vendor policy as of 2026-06; re-check at release).
- Enabling a Subscription Provider for Auto-Review requires an explicit opt-in that shows a warning: this use is a grey area under the vendor's terms, the vendor may restrict it without notice, and an API key is the supported route. Without the opt-in, Auto-Review uses API Providers only. If the subscription route stops working, Auto-Review reports it via FR-29 and, if configured, falls back per FR-11.

#### FR-11: Provider selection, model choice, and fallback
A user can set a default AI Provider and model in Configuration, override per run, and define an ordered fallback used when the primary is unavailable or rate-limited. The Report states which provider and model produced each AI Finding.

**Consequences (testable):**
- With the primary provider forced to fail, the run completes on the first fallback and the Report names both the failure and the provider used.

#### FR-12: Cost and usage transparency
Each Review Run reports input and output token usage (or "not reported by provider") and an estimated cost where the provider publishes pricing. A user can set a per-run and a monthly token or cost ceiling (the monthly ceiling applies across all Channels and Auto-Review); reaching either stops the AI layer, which reports `SKIPPED (cost ceiling reached)` with the Findings produced so far marked partial. `[ASSUMPTION]`

### 4.3 Configuration and Credentials

**Description:** Everything is dynamic. Behaviour is the merge of Configuration Layers; repositories can carry their own settings and Review Rules; users keep personal settings and Credentials. Realizes the "no hardcoded values" requirement across all journeys.

**Functional Requirements:**

#### FR-13: Layered Configuration
Configuration resolves from product defaults → user configuration → repository configuration (a file in the reviewed repository) → per-run overrides, with later layers winning. The exception: repository configuration may set only **review-policy keys** — Review Rules, include/exclude paths, thresholds, comment limits, and enabling extra Validators. It can never set AI Providers or endpoints, Credential references, the review event or Reviewer Identity, Sandbox use, Mandatory Layers, or anything that sends data to a new destination; such keys in a repository file are ignored and reported. A user can print the resolved Configuration for any PR, including which layer set each value.

**Consequences (testable):**
- Removing all user and repository configuration still yields a working review with documented defaults.
- Product-shipped defaults contain no repository, org, host, or URL values (enforced by FR-1's scan).
- A user can mark settings as mandatory (e.g. secret scanning on, minimum checks); repository configuration cannot weaken or disable them.
- Repository configuration is read from the PR's **base** branch, so a PR cannot disable its own checks by editing the config file; changes to that file, to dependency manifests, lockfiles, and CI workflows are always analysed (Validation Capability Spec §34).

#### FR-14: Review Rules from Configuration
Review Rules can come from the reviewed repository, from the user's configuration (per repo, per org, or global), or from a URL/file path the user supplies. Rules are checked on every run and reported as a checklist in the Report. Rules from the repository are untrusted data: they can add things to check, but cannot change the output format, suppress Findings, alter severity mapping, or direct the AI's behaviour beyond describing what to look for; user-configured rules take precedence where they conflict.

**Consequences (testable):**
- With rules defined both in the repository and in user configuration for that repo, the Report's checklist shows each rule and its source.
- An unreachable rules URL yields a warning in the Report and the run continues with the remaining rules.

#### FR-15: Credential handling
Credentials are read from the OS keychain, environment variables, or the vendor CLI's own login (GitHub CLI, Claude Code, Codex) — never from repository configuration, and never written to Reports, logs, prompts, or Published comments. `[ASSUMPTION: OS keychain is the default store for the CLI]`

**Consequences (testable):**
- A test injects a fake key into every input path and asserts it never appears in any output artefact.
- The GitHub write Credential is never exposed to Sandbox processes (Validation Capability Spec §29).

#### FR-16: Guided setup
A first-time user can run one setup flow that detects available Credentials (GitHub CLI login, logged-in Claude Code or Codex, provider keys in env), asks only for what's missing, validates each by a test call, and writes user configuration. Realizes UJ-1.

**Consequences (testable):**
- On a machine with GitHub CLI and Claude Code logged in, setup completes without asking for any value.
- An invalid key is reported at setup with the provider's error, not at first review.

#### FR-16a: Migration from the current tool
Existing users of today's `review.mjs` can keep their `rules/*.md` files (read as Review Rules) and their existing GitHub Actions secrets names; a migration note maps old flags (`--post`, `--event`, `--model`, `--rules`, `--dry-run`, `--list`) to the new CLI.

### 4.4 Publishing to GitHub

**Description:** Reports can be published to the PR as a review with a summary and inline comments, consistently across Channels and idempotently across repeated runs. Realizes UJ-1 through UJ-4.

**Functional Requirements:**

#### FR-17: Publish summary and inline comments
A user can Publish a Report as one PR review containing a summary (Overall Status, Coverage, detected technologies, each layer's Layer Status, Findings by severity, skipped checks and reasons, limitations) and inline comments on valid diff lines, each carrying severity, category, description, impact, evidence, recommendation, source, and confidence (Validation Capability Spec §27). Findings that cannot attach to a changed line go into the summary. Code suggestions are published only when the replacement range and code are valid. Every Published summary discloses that it was generated by PR Reviewer and names the AI Provider and model used.

**Consequences (testable):**
- No Publish is rejected by GitHub for an invalid line; this is verified before sending.
- Published AI-generated text is sanitised: `@`-mentions and team mentions are neutralised, links are limited to the PR's own repository and an allow-list of documentation hosts, and raw HTML and images are stripped.
- The number of inline comments respects a configurable maximum; the overflow is listed in the summary.

#### FR-18: Safe review event
Reviews are published as `COMMENT` by default. `REQUEST_CHANGES` is available only in manually started runs when enabled in user configuration — never in Auto-Review, where it could block merges through the user's reviewer or code-owner role — and the product never approves or merges a PR.

#### FR-19: Idempotent re-review
Re-running on the same Head Commit with the same Configuration never creates a duplicate review. A run on a new Head Commit:
- re-evaluates the Quality Gate over the whole PR, reusing cached results for unchanged inputs;
- updates the product's own previous summary in place (or supersedes it) and lists in it the Findings that are now resolved, resolving GitHub conversation threads only where the user's permissions allow;
- posts inline comments only for Findings that are new or changed, as a new review for that Head Commit, since GitHub does not allow adding comments to a submitted review.

The product never edits or deletes human comments (Validation Capability Spec §28). Because Publishes may appear under the user's own identity, the product recognises its own summaries and comments by a hidden marker, never by author.

**Consequences (testable):**
- Running the same review twice leaves exactly one summary on the PR.
- Two users of the product reviewing the same PR each produce at most one summary per Head Commit.
- After a push that fixes one of three Findings, the PR shows no repeated inline comments for the two still-open ones, and the summary lists one resolved.
- A human comment written by the same GitHub user is never edited or removed.

#### FR-20: Reviewer Identity
Publishes appear under the user's own GitHub identity by default; a user can instead configure a bot identity they control. `[ASSUMPTION]`

#### FR-20a: Don't impersonate the human reviewer
When the user is a requested reviewer on someone else's PR, Auto-Review by default creates a **pending (draft) review** visible only to the user, so the review request stays open and teammates never see a review the user hasn't read; the user submits it from GitHub (or any Channel) after checking it. A user can opt in to publishing immediately per Watch Scope item. For PRs the user authored or repos they own, publishing immediately is the default.

**Consequences (testable):**
- For a review-requested PR under default settings, the PR's review request to the user is still pending after Auto-Review runs, and the PR's other participants see no new review.

#### FR-20b: Finding feedback
Anyone on the PR can mark a published Finding as wrong or not useful (a reaction or a short reply on the comment). The product reads this feedback on later runs: it does not re-raise a dismissed Finding on the same code, and it counts dismissals for SM-2.

**Consequences (testable):**
- A Finding dismissed on one Head Commit is not re-posted on the next Head Commit if its code is unchanged.

#### FR-21: Optional commit status
Where permissions allow, a Review Run can set a commit status or check run on the Head Commit reflecting the Quality Gate. It never overrides branch protection. `[ASSUMPTION: off by default for repos the user does not administer]`

### 4.5 Channel: CLI

**Description:** A command-line tool installable globally from npm (and runnable without install via `npx`) that runs the Review Engine locally against any PR reference. It is also the building block for Auto-Review and the extension's local mode. Realizes UJ-1.

**Functional Requirements:**

#### FR-22: Install and run
A user can install the CLI globally from npm on macOS, Linux, or Windows with a supported Node.js LTS, run setup (FR-16), and review a PR by reference. The CLI shows per-layer progress and prints the Report.

#### FR-23: Preview before Publish
With a publish option, the CLI shows what will be posted (summary and inline comment count) and asks for confirmation; a non-interactive flag skips the prompt for automation.

#### FR-24: Automation-friendly output
The CLI can write the Report as Markdown and JSON to a chosen location, and exits with documented exit codes mapped to the Overall Status, so it can be used in any CI system.

**Consequences (testable):**
- Each Overall Status maps to a distinct, documented exit code; `INCOMPLETE` and `ERROR` never exit 0.
- The JSON Report validates against a published schema.

#### FR-25: List and pick PRs
A user can list open PRs for a repo or for their Watch Scope and choose one to review.

**Consequences (testable):**
- The list shows, per PR, whether the current Head Commit has already been reviewed.

#### FR-25a: Local usage stats
A user can see, from GitHub data for PRs they reviewed with the product, how many Findings were resolved, dismissed, or left open over a period — with no telemetry involved. Realizes measurement of SM-1 and SM-2 for each user.

### 4.6 Channel: Auto-Review

**Description:** A user can enable automatic reviews of every PR in their Watch Scope. The automation runs entirely within the user's own GitHub account (or a runner the user controls); nothing is installed on repositories the user doesn't administer. New PRs and new pushes are discovered and reviewed; reviews are published under the Reviewer Identity. Realizes UJ-2.

**Functional Requirements:**

#### FR-26: One-command enablement
A user can enable Auto-Review with one setup command — from the CLI, or as a GitHub CLI (`gh`) extension command — that uses their existing GitHub CLI login to create the automation in their own GitHub account, stores the needed Credentials as secrets there, and runs a first discovery to confirm it works. `[ASSUMPTION: a gh extension is offered alongside the npm CLI]` Discovery uses the user's own GitHub Credential to find PRs, because a GitHub App, webhook, or workflow on a repository the user doesn't administer requires that repository's admins.

**Consequences (testable):**
- Nothing is installed on, and no admin or write access is required to, target repositories; the only action on them is posting reviews/comments as the user.
- Disabling removes the automation and its stored secrets.
- The GitHub Credential stored for the automation has the least privilege that works for the Watch Scope (read PRs and post reviews; never `workflow`, admin, or delete scopes), has an expiry, and setup explains its scope in plain language. The automation warns before expiry (FR-29). Disabling deletes the stored secret and directs the user to revoke the token, with a direct link.
- The automation created in the user's account is self-contained and pinned to a released version of the product: at run time it depends on nothing the maintainer controls other than the public package registry, and it upgrades only when the user chooses.
- Discovery stays within GitHub's search and API rate limits for a Watch Scope of at least 200 repositories. `[ASSUMPTION]`

#### FR-27: Watch Scope
A user can independently enable: PRs they authored; PRs on repositories they own; PRs where they are a requested reviewer; PRs in listed orgs or repositories they don't administer — each with include/exclude filters (repo, org, branch, label, author, draft status).

**Consequences (testable):**
- With only "requested reviewer" enabled, a PR the user authored is not reviewed.
- An excluded org's PRs are never reviewed even when the user is a requested reviewer there.
- Org and other-owner scopes are off until enabled per org; enabling one shows that the org's code will be processed in the user's automation and sent to the user's chosen AI Provider.
- A repository whose configuration declares that automated reviews are not wanted is never reviewed by Auto-Review, whatever the user's Watch Scope says.
- On repositories the user owns, PRs from authors who are not collaborators are reviewed only after the user opts in per PR (e.g. a label), so strangers' PRs cannot spend the user's AI budget or CI minutes.

#### FR-28: Timely, non-duplicated discovery
New PRs and new Head Commits in the Watch Scope are reviewed within a configurable interval `[ASSUMPTION: default 30 minutes, chosen so idle polling alone stays well inside a GitHub Free account's monthly CI allowance; configurable]`, each Head Commit at most once (FR-19). On repositories the user owns, the user can also enable immediate review when a PR is opened or pushed. Draft PRs are skipped unless enabled.

#### FR-29: Visible health
Auto-Review reports its own failures once per cause, names the action that fixes each, and never fails silently. Failures include expired Credentials, missing org SSO authorisation, an org that requires approval for fine-grained tokens or blocks classic tokens, provider quota exhausted, and its schedule being disabled or running out of CI minutes. Each is reported where the user sees it and GitHub notifies them: an issue opened in the user's own automation repository, plus the run summary. The issue is closed automatically when the cause clears.

**Consequences (testable):**
- With an expired GitHub Credential, however many scheduled runs fail, there is exactly one open issue for that cause, naming the fix; it closes automatically once the Credential is renewed.

#### FR-29a: Runs within free limits and leaks nothing
Auto-Review's automation, at default settings, fits within the free CI allowance of a GitHub Free account for a typical user `[ASSUMPTION: ≤ 50 PRs reviewed per month]`, shows its estimated monthly CI usage at setup, keeps itself from being auto-disabled for inactivity, and never writes PR content, Findings, or code to its logs, state, or repository — only PR identifiers and Head Commit SHAs. The public-or-private choice for the automation's repository is made in architecture under these constraints.

**Notes:** Immediate review on repositories the user owns (FR-28) may use an event-driven trigger on the repository itself; that trigger is a mechanism choice, not a requirement. See addendum B3 for mechanism options.

### 4.7 Channel: Web App

**Description:** A web application where a signed-in user pastes a PR link, watches the run, reads the Report in the page, chooses which Findings to publish, and publishes to GitHub — or keeps the Report in the app only. Self-hostable with one command. Realizes UJ-3.

**Functional Requirements:**

#### FR-30: Sign in with GitHub
Users sign in with their GitHub account; the app uses that identity for reading PRs and as the Reviewer Identity. Each user's Credentials and Reports are private to them. `[ASSUMPTION]`

**Consequences (testable):**
- User B cannot read, list, or publish User A's Reports or use User A's Credentials through any page or API route.
- Only GitHub users or org members on the operator's allow-list can sign in; with no allow-list configured, only the operator can.
- When users run on an operator-provided AI key, per-user run and cost quotas apply.
- The app requests the narrowest GitHub OAuth scope that allows reading the PRs and posting reviews, and stores user tokens encrypted.
- A user can share a Report with other signed-in users by link; nothing is shared by default.

#### FR-31: Run and watch
A user can paste a PR reference, choose AI Provider and model (from what's configured), start a Review Run, and see live per-layer progress.

**Consequences (testable):**
- Progress shows each Validation Layer's Layer Status as it changes, and the run survives a page reload.

#### FR-32: Report view
The Report is shown in the page: Overall Status, Coverage, detected technologies, each layer's Layer Status, Findings grouped by severity and by file with evidence and code context, skipped checks and reasons, and AI Provider and usage.

**Consequences (testable):**
- The page renders every field present in the JSON Report (FR-8); nothing in the JSON is unreachable from the UI.

#### FR-33: Selective Publish
A user can deselect or edit Findings before Publishing, and publish to GitHub from the page. The page links to the published review.

**Consequences (testable):**
- Deselected Findings do not appear on GitHub; edited Findings appear with the edited text.

#### FR-34: History
A user can see their past Review Runs per PR and compare a PR's latest run with its previous one (new, resolved, unchanged Findings).

**Consequences (testable):**
- For a PR reviewed at two Head Commits, the comparison lists each Finding exactly once under new, resolved, or unchanged.

#### FR-35: Bring-your-own AI on the server
On a self-hosted instance, the operator or each user configures API Providers. API keys are stored encrypted at rest. Subscription Providers are not available in the Web App in v1 (FR-10). `[ASSUMPTION: per-user keys, with an optional operator-provided default]`

**Feature-specific NFRs:**
- Self-hosting is a single documented command on a standard container runtime. `[ASSUMPTION]`
- Accessible to WCAG 2.1 AA for the app's own UI. `[ASSUMPTION]`

### 4.8 Channel: Browser Extension

**Description:** A Chromium browser extension, published in the Chrome Web Store, that adds review actions to GitHub PR pages and shows results in a side panel. It works in two modes: **Standalone** — install, add your own AI API key and GitHub sign-in, and review immediately, with no server (AI review and file-parsing layers only; layers that need a Sandbox are reported `SKIPPED`); and **Connected** — drive a full Review Engine on the user's Web App or local CLI companion, including deterministic layers. Realizes UJ-4. `[ASSUMPTION: Standalone mode added to meet "just install it and validate"]`

**Functional Requirements:**

#### FR-36: Review from the PR page
On any GitHub PR page (github.com or configured Enterprise hosts), the extension shows a "Review" action that starts a Review Run for that PR (Standalone or on the connected backend) and shows progress and the Report in a side panel.

**Consequences (testable):**
- The action appears on PR pages and on no other GitHub pages, and follows client-side navigation between PRs without a page reload.

#### FR-37: Standalone and Connected modes
A new user can install the extension and complete a first review in Standalone mode using only their own API Provider key and GitHub sign-in. Optionally, the user connects the extension to a backend by URL — their own Web App instance or a local CLI companion — for full reviews. No backend URL is hardcoded. `[ASSUMPTION: Release 4 ships Standalone mode; Connected mode, with both backend kinds, follows in a 4.x release, matching §6.1]`

**Consequences (testable):**
- Standalone mode clearly labels which Validation Layers did not run and why.
- The local CLI companion accepts requests only from the paired extension: it listens on loopback only, requires a pairing token created at setup, rejects other origins, and asks for confirmation in the extension before any Publish.
- In Standalone mode the AI key is used only for calls to the provider the user configured, and is stored per the §4.8 credential NFR.

#### FR-38: Findings in context
Each Finding in the panel links to its line in the PR's diff view, and the user can Publish selected Findings from the panel.

**Consequences (testable):**
- PR data comes from the backend/GitHub API, not from reading GitHub's page structure; the extension keeps working across GitHub UI changes (including the redesigned "Files changed" view and client-side navigation between PR tabs), needing only the PR URL.

**Feature-specific NFRs:**
- In Connected mode the extension stores no AI Provider keys. Any Credential it holds (Standalone AI key, GitHub token, backend token) is kept where page scripts cannot read it, encrypted at rest, sent only over HTTPS to its own service, and covered by in-UI consent and a published privacy policy, per browser-store rules for credentials. `[ASSUMPTION]`
- Meets browser-store policies: no remotely hosted code; configuration and data fetched from the backend are treated as data only.

### 4.9 Deterministic Checks and Sandbox

**Description:** Deterministic Validation Layers (compile, lint, tests, framework tools, security scanners) need the PR's code checked out and often its dependencies installed — and many tools also execute repository files when loading their configuration (e.g. JavaScript-based lint configs). They run only inside a Sandbox. Where no Sandbox is available, those layers are reported `SKIPPED (no Sandbox)`, the Report's Coverage says so, and the review continues with layers that don't execute PR code.

**Functional Requirements:**

#### FR-39: Sandboxed execution only
Installing dependencies, building, or testing PR code happens only in a Sandbox (a local container, or a CI runner the user controls), with no GitHub write Credential, no AI Credential, no host credentials, and restricted network (Validation Capability Spec §29).

**Consequences (testable):**
- On a machine without a container runtime, the CLI runs no PR code and reports affected layers as `SKIPPED (no Sandbox)`.
- A test PR whose install script tries to read environment Credentials finds none.
- In Auto-Review, the step that executes PR code runs separately from the steps that hold the GitHub write Credential and AI Credentials. *(Today's workflow runs them in one process; this must change.)*
- Everything a Sandbox produces is untrusted: results are schema-validated before the engine uses them, the Sandbox has no GitHub token of any kind (including CI-provided default tokens), and it cannot write to caches or artefacts that the publishing step trusts without validation.
- A PR that changes tool configuration, build scripts, or CI workflows gets a Finding saying so, since those changes can alter what the deterministic layers report.
- In the Web App, each Review Run's Sandbox is a separate ephemeral environment; the app's own process never exposes the host container socket or its Credentials to it.

#### FR-40: Tool-free layers always available
Layers that only read files without executing any repository content — syntax parsing with the product's own parsers, secret scanning, manifest and lockfile analysis, existing-result reuse (FR-5), and AI review — run without a Sandbox. Tools whose configuration is executable code (e.g. JavaScript lint configs) count as executing PR code and need a Sandbox.

## 5. Cross-Cutting Non-Functional Requirements

- **NFR-1 Security — untrusted input.** PR code, PR text, repository files, and tool output are untrusted data: never executed outside a Sandbox, never followed as instructions by the AI.
- **NFR-2 Security — secrets.** No Credential ever appears in a Report, log, prompt, Published comment, or telemetry. Secret values found in PR code are reported by location only.
- **NFR-3 Privacy.** PR code is sent only to the AI Provider the user chose. No telemetry by default; any telemetry is opt-in, anonymous, and documented. `[ASSUMPTION]`
- **NFR-4 Reliability.** GitHub and AI Provider rate limits are respected with backoff; a run that cannot complete ends as `INCOMPLETE` or `ERROR`, never as a false `PASSED`.
- **NFR-5 Performance.** A typical PR (≤ 30 changed files, ≤ 1,500 changed lines) completes a review without deterministic layers in ≤ 3 minutes, and with deterministic layers in ≤ 10 minutes, excluding provider queueing. `[ASSUMPTION]`
- **NFR-6 Portability.** CLI supports current Node.js LTS on macOS, Linux, Windows. `[ASSUMPTION]`
- **NFR-7 Extensibility.** New Validators, AI Providers, and Channels are added by registering adapters against documented contracts, without changing the Review Engine core (Validation Capability Spec §22).
- **NFR-8 Determinism of non-AI parts.** For the same Head Commit and Configuration, deterministic layer results and fingerprints are identical across Channels and runs.
- **NFR-9 Documentation.** Each Channel has a quick-start that gets a new user from install to first published review in under 10 minutes. `[ASSUMPTION]`
- **NFR-10 Auditability.** Each Review Run keeps an audit record with its Report: checks executed and skipped with reasons, tool names and versions, the resolved Configuration (without Credentials), AI Provider, model, and usage, Quality Gate inputs, and what was Published. Source code is not retained after the run unless the user opts in (Validation Capability Spec §32).
- **NFR-11 Caching.** Deterministic results are cached and reused only when every input (Head Commit content, tool version, Configuration) is unchanged; caches are isolated per repository and per user and never shared across them (Validation Capability Spec §31).
- **NFR-12 Acceptance.** The Validation Capability Spec §36 acceptance scenarios that fall within the v1 validator set (§6.1) are v1 release criteria; scenarios outside it are tracked against the release that adds their validator.

## 6. MVP Scope

### 6.1 In Scope (v1)
`[ASSUMPTION: release slicing revised after review to fit a solo maintainer; confirm]`

**Release 1 — Engine + CLI.**
- Review Engine: context, detection, layered validation, Report (Markdown + JSON), Quality Gate, Publish, idempotent re-review, Configuration with repo-key allow-list, all safety FRs (FR-6a, FR-6b, FR-17 sanitising, FR-39/FR-40).
- AI Providers: Anthropic API, OpenAI API, Claude Code subscription, Codex subscription, and the custom-endpoint mechanism (FR-9a), through which OpenRouter, Ollama, and Azure OpenAI (OpenAI-compatible) are supported and documented. Native Gemini and Bedrock adapters follow in Release 1.x. Every provider requested for v1 is usable at Release 1 — some via FR-9a configuration rather than a dedicated adapter.
- CLI (FR-22–FR-25a) and the `gh` extension wrapper, on macOS and Linux; Windows supported for runs without a Sandbox. GitHub Enterprise Server: configurable, best-effort, not release-tested.
- Validators: technology detection for the Validation Capability Spec §6.1 matrix (detection only beyond the stacks below); deterministic validators for JavaScript/TypeScript (compiler; repo ESLint/TSLint config or named default), Angular 12+ and React framework checks; secret scanning; dependency vulnerability audit; reuse of existing CI/SonarQube results (FR-5); AI contextual review for all languages.

**Release 2 — Auto-Review** (FR-26–FR-29a), after the engine's identity, idempotency, and safety behaviour has been proven in manual runs.

**Release 3 — Web App** (FR-30–FR-35).

**Release 4 — Browser Extension** (FR-36–FR-38), Standalone mode first, then Connected mode.

**Release 1.x/2.x — more validators:** Python (Ruff, Mypy/Pyright, Bandit), Java (build compile, static analysis), others by demand.

### 6.2 Out of Scope for v1
- Running a SonarQube server or scanner ourselves (v1 reuses existing results only). Deferred to v2.
- Full L1–L14 deterministic coverage for every language in the tool registry (Validation Capability Spec §9.9). Added incrementally per demand.
- Runtime accessibility and browser-based checks (axe-core) — need a runnable app environment. v2+.
- GitLab, Bitbucket, Azure DevOps. v2+.
- Hosted public SaaS instance with accounts and billing.
- Firefox/Safari extensions. v2+.

## 7. Non-Goals (Explicit)

- PR Reviewer does not approve or merge PRs, does not override branch protection, and never modifies the code of the PR it reviews (suggestions are offered, never committed).
- It is not a replacement for CI, SonarQube, or human review; it consolidates and adds to them.
- It does not ship any repository-, org-, or company-specific defaults, rules, or URLs.
- It does not resell AI usage or proxy users' Credentials through a service run by the maintainer.
- It does not offer its own "log in with Claude / ChatGPT" or route subscription credentials through any server.
- It does not become an org-administered platform with seats, SSO administration, or central policy management in v1.

## 8. Success Metrics

**Primary**
- **SM-1 Useful comments:** share of published inline Findings that are resolved (code changed at that location in a later commit, or suggestion applied) — target ≥ 40% at 3 months. Validates FR-6, FR-7, FR-17. `[ASSUMPTION]`
- **SM-2 Low noise:** share of published Findings dismissed or marked wrong by the PR author or reviewer — target ≤ 15%. Validates FR-6, FR-7. `[ASSUMPTION]`
- **SM-3 Time to first review:** median time from PR open or push to published review in Auto-Review — target ≤ 40 minutes at default settings (≤ 10 minutes on repos with immediate review enabled). Validates FR-28.

**Secondary**
- **SM-4 Adoption:** npm weekly downloads and active Auto-Review installs (opt-in count) — target: 100 weekly active installs at 6 months. Validates FR-22, FR-26. `[ASSUMPTION]`
- **SM-5 Setup success:** share of first-time setups that reach a first successful review within 10 minutes — target ≥ 80%. Validates FR-16, NFR-9.
- **SM-6 Provider breadth in use:** at least 3 AI Providers each used by ≥ 10% of runs (signals the multi-provider promise is real). Validates FR-9.

**Counter-metrics (do not optimise)**
- **SM-C1 Comments per PR:** more comments is not better; optimising it inflates noise. Counterbalances SM-1.
- **SM-C2 Share of FAILED gates:** a stricter gate isn't a better product; tuning to fail more PRs erodes trust. Counterbalances SM-2.

**Measurement.** SM-1 and SM-2 are measured per user from GitHub data via FR-25a and FR-20b (no telemetry). SM-3 comes from Auto-Review's own run records. SM-4 uses public npm download counts plus an opt-in, anonymous "active install" ping (off by default, NFR-3). SM-5 and SM-6 are measured only from users who opt in to anonymous usage reporting, plus maintainer-run usability sessions; targets apply to that sample.

## 9. Open Questions

1. **Vendor terms drift.** Subscription use in Auto-Review ships as opt-in with a warning (decided 2026-11-24). Re-check Anthropic's and OpenAI's terms, and the Claude usage-credit details (currently sourced from press reports), before each release; owner: maintainer.
2. **Auto-Review compute and cost.** Running deterministic layers for many PRs from the user's own GitHub consumes CI minutes; what are the limits for free accounts and how should the product degrade?
3. **Org token policies.** Orgs can require approval for fine-grained tokens, block classic tokens, enforce SAML SSO, and restrict OAuth apps (on by default for new orgs). Which Credential type should setup recommend, and what does the user see when an org blocks it? Affects FR-26, FR-29, FR-30.
4. **Multiple users of the product on one PR.** If several team members each run Auto-Review, should their reviews coordinate (one summary per PR) or stay independent per user? FR-19 currently assumes per user.
5. **Product name** and licence. `[ASSUMPTION: MIT]`
6. **Repository configuration file format and name** — and whether to read existing review-tool configs from other products for easy migration.
7. **Public hosted instance** of the Web App: ever, and who pays for compute?
8. **Decisions delegated to architecture** (named here so they are made deliberately, not guessed): full clone vs API-only context retrieval per layer; where Auto-Review keeps its per-PR state; public vs private automation repository under FR-29a; exact meaning of "unchanged inputs" for incremental re-review and caching; the repository configuration file's name and schema (OQ-6); the Report JSON schema; how Findings are fingerprinted across line shifts.

## 10. Assumptions Index

- §2.2 — GitHub only (github.com + configurable Enterprise host) in v1.
- §3 / FR-20 — Reviewer Identity defaults to the user's own account; bot identity optional.
- FR-3 — Angular 12+ is the supported Angular range in v1.
- FR-8 — SARIF export after v1.
- FR-12 — Token/cost reporting; per-run ceiling and a monthly ceiling across Channels.
- FR-15 — OS keychain as default CLI Credential store.
- FR-21 — Commit status off by default for repos the user doesn't administer.
- FR-26 — A `gh` extension is offered alongside the npm CLI.
- FR-26 — Discovery scales to a Watch Scope of ≥ 200 repositories.
- FR-28 — Auto-Review discovery interval 30 minutes by default.
- FR-29a — Free-tier fit sized for ≤ 50 PRs reviewed per month.
- FR-30 — Web App sign-in with GitHub; per-user privacy of Credentials and Reports.
- FR-35 — Web App per-user API keys with optional operator default; keys encrypted at rest.
- §4.7 NFRs — one-command self-host; WCAG 2.1 AA.
- §4.8 / FR-37 — Extension Standalone mode (own API key, no server).
- FR-37 — Standalone mode in Release 4; Connected mode (Web App and local CLI companion backends) in a 4.x release.
- §4.8 NFRs — In Connected mode the extension stores no AI Provider keys; Credential handling per browser-store rules.
- NFR-3 — No telemetry by default.
- NFR-5 — Performance targets.
- NFR-6 — Node.js LTS on macOS, Linux, Windows.
- NFR-9 — 10-minute quick-start.
- §6.1 — Release slicing (1 Engine + CLI → 2 Auto-Review → 3 Web App → 4 Extension) and the Release 1 validator set.
- SM-1, SM-2, SM-4 — Targets.
- OQ-5 — MIT licence.
