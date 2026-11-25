---
title: "Adversarial review: PR Reviewer PRD (draft 2026-11-24)"
reviewed: prd.md, addendum.md (cross-checked against research-digest.md, extract-inputs.md, additional_info.md)
created: 2026-11-24
---

# Adversarial review: PR Reviewer PRD

## Verdict

**Not ready for architecture.** The PRD's two differentiators, "reuse a subscription you already pay for" and "review in orgs you don't administer", are also its two least defensible areas. As written, Auto-Review posts AI output under a human's name, on other people's repos, using a skeleton-key token, possibly driven by an agentic CLI reading attacker-controlled files. The PRD treats that as a convenience feature with a warning label. Several FRs cannot be met against GitHub's API as it actually works. Release 1 is several products' worth of scope for one maintainer. Almost every success metric needs telemetry that NFR-3 switches off.

| Severity | Count |
|---|---|
| Critical | 6 |
| High | 12 |
| Medium | 12 |
| Low | 6 |
| **Total** | **36** |

Severity means impact on building the right thing. It is not a measure of how hard the fix is.

---

## Critical

### C1. Auto-Review impersonates the user's judgement and silently clears their review requests
**§2.3 UJ-2, §2.1 (Social JTBD), FR-18, FR-20, FR-26, FR-27, FR-28, addendum B3**

UJ-2: "whenever he … is requested as a reviewer anywhere, a review appears on that PR under his name within minutes." Three problems compound:

1. **It satisfies the review request.** On GitHub, a requested reviewer who submits any review, including `COMMENT`, is removed from `requested_reviewers`. The PR author and the branch-protection UI now show Arjun as having reviewed it. The PR also drops out of `review-requested:@me`, the same search that addendum B3 uses for discovery. So FR-28's "new Head Commits … are reviewed" stops working for that whole Watch Scope bucket after the first post, and Arjun's own queue loses the PR. The product quietly takes over a human duty and then loses track of the PR.
2. **Nothing marks the output as AI or keeps a human in the loop.** FR-23 (preview and confirm) applies only to the CLI. Auto-Review has no confirmation, no per-repo opt-in, no daily cap and no kill switch beyond "disable". FR-17 doesn't require an AI disclosure in each comment. Today's tool has a footer ("Check every finding before acting on it", extract A7), and the PRD drops it. §2.1 wants comments that "read as helpful rather than as bot noise", but the honest reading of an unmarked AI comment under a human login is that it's deceptive. Many org AI-use policies require disclosure. Teammates also can't filter or mute an account that is a real person.
3. **It gives the AI merge-blocking power through the user's role.** FR-18 permits `REQUEST_CHANGES` when configured. If the user is a CODEOWNER or required reviewer, an AI-authored `REQUEST_CHANGES` under their login blocks merge until someone dismisses it. That contradicts FR-6 ("AI-only findings cannot fail the Quality Gate by default") and the spirit of §7 ("does not override branch protection"). The gate becomes irrelevant because the blocking happens through the review state.

Automated, high-volume posting from a personal account onto repos the user doesn't own is also exactly the pattern GitHub's acceptable-use and anti-abuse systems flag. The PRD never mentions account-suspension risk, which falls on the user.

**Required:** Auto-Review must never post as a review on PRs where the user is a requested reviewer unless the user explicitly opts in for each repo. Default to a draft or pending review (GitHub supports pending reviews visible only to their author) or to a local report. Require a mandatory, non-removable AI-disclosure marker. Forbid `REQUEST_CHANGES` in Auto-Review. Add per-day and per-repo posting caps. Track Watch Scope membership independently of the search qualifier that posting invalidates.

### C2. Subscription Providers are agentic CLIs fed attacker-controlled content, and the PRD sandboxes the wrong thing
**FR-9, FR-10, FR-15, FR-39, NFR-1, addendum B2**

FR-39 sandboxes "installing dependencies, building, or testing PR code". The riskiest executable in the design isn't on that list: `claude -p` / `codex exec` is an autonomous agent with tools (shell, file read and write, web fetch, MCP), and the PRD hands it the PR's diff, description and files, which NFR-1 calls untrusted. The PRD never requires:
- tools disabled or allow-listed for the review invocation,
- running it outside the checkout. Claude Code loads `CLAUDE.md` and project `.claude/settings.json` (which can define **hooks that run shell commands**) from its working directory, and Codex loads `AGENTS.md`. If the CLI runs with the PR checkout as its working directory, the PR author controls the agent's instructions and can run commands without any prompt injection at all,
- isolating the user's personal configuration (their MCP servers for mail, Slack, cloud) from a run that processes a stranger's PR,
- keeping GitHub write credentials out of the agent's environment. FR-15 only says "never exposed to Sandbox processes", and the vendor CLI isn't classed as a Sandbox process.

On a laptop, this gives a stranger's PR a path to the developer's home directory and personal integrations. In Auto-Review it gives a path to the publishing job's secrets. FR-10's "unmodified CLI" requirement makes this worse, because it rules out hardening by patching and so pushes all the hardening into invocation flags and an empty working directory. The PRD specifies neither.

**Required:** A new FR covering how vendor agent CLIs are invoked: no tools (pure completion mode), an empty temporary working directory, no project or user settings, MCP and hooks disabled, a scrubbed environment, and output accepted only through schema validation. It needs a test PR that ships a malicious `CLAUDE.md`, `.claude/settings.json` hook and `AGENTS.md`. If a vendor CLI can't be run in no-tool mode, that provider is not eligible.

### C3. FR-10 forbids storing subscription tokens; Auto-Review with a subscription requires storing them
**FR-10, FR-26, §4.2 table, research-digest §2, OQ-1**

FR-10: the product "never extracts, stores, proxies, or transmits subscription session tokens". FR-26: setup "stores the needed Credentials as secrets" in the user's GitHub account. A GitHub-hosted Actions runner has no logged-in Claude Code or Codex. The only way the "Opt-in with warning" cell in FR-10's table can work is for the setup command, which is the product, to take a long-lived subscription OAuth token (`claude setup-token`, or Codex's `auth.json`) and write it into an Actions secret. That is extracting and storing it. The table's own column header, "user's own runner", isn't what B3 describes: B3 uses a scheduled workflow on GitHub's runners.

The research the PRD cites cuts against it. research-digest §2 says the Claude grey area "does NOT extend to the web app, the extension or a hosted auto-reviewer". OpenAI says "Don't expose Codex execution in untrusted or public environments", and a runner processing strangers' PRs is exactly that. The PRD moved this from an open question to "decided 2026-11-24" without resolving the contradiction.

**Required:** Pick one. Either (a) subscriptions are CLI-only and Auto-Review is API-only, or (b) Auto-Review with a subscription is supported only on a self-hosted runner on the user's own machine, where the vendor CLI is already logged in and no token leaves it, and FR-10 is reworded to say that. Never have the product write subscription tokens into GitHub Secrets.

### C4. Repository configuration can steer the run, including where credentials and code go
**FR-13, FR-14, FR-15, NFR-1, NFR-3**

FR-13's precedence is "product defaults → user configuration → repository configuration → per-run overrides, with later layers winning". So for any repo in Watch Scope (d), which by definition someone else administers, **strangers' config overrides the user's**. The only carve-out is settings the user has pre-marked "mandatory". FR-15 stops credentials being *read from* repo config. Nothing stops repo config from setting:
- a provider base URL (`openai.baseURL`, `ollama.host`, Azure endpoint). The user's API key is then sent to whatever server the repo names. This is credential exfiltration by configuration.
- a different provider or model. Org code then goes to a vendor the user didn't choose (NFR-3 "only to the AI Provider the user chose"), and so does cost.
- token or cost ceilings (FR-12), comment caps, `REQUEST_CHANGES` (FR-18), commit status (FR-21).
- Review Rules "from a URL" (FR-14). That is a remote fetch at review time, which allows SSRF from the user's machine or runner and content that changes after anyone reviews it.

Separately, FR-14 makes Review Rules taken from the reviewed repository part of the AI's instructions. NFR-1 says repository files are "never followed as instructions by the AI". Both can't be true. A repo maintainer, or a PR that lands a rules change on the base branch, steers the AI that posts under the user's name.

**Required:** Repo configuration gets an explicit **allow-list** of keys it may set: rule content, path filters, technology hints, and stricter gates only. Provider, endpoint, model, credentials, budget, publish event, status and identity are user-only. Repo Review Rules go to the AI as quoted data ("the repo asks reviewers to check X"), never as system instructions, and can only add checks, never suppress them. Ban URL-sourced rules from repo config.

### C5. The Auto-Review credential is a skeleton key stored in a repo
**FR-26, FR-15, FR-29, OQ-3, addendum B3, UJ-1**

The PRD leaves token type to OQ-3. GitHub decides it for you:
- A fine-grained PAT is scoped to **one resource owner** (one user or one org). Watch Scope spans "my repos" + "repos I'm requested on anywhere" + "listed orgs", so a single fine-grained token can't cover it. You'd need N tokens, each subject to that org's approval policy (FR-29).
- In practice setup will fall back to a **classic PAT with `repo` scope**, which is read and write (including push) on every private repo the user can reach, across every org. One-command setup (FR-26) creates a repo and pushes a workflow file into it, so it also needs the `workflow` scope. UJ-1's "detects her GitHub CLI login" means reusing `gh`'s token, which has `repo`, `read:org` and `gist` by default.
- That token sits as an Actions secret in an automation repo, read by a scheduled workflow that pulls third-party actions and processes attacker-supplied PR content. Anyone with write access to that repo, any compromised action in the workflow, or any job that can reach the secret can push code as the user to every repo they can write to.
- FR-26 "Disabling removes the automation and its stored secrets": deleting a secret doesn't revoke the token.

The PRD is silent on least privilege, token expiry, rotation, pinning actions by SHA, and blast radius. NFR-2 covers leakage into reports, not whether the credential should be this powerful in the first place.

**Required:** An FR that names the credential model per Watch Scope bucket and its minimum scopes. Disabling must revoke or expire the token, or tell the user to. Expiry gets surfaced through FR-29. Every action in the generated workflow is pinned by SHA. The automation repo must be private. State plainly in setup that a classic PAT can push to all of the user's repos, and require acknowledgement.

### C6. Release 1 is not shippable by a solo maintainer, and the PRD says so itself without acting on it
**§6.1, FR-9, FR-3, FR-22, NFR-6, FR-1 (GHES), addendum D1**

Release 1 = the Review Engine, plus **nine** AI providers (two of them agentic subscription CLIs) behind a conformance suite (FR-9), plus technology detection for "all languages in the … §6.1 matrix" (about 33 technologies), plus deterministic validators for JS/TS, Angular, React, Python (Ruff, Mypy/Pyright), Java, secret scanning and dependency audit, plus base-vs-head comparison (FR-4), CI/Sonar reuse (FR-5), dedup and fingerprints (FR-7), layered config with mandatory locks (FR-13), audit records (NFR-10), idempotent re-review with resolved-finding tracking (FR-19), a local container sandbox (FR-39), a split-job Actions sandbox, Auto-Review with four Watch Scope buckets and six filter types (FR-27), health reporting (FR-29), and support for macOS, Linux and **Windows** (NFR-6) **and** GitHub Enterprise Server (FR-1). The starting point is a 440-line single-file script with 6 assertions (addendum A).

Addendum D1 names the tension ("Spec scale … vs a solo open-source start") and claims §6 resolves it. It doesn't. §6 defers SonarQube scanning, axe and other forges, and keeps everything else. Meanwhile the market snapshot says the commodity part (npm BYOK reviewer) is "a crowded, cheap niche" (PRScope, PR-Agent). So the time goes into breadth that competitors already have, while the differentiators (C1, C3) are the least safe parts.

**Required:** Cut Release 1 to: engine + CLI; Anthropic API + OpenAI-compatible (which covers OpenRouter and Ollama) + Claude Code subscription (in hardened mode, C2); TS/JS only for deterministic layers, via sandbox or SKIPPED; idempotent publish; github.com only; macOS and Linux. Make Auto-Review Release 1.5 for owned repos only, then expand to non-administered orgs only after C1, C5 and H5 have answers. Treat "all providers" and "all languages" as roadmap items, not v1.

---

## High

### H1. Auto-Review on GitHub Actions doesn't fit the free tier, goes dark silently, and FR-29 has nowhere to report
**FR-26, FR-28, FR-29, OQ-2, addendum B3/B6**

The arithmetic: a 15-minute schedule is 2,880 runs a month. Actions bills each job rounded up to a whole minute, and FR-39 requires PR-code execution to run in a separate job from publishing, so even a no-op run is about 2 jobs. That's **≥5,760 billed minutes a month with zero PRs**, against GitHub Free's 2,000 private-repo minutes (current published limits; verify at release). The obvious workaround is a public automation repo, where minutes are free. That makes logs, step summaries and artifacts of **private org PR content public** (see H5). It also triggers GitHub's rule that **scheduled workflows in public repos are disabled after 60 days without repository activity**. Scheduled runs are also delayed or dropped under load.

So the failure mode is silent: the scheduler stops, and FR-29 ("reports its own failures … in its run summary") can't report anything because nothing runs. "Optionally a notification" is undefined. Actions emails only on workflow *failure*, and a health problem that ends the run green notifies nobody.

**Required:** OQ-2 can't stay open, because it decides whether the channel is viable. Specify the run budget, adaptive polling, a heartbeat that fails the workflow (so the user gets an email) when health problems persist, and liveness detection from another channel (`pr-reviewer status` in the CLI showing the last successful poll). Forbid public automation repos when Watch Scope includes private repos.

### H2. "Honest status" for deterministic layers is attacker-controlled
**FR-4, FR-5, FR-39, NFR-8, addendum B3/B6**

- FR-4: deterministic layers "use the repository's own tool configurations". FR-13 pins *repo config* to the base branch, but nothing pins **tool config** (`.eslintrc`, `tsconfig.json`, `package.json` scripts, `pyproject.toml`, `jest.config`). A PR can add `/* eslint-disable */`, set `"test": "exit 0"`, loosen `strict`, or drop a rule, and the layer reports `PASSED`. Spec §29 requires "separate trusted tool configuration from PR-controlled configuration". The PRD dropped that.
- Addendum B6: results go "as artefacts to the publishing job". The untrusted job writes those artifacts, so a malicious install script can overwrite the result file with a clean report. Addendum B3 puts the idempotency state file "in the automation repo or its cache". Actions caches are writable by any job in the repo, so the untrusted job can poison the state and suppress or duplicate reviews.
- FR-39 says the sandbox job has "no GitHub write Credential", but every job gets an automatic `GITHUB_TOKEN` scoped to the automation repo, which is write by default in many configurations. Unless `permissions: {}` is required, the sandbox can push to the automation repo, including to its workflow, if the token has `workflows` permission.
- "Restricted network" (FR-39) isn't available on GitHub-hosted runners without extra tooling. The PRD states it as a given.

**Required:** Tool config comes from base, or from a trusted overlay, with PR changes to tool config reported as findings. Untrusted-job outputs get schema validation and size limits and are treated as untrusted. The publishing job must recognise that a sandbox result can be forged, so a crash or a forged pass must never become `PASSED` for a mandatory layer without corroboration. State lives where the untrusted job can't write. Require `permissions: {}` on sandbox jobs. Restate "restricted network" as what is actually achievable per runner type.

### H3. FR-19's idempotent re-review can't be built on GitHub's review model under a user identity
**FR-19, UJ-2, FR-20, §3 Reviewer Identity, spec §28**

- UJ-2: "updates the existing summary instead of adding another". You can edit a review's *body*, but you **can't add inline comments to an already-submitted review**. Any push with new inline findings needs a new review object, so the timeline gets a review per push. Editing the old review's body also leaves the "current" summary attached to a stale commit in the timeline.
- "Marks Findings that are now resolved". Resolving review threads (GraphQL `resolveReviewThread`) is limited to the PR author and users with write access. For Watch Scope (d) the user usually has neither, so it can't be done.
- "Never edits or deletes human comments". With Reviewer Identity = the user's own account (FR-20 default), "the product's own" comments and "human" comments **have the same author**. Spec §28 assumes "bot-owned" comments. Telling them apart then rests entirely on a hidden marker in the body, which the PRD doesn't specify. A user who edits a product comment by hand (adds context, say) gets it overwritten on the next run.
- "Same Head Commit with the same Configuration" means a different config (another provider, a fallback via FR-11, a changed ceiling) on the same head creates a second review. FR-11 fallback makes that routine.
- The FR-19 consequence "Two users … each produce at most one summary" pre-decides OQ-4 as "independent per user". With five teammates on Auto-Review, every push gets five AI reviews. That makes SM-C1 a certainty rather than a counter-metric.

**Required:** Define the publish model precisely: one sticky issue comment for the summary (editable, not tied to a commit) plus new review comments only for *new* fingerprints. Specify the marker format and the ownership rule. Drop "resolve" for repos without write access, or replace it with a reply ("fixed in abc123"). Make the idempotency key exclude provider and model. Answer OQ-4 before architecture, for example by detecting another product summary on the PR and deferring to it.

### H4. The success metrics can't be measured under the PRD's own privacy stance
**§8 SM-1 to SM-6, NFR-3, §8 NOTE FOR PM**

NFR-3: "No telemetry by default." Then:
- **SM-1** (resolution rate) and **SM-2** (dismissal rate) need per-comment outcome data across users. GitHub has no "dismissed as wrong" signal for review comments. The only proxies are resolved threads, hidden comments and reactions, and none of them is defined. "Code changed at that location in a later commit" counts any edit to a busy line as a success.
- **SM-3** needs Auto-Review timing from users' private automation repos.
- **SM-4** "active Auto-Review installs (opt-in count)". The installs live in users' GitHub accounts, invisible to the maintainer. npm downloads count CI caches and mirrors, not users.
- **SM-5** "first-time setups that reach a first successful review within 10 minutes" needs funnel telemetry.
- **SM-6** "≥ 10% of runs" per provider needs run telemetry. It's also a vanity metric: it measures configuration diversity, not value.

The NOTE FOR PM concedes this and leaves it unresolved. As written, the primary metrics can be measured only on the maintainer's own repos, a sample of one with an obvious bias.

**Required:** Either define an opt-in telemetry spec now (events, fields, anonymisation, endpoint, and who runs it, which conflicts with §7 "does not … proxy … through a service run by the maintainer" unless carved out), or replace the metrics with ones that can be observed: GitHub stars and issues, a public dogfood cohort, a local `pr-reviewer stats` command that users can choose to share, and reactions on comments. Define "dismissed".

### H5. Private org code moves into the user's personal account and personal AI vendor, and repo owners have no say
**§4.6, FR-27 (d), FR-39, NFR-3, NFR-10, FR-13**

For Watch Scope (d), the product checks out an org's private code into the **user's personal** Actions runner. The logs, step summaries, artifacts (90-day default retention), caches and audit records (NFR-10) then live in a personal repo the org can't see or revoke. The code also goes to the user's personal AI subscription. NFR-3's "PR code is sent only to the AI Provider the user chose" puts the wrong party in charge of the decision: the **org** owns the code. For employees this is a data-handling and IP-policy violation that the tool performs automatically, and the PRD markets it as the headline feature (§1, "including in organisations where you can't install anything").

FR-13 also lets the user's "mandatory" settings override the repo's config, so a repo that sets `ai: false` can be overruled by a user who marked AI review mandatory.

**Required:** A repo-owner opt-out that always wins, such as a well-known config key or the absence of an opt-in. Setup must warn explicitly about org data policy for scope (d). A no-retention mode for Actions: no artifacts, no PR content in logs or step summaries, cache encryption or no cache. Default scope (d) to "own PRs only", not "any PR in org X".

### H6. Prompt-injection defence is aimed at the input; the damage happens in the output posted under the user's name
**FR-6, FR-17, NFR-1, spec §30**

FR-6's testable consequence, "A PR containing instructions aimed at the AI … is reported as a finding, not obeyed", can't be verified in general. Injection detection is not reliable, and one fixed test PR proves nothing. The PRD never constrains what the AI may *emit*, and everything it emits is posted as the user:
- **`suggestion` blocks.** An injected model proposes a "fix" that adds a backdoor, an exfiltrating fetch, or a dependency swap. The PR author or a maintainer clicks "Commit suggestion" because a trusted human colleague appeared to propose it. FR-17 checks only that the "replacement range and code are valid", meaning syntactically, not safely.
- Markdown links and images (phishing, tracking pixels), `@org/team` mentions (mass notification under the user's name), `#123` cross-references, HTML comments carrying forged idempotency markers (H3), and a summary that claims checks passed.
- A prompt-injected AI-written summary contradicting the deterministic layer status. FR-17 should render status from engine data only, but doesn't say so.

**Required:** An output-policy FR. The summary's status and gate sections are rendered by the engine and are never AI text. AI text is sanitised: no raw HTML, links only to the PR's own repo, `@mentions` and cross-references stripped. Suggestions are size-limited and diff-scoped, and flagged when they add network or exec calls or dependencies. Add a red-team corpus (not one test PR) as a release gate.

### H7. Secrets in the PR go straight to the AI provider and can come back out in public comments
**NFR-2, FR-15, FR-40, spec §13 line 1236, extract D11**

NFR-2: "Secret values found in PR code are reported by location only." The spec is stricter: "Never include secret values in … AI prompts". The PRD never requires secret scanning to run **before** prompt construction, or redaction of what it finds. FR-40 lists secret scanning and AI review as parallel tool-free layers. So a committed key goes to the AI vendor (and in Auto-Review, to the user's personal vendor account, which is H5). The model can quote it back in a finding or suggestion, which gets posted, and on a public repo that is permanent once indexed. FR-15's fake-key test covers *credentials the product holds*, not secrets in the PR.

**Required:** An ordering FR: secret scan → redact in diff, files and PR text → build prompt. A publish-time filter that rejects any comment matching a detected secret or a high-entropy pattern. A test PR containing a canary secret, asserting it never appears in the prompt, the report, logs or comments.

### H8. The self-hosted Web App has no access-control or isolation model
**FR-30, FR-35, §4.7 NFRs, UJ-3, addendum B4**

- **Who can sign in?** "Users sign in with their GitHub account". Any GitHub user can, unless there's an allow-list. With FR-35's "optional operator-provided default" key, a public self-hosted instance is a free AI proxy for anyone who finds it. There's no org or team allow-list, no admin role, no quota.
- **The OAuth token is the C5 problem at server scale.** Posting reviews on private repos through an OAuth app needs `repo` scope. That's full read and write on every team member's private repos, held server-side. Orgs with OAuth-app access restrictions (on by default for new orgs, per the research) block it outright. FR-30 doesn't name scopes or the restriction path.
- **Sandbox on the server is undefined.** FR-39 lists "a local container, or a CI runner the user controls". A web server is neither. Running containers from inside a containerised single-command deployment (§4.7 NFR) means exposing the Docker socket (spec §29: "Do not expose the host Docker socket") or Docker-in-Docker. The PRD doesn't say whether deterministic layers run in the Web App at all.
- **"Stored encrypted at rest"** (FR-35): with a key where? On the same host, in the same compose file, that's obfuscation.
- **UJ-3 vs FR-30.** UJ-3 is "Meera gives her **team** a review page … Past reviews stay listed per PR". FR-30 says "each user's … Reports are private to them". Can a team see each other's reviews of a shared PR or not? If they can, private-repo access must be re-checked on every view, since a user may lose repo access after a run.

**Required:** An access-control FR (allow-listed GitHub orgs or users, admin role, per-user quotas, operator-key usage policy), a stated OAuth/GitHub App scope model, an explicit statement of whether the Web App runs deterministic layers and how it isolates them, key management for the encryption key, and resolution of the team-versus-private visibility conflict.

### H9. The extension's "local CLI companion" is an unauthenticated localhost endpoint that can publish as the user
**FR-37, §4.8 NFRs, addendum B5**

FR-37 has the CLI serve a localhost API that the extension calls. That process holds the GitHub write token, AI keys and the vendor CLI login, and it can Publish. The PRD has no authentication, origin check or pairing requirement for it. Any web page the user visits can send requests to `localhost:<port>` (CSRF), or use DNS rebinding to read responses. The result is drive-by "review this PR and publish", running the agentic vendor CLI (C2), and possibly reading reports of private repos. The §4.8 NFR about tokens being "held where page scripts cannot read them" protects the extension's storage, not the companion.

**Required:** The companion binds to loopback only, requires a per-install pairing secret held only by the extension, checks `Origin` against the extension ID, rejects non-loopback `Host` headers, and never publishes without an explicit user action in the panel.

### H10. Strangers can spend the user's AI budget and Actions minutes
**FR-12, FR-27, FR-28, §2.3 UJ-2**

Watch Scope "PRs on repositories they own" includes public repos that anyone can open PRs against. FR-12's ceiling is **per run**. Twenty PRs with near-limit diffs means twenty full-budget runs on the user's key or subscription credit, plus sandbox minutes, plus executing attacker code in the user's Actions (crypto-mining in the user's account is a ToS problem for the user). Filters exist (FR-27 "author") but default to off, and there's no per-day or per-month budget or first-time-contributor gate.

**Required:** Per-period budgets (daily and monthly tokens or cost, and Actions minutes). Default-deny for authors without write access or for first-time contributors, mirroring GitHub's "approve workflows for first-time contributors". Run the deterministic sandbox only for trusted authors by default.

### H11. Status vocabulary drifts, so honest status will be implemented three different ways
**§3 Layer Status, FR-2, FR-4, FR-7, FR-12, §4.9, FR-39, UJ-3**

§3 defines seven Layer Statuses and FR-7 six gate statuses. The rest of the PRD then uses words that are in neither list: UJ-3 and FR-12 mark the AI layer "incomplete" (a *gate* status, not a layer status), §4.9 says "reported `unavailable`", FR-39 says "`SKIPPED (no sandbox available)`", and FR-2 says the run is "superseded" (is that `CANCELLED`?). An architect has to invent the mapping, and each Channel will invent it differently.

Worse, the PRD never says which layers are **mandatory by default**. If compile and lint are mandatory, every laptop without Docker (most Windows users, many Mac users) gets `INCOMPLETE` on every run, and FR-24's exit codes then fail CI. If they aren't mandatory, a run with no compile check shows `PASSED`, which is the "quietly fails" case FR-4 claims to prevent. A layer that was SKIPPED by design but isn't mandatory passes silently; extract D14 raised this and the PRD didn't resolve it.

**Required:** A table mapping each condition (no sandbox, budget hit, provider rate-limited, superseded, tool missing, unsupported tech) to a Layer Status and its gate effect. A default mandatory-layer set for each channel. When the gate passes with layers skipped, the result must say so in the gate line itself, for example `PASSED (3 layers skipped)`, not only in a table further down.

### H12. An architect would have to guess the load-bearing decisions
**FR-2, FR-3, FR-13, FR-19, FR-9, FR-31, FR-37, NFR-10, OQ-6**

These aren't "mechanism choices for architecture". They determine product behaviour and security:
1. **Clone or API-only?** FR-2 and spec §5 want related code, call sites and merge-base. FR-3 wants whole-repo technology detection. FR-4 wants base-vs-head tool runs. All of these need a git clone (extract D15). The current tool is API-only. The answer determines rate-limit budget, isolation and performance.
2. **Where state lives** for idempotency (FR-19) in the CLI with no server: GitHub markers only? A local DB? What is the source of truth when they disagree?
3. **AI call shape.** One structured single-shot call, or per-layer calls (extract D12)? Agentic exploration by subscription CLIs (C2), or not? This drives cost by 3-10×.
4. **Config file name, schema and versioning** (OQ-6) is a public contract that the repo-config allow-list (C4) depends on.
5. **Report/JSON schema versioning** (FR-8). Channels and third parties consume it; it is unversioned.
6. **Re-review "only what changed"** (UJ-2): a diff between the previous and new head, or a full re-review with fingerprint diffing? What happens on force-push or rebase?
7. **Web App concurrency and queue limits**, and cancellation semantics when a PR gets a new push mid-run.
8. **Data retention** for reports and audit (NFR-10) on each channel, and deletion when a user leaves.
9. **GHES minimum version.** Search, review and Actions APIs differ.
10. **Backward compatibility with today's tool** (extract D7). Do the CLI flags, `rules/*.md` and the severity enum survive?

**Required:** Resolve items 1, 2, 3 and 6 in the PRD as product decisions, since each changes user-visible behaviour or security. The rest can go to architecture, but list them explicitly as open questions.

---

## Medium

### M1. FR-17's "no Publish is rejected by GitHub … verified before sending" overclaims
**FR-17, FR-18, FR-27**

Line validity is one of many 422 causes. Others: `REQUEST_CHANGES` on **your own PR**, which Watch Scope "PRs they authored" plus FR-18 makes routine ("Can not request changes on your own pull request"); multi-line comments whose `start_line`/`line` span hunks; locked conversations; archived repos; the user being blocked by the org; review body over the 65,536-character limit (a big summary under FR-17's content list will hit it); and files GitHub won't diff (too large). Rewrite it as: "Publish validates against known GitHub constraints. On rejection it falls back to summary-only and records why. It never drops findings silently."

### M2. FR-21 commit status / check run: one is impossible, the other needs write access and is spoofable
**FR-21, FR-26 consequence, addendum D3**

Check runs can be created **only by GitHub Apps**. A PAT or OAuth user token gets a 403. Commit statuses need push access, so the feature never applies to Watch Scope (d). On repos where it does work, any writer or integration can set the same context, so a required status named after this product is trivially spoofable. FR-26's "the only action on them is posting reviews/comments" also contradicts FR-21 when the user has write access. Drop "check run", and scope commit status to repos the user administers, with a configurable context.

### M3. Channel parity ("same findings, whichever door") is false by design
**§1 Vision, §3 Review Engine, NFR-8, FR-10, FR-39**

The glossary says all Channels "produce the same Findings for the same inputs". But sandbox availability differs (laptop without Docker vs Actions), Subscription Providers are restricted by channel (FR-10), and tool versions differ unless pinned (a repo's ESLint from the lockfile needs install, so the sandbox version differs from the bundled one). NFR-8 "identical across Channels" holds only if tool versions are part of the Configuration. Restate this as: same Configuration plus same tool versions plus same provider gives the same deterministic findings, and the Report shows where a channel differs.

### M4. "No hardcoded values" contradicts itself and the enforcing test isn't defined
**FR-1, FR-12, FR-13, memlog decision "No hardcoded values anywhere (URLs, repos, orgs, rules, models, endpoints)"**

FR-13 requires that "removing all user and repo configuration still yields a working review with documented defaults". A working review needs a default provider, endpoint and model, which are hardcoded by definition. FR-1 defaults to github.com. FR-12's "estimated cost where the provider publishes pricing" needs a bundled price table, which goes stale and ends up quietly wrong. FR-1's "repo-scan test fails the build if [a repository name] is added" can't enumerate unknown names. It needs a concrete rule, such as no `owner/repo` literals outside `test/fixtures`. Split values into *product defaults* (allowed, documented, overridable: host, provider endpoints, default model, price table with an as-of date) and *tenant values* (banned: org, repo, rules, company URLs). Show the price table's date in the Report so stale cost estimates are visible.

### M5. FR-11 fallback can send code to a vendor and a bill the user didn't intend
**FR-11, NFR-3, FR-10**

An ordered fallback that fires on "unavailable or rate-limited" moves private code from vendor A to vendor B mid-run, and from a subscription to a metered API key, without a per-run decision. NFR-3 wants code to go "only to the AI Provider the user chose". Configuring a list doesn't amount to choosing for this repo. It also breaks FR-19 idempotency, since the configuration differs (H3). Require fallback to be opt-in for each repo or org, never to cross from subscription to metered without explicit config, and always to be recorded in the summary.

### M6. FR-5 reuse of CI and Sonar results trusts signals anyone can forge, on commits that may not match
**FR-5, spec §10.3**

Commit statuses can be set by any writer or integration (M2). CI often runs on `refs/pull/N/merge`, a synthetic merge commit, not the head SHA. Fork PR CI may not run without approval. Sonar's PR analysis has its own branch and PR keys. "Same Head Commit" isn't enough. Specify which result sources count as trusted (an allow-list of check-run app IDs or status contexts in user config) and how merge-ref results are treated. A reused `PASSED` should be labelled with its source, not merged in as the engine's own pass.

### M7. SM-3's ≤15-minute median can't be met with FR-28's default
**SM-3, FR-28, NFR-5, H1**

Average wait for a 15-minute poll is 7.5 minutes. Add GitHub search-index lag, cron start delay, and up to 10 minutes of run time (NFR-5 with deterministic layers). The median lands around 15–20 minutes before any queueing. Either default the interval to 5 minutes (which makes H1's minutes problem three times worse) or set SM-3 at 25–30 minutes.

### M8. Search-based discovery can't guarantee FR-26/FR-28 at 200 repos
**FR-26 consequence, FR-28, addendum B3**

The search API returns at most 1,000 results per query, has index lag, and returns PRs, not head SHAs. Detecting "new Head Commits" therefore needs a per-PR REST call each cycle, across every open PR in scope. Publishing then hits secondary limits for content creation (documented as roughly 80 a minute and 500 an hour). "≥ 200 repositories" is an `[ASSUMPTION]` with no supporting calculation. Specify a request budget per cycle, use ETags and conditional requests, and degrade by stretching the interval while reporting that it has, instead of silently missing PRs.

### M9. The FR-20 bot identity doesn't reach the repos it's meant for
**FR-20, §1, §2.2**

A machine account can only comment on private org repos it has been granted access to, which requires an org admin. That defeats the "orgs you don't administer" pitch. GitHub's terms also allow a person one free machine account. So the bot option works only on public repos and the user's own. Say so. If the bot option is the answer to C1's disclosure problem, the PRD has to accept that it can't cover private org repos.

### M10. "Superseded, don't publish" starves busy PRs, and the check is racy
**FR-2, spec §28**

On an active PR (pushes every few minutes) and a 10-minute run (NFR-5), every run is superseded and nothing is ever published. Checking the head and then posting is also a TOCTOU race, because GitHub accepts a review with an older `commit_id`. Define a policy: publish to the reviewed commit with an "outdated" banner after N supersessions, or debounce until the head has been stable for X minutes.

### M11. NFR-5 performance targets ignore install and build reality and FR-4's doubling
**NFR-5, FR-4, §6.1**

"≤ 10 minutes with deterministic layers" for a cold-container Angular or Java project includes `npm ci` or the Maven/Gradle dependency resolution, a full build, tests, and then, per FR-4's base-vs-head comparison, **the same again on base**. Real Angular monorepos exceed 10 minutes on install and build alone. Make the target per stack, allow caching, and say whether base runs are incremental or cached.

### M12. The extension's value is unproven and its requirements conflict
**FR-36 to FR-38, §4.8 NFRs, addendum C, Release 3**

Qodo is removing its Chrome extension (addendum C), and the PRD notes this as a signal but doesn't answer it. The extension adds a button and a side panel over a backend that already has a web UI. FR-38 says it "keeps working across GitHub UI changes … needing only the PR URL", yet requires each finding to link "to its line in the PR's diff view". Those diff anchors are a GitHub URL and DOM contract that the January 2026 redesign already changed. The §4.8 NFR also says the extension holds "GitHub tokens", but if the backend does the GitHub calls, why does the extension hold one at all? Decide whether the extension is a thin launcher (no GitHub token, deep link to the Web App report) or a full client. Keep Release 3 conditional on Release 2 adoption.

---

## Low

### L1. FR-6's AI-finding validation is shallow
"Every AI Finding's file and line exists in the Head Commit" is a sanity check, not validation. A finding can sit on a real line and still be about something else. Require the line to be in the changed set (or an explicitly related-context line) and the cited evidence snippet to match the file content at that line.

### L2. Cost reporting for Subscription Providers is meaningless as specified
FR-12's "estimated cost where the provider publishes pricing" doesn't apply to subscription runs that draw on plan credit and then API rates (FR-10). Report "plan credit consumed (estimate)" separately, or show nothing. FR-16's "validates each by a test call" also spends subscription credit and quota. Say so.

### L3. FR-26 consequence contradicts FR-19 and FR-21
"The only action on them is posting reviews/comments as the user" is incompatible with FR-19's resolving threads and editing summaries, and with FR-21's commit status. Reword it to list the actual write operations.

### L4. Existing PR comments as AI context widen the injection surface and create a feedback loop
FR-2 (spec §5) includes existing reviews and comments in context. That covers strangers' comments on public PRs (more injection) and the product's own earlier output (the model confirms its own earlier claims). Exclude the product's own comments, or mark them as such, and cap third-party comment text.

### L5. Open questions pre-decided inside FRs
OQ-4 (coordinating multiple users) is already answered by FR-19's consequence. OQ-3 (token type) is already constrained by GitHub (C5). OQ-6 (config format) blocks C4's allow-list. Either close these or remove the FR language that assumes an answer.

### L6. The assumption load is too high for a "finalize" request
There are 21 `[ASSUMPTION]` tags, including the release order and the v1 validator set (§6.1, "user said 'assume'; confirm"). The PRD is `status: draft`, yet the memlog records "User requested finalize." The scope-defining assumptions (§6.1, FR-20, FR-30, FR-35, FR-37) need explicit confirmation before epics are cut. Otherwise the downstream workflows will build on the PM's guesses.

---

## What to change before architecture (in order)

1. Decide what Auto-Review *is* (C1, C3, C5, H1, H5, H10). Recommended: a pending (draft) review or a local report by default, explicit opt-in to post for each repo, mandatory AI disclosure, never on review requests unless opted in, API keys only, private automation repo, least-privilege tokens, budgets.
2. Add three security FRs: hardened vendor-CLI invocation (C2), a repo-config allow-list with Review Rules as data (C4), and an output policy plus secret redaction before the prompt (H6, H7).
3. Rewrite FR-17, FR-19 and FR-21 against GitHub's actual publishing model (H3, M1, M2).
4. Add a status-mapping table and default mandatory layers (H11).
5. Cut Release 1 (C6) and either fund telemetry or replace the metrics (H4).
6. Resolve H12 items 1, 2, 3 and 6 in the PRD.
