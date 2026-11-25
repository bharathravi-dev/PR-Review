---
title: "Addendum: PR Reviewer PRD — mechanisms, options, and evidence"
created: 2026-11-24
updated: 2026-11-24
---

# Addendum to the PR Reviewer PRD

Material that informs architecture and later decisions but does not belong in the PRD itself. Nothing here is a requirement unless the PRD's FRs say so.

## A. Current state (baseline to evolve from)

Full detail with file:line citations: `extract-inputs.md` §A.

- One zero-dependency Node file (`review.mjs`): fetches the PR via the GitHub REST API, makes one Anthropic call (default model `claude-sonnet-5-5`, forced `submit_review` tool), posts one review whose inline comments land only on valid diff lines, never approves, treats PR text as untrusted.
- Context caps: 60 KB per file, 350 KB full-file context, 400 KB of diff.
- GitHub Actions workflow: manual dispatch only; secrets `ANTHROPIC_API_KEY` and `GH_REVIEW_TOKEN`; the write token and AI key share one process.
- `test.mjs`: 6 unit assertions.
- Absent vs the Validation Capability Spec: technology detection, deterministic tools, SonarQube, Quality Gate, dedup, idempotency (re-runs post duplicates), retry/backoff, config file and hierarchy, audit trail, per-validator degradation (any error ends the run).
- Repo-specific values to remove for FR-1/FR-13: the bundled `rules/sunbird-cb-portal.md`, README examples naming KB-iGOT/sunbird-cb-portal.

**Reusable:** PR fetch and diff-line mapping, the publish routine, the untrusted-input stance, the rules-file idea (generalised into Review Rules via Configuration).

## B. Mechanism options by Channel (for architecture to decide)

### B1. Review Engine packaging
- One TypeScript core package consumed by all Channels; Channels are thin adapters: `core`, `providers/*`, `validators/*`, `cli`, `action` (Auto-Review), `web` (server + UI), `extension`.
- Validator and provider contracts as in Validation Capability Spec §22, with a registry so new ones register without touching the core.

### B2. AI Providers
- API Providers: direct HTTPS adapters, or one adapter over an OpenAI-compatible interface plus native adapters where structured output differs (Anthropic, Gemini, Bedrock). OpenRouter and Ollama expose OpenAI-compatible endpoints.
- Claude subscription: spawn the user's own `claude -p` (headless Claude Code) with JSON output, passing structured context on stdin; never touch its credential files. Since 2026-06-15, headless/Agent SDK use draws on a separate monthly credit equal to the plan price, billed at API rates beyond it (press reports; verify on release).
- ChatGPT subscription: spawn the user's own `codex exec` with `--json` (JSONL events) and `--output-schema` for schema-shaped Findings; Codex's own read-only sandbox by default. OpenAI recommends API keys for automation.
- Rejected for v1: offering "Sign in with ChatGPT" in the Web App (needs OpenAI approval; partner programme), any Claude.ai login in our own UI (not permitted), GitHub Models (retired), Copilot (no sanctioned route), Gemini CLI personal login (discontinued 2026-06-18).

### B3. Auto-Review discovery (repos the user doesn't administer)
Why polling: a GitHub App needs an org owner's install, and even user tokens issued through an App only reach orgs where it's installed. A reusable Action needs write access to add the workflow, and fork PRs don't get Actions secrets. Repo webhooks need admin. So, for PRs in orgs or repositories the user doesn't administer, the only route is the user's own token.
- A workflow in a repo the user owns (created by the setup command), on a schedule plus manual dispatch.
- Search queries per Watch Scope item: `is:pr is:open author:@me`, `is:pr is:open user:<login>` for owned repos, `is:pr is:open review-requested:@me`, plus `org:<org>` / `repo:<r>` filters. Search API limit is 30 requests/min; page through results and keep a state file (last reviewed Head Commit per PR) in the automation repo or its cache to enforce FR-19.
- For repos the user owns, an optional `pull_request` workflow there gives immediate review (FR-28).
- Org obstacles to surface via FR-29 (an issue in the user's automation repository plus the run summary): fine-grained token approval, classic tokens blocked, SAML SSO authorisation, OAuth app access restrictions (default-on for new orgs).
- Precedent: Copilot's per-user "automatically review my PRs" setting, which works only where the org allows Copilot review.

### B4. Web App
- Server holding the core; job queue for runs; SSE/WebSocket for live progress; Postgres or SQLite for Reports/history; GitHub OAuth sign-in; container image + compose file for one-command self-host.
- Per-user encrypted API keys; Subscription Providers excluded (FR-10).

### B5. Browser Extension (Chrome MV3)
- Remote code is banned; remote API calls and fetching config/data are allowed.
- Only the background service worker makes cross-origin requests; content scripts relay through it.
- `chrome.storage.local`/`sync` are readable by content scripts by default; `storage.session` is not, and is cleared on browser restart — choose per token lifetime.
- Credentials count as sensitive data under store policy: HTTPS, encryption at rest, privacy policy, in-UI consent.
- GitHub's redesigned "Files changed" view became default in January 2026: `/changes` routes, client-side tab switches, virtualised large diffs. So read PR data via API and render our own side panel; use the URL (and `popstate`/navigation events) only to know which PR is open.
- Modes (FR-37): Standalone — the extension calls the user's AI Provider and the GitHub API itself, with no backend; Connected — a Web App URL, or a local "CLI companion" (the CLI serving a localhost API). For Ollama-backed local runs the user may need `OLLAMA_ORIGINS` configured (third-party guidance; verify).

### B6. Deterministic checks and Sandbox
- Local: a container runtime (Docker/Podman) with no host mounts beyond the checkout, no Credentials in env, network restricted to package registries.
- Auto-Review: separate job for PR-code execution without the write token or AI key; results passed as artefacts to the publishing job.
- Reuse first (FR-5): read existing commit statuses/check runs (e.g. `sonarqube/quality-gate`, CI test jobs) for the Head Commit before running anything.

## C. Market snapshot

See `research-digest.md` for the full table with sources and verification tags. Key takeaways:
- Only the open-source tools offer real bring-your-own-provider: PR-Agent (community-owned, any model via LiteLLM) and PRScope (npm; OpenAI, Anthropic, Ollama, OpenAI-compatible).
- Commercial tools sell their own model per seat or credit; CodeRabbit (50+ linters) and Copilot (CodeQL) pair AI with deterministic analysis.
- Qodo is removing its Chrome extension in favour of in-GitHub chat, a signal that extension value depends on doing something the PR page can't.
- Unverified as current: several vendors' pricing; Ellipsis status.

## D. Tensions noted from the Validation Capability Spec

(From `extract-inputs.md` §D; the PRD resolves them as noted.)
1. Spec scale (multi-org platform, ~33 technologies) vs a solo open-source start → PRD §6.1 slices v1 into four releases and adds validators incrementally.
2. Isolation vs laptop use → FR-39/FR-40: Sandbox or `SKIPPED`.
3. Spec expects bot-owned comments and Check Runs (GitHub App) vs posting as the user without org installs → PRD defaults to the user's identity (FR-20); commit status only where permitted (FR-21).
4. SonarQube availability unknown → reuse existing results only in v1 (FR-5).
