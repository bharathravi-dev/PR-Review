# Challenger AI PR-review products: Qodo / PR-Agent, Sourcery, Ellipsis, Bito, Cursor Bugbot, Korbit, CodeAnt AI (as of late Nov 2026)

Research date: 2026-11-25. Sources are mostly vendor docs and pricing pages, so treat claims as vendor-stated unless marked otherwise. Vendor blogs are biased toward the vendor, and the third-party "comparison" blogs are often written by competitors (flagged where it matters).

Status changes since 2025 that matter most:
- **Qodo Merge has become "Qodo" (Qodo 2.0, Feb 2026).** The old qodo-merge-docs.qodo.ai URL now 301-redirects to docs.qodo.ai/code-review. **PR-Agent was handed to a community org (The-PR-Agent) in April 2026 and relicensed. It is MIT as of July 2026.**
- **Korbit was acquired by Boost Security (announced May 6, 2026).** The korbit.ai marketing site still runs, but its demo CTA points to boostsecurity.io. A competitor reported that signup and docs hosts were dead in Nov 2026.
- **Ellipsis has pivoted from a code-review bot to a general "agents as code" / background-agent platform.** Code review is now one use case among several.
- **Cursor Bugbot moved from $40/seat to usage-based billing (May 2026), at about $1.00–1.50 per run.**
- **CodeAnt AI has grown into a broad AppSec suite:** code review, SAST/SCA/secrets/IaC, cloud security (CSPM), DAST, and AI pentesting.

---

## 1. Open-source status, license, community size (the most important question for an OSS, self-hostable competitor)

### Takeaway
Of the seven, PR-Agent is the only real open-source PR reviewer. It is now community-governed and MIT-licensed, with about 16.7k stars. It is still under active development (v0.50.0 tagged Nov 7, 2026), but Qodo itself says it "has not kept pace" with the commercial product. Every other product is closed SaaS. Sourcery, Bito and CodeAnt publish only small MIT-licensed side repos (CLI, rules, legacy agent).

### Cited Findings
- **PR-Agent has moved to a community org.** Qodo's blog (Apr 23, 2026) announced the move from `qodo-ai/pr-agent` to the community-owned GitHub org `The-PR-Agent`, "independent of Qodo". Qodo said it is "focusing its investment on its enterprise AI code review and governance platform" and that PR-Agent "has not kept pace with the Qodo platform." — [Qodo blog](https://www.qodo.ai/blog/qodo-is-handing-pr-agent-over-to-the-community/)
- **PR-Agent governance.**
  - Naor Peled (TypeORM maintainer) is the first external maintainer.
  - The governance committee is Peled, Ofir Friedman (ex-Qodo-internal contributor) and Dana Fine.
  - A foundation is being "explored" but none has been named. — [Qodo blog](https://www.qodo.ai/blog/qodo-is-handing-pr-agent-over-to-the-community/)
  - The README says the project is "currently in the process of being donated to an open-source foundation" and calls it "a community-maintained legacy project of Qodo". — [GitHub The-PR-Agent/pr-agent](https://github.com/The-PR-Agent/pr-agent)
- **PR-Agent license history, from the LICENSE commit log (GitHub API):**
  - Launched under Apache-2.0 in 2023.
  - Changed to AGPL-3.0 on 2025-05-22.
  - Changed back to Apache-2.0 on 2026-05-20.
  - Changed to MIT on 2026-07-09, with the commit message "From Apache-2.0 to MIT".
  - The current SPDX id is MIT. — [GitHub API: The-PR-Agent/pr-agent](https://api.github.com/repos/The-PR-Agent/pr-agent)
  - Qodo's April blog says the project is "returning to Apache 2.0". That was true at the time but has since been superseded by MIT. — [Qodo blog](https://www.qodo.ai/blog/qodo-is-handing-pr-agent-over-to-the-community/)
- **PR-Agent community size and activity (GitHub API, 2026-11-25):**
  - 16,655 stars, 2,250 forks, 46 open issues.
  - Created 2023-07-05; last push 2026-11-25.
  - Latest tags are v0.50.0 (commit date 2026-11-07), v0.49.0 and v0.48.0.
  - The repo description reads "PR Agent: The Original Open-Source PR Reviewer. This project is not the Qodo free tier."
  - Homepage is pr-agent.ai.
  - Source: [GitHub API](https://api.github.com/repos/The-PR-Agent/pr-agent)
- **What the PR-Agent repo contains (GitHub tree, main branch):**
  - Command docs: `add_docs, ask, describe, generate_labels, help, help_docs, improve, review, similar_issues, update_changelog`.
  - Git providers: GitHub, GitLab, Bitbucket Cloud, Bitbucket Server, Azure DevOps, Gitea, Gerrit, AWS CodeCommit, a local git provider, and a plain-diff provider.
  - Deployment assets: Dockerfiles for a GitHub Action, Lambda and a "mosaico" docker-compose setup.
  - Source: [GitHub tree](https://github.com/The-PR-Agent/pr-agent)
- **PR-Agent models and deployment.**
  - Models: OpenAI, Anthropic Claude, Gemini, DeepSeek, Mistral, "any other model reachable through LiteLLM" (Azure OpenAI, Bedrock, Vertex, Databricks, OpenRouter, Ollama).
  - Deployment: CLI (`pip install "pr-agent[github]"`), GitHub Action (`the-pr-agent/pr-agent@main`), Docker image `pragent/pr-agent` (≥0.34.2), webhooks/self-hosted.
  - `/help_docs` has been disabled since v0.36.1 because of a credential-exposure issue (#2445).
  - Source: [GitHub README](https://github.com/The-PR-Agent/pr-agent)
- **Sourcery.** The `sourcery-ai/sourcery` repo is MIT, with 1,890 stars and last push 2026-11-10. This is the public repo for the IDE/CLI and rules, not the review service, which is closed SaaS. — [GitHub API](https://api.github.com/repos/sourcery-ai/sourcery)
- **Bito.** The `gitbito/CodeReviewAgent` repo is MIT, with 69 stars and last push 2025-11-13, so it is likely stale. It is the older self-hosted "CRA" Docker distribution; the current product is closed. — [GitHub API](https://api.github.com/repos/gitbito/CodeReviewAgent)
- **CodeAnt AI.** The `CodeAnt-AI/codeant-cli` repo is MIT with 2 stars, so it is a thin client only. — [GitHub API](https://api.github.com/repos/CodeAnt-AI/codeant-cli)
- **Ellipsis, Cursor Bugbot, Korbit.** I found no open-source code repositories for any of them (`ellipsis-dev/ellipsis` returns 404). — [GitHub API](https://api.github.com/repos/ellipsis-dev/ellipsis)

### Inferences
- **The self-hostable, BYO-LLM, OSS niche has one incumbent.** PR-Agent is widely adopted (about 16.7k stars) but has been "de-prioritized" by its creator. A new OSS reviewer competes with it directly, and could reuse it, since MIT is now maximally permissive.
- **The license churn (Apache → AGPL → Apache → MIT in about 14 months) is itself a signal.** Qodo no longer sees PR-Agent as a moat, and the commercial value has moved to closed features: multi-agent review, Rule Miner, cross-repo context, analytics.

### Gaps
- I did not get an exact, documented list of features that were Qodo-Merge-only and absent from PR-Agent. Historically, Qodo-only features included `/test`, `/implement`, `/compliance`, `/analyze`, `/scan_repo_discussions`, auto best-practices learning, chat on suggestions and CI feedback. These names are from prior knowledge, not verified this session.
- What can be verified is that the OSS repo's command docs do not include test, implement, compliance or analyze pages.

---

## 2. PR-level outputs (description/summary, walkthroughs, diagrams, effort estimate, changelog, labels)

### Takeaway
Every product generates a PR summary of some kind. PR-Agent (and Qodo before it) has the broadest set of PR-level tools in OSS: describe/walkthrough, labels, changelog, docs, and an effort estimate inside `/review`. Sourcery adds a "reviewer's guide" and diagrams. Korbit adds release-notes and sprint reports. Bugbot keeps PR summaries optional.

### Cited Findings
- **PR-Agent (OSS):** commands `/describe` (title, summary, walkthrough), `/review`, `/improve`, `/ask`, `/generate_labels`, `/update_changelog`, `/add_docs` and `/similar_issue`. — [GitHub tree / docs](https://github.com/The-PR-Agent/pr-agent)
- **Qodo (commercial):**
  - Produces a "PR summary": a structured walkthrough of the change before files are opened.
  - Its "Review effort mode" matches review depth to risk.
  - Merge Risk is a separate docs page.
  - Source: [Qodo docs](https://docs.qodo.ai/code-review)
- **Sourcery:**
  - Adds a summary of purpose and risk to the PR description.
  - Posts a "reviewer's guide" comment that maps the change set file by file and explains how to verify it.
  - Commands: `summary`, `guide`, `title` (regenerate the PR title).
  - Sources: [Sourcery docs overview](https://docs.sourcery.ai/Code-Review/Overview/), [Sourcery commands](https://docs.sourcery.ai/reviews/commands/)
  - The free Open Source plan includes "PR summaries and diagrams". — [Sourcery pricing](https://www.sourcery.ai/pricing)
- **Bito:** PR summaries are on the Free plan. — [Bito docs](https://docs.bito.ai/ai-code-reviews-in-git/overview)
- **Cursor Bugbot:** "PR summary mode" is configurable in the dashboard or `.cursor/config/bugbot.yaml`. — [Cursor Bugbot docs](https://cursor.com/docs/bugbot)
- **Korbit:** auto-generated PR descriptions and review summaries, plus "Insights reports" (release notes, stand-up reports, sprint reviews). — [korbit.ai](https://www.korbit.ai/)
- **CodeAnt:**
  - Review comments include "steps of reproduction" and "impact analysis" for Critical/High findings.
  - A summary comment reports quality-gate results.
  - Source: [CodeAnt code review docs](https://docs.codeant.ai/pull_request/features/code_review.md)
- **Ellipsis:** its current docs only describe "Review each push to a pull request" as a quick-start agent. — [Ellipsis docs](https://www.ellipsis.dev/docs)

### Inferences
- Changelog/release notes and labels are covered in OSS only by PR-Agent, and among the closed products mainly by Korbit's reports.
- Diagrams appear in Sourcery's free tier. Not having them is a visible gap for an OSS entrant.

### Gaps
- I could not verify the diagram types for Sourcery (sequence, ER, class) or CodeAnt (sequence diagrams); the fetched pages did not describe them.
- I could not confirm whether the current Qodo PR summary still emits labels, an effort score (1–5) or a changelog.
- I could not verify Bito's "changelist" and effort-estimate features on the fetched pages.

---

## 3. Inline review: line comments, committable suggestions, autofix, severity, noise controls, limits

### Takeaway
Committable one-click suggestions are now table stakes. The differentiators are autofix agents (Bugbot Autofix, Qodo "Agent prompt", CodeAnt "Prompt for AI Agent") and severity/noise controls (Qodo severity thresholds plus a judge agent; CodeAnt's 4-level severity; Bugbot effort levels and incremental review).

### Cited Findings
- **Qodo:**
  - Specialized agents (correctness, standards compliance, architecture, risk) run in parallel.
  - A "judge agent" merges findings, dedupes them and filters out low-confidence ones.
  - Findings are ranked by severity, with configurable severity thresholds (High vs Low).
  - Fixes: an "Apply Suggestion" button for small single-file fixes, and an "Agent prompt" to hand larger fixes to a coding agent.
  - Noise controls: review verbosity, comment location, ignore content, findings visibility, persistent review comments (`handle_push_trigger = true` in `.pr_agent.toml`).
  - Source: [Qodo docs](https://docs.qodo.ai/code-review)
- **Cursor Bugbot:**
  - Incremental review is on by default (only changes since the last review).
  - Effort levels: low, default, high, smart. They are available only on usage-based plans.
  - Skipped: PRs above a size limit, `linguist-generated` files, and credential-like files (`.env`, `*.pem`).
  - The CI check concludes `neutral` when findings exist, or `failure` if fail-on-unresolved is enabled.
  - Autofix modes: Off / Create New Branch (GitHub and Origin only) / Commit to Existing Branch (max 3 attempts per PR). Autofix is billed as Cloud Agent credits.
  - Source: [Cursor Bugbot docs](https://cursor.com/docs/bugbot)
- **CodeAnt:**
  - Inline comments are tagged by category and severity (Critical/High/Medium/Low).
  - Fixes can be applied with "Commit suggestion" or copied out via "Prompt for AI Agent".
  - A "security-only" review mode is available.
  - Quality Gates give pass/fail on Secrets, Duplicate Code, SAST and Coverage.
  - Source: [CodeAnt code review docs](https://docs.codeant.ai/pull_request/features/code_review.md)
- **Bito:**
  - Review is split into specialized "perspectives" (performance, structure, security, optimization, scalability), then combined and filtered. — [Bito docs](https://docs.bito.ai/ai-code-reviews-in-git/overview)
  - Line-level suggestions are on the Team plan. — [Bito docs](https://docs.bito.ai/ai-code-reviews-in-git/overview)
  - "One-click apply for AI fixes" is listed on the Team plan. — [Bito pricing](https://bito.ai/pricing/)
  - `#inline_comment=False` gives a single consolidated review instead of inline comments. — [Bito commands](https://docs.bito.ai/ai-code-reviews-in-git/available-commands)
- **Sourcery:**
  - Inline comments, summaries and a status check. — [Sourcery docs](https://docs.sourcery.ai/)
  - "One-click fixes" and "auto-approval of low-risk PRs" are in the free OSS plan. — [Sourcery pricing](https://www.sourcery.ai/pricing)
  - The `review` command "resets the per-PR re-review counter", which implies a per-PR re-review cap. — [Sourcery commands](https://docs.sourcery.ai/reviews/commands/)
- **Korbit:** flags issues and suggests fixes in PRs, with "higher review limits" on the Max tier. — [korbit.ai](https://www.korbit.ai/)

### Inferences
- **Auto-approval of low-risk PRs (Sourcery) and merge-risk scoring (Qodo) mark a trend**: reviewers are moving from commenting to gating.
- **"Prompt for AI agent" hand-off is now common (Qodo, CodeAnt).** An OSS tool can offer it cheaply.

### Gaps
- PR-Agent's `/improve` committable-suggestion behavior was not re-verified in this session. The command exists, but I did not confirm its current suggestion format.
- I found no explicit numeric comment caps for any vendor.

---

## 4. Commands and chat in PR threads

### Takeaway
All the active products support on-PR commands and threaded chat. The command sets range from PR-Agent's rich slash commands to Bugbot's minimal `bugbot run` / `@cursor remember`.

### Cited Findings
- **PR-Agent:** `/describe /review /improve /ask /generate_labels /update_changelog /add_docs /similar_issue /help` (`/help_docs` disabled). — [GitHub](https://github.com/The-PR-Agent/pr-agent)
- **Qodo:** "Chat with Qodo" in the PR thread. — [Qodo docs](https://docs.qodo.ai/code-review)
- **Sourcery:**
  - `@sourcery-ai review | summary | guide | title | resolve | dismiss | create issue` (create issue is GitHub only).
  - The same commands work as `sourcery-<cmd>` labels.
  - Non-command replies in Sourcery threads are treated as chat.
  - Source: [Sourcery commands](https://docs.sourcery.ai/reviews/commands/)
- **Bito:**
  - Review scopes: `/review`, `/review full`, `/review security|performance|scalability|codeorg|codeoptimize` (combinable).
  - Workflow control: `/pause`, `/resume`, `/abort`, `/resolve` (GitLab and Bitbucket only).
  - Source: [Bito commands](https://docs.bito.ai/ai-code-reviews-in-git/available-commands)
- **Cursor Bugbot:**
  - `cursor review` / `bugbot run [verbose=true]` triggers a review.
  - `@cursor remember [fact]` saves a rule.
  - `@cursor push <sha>` applies an Autofix on stacked PRs.
  - Source: [Cursor Bugbot docs](https://cursor.com/docs/bugbot)
- **CodeAnt:**
  - `@codeant-ai: review` re-runs the review.
  - `@codeant-ai: <question>` opens a chat.
  - Replying with reasoning dismisses a finding.
  - Source: [CodeAnt docs](https://docs.codeant.ai/pull_request/features/code_review.md)
- **Korbit:** "Ask Korbit" chat over the codebase on Pro and above. — [korbit.ai](https://www.korbit.ai/)
- **Ellipsis:** its GitHub integration answers @ellipsis mentions on issues and PRs. — [Ellipsis docs](https://www.ellipsis.dev/docs)

### Inferences
- Scoped review commands (Bito's `/review security,performance`) and label-triggered commands (Sourcery) are cheap UX wins for an OSS tool.

### Gaps
- I found no source for test-generation commands (`/test`) in any currently active product's PR interface (see section 7).

---

## 5. Learning, rules files, custom instructions, acceptance-rate tuning

### Takeaway
Learning from PR feedback is now the main competitive axis:
- **Bugbot** has "learned rules" from reactions, replies and human comments.
- **Qodo** has Rule Miner and dismissal-based quieting.
- **Bito Professional** has "auto-learn from feedback".

Repo-level rules files are standard: `.cursor/BUGBOT.md`, `.pr_agent.toml`, and Sourcery's "agent instruction files".

### Cited Findings
- **Bugbot learned rules:**
  - Signals: reactions (a downvote means not useful), replies explaining what was wrong, and human-reviewer comments that flag missed issues. These become candidate rules, which are promoted to active as evidence builds and disabled on consistent negative signal.
  - Users can edit or delete rules.
  - Scale: more than 110,000 repos have enabled learning, and more than 44,000 rules have been generated.
  - Source: [Cursor blog, Apr 8 2026](https://cursor.com/blog/bugbot-learning)
  - Learning runs count toward usage, and learning can be switched off ("Automatically Learn Rules"; not on Azure DevOps).
  - `.cursor/BUGBOT.md` (root plus nested files) supplies context, with a 30k-character cap per rule and 100k combined. `.cursor/rules/*.mdc` does NOT apply to Bugbot.
  - Source: [Cursor Bugbot docs](https://cursor.com/docs/bugbot)
- **Qodo:**
  - "Review Standards" are built from the codebase, PR history and requirements.
  - "Rule Miner" turns recurring PR-history patterns into rules.
  - PR history is used to prioritize issues similar to past fixes and to quiet consistently dismissed ones.
  - Source: [Qodo docs](https://docs.qodo.ai/code-review)
  - The pricing page lists a rules system with no stated limit. — [Qodo pricing](https://www.qodo.ai/pricing/)
- **Bito:** custom review guidelines and "auto-learn from feedback" are on the Professional tier ($20–25/seat). — [Bito pricing](https://bito.ai/pricing/)
- **Sourcery:** custom review rules (free tier), "agent instruction files", review analytics. — [Sourcery docs](https://docs.sourcery.ai/), [Sourcery pricing](https://www.sourcery.ai/pricing)
- **Korbit:** custom coding policies on the Max tier. — [korbit.ai](https://www.korbit.ai/)

### Inferences
- **Resolution rate / acceptance rate has become the metric vendors optimize and publish** (see section 10).
- An OSS tool that logs reactions and resolutions locally, then mines rules into a repo file, would match the core of Bugbot and Qodo learning without SaaS lock-in.

### Gaps
- PR-Agent's OSS learning features (if any, e.g. best-practices file support) were not re-verified this session.
- I could not verify CodeAnt's learning features from the fetched pages.

---

## 6. Context: codebase indexing, multi-repo, tickets, ticket compliance

### Takeaway
The commercial leaders have moved beyond the diff:
- **Qodo:** full-repo analysis, cross-repo review, requirement-gap checks against linked specs, and Figma UX-deviation checks.
- **Bito Enterprise:** cross-repo impact analysis via "AI Architect".
- **Bugbot:** MCP tools on Team/Enterprise.

Ticket integrations are mostly Jira.

### Cited Findings
- **Qodo:**
  - Analyzes the full repository, not just the diff.
  - Cross-repository review traces impact in both directions (for example, a broken API contract owned by another repo).
  - "Requirement gaps" flags PRs that miss their linked spec.
  - "UX deviations" flags drift from a linked Figma design.
  - Source: [Qodo docs](https://docs.qodo.ai/code-review)
  - Pricing lists a "Context Engine", a "Cross Repo Software Map" and cross-repo review. — [Qodo pricing](https://www.qodo.ai/pricing/)
- **Bito:**
  - Symbol indexing, ASTs and embeddings for codebase-aware review. — [Bito docs](https://docs.bito.ai/ai-code-reviews-in-git/overview)
  - Jira, Confluence and Google Docs integrations on Professional; cross-repo impact analysis "powered by AI Architect" on Enterprise. — [Bito pricing](https://bito.ai/pricing/)
- **Sourcery:** Jira integration on Pro and above. — [Sourcery pricing](https://www.sourcery.ai/pricing)
- **Cursor Bugbot:** MCP tools can be added to Bugbot (Team/Enterprise only). — [Cursor Bugbot docs](https://cursor.com/docs/bugbot)
- **Ellipsis:** sessions can be triggered from Slack, Linear, GitHub, Sentry and Jira events, and environments can include MCP servers. — [ellipsis.dev](https://www.ellipsis.dev/)
- **PR-Agent:** `/similar_issue` provides issue-scoped retrieval. — [GitHub](https://github.com/The-PR-Agent/pr-agent)

### Inferences
- **Ticket-compliance checks (Qodo) and cross-repo impact (Qodo, Bito) are enterprise-gated.** That is an opening for an OSS tool, which could read linked GitHub/GitLab issues or Linear tickets for free.

### Gaps
- I could not confirm whether the OSS PR-Agent still ships the ticket-compliance section in `/review`. It existed in 2025 per prior knowledge, but this was not verified.
- I found no source on Linear integration for the review products, other than Ellipsis as an agent trigger.

---

## 7. Deterministic tooling (SAST, secrets, IaC, SCA, linters, quality metrics) and test/doc generation

### Takeaway
CodeAnt and Sourcery have moved hardest into deterministic security scanning, and CodeAnt is now a full AppSec suite. Bito pipes in third-party static analyzers. Korbit's new owner (Boost Security) is an AppSec/SDLC-security company. Test generation has largely dropped out of PR-review products.

### Cited Findings
- **CodeAnt:**
  - Code security: SAST, SCA, secrets, SBOM, IaC and malware checks.
  - Code quality: dead code, duplication, complexity, anti-patterns, docstrings.
  - Engineering metrics: DORA and developer productivity.
  - Sources: [CodeAnt docs](https://docs.codeant.ai/), [codeant.ai](https://www.codeant.ai/)
  - Pricing: Code Quality $24/dev/mo; Code Security $24/dev/mo; AI Code Review + Code Security $40/dev/mo; Cloud Security $299 per cloud account/mo; DAST $199 per app/mo; AI pentest $4,000 one-time per root domain. — [CodeAnt pricing](https://www.codeant.ai/pricing)
- **Sourcery:**
  - Security scanning covers secrets, SAST, IaC, dependencies and licenses in one scan.
  - Includes severity, triage, repo risk profiles and agent-generated fix prompts.
  - Findings are exposed via an API and an MCP server.
  - Source: [Sourcery docs](https://docs.sourcery.ai/)
  - Nightly scans of 50 repos are on the Team tier. — [Sourcery pricing](https://www.sourcery.ai/pricing)
- **Bito:** real-time findings from fbinfer and OWASP Dependency-Check, plus high-severity results from tools like Snyk. — [Bito docs](https://docs.bito.ai/ai-code-reviews-in-git/overview)
- **Korbit:** Boost Security says the acquisition adds "AI-native static application security testing and automated code review" to its platform. — [Newswire press release](https://www.newswire.ca/news-releases/boost-security-announces-acquisitions-of-secureiqx-and-korbit-ai-and-4m-in-additional-funding-898688803.html), [SiliconANGLE](https://siliconangle.com/2026/05/06/boost-security-acquires-secureiqx-korbit-adds-4m-new-funding/)
- **Cursor Bugbot:** I found no deterministic scanners documented. It is LLM-only, and it explicitly skips credential files. — [Cursor Bugbot docs](https://cursor.com/docs/bugbot)
- **Generation features:**
  - PR-Agent has `/add_docs` (docstrings). — [GitHub](https://github.com/The-PR-Agent/pr-agent)
  - CodeAnt lists docstring coverage under code quality. — [CodeAnt docs](https://docs.codeant.ai/)
  - Bito's `/review codeoptimize` gives refactoring suggestions. — [Bito commands](https://docs.bito.ai/ai-code-reviews-in-git/available-commands)
  - Sourcery's docs keep a "refactorings list" reference. — [Sourcery docs](https://docs.sourcery.ai/)

### Inferences
- **The market is splitting into two camps.** LLM-native precision reviewers (Bugbot, Qodo) sit on one side; AppSec-bundled reviewers (CodeAnt, Sourcery, Boost/Korbit) sit on the other.
- **An OSS reviewer that runs real tools** (semgrep, gitleaks, trivy/osv-scanner, linters) with honest status and LLM triage fills the gap between the two camps.

### Gaps
- I could not identify which engines CodeAnt and Sourcery use under the hood (proprietary or wrapped OSS).
- I found no current source showing PR-level test generation (`/test`) in any active product. Qodo's test generation historically lived in Qodo Gen/Cover; its status is not verified.

---

## 8. Surfaces: git hosts, IDE, CLI, local/pre-commit

### Takeaway
PR-Agent has the widest git-host coverage of any product here, including Gitea, Gerrit and CodeCommit. Bugbot covers all four major hosts plus self-hosted variants. Sourcery has dropped to GitHub and GitLab only. Pre-PR review in the IDE or CLI is now offered by Qodo, Bito, CodeAnt and Sourcery.

### Cited Findings
- **PR-Agent:** GitHub, GitLab, Bitbucket Cloud and Server, Azure DevOps, Gitea, Gerrit, CodeCommit, local git and plain diff; plus a CLI. — [GitHub tree](https://github.com/The-PR-Agent/pr-agent)
- **Qodo:**
  - GitHub, GitLab, Bitbucket and Azure DevOps; Gerrit on Enterprise.
  - "Pre-PR review skills" are on both plans.
  - Source: [Qodo pricing](https://www.qodo.ai/pricing/)
- **Cursor Bugbot:**
  - GitHub (incl. GHES), GitLab (incl. Self-Hosted), Bitbucket (incl. Data Center), Azure DevOps Services and "Origin".
  - Autofix support varies by host.
  - Source: [Cursor Bugbot docs](https://cursor.com/docs/bugbot)
- **Sourcery:**
  - GitHub, GHES (Enterprise plan only), GitLab.com and self-managed GitLab.
  - Bitbucket is not mentioned.
  - IDE support: VS Code, Cursor, Windsurf, JetBrains.
  - Sources: [Sourcery pricing](https://www.sourcery.ai/pricing), [Sourcery docs](https://docs.sourcery.ai/)
- **Bito:**
  - GitHub, GitLab and Bitbucket, plus self-managed GitHub and GitLab. — [Bito docs](https://docs.bito.ai/ai-code-reviews-in-git/overview)
  - Reviews in Git, IDE and CLI; VS Code, JetBrains, Cursor and Windsurf; "CI/CD pipeline reviews" on Professional. — [Bito pricing](https://bito.ai/pricing/)
- **CodeAnt:**
  - The same review runs in the IDE (VS Code), the CLI and CI/CD; there is also an MCP server and an API. — [CodeAnt docs](https://docs.codeant.ai/)
  - A Bitbucket Data Center setup guide exists. — [CodeAnt docs](https://docs.codeant.ai/setup/bitbucket_data_center.md)
  - Azure DevOps support is vendor-claimed. — [CodeAnt Azure page](https://www.codeant.ai/git-platform/azure-devops-ai-code-review-2)
- **Korbit:** GitHub, GitLab, Bitbucket. — [korbit.ai](https://www.korbit.ai/)
- **Ellipsis:** GitHub only, plus an Agents API and CLI. — [Ellipsis docs](https://www.ellipsis.dev/docs)

### Inferences
- **Gitea, Gerrit and Forgejo users have essentially no commercial option besides Qodo Enterprise (Gerrit only).** PR-Agent covers them, and a new OSS entrant should too.

### Gaps
- I could not verify Bito's Azure DevOps support.
- I found no vendor offering a pre-commit hook explicitly; only IDE and CLI pre-PR review were found.

---

## 9. Deployment: self-hosting, air-gapped, BYO LLM, data retention, SOC 2

### Takeaway
Self-hosting and BYO-key are enterprise-gated everywhere except PR-Agent (free and self-hosted by design). Bito Professional, at +$5/seat, is the cheapest commercial self-host. Ellipsis offers BYOC in your own AWS VPC. Bugbot does not self-host at all; it only connects to self-hosted git.

### Cited Findings
- **Qodo:** single-tenant SaaS and on-prem/air-gapped are Enterprise only, as is BYOK. Qodo states it does not train on customer code, and the Trust Center is at trust.qodo.ai. — [Qodo pricing](https://www.qodo.ai/pricing/)
- **Sourcery:**
  - Self-hosting, GHES, SSO and BYO LLM keys are on Enterprise.
  - Code is "not retained" and not used for training.
  - Claims SOC 2 Type II.
  - Sources: [Sourcery pricing](https://www.sourcery.ai/pricing), [Sourcery docs](https://docs.sourcery.ai/)
- **Bito:**
  - Team plan: cloud only. Professional: self-hosted for +$5/seat/mo. Enterprise: self-hosted or on-prem.
  - Claims SOC 2 Type II; code is not stored or used for training.
  - Source: [Bito pricing](https://bito.ai/pricing/)
  - Self-hosted configuration goes through `bito-cra.properties`. — [Bito commands](https://docs.bito.ai/ai-code-reviews-in-git/available-commands)
  - BYO LLM: not found.
- **Cursor Bugbot:**
  - No self-hosting; it follows Cursor's privacy compliance. — [Cursor Bugbot docs](https://cursor.com/docs/bugbot)
  - Privacy-mode "no training" guarantee (general, not Bugbot-specific). — [Cursor pricing](https://cursor.com/pricing)
  - Models are not disclosed; Autofix uses the user's default agent model.
- **CodeAnt:**
  - Claims SOC 2 Type II and HIPAA. — [codeant.ai](https://www.codeant.ai/)
  - Self-hosted Bitbucket Data Center via SSO. — [CodeAnt docs](https://docs.codeant.ai/setup/bitbucket_data_center.md)
  - On-prem/self-hosted "options available" on its Azure DevOps page (vendor claim). — [CodeAnt Azure page](https://www.codeant.ai/git-platform/azure-devops-ai-code-review-2)
- **Korbit:** on-prem installation on Enterprise; claims SOC 2 Type 2 and no training on code. — [korbit.ai](https://www.korbit.ai/)
- **Ellipsis:**
  - BYOC: the control plane and agent sandboxes run in your AWS VPC, and "No credentials, code, or LLM calls leave it." — [Ellipsis pricing](https://www.ellipsis.dev/pricing)
  - SOC 2 Type I certified, Type II in progress; code lives only in the session sandbox. — [ellipsis.dev](https://www.ellipsis.dev/)
  - Harnesses: Claude Code, Codex, Gemini CLI. — [Ellipsis docs](https://www.ellipsis.dev/docs)
- **PR-Agent:** fully self-hostable with any LiteLLM-reachable model, including local Ollama. — [GitHub](https://github.com/The-PR-Agent/pr-agent)

### Inferences
- **Air-gapped plus local models remains a high-price enterprise SKU** (Qodo, Bito, Korbit, CodeAnt) or DIY with PR-Agent. That is the clearest positioning gap for a polished OSS self-hosted reviewer.

### Gaps
- I did not retrieve specific data-retention periods for any vendor.
- I did not check the trust-center pages or verify SOC 2 claims independently.

---

## 10. Pricing and free tiers

### Takeaway
Pricing is converging on usage-based models: Qodo pooled credits, Bugbot per run, Ellipsis tokens + 10%, and Bito per-seat with a line-count overage. Per-seat survivors cluster at $12–30 per developer per month. Free tiers are mostly limited to OSS/public repos.

### Cited Findings
- **Qodo:**
  - 14-day free trial (unlimited).
  - Pro Team: $30/mo for about 14 PR reviews / 2,000 credits; credits are $0.015 each, pooled, expire monthly, with overage at the same rate up to a spending cap.
  - "We don't offer a permanent free tier"; there is an OSS program; Enterprise is custom.
  - Source: [Qodo pricing](https://www.qodo.ai/pricing/)
  - Earlier-2026 per-seat pricing was $30/user/mo with 250 free credits. Third-party sources conflict on this. — [dev.to](https://dev.to/rahulxsingh/qodo-ai-pricing-free-vs-teams-vs-enterprise-plans-in-2026-2mh5), [PricingSaaS](https://pricingsaas.com/companies/qodo)
- **Cursor Bugbot:**
  - Was $40/seat/mo.
  - Moved to usage-based billing on May 11, 2026, with an average of $1.00–1.50 per run. Existing customers switch at their first renewal after June 8, 2026.
  - Source: [Cursor blog May 2026](https://cursor.com/blog/may-2026-bugbot-changes)
  - Included only on Premium/Super/Ultra/Teams/Enterprise, not Free or Plus; Teams is "$30+/user/month". — [Cursor pricing](https://cursor.com/pricing)
  - Users complain on the forum about iterative-workflow cost; one thread is titled "Bugbot price hike, +135%" (user-reported). — [Cursor forum](https://forum.cursor.com/t/the-new-usage-based-bugbot-pricing-punishes-iterative-workflows-and-power-users/161134), [Cursor forum](https://forum.cursor.com/t/bugbot-price-hike-135/174859)
- **Sourcery:** Open Source free (public repos); Pro $12/$15; Team $24/$30 per dev/mo (annual/monthly); Enterprise custom; 14-day Team trial. — [Sourcery pricing](https://www.sourcery.ai/pricing)
- **Bito:** Team $12/$15; Professional $20/$25 per seat/mo; Enterprise custom. Includes 5K lines/seat/month, then $5 per 1K lines. 14-day trial. — [Bito pricing](https://bito.ai/pricing/)
- **CodeAnt:** AI Code Review $24/dev/mo; Review + Security $40/dev/mo (annual, "save up to 20%"); a "$0 / Start free trial" option with no stated limits. — [CodeAnt pricing](https://www.codeant.ai/pricing)
- **Korbit (still listed on its site):** Pro $12/$15; Max $18/$24 per user/mo; Enterprise custom; 14-day trial; Max free for OSS repos. — [korbit.ai](https://www.korbit.ai/)
- **Ellipsis:** $0 per seat; tokens at cost + 10% platform fee; $0.142 per vCPU-hour, $0.024 per GB-hour; BYOC on AWS; support packages $5k–15k/mo; $100 free credit for new orgs. — [Ellipsis pricing](https://www.ellipsis.dev/pricing), [ellipsis.dev](https://www.ellipsis.dev/)

### Inferences
- Usage-based billing creates cost unpredictability for heavy iterative pushes, as the Bugbot forum backlash shows.
- A self-hosted BYO-key tool with transparent per-PR token cost is a credible counter-position.

### Gaps
- I did not verify Ellipsis's pre-pivot code-review pricing (historically about $20/user/mo, from prior knowledge).
- Whether Korbit pricing is still honored after the acquisition is unknown.

---

## 11. Published accuracy claims and methodology

### Takeaway
Cursor is the only vendor here that publishes a quantified, cross-vendor metric: resolution rate, judged by an LLM on public repos. Qodo publishes a vendor benchmark claim for Qodo 2.0. All are self-reported and unaudited.

### Cited Findings
- **Bugbot resolution rate** (share of flagged bugs resolved by merge time, judged by an LLM on public repos only):
  - 52% at launch out of beta (July 2025), now "nearing 80%".
  - Comparison table:

    | Product | Resolution rate | PRs analyzed |
    |---|---|---|
    | Bugbot | 78.13% | 50,310 |
    | Greptile | 63.49% | 11,419 |
    | CodeRabbit | 48.96% | 33,487 |
    | GitHub Copilot | 46.69% | 24,336 |
    | Codex | 45.07% | 19,384 |
    | Gemini Code Assist | 30.93% | 21,031 |

  - The post says Bugbot reviews "hundreds of thousands of PRs per day".
  - Source: [Cursor blog, Apr 8 2026](https://cursor.com/blog/bugbot-learning)
- **Bugbot experiments:** 40 major experiments raised the rate from 52% to more than 70%, and bugs flagged per run from 0.4 to 0.7. — [Cursor blog "Building a better Bugbot"](https://cursor.com/blog/building-bugbot)
- **Autofix post:** reported a 76% resolution rate. — [Cursor blog "Bugbot Autofix"](https://cursor.com/blog/bugbot-autofix)
- **Effort levels (May 2026):** default effort resolves 80% of identified bugs; high effort finds 35% more bugs at the same 80% (internal runs). — [Cursor blog May 2026](https://cursor.com/blog/may-2026-bugbot-changes)
- **Qodo 2.0 (Feb 4, 2026)** claims "the highest precision and recall, outperforming alternatives by 11%". I could not retrieve the methodology (the press release returned 403). — [GlobeNewswire](https://www.globenewswire.com/news-release/2026/02/04/3232129/0/en/qodo-2-0-redefines-ai-code-review-for-accuracy-and-enterprise-trust.html), [IT Brief](https://itbrief.com.au/story/qodo-2-0-debuts-multi-agent-ai-code-review-upgrade)
- **CodeAnt:** usage claims only (2,000+ orgs on AI code review, 1B+ LOC scanned monthly, Gartner Cool Vendor 2026); no accuracy or false-positive figures. — [codeant.ai](https://www.codeant.ai/)
- **Sourcery, Bito, Korbit, Ellipsis:** no accuracy claims were found on the fetched pages.

### Inferences
- **"Resolution rate" is becoming the de facto public metric**, but it conflates usefulness with compliance and depends on the LLM judge.
- An OSS project could publish a reproducible version (open judge prompts, open dataset of public PRs). That would be a credibility differentiator against vendor-run benchmarks.

### Gaps
- I found no independent third-party audit of any of these numbers.
- I could not retrieve Qodo's benchmark methodology or the names of the competitors it compared against.

---

## 12. Shutdowns, acquisitions, renames, pivots

### Takeaway
Three of the seven have changed materially in 2026: Qodo (rebrand and OSS spin-out), Korbit (acquired), and Ellipsis (pivot). Plan around them as moving targets.

### Cited Findings
- **Qodo Merge rebranded:**
  - Qodo Merge ("Qodo 1.0") was "rebranded and evolved into Qodo (Qodo 2.0)". — [GitHub README](https://github.com/The-PR-Agent/pr-agent)
  - The old docs URL 301-redirects to docs.qodo.ai/code-review. — [Qodo docs](https://docs.qodo.ai/code-review)
  - Qodo 2.0 multi-agent review launched Feb 2026. — [GlobeNewswire](https://www.globenewswire.com/news-release/2026/02/04/3232129/0/en/qodo-2-0-redefines-ai-code-review-for-accuracy-and-enterprise-trust.html)
- **Korbit acquired:**
  - Boost Security announced on May 6, 2026 that it had acquired Korbit.ai (Montreal) and SecureIQx, and raised $4M. Terms were undisclosed. — [Boost blog](https://boostsecurity.io/blog/announcing-two-acquisitions-and-a-funding-round), [SiliconANGLE](https://siliconangle.com/2026/05/06/boost-security-acquires-secureiqx-korbit-adds-4m-new-funding/), [Newswire](https://www.newswire.ca/news-releases/boost-security-announces-acquisitions-of-secureiqx-and-korbit-ai-and-4m-in-additional-funding-898688803.html)
  - korbit.ai still markets the product, but "Request Demo" links to boostsecurity.io. — [korbit.ai](https://www.korbit.ai/)
  - A competitor blog (Qodex, updated Nov 12, 2026) reports Korbit's get-started page returned 404 and that app.korbit.ai and docs.korbit.ai had no DNS on Nov 11, 2026. This is competitor-reported and unverified. — [Qodex blog](https://qodex.ai/blog/korbit-alternatives)
- **Ellipsis pivoted:**
  - Now an "agents as code" platform (YAML/Python/TS SDK, sessions, budgets, "Software Factories").
  - Code review is one use case.
  - Shows 11.6k agents built and 67k repos connected.
  - The site contained embedded instructions aimed at AI agents, which I ignored.
  - Source: [ellipsis.dev](https://www.ellipsis.dev/)
  - YC lists the company as Active, with a team size of 2. — [YC](https://www.ycombinator.com/companies/ellipsis/jobs)

### Inferences
- **Korbit looks like an acqui-hire or technology absorption into Boost's AppSec platform.** A standalone Korbit reviewer should be treated as at risk of sunset.
- **Ellipsis is no longer a direct PR-reviewer competitor.** It competes with background-agent platforms instead.

### Gaps
- I did not confirm whether app.korbit.ai is actually offline (not independently checked).
- I did not find a Sourcery or Bito acquisition or rename. Both appear independent and active (Sourcery's repo was pushed 2026-11-10).
