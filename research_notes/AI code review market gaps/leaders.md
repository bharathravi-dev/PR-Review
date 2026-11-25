# Market Leaders in Dedicated AI PR Review (CodeRabbit, GitHub Copilot code review, Graphite Agent, Greptile), as of late November 2026

Research date: 2026-11-25. Sources are mostly vendor docs, pricing pages and changelogs, fetched live on that date. Unless marked "(vendor claim)", a statement describes documented product behavior. Quantitative quality claims all come from vendors and are flagged. Note: graphite.com/pricing and the Graphite launch blog returned HTTP 402 to automated fetches, so Graphite pricing comes from Graphite's own docs (billing-plans.md) and third-party trackers.

**How much has changed since 2025.** All four products changed substantially in 2026:
- CodeRabbit reorganized into a suite: Review, Explain/Change Stack, Verify, Secure, Triage and a Coding Agent. Its tiers are now Essentials, Team, Advanced and Enterprise.
- Copilot code review became agentic (March 2026) and moved to AI-credit billing (June 2026).
- Graphite renamed Diamond to "Graphite Agent" (October 2025), and Cursor bought Graphite (December 2025).
- Greptile dropped per-seat pricing in favor of credits, with review tiers Base, Plus and Apex.

Pricing and feature lists from 2024–2025 comparison articles are largely out of date.

---

## 1. PR-level outputs (summary, walkthrough, diagrams, effort estimate, release notes, fun extras)

### Takeaway
CodeRabbit has the richest configurable PR-level output: a summary, a walkthrough with a changed-files table, sequence diagrams, an effort estimate, related issues and PRs, suggested labels and reviewers, and an optional poem (now off by default). Greptile pairs a summary with a 0–5 confidence score and auto-chosen Mermaid diagrams. Copilot posts an overview comment with an assessment and a running findings ledger. Graphite generates PR titles and descriptions, and its review output focuses on bugs.

### Cited Findings
**CodeRabbit**
- Its summary is "A structured comment posted by CodeRabbit at the top of every pull request" that covers "summarizing changes, sequence diagrams, review effort, and more." — [CodeRabbit code review overview](https://docs.coderabbit.ai/guides/code-review-overview.md)
- Config keys and defaults — [CodeRabbit configuration reference](https://docs.coderabbit.ai/reference/configuration.md):
  - On by default: `reviews.high_level_summary`, `reviews.sequence_diagrams`, `reviews.estimate_code_review_effort`, `reviews.assess_linked_issues`, `reviews.related_issues`, `reviews.related_prs`, `reviews.suggested_labels`, `reviews.suggested_reviewers`, `reviews.changed_files_summary`, `reviews.collapse_walkthrough`, `reviews.review_status`.
  - Off by default: `reviews.poem` ("Generates a poem in the walkthrough comment").
- Commands regenerate outputs on demand: `@coderabbitai summary` regenerates the PR summary, and `@coderabbitai generate sequence diagram` posts a sequence diagram as a comment. — [CodeRabbit review commands](https://docs.coderabbit.ai/reference/review-commands.md)
- New in 2026, **CodeRabbit Explain / Change Stack** "Breaks large diffs into logical cohorts and layers, with range-specific summaries and diagrams." It is a structured workspace for reading, questioning and acting on a PR, with snapshots and chat pinned to a review snapshot. — [CodeRabbit docs home](https://docs.coderabbit.ai/); [CodeRabbit llms.txt](https://docs.coderabbit.ai/llms.txt)
- `tone_instructions` (up to 250 chars) changes phrasing, and `language` (ISO code, default `en-US`) sets the output language. — [CodeRabbit review style](https://docs.coderabbit.ai/pr-reviews/review-style.md)
- Post-merge actions are a Team-tier feature. — [CodeRabbit pricing](https://www.coderabbit.ai/pricing)

**GitHub Copilot code review**
- The overview comment shows Copilot's "current assessment of your pull request," the effort level used and a summary of findings. It keeps track of findings across commits in three groups: **Open**, **Resolved since last review** and **Previously missed**. "The earlier pull request summary and per-file summaries remain available." GA as of 2026-09-18. — [GitHub changelog 2026-09-18](https://github.blog/changelog/2026-09-18-copilot-code-review-an-improved-review-experience)
- "Every review includes an approval assessment in the overview comment." — [GitHub Docs: Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review)
- Review sessions show the AI credits they consumed (November 2026). — [GitHub changelog 2026-11-06](https://github.blog/changelog/2026-11-06-copilot-code-review-api-management-and-review-overview-updates)

**Graphite**
- "AI-generated PR titles and descriptions" are included on all paid plans. "Suggested fixes + CI summaries" are on Team and Enterprise only. — [Graphite billing & plans](https://graphite.com/docs/billing-plans.md)
- Graphite Chat can "Summarize PR changes, flag issues to focus on, explain functions." — [Graphite Chat docs](https://graphite.com/docs/graphite-chat.md)

**Greptile**
- The summary comment has a plain-language summary and a **confidence score** ("0-5 rating that tells you at a glance whether the PR is ready to merge": 5 = merge, 4 = minor polish, 3 = implementation issues, 2 = significant bugs, 0–1 = critical). It also lists findings linked to comments, a per-file analysis and auto-generated diagrams. — [Greptile: Anatomy of a Review](https://www.greptile.com/docs/code-review/first-pr-review.md)
- The diagram type is chosen by what changed: sequence for API or multi-service flows, ER for schema changes, class for class hierarchies, flow for control logic. Trivial PRs get no diagram, and users can ask for a specific type. — [Greptile: Anatomy of a Review](https://www.greptile.com/docs/code-review/first-pr-review.md)
- The footer shows a review counter, the last reviewed commit and a re-trigger button. Summary components can be toggled. — [Greptile: Anatomy of a Review](https://www.greptile.com/docs/code-review/first-pr-review.md)

### Inferences
- An effort estimate, sequence diagrams and related issues/PRs are table stakes for summary features. The differentiators are now **merge-readiness scores** (Greptile's 0–5, Copilot's approval assessment) and **stateful findings ledgers** that track open, resolved and missed issues across pushes (Copilot).
- CodeRabbit turning `poem` off by default suggests "fun extras" lost favor with enterprise buyers.

### Gaps
- None of the four documents a dedicated release-notes generator for PR review. CodeRabbit's "post-merge actions" may cover it, but no details were fetched.
- The Graphite Agent review summary format couldn't be verified (pages blocked or not detailed).

---

## 2. Inline review (line comments, suggestions, autofix, severity, nitpick handling, limits)

### Takeaway
All four post line comments with suggested changes. Severity labels are now universal:
- CodeRabbit: Critical, Major, Minor, Trivial, Info
- Greptile: P0, P1, P2
- Copilot: severity per finding

Autofix has moved beyond one-click suggestions to agents that commit fixes:
- CodeRabbit: `fix comments`, `autofix`, `fix-ci`
- Copilot: hand-off to the cloud agent
- Greptile: "Fix with your Agent" and "Fix All"
- Graphite: Chat editor and Cursor Cloud Agents

### Cited Findings
**CodeRabbit**
- Content categories: Security & Privacy, Stability & Availability, Data Integrity & Integration, Functional Correctness, Performance & Scalability, Maintainability & Code Quality. Severity levels: Critical, Major, Minor, Trivial, Info. Tool findings appear in a collapsed "🧰 Tools" section with each tool's own severity and rule ID. — [CodeRabbit code review overview](https://docs.coderabbit.ai/guides/code-review-overview.md)
- "One-click fixes: Apply suggested changes directly to your PR with a single click." — [CodeRabbit code review overview](https://docs.coderabbit.ai/guides/code-review-overview.md)
- Noise control through profiles — [CodeRabbit review style](https://docs.coderabbit.ai/pr-reviews/review-style.md):
  - `quiet`: inline comments only for critical and major findings; the rest are collapsed.
  - `chill` (default): critical, major and minor inline, **capped at 20 comments**; beyond that, minor findings collapse first, then major.
  - `assertive`: every severity inline.
- Fix commands — [CodeRabbit review commands](https://docs.coderabbit.ai/reference/review-commands.md):
  - `@coderabbitai fix comments` fixes unresolved findings and commits the fixes to the PR branch.
  - `@coderabbitai autofix` keeps fixing findings and failing required CI checks.
  - `@coderabbitai fix-ci` delivers CI fixes "as a stacked pull request or a commit."
  - `@coderabbitai local commit` commits a proposed change.
  - `@coderabbitai resolve merge conflict` resolves conflicts with the base branch.
- `@coderabbitai track` and `@coderabbitai fixed` let a *human* reviewer's comment be tracked as a finding and checked against later commits. — [CodeRabbit review commands](https://docs.coderabbit.ai/reference/review-commands.md)
- The Essentials tier includes "slop detection." — [CodeRabbit pricing](https://www.coderabbit.ai/pricing)

**GitHub Copilot code review**
- Suggested changes can be applied "with a couple of clicks." Passing suggestions to the Copilot cloud agent (public preview) "creates a new pull request against your branch with the fixes applied." — [GitHub Docs: Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review)
- Each finding has a severity and a short title. When a complete batch of suggestions is committed, Copilot generates the commit message. — [GitHub changelog 2026-09-18](https://github.blog/changelog/2026-09-18-copilot-code-review-an-improved-review-experience)
- Copilot auto-resolves its own comments once a later push addresses them, or resolves them as "Won't Fix" or "Incorrect." — [GitHub changelog 2026-09-18](https://github.blog/changelog/2026-09-18-copilot-code-review-an-improved-review-experience); [GitHub changelog 2026-09-11](https://github.blog/changelog/2026-09-11-auto-resolution-and-analysis-updates-in-copilot-code-review)
- In August 2026 the old 300-file / 20,000-line size cap was removed. — [GitHub changelog 2026-08-27](https://github.blog/changelog/2026-08-27-copilot-code-review-resolution-reasons-and-expanded-capabilities) (via search summary)
- Effort levels — [GitHub Docs: Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review):
  - Lite: fast feedback on common issues.
  - Balanced (default since October 2026): routes to a higher-reasoning model.
  - Max (preview): multiple high-reasoning models.
  - Adaptive (preview): Copilot picks the level, capped at the configured maximum.
- Dependency files (package.json, Gemfile.lock), logs and SVGs are excluded from review. — [GitHub Docs: Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review)

**Graphite**
- Each comment gives the problem, why it matters and a concrete fix. Suggestions can be committed like a teammate's. — [Graphite review comments](https://graphite.com/docs/ai-review-comments.md)
- Categories — [Graphite review comments](https://graphite.com/docs/ai-review-comments.md):
  - Logic bugs
  - Edge cases (null checks, races, leaks)
  - Security (SQLi, XSS, authorization bypass, insecure crypto)
  - Performance (N+1 queries, inefficient algorithms)
  - Accidentally committed code (debug logs, test data, commented-out code)
- Graphite "Focuses on real bugs" rather than style issues or best practices. — [Graphite AI reviews](https://graphite.com/docs/ai-reviews.md)
- PRs over **200,000 characters** are "Not running" (not analyzed). — [Graphite review comments](https://graphite.com/docs/ai-review-comments.md)
- Graphite Chat can apply fixes in one click and commit through an in-browser Editor. — [Graphite Chat docs](https://graphite.com/docs/graphite-chat.md)
- Graphite has "Experimental comments" with their own feedback flow. — [Graphite llms.txt](https://graphite.com/docs/llms.txt)

**Greptile**
- Severity badges: P0 (Critical), P1 (High), P2 (Medium). Comment types are logic, syntax and style, selected via `commentTypes` in `.greptile/config.json`. Most comments include a diff-style suggestion. — [Greptile: Anatomy of a Review](https://www.greptile.com/docs/code-review/first-pr-review.md)
- A "Fix with your Agent" button on each comment sends the issue, file paths, lines and suggested code to Claude Code, Codex, Conductor, Cursor or Devin. The summary has a "Fix All" button. — [Greptile docs intro](https://www.greptile.com/docs)
- Dedicated docs cover "Controlling Nitpickiness" (strictness, comment-type filters, ignored files) and "Reducing Nitpicks." — [Greptile llms.txt](https://www.greptile.com/docs/llms.txt)

### Inferences
- What sets products apart is less inline comments themselves and more (a) severity-gated volume caps (CodeRabbit's 20-comment cap in `chill`), (b) state that persists across pushes (auto-resolution, "previously missed"), and (c) an agent that commits fixes.
- An open-source reviewer should treat committable GitHub suggestion blocks plus severity labels as the minimum, and add a thread-resolution loop.

### Gaps
- No explicit per-review comment caps were found for Copilot, Graphite or Greptile.
- Whether Greptile's suggestions are native GitHub "committable suggestion" blocks is unstated in the docs fetched.

---

## 3. Conversation (chat, commands, tests/docstrings, thread resolution)

### Takeaway
CodeRabbit has by far the largest command surface: about 32 `@coderabbitai` commands, covering review control, fixes, tests, simplification, pre-merge checks, config generation and planning. Greptile is driven by `@greptileai` mentions. Copilot works through the Reviewers menu and the API. Graphite's chat lives in its own web PR page, not in GitHub comments.

### Cited Findings
- CodeRabbit commands — [CodeRabbit review commands](https://docs.coderabbit.ai/reference/review-commands.md):
  - Review control: `review` (incremental), `full review`, `pause`, `resume`, `resolve`, `approve`
  - Verification: `verify` (tests the PR in an isolated browser), `track` and `fixed`
  - Fixes: `fix comments`, `fix-ci`, `resolve merge conflict`, `autofix`, `local commit`
  - Generation and cleanup: `generate unit tests`, `simplify`, `run <recipe>`, `evaluate custom finishing touch`, `summary`, `generate sequence diagram`, `plan` (Coding Plan from an issue)
  - Pre-merge: `run pre-merge checks`, `ignore pre-merge checks`, `evaluate custom pre-merge check`, `skip post-merge actions`
  - Configuration: `configuration`, `generate configuration`, `emit path instructions`
  - Other: `/create_issue` (GitLab), `help`, `rate limit`, `generate project vocabulary`
- CodeRabbit chat "has access to your entire repository." — [CodeRabbit code review overview](https://docs.coderabbit.ai/guides/code-review-overview.md)
- CodeRabbit also runs Slack and Discord agents that "investigate code, generate plans, and open PRs." — [CodeRabbit docs home](https://docs.coderabbit.ai/)
- Docstring generation: no docstrings key appears in the current configuration reference, and no `generate docstrings` command appears in the current command list. (It existed in 2025; it may have been removed or folded into custom recipes.) — [CodeRabbit configuration reference](https://docs.coderabbit.ai/reference/configuration.md); [CodeRabbit review commands](https://docs.coderabbit.ai/reference/review-commands.md)
- Greptile: tag `@greptileai` to retry or re-review. Reviews can be escalated with comments like "@greptileai review this at apex," which can raise the tier but not lower it. There is a "Chat with PR" interface. — [Greptile: Anatomy of a Review](https://www.greptile.com/docs/code-review/first-pr-review.md); [Greptile Review Tiers](https://www.greptile.com/docs/code-review/review-tiers.md); [Greptile llms.txt](https://www.greptile.com/docs/llms.txt)
- Copilot: re-request a review from the Reviewers menu. Since October 2026 the REST and GraphQL APIs can request reviews with a per-request effort level. — [GitHub Docs: Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review); [GitHub changelog 2026-10-02](https://github.blog/changelog/2026-10-02-copilot-code-review-api-support-and-new-default-effort-level)
- Copilot honors author replies that keep an issue open. — [GitHub changelog 2026-09-18](https://github.blog/changelog/2026-09-18-copilot-code-review-an-improved-review-experience)
- Graphite Chat sits in the PR review page's right panel. It can explain code, generate tests, search the codebase and related PRs, help address reviewer feedback, debug CI failures and commit fixes. — [Graphite Chat docs](https://graphite.com/docs/graphite-chat.md)

### Inferences
- Commands are becoming "agent verbs" (fix CI, resolve conflicts, simplify, plan) rather than review toggles. An OSS reviewer can stay competitive with a much smaller set (review, full review, pause, resume, resolve, explain, fix) if it does each one reliably.

### Gaps
- Whether Copilot supports conversational Q&A directly in review threads, beyond the approval and resolve semantics, was not confirmed in the fetched docs.

---

## 4. Learning and customization (memory, rules files, path instructions, noise tuning)

### Takeaway
Every leader now reads repository rule files. CodeRabbit auto-detects AGENTS.md, CLAUDE.md and .cursorrules. Copilot reads copilot-instructions.md, path-scoped *.instructions.md, AGENTS.md and skills. Greptile uses `.greptile/` folders and `greptile.json`. Graphite uses UI prompts or markdown rule files. Learning from feedback ranges from explicit natural-language "learnings" (CodeRabbit) to implicit inference from reactions, replies and commits (Greptile).

### Cited Findings
**CodeRabbit**
- `.coderabbit.yaml` sets repo configuration, and path instructions plus instruction docs in a `.coderabbit/` directory guide reviews by path. — [CodeRabbit review index](https://docs.coderabbit.ai/_llms/review.txt); [CodeRabbit review instructions](https://docs.coderabbit.ai/pr-reviews/review-instructions.md)
- CodeRabbit "automatically detects coding guideline files such as .cursorrules, CLAUDE.md, and AGENTS.md." `knowledge_base.code_guidelines.filePatterns` adds globs or `{files, applyTo}` objects. — [CodeRabbit code guidelines](https://docs.coderabbit.ai/knowledge-base/code-guidelines.md); [CodeRabbit configuration reference](https://docs.coderabbit.ai/reference/configuration.md)
- Learnings: "Teach CodeRabbit your review preferences using natural-language chat." The scope is local, global or auto (default auto). — [CodeRabbit learnings](https://docs.coderabbit.ai/knowledge-base/learnings.md); [CodeRabbit configuration reference](https://docs.coderabbit.ai/reference/configuration.md)
- `@coderabbitai emit path instructions` opens a PR that adds CodeRabbit's *suggested* path instructions to `.coderabbit.yaml`, which is a form of self-tuning. — [CodeRabbit review commands](https://docs.coderabbit.ai/reference/review-commands.md)
- Custom pre-merge checks use "natural language instructions" for validation (10 on Team, 20 on Advanced and Enterprise). — [CodeRabbit custom checks](https://docs.coderabbit.ai/pr-reviews/custom-checks.md); [CodeRabbit pricing](https://www.coderabbit.ai/pricing)

**GitHub Copilot code review**
- Context files — [GitHub Docs: Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review):
  - `.github/copilot-instructions.md` (repo-wide)
  - `.github/instructions/**/*.instructions.md` (path-scoped)
  - `AGENTS.md` at the repo root
  - `.github/skills/` (for example, a `code-review` skill)
- Instructions are read from the PR's **head branch**. "Copilot Memory can store repository-level facts for reviews." — [GitHub Docs: Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review)
- Timeline: AGENTS.md support shipped June 2026, and agent skills plus MCP reached GA in July 2026. — [GitHub changelog 2026-06-18](https://github.blog/changelog/2026-06-18-copilot-code-review-agents-md-support-and-ui-improvements); [GitHub changelog 2026-07-31](https://github.blog/changelog/2026-07-31-copilot-code-review-agent-skills-and-mcp-now-generally-available/)

**Graphite**
- Customization has two parts — [Graphite AI review customization](https://graphite.com/docs/ai-review-customization):
  - **Exclusions**: situations where the agent should not comment.
  - **Custom rules**: either UI prompts (recommended) or file-based markdown rules in the repo. Large rule files are truncated.
- The Rules & exclusions tab shows acceptance rate and issues caught *per rule*. — [Graphite AI review customization](https://graphite.com/docs/ai-review-customization)
- The agent "Learns from feedback" based on how the team interacts with comments, but no mechanism is detailed. The dashboard tracks downvote rate and acceptance rate. — [Graphite AI reviews](https://graphite.com/docs/ai-reviews.md); [Graphite review comments](https://graphite.com/docs/ai-review-comments.md)

**Greptile**
- Configuration methods: `.greptile/` folders (directory-scoped with inheritance, holding `config.json`, `rules.md` and `files.json`), `greptile.json`, or the Dashboard. — [Greptile llms.txt](https://www.greptile.com/docs/llms.txt)
- Learning signals — [Greptile Memory and Learning](https://www.greptile.com/docs/how-greptile-works/memory-and-learning.md):
  - Patterns in human reviewer comments become inferred rules.
  - Positive, context-setting and dismissive replies.
  - 👍/👎 reactions (a 👎 can suppress a comment type).
  - First-vs-last-commit analysis to see whether a comment was addressed.
- How suppression works: style comments are reduced for low-nitpick teams, "logic errors are never suppressed," and one example suppresses a comment type "after 3 ignores." — [Greptile Memory and Learning](https://www.greptile.com/docs/how-greptile-works/memory-and-learning.md)
- (vendor claim) Greptile cites an "80% reduction in ignored comments" and "3x higher suggestion adoption rate," but gives no methodology. It also says it stops commenting on low-priority items after two to three weeks. — [Greptile Memory and Learning](https://www.greptile.com/docs/how-greptile-works/memory-and-learning.md); [Greptile docs intro](https://www.greptile.com/docs)

### Inferences
- **AGENTS.md is now the common format**: CodeRabbit auto-detects it, and Copilot added it in June 2026. An OSS tool should read AGENTS.md, CLAUDE.md, .cursorrules and copilot-instructions.md with no extra setup.
- Per-rule effectiveness metrics (Graphite) and "emit learned rules as a config PR" (CodeRabbit) are two strong patterns that also fit self-hosting and keep learning transparent and version-controlled.

### Gaps
- It is unclear whether Greptile's inferred rules can be viewed or edited, or whether they apply per repo or per org; the docs don't say.
- No details were found on how Graphite "learns" beyond dashboard metrics.

---

## 5. Context (codebase indexing, cross-repo, tickets, docs and web, PR history)

### Takeaway
All four claim whole-codebase context:
- Greptile: a code graph plus embeddings.
- CodeRabbit: a code graph plus vector representations, linked repos, web search, MCP, and Jira and Linear.
- Copilot: agentic tool-calling over the repo, with cross-repo search of public repos in preview, and MCP.
- Graphite: codebase, stack, CI and PR-history awareness.

Ticket-compliance checking against Jira and Linear is explicit in CodeRabbit and Greptile.

### Cited Findings
**CodeRabbit**
- Code graph analysis: "Deep understanding of code relationships and dependencies across your project." — [CodeRabbit code review overview](https://docs.coderabbit.ai/guides/code-review-overview.md)
- Stored context includes "encrypted code and dependency caches and vector representations of code." — [CodeRabbit FAQ](https://docs.coderabbit.ai/faq.md)
- Multi-repo analysis: "Link related repositories so CodeRabbit can detect breaking changes, API mismatches." Linked-repo limits are 1, 5, 10 and 20 by tier. — [CodeRabbit multi-repo analysis](https://docs.coderabbit.ai/knowledge-base/multi-repo-analysis.md); [CodeRabbit pricing](https://www.coderabbit.ai/pricing)
- Other context sources: web search (on by default), MCP servers as a knowledge source (5 to 20 connections by tier), and Jira and Linear (default `auto`, disabled for public repos). — [CodeRabbit configuration reference](https://docs.coderabbit.ai/reference/configuration.md); [CodeRabbit MCP context](https://docs.coderabbit.ai/knowledge-base/mcp-context.md); [CodeRabbit pricing](https://www.coderabbit.ai/pricing)
- Jira and Linear integrations cover "Issue context, acceptance criteria checks, Coding Plans." `reviews.assess_linked_issues` scores how well the changes address linked issues. — [CodeRabbit llms.txt](https://docs.coderabbit.ai/llms.txt); [CodeRabbit configuration reference](https://docs.coderabbit.ai/reference/configuration.md)
- The **Blast Radius** and architecture impact review features are Advanced tier. — [CodeRabbit pricing](https://www.coderabbit.ai/pricing)

**GitHub Copilot code review**
- Full project context gathering "analyzes the whole repository, not just the diff." — [GitHub Docs: Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review)
- Cross-repo context (preview) searches the default branch of related **public** repos. — [GitHub Docs: Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review)
- The GitHub and Playwright MCP servers are on by default. Agentic features run on GitHub Actions runners, and reviews have limited context when no runners are available. — [GitHub Docs: Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review)
- The architecture became agentic, with tool-calling over directory structure and references, in March 2026. — [GitHub changelog 2026-03-05](https://github.blog/changelog/2026-03-05-copilot-code-review-now-runs-on-an-agentic-architecture/)
- Shell tools from the Copilot SDK run behind the agent firewall (September 2026). — [GitHub changelog 2026-09-11](https://github.blog/changelog/2026-09-11-auto-resolution-and-analysis-updates-in-copilot-code-review) (via search summary)

**Graphite**
- Graphite Chat is aware of the "codebase, PR stack, CI failures, reviewer comments, and team coding patterns" and has access to "codebase and PR history." — [Graphite Chat docs](https://graphite.com/docs/graphite-chat.md)

**Greptile**
- It builds "a graph of the whole repository, covering functions, classes, and dependencies." — [Greptile docs intro](https://www.greptile.com/docs)
- Embeddings are used for indexing (text-embedding-3-small or Titan V2 when self-hosted). — [Greptile deployment options](https://www.greptile.com/docs/self-hosting/deployment-options.md)
- Cross-repo context via "Repo Clusters." — [Greptile llms.txt](https://www.greptile.com/docs/llms.txt)
- Jira integration checks reviews "against Jira tickets and Confluence pages," and Linear integration checks them against Linear issues. — [Greptile llms.txt](https://www.greptile.com/docs/llms.txt)
- Also available: Knowledge Base and MCP "Custom Context." — [Greptile llms.txt](https://www.greptile.com/docs/llms.txt)

### Inferences
- Copilot's context depends on Actions runners and is limited to public repos for cross-repo search. That leaves a gap for self-hosted, private multi-repo context.
- Linked-issue and acceptance-criteria compliance is an established feature at CodeRabbit and Greptile. Copilot and Graphite don't document it.

### Gaps
- Graphite's indexing approach is undocumented.
- Whether Copilot reads GitHub Issues linked to a PR as review context was not found.

---

## 6. Deterministic tooling (linters, SAST, secrets, coverage)

### Takeaway
CodeRabbit is the only one of the four that ships a large catalog of open-source linters and scanners inside its review: 59 tools in the config reference. Copilot leaves deterministic analysis to separate products (CodeQL via GitHub Code Quality and Advanced Security). Greptile and Graphite rely on LLM analysis, and Greptile adds an LLM security review and TREX end-to-end testing.

### Cited Findings
- CodeRabbit "integrates 50+ third-party tools like ESLint, Ruff, and Betterleaks." The config reference lists **59** tools under `reviews.tools`, each enabled by default — [CodeRabbit tools](https://docs.coderabbit.ai/tools/index.md); [CodeRabbit configuration reference](https://docs.coderabbit.ai/reference/configuration.md):
  - JS/TS and web: eslint, biome, oxc, stylelint, htmlhint, reactDoctor
  - Python: ruff, flake8, pylint
  - Go, Rust and JVM: golangci-lint, clippy, detekt, pmd
  - C, C++ and Swift: clang, cppcheck, fbinfer, swiftlint
  - Ruby and PHP: rubocop, brakeman, phpstan, phpmd, phpcs
  - Shell and scripting: shellcheck, psscriptanalyzer, luacheck
  - SAST and pattern search: semgrep, opengrep, ast-grep
  - Secrets and PII: gitleaks, trufflehog, presidio
  - Dependencies and IaC: trivy, osvScanner, checkov, tflint, hadolint
  - CI configs: actionlint, zizmor, circleci
  - Data and API: sqlfluff, squawk, buf, oasdiff
  - Docs and prose: markdownlint, vale, languagetool
  - Also: github-checks, verilator, skillspector, and others
- If a repo has no config of its own, CodeRabbit's review profile picks the fallback tool rules. Only `assertive` selects the stricter rule sets, and for PHPStan the profile picks level 8 for assertive and 3 otherwise. — [CodeRabbit review style](https://docs.coderabbit.ai/pr-reviews/review-style.md)
- **CodeRabbit Secure** scans repositories for vulnerabilities, leaked secrets and vulnerable dependencies. It includes Deep Scan beyond the diff, a Security check status, delta scans, Security Blast Radius and runtime verification of findings. — [CodeRabbit llms.txt](https://docs.coderabbit.ai/llms.txt)
- **CodeRabbit Verify** tests PRs and user journeys "against your running app in an isolated sandbox, returning bugs and blockers with screenshots and recordings." — [CodeRabbit docs home](https://docs.coderabbit.ai/)
- Copilot code review: the docs don't say it runs ESLint or CodeQL. CodeQL belongs to **GitHub Code Quality**, a separate offering with rules-based CodeQL on PRs, test-coverage metrics and optional ruleset gating. — [GitHub Docs: Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review)
- Greptile has a Security Review for GitHub PRs and **TREX**, an end-to-end testing agent with environments, custom flows and recordings (3 credits per run). — [Greptile llms.txt](https://www.greptile.com/docs/llms.txt); [Greptile Review Tiers](https://www.greptile.com/docs/code-review/review-tiers.md)
- Graphite: no deterministic linters are documented. Its review is LLM-only and bug-focused. — [Graphite AI reviews](https://graphite.com/docs/ai-reviews.md)

### Inferences
- The new frontier is **runtime verification**: CodeRabbit Verify and Greptile TREX both run the app in a sandbox. Static linting is now standard for CodeRabbit but still missing at Greptile and Graphite.
- Bundling deterministic linters with honest pass/fail status is a defensible niche for an OSS reviewer, since only CodeRabbit does it, and only inside a closed SaaS.

### Gaps
- No test-coverage reporting was found for CodeRabbit, Greptile or Graphite reviews.

---

## 7. Workflow (incremental review, pause, drafts, approvals, status checks, stacks, merge queue)

### Takeaway
All four support incremental review and skip drafts by default (or make draft review optional). CodeRabbit and Greptile can **auto-approve**, and Copilot can submit approvals that count toward required reviews (opt-in). Graphite's differentiator is its stacked-PR, merge-queue and CLI workflow. CodeRabbit added Triage (queue prioritization) and stacked-PR CI fixes.

### Cited Findings
**CodeRabbit**
- `auto_incremental_review` (default true) reviews each push incrementally. — [CodeRabbit: when reviews run](https://docs.coderabbit.ai/pr-reviews/when-reviews-run.md)
- `drafts: false` (default) skips drafts. — [CodeRabbit: when reviews run](https://docs.coderabbit.ai/pr-reviews/when-reviews-run.md)
- `auto_pause_after_reviewed_commits` (default **5**) pauses automatic reviews. — [CodeRabbit: when reviews run](https://docs.coderabbit.ai/pr-reviews/when-reviews-run.md)
- Filters: `base_branches` regexes, positive and `!` labels, and `ignore_title_keywords`. `[Snyk]` titles are always skipped, and `@coderabbitai ignore` in a PR description skips that PR. — [CodeRabbit: when reviews run](https://docs.coderabbit.ai/pr-reviews/when-reviews-run.md)
- `reviews.auto_approvals.enabled` (default false) "requests changes for blocking findings and approves when conditions are met." — [CodeRabbit configuration reference](https://docs.coderabbit.ai/reference/configuration.md)
- Approval policies combine "Automatic Approvals, risk limits, GitHub branch rules, and Triage." — [CodeRabbit approval policies](https://docs.coderabbit.ai/pr-reviews/approval-policies.md)
- A status check can be required before merging. — [CodeRabbit status check](https://docs.coderabbit.ai/pr-reviews/status-check.md)
- Pre-merge checks act as quality gates. "Security merge blocking" is an Advanced-tier feature. — [CodeRabbit pre-merge checks](https://docs.coderabbit.ai/pr-reviews/pre-merge-checks.md); [CodeRabbit pricing](https://www.coderabbit.ai/pricing)
- Triage ranks the PR queue by value and risk and routes PRs to reviewers. Its rules cover merging, closing stale PRs and fixing CI. — [CodeRabbit docs home](https://docs.coderabbit.ai/); [CodeRabbit llms.txt](https://docs.coderabbit.ai/llms.txt)

**GitHub Copilot code review**
- By default Copilot reviews only when assigned. Automatic review can be set at user, repo or org level (review on open, on new pushes, on drafts), and only one review is posted. — [GitHub Docs: Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review)
- Without per-push review, Copilot reviews a PR once. — [GitHub Docs: Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review)
- Copilot approvals don't count toward required approvals by default. When enabled, Copilot "can submit an approving review that satisfies a required-approval rule," and new commits dismiss it. — [GitHub Docs: Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review)
- The automatic-review rule supports a bypass list (November 2026). — [GitHub changelog 2026-11-06](https://github.blog/changelog/2026-11-06-copilot-code-review-api-management-and-review-overview-updates)

**Graphite**
- Core features: a stacked-PR CLI (`gt`), GT MCP for AI agents, a VS Code extension for stacks, a merge queue, "Merge When Ready," a mergeability status check that prevents mid-stack merges, CI optimizations for stacks, and automations (reviewer assignment, labels). — [Graphite llms.txt](https://graphite.com/docs/llms.txt)
- Merge queue by tier: none on Starter, "Basic" on Team, "Advanced" on Enterprise. — [Graphite billing & plans](https://graphite.com/docs/billing-plans.md)
- Cursor Cloud Agents can create and update PRs inside Graphite. — [Graphite llms.txt](https://graphite.com/docs/llms.txt)

**Greptile**
- Drafts are skipped by default, and branch filters are available. — [Greptile: Anatomy of a Review](https://www.greptile.com/docs/code-review/first-pr-review.md)
- "Auto-approve PRs: Approving low-risk PRs after a clean 5/5 review." — [Greptile llms.txt](https://www.greptile.com/docs/llms.txt)

### Inferences
- **Gating is converging on "AI approval as a required reviewer"** (CodeRabbit approval policies, Copilot approvals, Greptile 5/5 auto-approve). An OSS tool should expose a configurable status check and approve/request-changes semantics.
- Only Graphite treats stacked PRs as a core primitive. CodeRabbit can only *deliver* fixes as stacked PRs.

### Gaps
- No Greptile pause/resume command was documented in the pages fetched.
- How Graphite Agent handles drafts and re-reviews on push was not documented in the pages fetched.

---

## 8. Surfaces (Git hosts, IDE, CLI, local review)

### Takeaway
- **CodeRabbit** covers the most ground: GitHub, GitLab, Bitbucket and Azure DevOps; VS Code, Cursor, Windsurf and JetBrains; a CLI built for agent loops; and an API plus MCP.
- **Greptile** supports GitHub (including GHES), GitLab (including self-managed), Bitbucket (including Data Center), Gitea and Perforce, plus a CLI and MCP into IDE agents.
- **Copilot** covers GitHub and its IDEs, plus a newly listed Azure DevOps surface.
- **Graphite** appears to be GitHub-only, including GHES.

### Cited Findings
- **CodeRabbit:**
  - Git platforms: GitHub, GitLab, Azure DevOps and Bitbucket. — [CodeRabbit docs home](https://docs.coderabbit.ai/)
  - IDE extensions: VS Code, Cursor, Windsurf and JetBrains. — [CodeRabbit docs home](https://docs.coderabbit.ai/)
  - The CLI does "Pre-commit reviews from the command line. Works with Claude Code, Cursor, Codex, Gemini." It has an agent mode with exit codes. — [CodeRabbit docs home](https://docs.coderabbit.ai/); [CodeRabbit llms.txt](https://docs.coderabbit.ai/llms.txt)
  - The REST API has 8 operations, and there is a hosted MCP server. — [CodeRabbit code review overview](https://docs.coderabbit.ai/guides/code-review-overview.md)
  - Capabilities differ by provider. — [CodeRabbit Change Stack provider support](https://docs.coderabbit.ai/change-stack/provider-support.md)
- **Copilot:**
  - Surfaces: GitHub.com, GitHub CLI, GitHub Mobile, VS Code, Visual Studio, Xcode, JetBrains and **Azure DevOps**. — [GitHub Docs: Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review)
  - Members without a Copilot license can use it on GitHub.com (billed to the org), but not in IDEs. — [GitHub Docs: Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review)
  - Preview features are supported on GHE Cloud with data residency (December 2025). — [GitHub changelog 2025-12-18](https://github.blog/changelog/2025-12-18-copilot-code-review-preview-features-now-supported-in-github-enterprise-cloud-with-data-residency)
- **Graphite:**
  - Self-hosting/enterprise docs cover only GitHub Enterprise Server. — [Graphite llms.txt](https://graphite.com/docs/llms.txt)
  - The VS Code extension is for managing stacks, and there is a `gt` CLI. — [Graphite llms.txt](https://graphite.com/docs/llms.txt)
- **Greptile:**
  - Code providers: GitHub (Cloud, GHES, GHE Cloud with data residency), GitLab (Cloud and Self-Managed), Bitbucket (Cloud and Data Center), Cursor Origin (beta), Gitea, and Perforce with P4 Code Review (on-prem only). — [Greptile docs intro](https://www.greptile.com/docs)
  - The CLI runs local reviews and can evaluate past closed or merged PRs with JSON output. — [Greptile llms.txt](https://www.greptile.com/docs/llms.txt)
  - The MCP server works in Claude Code, Cursor, VS Code and Codex. There are also Claude Code and Codex plugins. — [Greptile llms.txt](https://www.greptile.com/docs/llms.txt)

### Inferences
- "Review inside the coding agent loop" (CodeRabbit CLI agent mode, Greptile MCP and plugins) is now a standard surface, and the PR comment is no longer the only interface.
- Graphite's GitHub-only scope and Copilot's GitHub-centric scope leave GitLab, Bitbucket and Gitea users relying on CodeRabbit or Greptile.

### Gaps
- Graphite's GitLab and Bitbucket status was not stated explicitly. "GitHub-only" is inferred from its docs index, where GHES is the only host-related page.

---

## 9. Deployment and trust (self-hosting, retention, SOC 2, models, BYOK)

### Takeaway
Self-hosting exists only at enterprise tiers (CodeRabbit Enterprise, Greptile Enterprise). Copilot and Graphite are SaaS-only, though Copilot can use self-hosted Actions runners. Greptile is the most open about its models and offers BYO model providers when self-hosted. The others name only providers (OpenAI and Anthropic) or nothing.

### Cited Findings
**CodeRabbit**
- Self-hosting and customer-chosen SaaS regions are available only on Enterprise. — [CodeRabbit pricing](https://www.coderabbit.ai/pricing)
- A reverse tunnel reaches private services. — [CodeRabbit llms.txt](https://docs.coderabbit.ai/llms.txt)
- Self-hosted and GHES orgs can't connect to the MCP server. — [CodeRabbit pricing](https://www.coderabbit.ai/pricing)
- Code goes to "OpenAI and/or Anthropic," and neither party trains on it. — [CodeRabbit FAQ](https://docs.coderabbit.ai/faq.md)
- Stored data includes encrypted code and dependency caches and vector representations. Learnings can be opted out of, and self-hosted deployments can opt out of all retention. — [CodeRabbit FAQ](https://docs.coderabbit.ai/faq.md)
- Model output logging is off by default. — [CodeRabbit FAQ](https://docs.coderabbit.ai/faq.md)
- (vendor claim) SOC 2 Type II, with an annual report and a "zero-data retention policy." — [CodeRabbit compliance](https://coderabbit.ai/compliance); [CodeRabbit trust center](https://www.coderabbit.ai/trust-center/soc)
- No BYO key is documented.

**GitHub Copilot code review**
- Copilot uses "a carefully tuned mix of models, prompts, and system behaviors." It names no models, model switching is not supported, and it may use models not enabled in org Model settings. — [GitHub Docs: Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review)
- Agentic reviews run on GitHub Actions runners, either GitHub-hosted or self-hosted. — [GitHub Docs: Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review); [GitHub changelog 2026-03-05](https://github.blog/changelog/2026-03-05-copilot-code-review-now-runs-on-an-agentic-architecture/)

**Graphite**
- Anthropic and OpenAI are its AI subprocessors. "Neither Graphite nor any of its subprocessors use your data to train their models." — [Graphite AI privacy & security](https://graphite.com/docs/ai-privacy-and-security.md)
- AI features are opt-in and off by default, and an org can request a full AI block. — [Graphite AI privacy & security](https://graphite.com/docs/ai-privacy-and-security.md)
- No self-hosting, retention terms or SOC 2 are stated on that page. — [Graphite AI privacy & security](https://graphite.com/docs/ai-privacy-and-security.md)
- Enterprise adds GHES, SAML/SSO, an audit log (SIEM) and private uploads. — [Graphite billing & plans](https://graphite.com/docs/billing-plans.md)

**Greptile**
- Deployment options: Greptile Cloud, Docker Compose (up to about 100 devs), Kubernetes with Helm (100+), and air-gapped. — [Greptile docs intro](https://www.greptile.com/docs); [Greptile deployment options](https://www.greptile.com/docs/self-hosting/deployment-options.md)
- SOC 2 Type II, SSO/SAML and audit logs. — [Greptile docs intro](https://www.greptile.com/docs)
- Self-hosted model requirements — [Greptile deployment options](https://www.greptile.com/docs/self-hosting/deployment-options.md):
  - Smart model: Claude Sonnet 4.5+ or GPT-5.x/6.x
  - Fast model: GPT-4o-mini, GPT-5 nano or Claude Haiku 4.5
  - Embeddings: text-embedding-3-small or Titan V2
  - Providers: OpenAI, Anthropic, AWS Bedrock, Azure OpenAI and GCP Vertex AI
- Self-hosting sizing runs from 4 cores / 16 GB (5–10 devs) to 32 cores / 128 GB (100 devs) on a single VM. — [Greptile deployment options](https://www.greptile.com/docs/self-hosting/deployment-options.md)
- SSO in self-hosted deployments uses BoxyHQ Jackson. — [Greptile llms.txt](https://www.greptile.com/docs/llms.txt)

### Inferences
- **The biggest structural gap for an OSS self-hostable entrant:** self-hosting with your own model keys is an enterprise-sales item at CodeRabbit and Greptile and isn't offered by Copilot or Graphite.
- Greptile's published model matrix (frontier "smart" model, cheap "fast" model, embeddings) is a useful reference architecture.

### Gaps
- No vendor states concrete retention durations in the docs fetched.
- Graphite's and Copilot code review's SOC 2 and ZDR specifics weren't checked in this session. GitHub's broader trust documentation likely covers Copilot, but it was not fetched.

---

## 10. Pricing, open-source free tier, and limits

### Takeaway
Pricing models now differ sharply:
- **CodeRabbit:** per seat, $24–72 per user per month annual, with hourly review caps and a $0.25-per-file overage.
- **Copilot:** per seat ($19 Business, $39 Enterprise) plus usage-based AI credits, about $0.25–$10 per review.
- **Graphite:** per seat, $20 Starter and $40 Team (annual), with unlimited AI review on Team.
- **Greptile:** usage only, at $1 per credit and 1, 3 or 10 credits per review, with no seat fees.

CodeRabbit (public repos free forever) and Greptile (OSI-licensed non-commercial projects, by application) have open-source programs.

### Cited Findings
**CodeRabbit** — [CodeRabbit pricing](https://www.coderabbit.ai/pricing)

| Tier | Monthly | Annual | Reviews/dev/hour | Linked repos |
|---|---|---|---|---|
| Essentials | $30 | $24 | 5 | 1 |
| Team | $60 | $48 | 8 | 5 |
| Advanced | $90 | $72 | 10 | 10 |
| Enterprise | custom | custom | 12 | 20 |

- Prices are per user per month. Review allowances are subject to the Fair Usage Policy.
- Usage-based reviews beyond the allowance cost **$0.25 per reviewed file**.
- Public repos get "free reviews forever."
- Limits use rolling windows, some plans use adaptive limits, and grandfathered Pro+ customers keep 10 reviews per hour. The 14-day Advanced trial includes 10 reviews per hour and 50 chat messages per hour. — [CodeRabbit FAQ](https://docs.coderabbit.ai/faq.md)

**GitHub Copilot**
- Billing changed to usage-based **GitHub AI Credits** (1 credit = $0.01) on June 1, 2026. Business stays $19 per user per month and Enterprise $39, each including credits equal to the seat price, pooled at the org level. — [GitHub blog: usage-based billing](https://github.blog/news-insights/company-news/github-copilot-is-moving-to-usage-based-billing/); [GitHub Docs: usage-based billing](https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-organizations-and-enterprises) (via search summary; promotional-credit details conflict between blog and docs)
- Estimated cost per review: Lite about $0.25 ($0.05–$1), Balanced about $1.50 ($0.25–$5), Max about $10 ($1.50–$25). These exclude Actions minutes. — [GitHub Docs: Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review)
- Who pays: automatic reviews bill the PR author, and manual reviews bill the requester. Reviews are blocked once the budget runs out. — [GitHub Docs: Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review)
- Seat charges become upfront from October 1, 2026 for existing customers. — [GitHub changelog 2026-08-28](https://github.blog/changelog/2026-08-28-upcoming-changes-to-github-copilot-policies-and-billing/?output=1) (via search summary)

**Graphite**
- Starter is $20 per seat per month and Team $40, both billed annually. Enterprise pricing is custom, and Hobby is free for personal projects. — [Graphite billing & plans](https://graphite.com/docs/billing-plans.md)
- AI review and chat are "Limited" on Starter (no numbers given) and "Unlimited" on Team and Enterprise. Review customization and suggested fixes are Team and above. — [Graphite billing & plans](https://graphite.com/docs/billing-plans.md)
- There is a 30-day Team trial. No open-source policy is stated. — [Graphite billing & plans](https://graphite.com/docs/billing-plans.md)
- The October 2025 launch post said Team at $40 matched Cursor BugBot's price, and that Graphite Agent was included in every plan. — [Graphite blog](https://graphite.com/blog/introducing-graphite-agent-and-pricing) (via search summary; direct fetch blocked)
- Cursor announced its acquisition of Graphite on 2025-12-19, and Graphite continues as an independent product. — [Fortune](https://fortune.com/2025/12/19/cursor-ai-coding-startup-graphite-competition-heats-up/) (via search summary)

**Greptile** — [Greptile pricing](https://www.greptile.com/pricing); [Greptile Review Tiers](https://www.greptile.com/docs/code-review/review-tiers.md)
- Plans:
  - Starter: free, 1 active developer, 50 credits per month.
  - Pro: $1 per credit with no seat fees, unlimited devs and agents, and shared prepaid credits.
  - Enterprise: custom.
- Credit costs: Base review 1, Plus 3, Apex 10, TREX run 3. Auto mode picks the tier per PR, and Greptile recommends Apex for PRs over 30 files.
- Free for qualified non-commercial projects with an OSI-approved license (by application). Startups get 500 credits per month for 6 months.

### Inferences
- At list prices, an average Copilot Balanced review (about $1.50) or Greptile Plus review ($3) costs about as much as a CodeRabbit per-file overage across 6–12 files. Per-review costs of $0.25–$10 are now normal, which supports an OSS model where teams pay their own LLM provider directly.
- Under Copilot's per-review billing, a noisy, repeated per-push review directly costs the PR author. Incremental, cheap re-reviews matter commercially.

### Gaps
- Exact Graphite Starter AI-review limits were not published.
- Copilot Pro and Pro+ individual-plan prices after the credit change were not verified in this session.

---

## 11. Published accuracy, catch-rate and false-positive claims

### Takeaway
Every quantitative claim found was published by a vendor or a competitor. The most-cited one, Greptile's July 2025 benchmark, scores Greptile 82%, Bugbot 58%, Copilot 54%, CodeRabbit 44% and Graphite 6%. It is self-published, predates the major 2026 changes, and has an internal arithmetic inconsistency. No vendor publishes a false-positive rate. Graphite and Copilot instead show acceptance and downvote rates in their dashboards.

### Cited Findings
- (vendor benchmark, July 2025) Greptile tested 50 real bugs across 5 OSS repos: Sentry/Python, Cal.com/TypeScript, Grafana/Go, Keycloak/Java and Discourse/Ruby. Tools ran on default cloud settings, and a bug counted only with an explicit line-level comment. Overall catch rates: Greptile 82%, Bugbot 58%, Copilot 54%, CodeRabbit 44%, Graphite 6%. Copilot's per-repo totals sum to 26/50 (52%), not the 54% shown. No false-positive figures were reported. — [Greptile benchmarks](https://www.greptile.com/benchmarks.md)
- (vendor claims) Greptile claims "100K+" bugs caught monthly, 9x faster time to merge, about 3-minute reviews, an 80% reduction in ignored comments and 3x higher adoption. — [Greptile docs intro](https://www.greptile.com/docs); [Greptile Memory and Learning](https://www.greptile.com/docs/how-greptile-works/memory-and-learning.md)
- (competitor claim) Augment Code says CodeRabbit showed "reasonable recall, low precision" in its test, and that Greptile's 82% is "substantially lower on Martian's independent leaderboard." — [Augment Code comparison](https://www.augmentcode.com/tools/coderabbit-vs-greptile-vs-augment-cosmos) (via search summary; not fetched directly)
- DeepSource notes that "Every AI code review vendor benchmarks itself, and wins," which is itself a vendor-adjacent critique. — [DeepSource blog](https://deepsource.com/blog/ai-code-review-benchmarks)
- Graphite reports no catch-rate numbers. Its dashboard exposes issues found, issues accepted, acceptance rate over time, downvote rate, and per-category and per-rule acceptance. — [Graphite review comments](https://graphite.com/docs/ai-review-comments.md); [Graphite AI review customization](https://graphite.com/docs/ai-review-customization)
- Copilot's docs say it is "not guaranteed to spot all problems." The September 2026 changelog contains no accuracy statistics. — [GitHub Docs: Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review); [GitHub changelog 2026-09-18](https://github.blog/changelog/2026-09-18-copilot-code-review-an-improved-review-experience)
- Other 2026 benchmarks exist but weren't verified: Tenki (updated 2026-05-20, covering Tenki, CodeRabbit, Greptile, Graphite, Copilot, Cursor and Devin) and several dev.to multi-tool trials. — [Tenki benchmark](https://tenki.cloud/benchmarks/code-reviewer.md); [dev.to 4-tool trial](https://dev.to/_vjk/best-ai-code-reviewer-in-2026-we-ran-4-in-parallel-for-3-weeks-146-prs-679-findings-1c0f) (not fetched)

### Inferences
- There is no neutral, reproducible, current benchmark that measures **precision**, not just recall. A transparent, open eval harness would be credible and set an OSS entrant apart. Greptile's "evaluate with CLI on closed PRs" feature shows buyers want this.
- Graphite's 6% in a July 2025 test predates the Graphite Agent relaunch (October 2025) and should not be treated as current.

### Gaps
- Martian leaderboard figures, Tenki numbers and any CodeRabbit- or Copilot-published accuracy statistics (for example, review volume or "% actionable") were not retrieved.
- Older Graphite Diamond claims about low unhelpful-comment rates (2025) could not be verified in this session.
