# Input reconciliation: user's own words vs PRD

Checked: `prd.md`, `addendum.md` (with `.memlog.md`, `extract-inputs.md`, and `additional_info.md` for cross-checks). Date: 2026-11-24.

Legend: **Captured** / **Partial** (what's missing) / **Not captured**.

---

## Item 1: the four channels

> "install an npm globally, and I just have a cloud license, use that, or OpenAI use that, or anyone use that, and give the PR. It should validate and post the comments … there should be a UI to just take the PR link and validate and post the reviews, comments, whatever is there, to GitHub as well as in the website itself … for my GitHub account, I need to inject this one, and whenever raising to my account any PR, it has to automatically validate. So GitHub CLI … just a PR is shared. I need to have a plugin, Chrome plugin or anything. So just install that and validate those things."

| Sub-ask | Status | Where / what's missing |
|---|---|---|
| "So now it is running in the cloud" (baseline) | Captured | §0, addendum §A (manual-dispatch Actions workflow as the baseline). |
| npm global install, give PR, validate, post comments | Captured | FR-22 (npm global + npx), FR-1, FR-23 (preview and confirm), FR-17, UJ-1. |
| "cloud license, use that" (Claude subscription) | Captured | FR-9, FR-10 (user's own logged-in Claude Code, CLI allowed), FR-16 detection, UJ-1. |
| "OpenAI use that" | Captured | FR-9 (OpenAI API and ChatGPT via Codex CLI). |
| **"or anyone use that"** (provider openness) | **Partial** | FR-9 is a closed list of 9 providers; extending it means "a new provider adapter registered with the engine" (code), not configuration. There is no user-configurable **generic OpenAI-compatible endpoint** (base URL + key + model) FR, so a user on Groq, DeepSeek, Mistral, Together, LM Studio, vLLM, a corporate gateway, etc. cannot "use that" without a code change. The addendum (B2) mentions an OpenAI-compatible adapter only as an architecture option. This also sits uneasily with item 2's "everything dynamic": the endpoint is effectively hardcoded per provider. Suggest an FR: "any OpenAI-compatible (and Anthropic-compatible) endpoint by configured base URL, key, and model; no code change". |
| UI: take PR link, validate | Captured | FR-30, FR-31, UJ-3. |
| UI: "post … whatever is there, to GitHub **as well as** in the website itself" | Captured | FR-32 (full Report in page: status, gate, technologies, layers, findings with evidence, skipped checks, AI usage), FR-33 (publish from page, link to review), FR-34 history. "Whatever is there" is met: the Report is the full output and FR-17's summary carries the same sections. Minor: FR-33 lets the user deselect/edit before publishing; a one-click "publish everything" default is implied but not stated. |
| "for my GitHub account, I need to **inject this one**" | Captured (interpretation) | FR-26 (one setup command creates the automation inside the user's own GitHub account, stores secrets there, runs a first discovery), UJ-2, addendum B3 (workflow in a user-owned repo). Interpreted as "install into my account", not "install on each repo"; consistent with item 4 ("own GitHub"). |
| "whenever raising to my account any PR, it has to automatically validate" | Captured, with a latency caveat | FR-27 (authored, owned repos, requested reviewer, orgs), FR-28 default ≤ 15 min polling `[ASSUMPTION]`; event-driven trigger only as an optional optimisation for owned repos (§4.6 Notes). "Whenever" may imply near-instant; the 15-minute default should be confirmed with the user. |
| **"So GitHub CLI"** | **Partial** | `gh` appears only as a **credential source**: FR-15, FR-16 (detect GitHub CLI login), UJ-1. The user tied "GitHub CLI" directly to the auto-review sentence. Plausible meanings not reflected: (a) auto-review is enabled/managed through `gh` (e.g. setup uses `gh auth` and `gh` to create the repo, workflow and secrets); (b) the tool is distributed as a **`gh` extension** (`gh extension install … ; gh pr-review <url>`); (c) running on GitHub's own infrastructure (Actions). FR-26 does not say which Credential/tooling setup uses, nor whether `gh` is required, preferred, or optional. Needs a one-line confirmation and, if (a)/(b), an FR. |
| Chrome plugin "or anything" for a shared PR link | Captured | FR-36–FR-38, UJ-4 (PR link from chat). Chromium only; Firefox/Safari v2+ (§6.2), acceptable under "or anything". |
| **"just install that and validate"** (zero-setup simplicity) | **Partial / conflicting** | The extension "contains no AI logic" and needs a backend (FR-37): either a self-hosted Web App or a local CLI companion. There is no hosted instance (§6.2, OQ-7) and the extension stores no AI keys (§4.8 NFR). So "just install" really means install the extension **and** install the CLI (and run it as a local server) or self-host the Web App. UJ-4's edge case even plans for "walks him through pointing it at one". It also ships last (Release 3, §6.1). This is a deliberate trade-off (store policy, key safety) but the PRD does not acknowledge it against the user's stated simplicity bar, and has no FR or metric for extension time-to-first-review (NFR-9's 10 min covers "each Channel" generically). Options to surface: a standalone mode (extension calls the user's chosen API provider directly with a key in `storage.session`, tool-free layers only), auto-discovery of a running CLI companion, or explicitly accept the dependency and set an install-to-review target for it. Also not stated: publication on the Chrome Web Store (FR-36 only requires meeting store policy). |

## Item 2: nothing hardcoded; usable by me and others

> "No hardcoded values like URL, repos, nothing … end-to-end to be dynamic … anyone can install it by the npm package, or any other way … usable from me and as well as from others."

| Sub-ask | Status | Where / what's missing |
|---|---|---|
| No hardcoded URL, repos, orgs | Captured | FR-1 (repo-scan test fails the build), FR-13 (layered config, defaults with no repo/org/host/URL), FR-14 (rules via config), FR-37 (no backend URL hardcoded), §7, addendum §A (remove `rules/sunbird-cb-portal.md` and README examples). |
| "End-to-end dynamic" | Mostly captured | Models/providers via FR-11; GitHub host via FR-1. Gaps: provider endpoints are fixed per adapter (see "anyone use that" above); Web App's own deployment settings (public URL, OAuth app client ID/secret, ports) are not named as configuration, though the principle covers them; the Auto-Review automation's source (does the generated workflow reference the maintainer's repo/Action by name and version?) is unspecified, which is both a hardcoded value and a lock-in point. |
| Anyone can install via npm | Captured | FR-22, SM-4, §1 Vision, §2.1. |
| "or any other way" | Partial | Channels give npm, npx, container self-host (§4.7 NFR), Chrome extension. Not mentioned: a published reusable GitHub Action / Marketplace entry so other repo owners can add it to their CI (FR-24 says "any CI" via CLI only), `gh` extension (see item 1), Homebrew/standalone binary, Docker image for the CLI. Not essential, but "any other way" was explicit. |
| **"usable from me and others"** (multi-user, no maintainer lock-in) | **Mostly captured; two gaps** | Captured: §7 "does not resell AI usage or proxy users' Credentials through a service run by the maintainer"; per-user Auto-Review in each user's own account (FR-26); per-user privacy in Web App (FR-30, FR-35); bring-your-own provider (§4.2); FR-19 per-user idempotency; OQ-4 on multiple users per PR. Gaps: (1) Web App and Extension depend on someone self-hosting — no hosted option means "others" who are not technical must self-host or run the CLI companion (OQ-7 leaves it open); (2) no requirement that the Auto-Review automation is self-contained in the user's account (vendored/pinned) rather than pulling from a maintainer-controlled reference that the maintainer could change or remove. |

## Item 3: "2, fast" — real open-source for adoption; fast path

**Captured.** §0 ("open-source product that anyone can install and use"), §1 Vision, §2.1, SM-4 adoption, NFR-9 docs/quick-starts, OQ-5 licence `[ASSUMPTION: MIT]`, memlog decisions. Fast path reflected by `[ASSUMPTION]` tags and §10 index. Minor: contributor-facing items an adoption-oriented OSS project usually needs (contribution guide, adapter/validator authoring docs, versioning/semver policy) are only implied by NFR-7; not required by the user's words.

## Item 4: "1 a,b,c,d own GitHub, 3 all, rest assume"

| Sub-ask | Status | Where |
|---|---|---|
| (a) PRs the user opens | Captured | FR-27, Glossary "Watch Scope", UJ-2, addendum B3 (`author:@me`). |
| (b) PRs on repos they own | Captured | FR-27, B3 (`user:<login>`). Note: repos owned by orgs the user administers are not explicitly "owned"; the include list in (d) covers them. |
| (c) PRs where requested reviewer | Captured | FR-27, B3 (`review-requested:@me`). Minor: whether team review requests count (vs direct only, `user-review-requested:@me`) is unstated. |
| (d) Org repos they don't administer | Captured | FR-26 (nothing installed on target repos; polling with the user's own Credential), FR-27, FR-29 (SSO, token policy health), UJ-2, B3, OQ-3. |
| Runs from the user's own GitHub | Captured | §4.6 description, FR-26. |
| "3 all" — all AI providers at first release | Captured (with a wording ambiguity) | §6.1 "AI Provider Layer with all providers listed in FR-9" and memlog ("R1 = engine + all providers + CLI + Auto-Review"). §6.1 lists the provider layer as a v1 bullet without tying it to Release 1; adding "(Release 1)" to that bullet would remove doubt. Providers dropped for external reasons (GitHub Models retired, Copilot, Gemini personal login) are explained under FR-9 Out of Scope — reasonable, but the user should see that "all" excludes these. |
| "rest assume" | Captured | `[ASSUMPTION]` tags; §10 index; §6.1 release order tagged for confirmation. |

## Item 5: "opt-in with warning" (subscription providers in Auto-Review)

**Captured.** FR-10 table (Auto-Review column: "Opt-in with warning") and its last Consequence (explicit opt-in, warning text content, API-only default, failure reported via FR-29, fallback via FR-11); OQ-1 rewritten to track vendor-terms drift; memlog decision.

## Item 6: lint / Angular 12+ standards, comments, the validation spec

| Sub-ask | Status | Where / what's missing |
|---|---|---|
| "add comments" on PRs; inline comments and a summary | Captured | FR-17 (one review: summary + inline comments on valid diff lines; overflow and unattachable findings go into the summary), FR-18, FR-19, Glossary "Publish". |
| "tslint, js lint" | Partial | §6.1 v1 validator set: "compiler, repo's ESLint/TSLint config". FR-4 uses the repo's own config "where present". Missing at PRD level: what happens when the repo has **no** lint config. Spec (`additional_info.md` lines ~413–418) requires "a clearly identified default ruleset", version-compatible, reported in the Report; FR-4 cites spec §7 generally but does not carry this forward, and the user's words read as "always check lint standards", not "only if configured". "js lint" is probably ESLint, but JSLint/JSHint configs in older repos are not mentioned — worth a confirm. |
| **"angular 12+ standards"** | **Partial** | §6.1 says "Angular and React framework checks"; FR-3 detects framework versions; spec §6 (line 280) says don't enforce newer-version rules on older apps. Not captured: the explicit **supported Angular range (12 and above)** as a v1 commitment, and version-aware standards across that range (e.g. NgModule vs standalone, TSLint-era 12 projects vs angular-eslint, signals/control flow only on versions that have them). No acceptance test names an Angular 12 project. Suggest a consequence under FR-3/§6.1: "Angular 12 through current: rules selected by detected version; an Angular 12 TSLint-configured project and a current angular-eslint project are both in the test corpus." |
| Long spec (`additional_info.md`) "for validation checks" | Captured by reference, with deliberate cuts | §0 and FR-2–FR-8, FR-13, FR-39 reference the Validation Capability Spec by section rather than restating it. Deferred from the spec: running SonarQube ourselves (§6.2, reuse only), full L1–L14 per language, runtime accessibility (axe-core). These were "assumed" under "rest assume" and are tagged in §6.1, but the user should explicitly see that parts of their spec are cut from v1. |

---

## Summary of gaps (priority order)

1. **Browser extension is not "just install that"** — needs a self-hosted Web App or a running CLI companion, ships in Release 3; no standalone mode, no Web Store publication requirement, and the conflict with the user's simplicity bar is not acknowledged.
2. **"GitHub CLI" only appears as a credential source** — the user linked it to auto-review; whether setup is driven by `gh`, or the tool ships as a `gh` extension, is neither captured nor listed as an open question.
3. **Angular 12+ and lint without repo config** — no stated supported Angular range or version-aware test corpus, and the spec's "default ruleset when config is absent" is not carried into FR-4.
4. **"Anyone use that" is a fixed list** — no FR for a user-configured OpenAI-/Anthropic-compatible endpoint (base URL + key + model), so new providers need code; also weakens "everything dynamic".
5. **Maintainer lock-in in Auto-Review and hosting** — the generated automation's dependency on a maintainer-controlled reference is unspecified, and non-technical "others" have no path to the Web App/Extension without self-hosting.

Minor: confirm the ≤ 15-minute polling default against "whenever … automatically"; tag the all-providers bullet in §6.1 as Release 1; "any other way" distribution (reusable GitHub Action/Marketplace, `gh` extension) not listed.
