# Platform-vendor and code-quality-incumbent AI code review (as of late Nov 2026)

Scope: Gemini Code Assist on GitHub, Amazon Q Developer for GitHub (and its successor Kiro), Anthropic Claude Code Review and Claude Code GitHub Actions, OpenAI Codex code review, GitLab Duo Code Review and Code Review Flow, DeepSource, SonarQube (AI CodeFix, AI Code Assurance), Codacy.

Source quality: items marked "(primary)" come from vendor docs or pricing pages fetched on 2026-11-25. Items marked "(secondary)" come from blogs, aggregators or news. Where the two disagree, I say so. Some things I remember from training but could not re-verify this session. Those are in Gaps, not Findings.

---

## 1. What the PR review produces (summaries, inline comments, fixes, severity, style guides, commands)

### Takeaway
Every vendor now posts inline review comments on PRs. They differ in how they keep noise down:
- **Claude Code Review:** multi-agent find, verify and rank pipeline, plus a check run.
- **Codex:** posts only P0/P1 issues.
- **Gemini:** severity threshold, default MEDIUM.
- **Amazon Q:** summary plus threaded findings with committable fixes.

The code-quality incumbents (Sonar, DeepSource, Codacy) start from rule-engine findings and add LLM fixes or an "AI Reviewer" on top.

### Cited Findings

**Gemini Code Assist on GitHub**
- It "can summarize pull requests and generate in-depth code reviews." It does not generate summaries or code suggestions for files in `.github/workflows`. — [Google Cloud docs: Review repo code](https://docs.cloud.google.com/gemini/docs/code-review/review-repo-code) (primary)
- Users can tag `/gemini` in PR comments to ask questions in the context of the PR. — [Google Cloud docs: Review repo code](https://docs.cloud.google.com/gemini/docs/code-review/review-repo-code) (primary)
- Severity levels are `LOW`, `MEDIUM`, `HIGH` and `CRITICAL`, set through `comment_severity_threshold` (default `MEDIUM`). Issues below the threshold are skipped. Style-guide violations "usually meet or exceed the threshold." — [Google Cloud docs: Customize repo review](https://docs.cloud.google.com/gemini/docs/code-review/customize-repo-review) (primary)
- The PR summary, help message and code review on PR open are each toggled separately:
  - `pull_request_opened.summary` (default false in the current schema)
  - `pull_request_opened.help` (default false)
  - `pull_request_opened.code_review` (default true)
  - `have_fun` adds a poem to the summary.
  - Source: [Google Cloud docs: Customize repo review](https://docs.cloud.google.com/gemini/docs/code-review/customize-repo-review) (primary)
- Per a third-party blog, `styleguide.md` is natural-language coding rules, and reviews cite the rule that triggered them. — [dev.to / Daniel Sogl](https://dev.to/danielsogl/gemini-code-assist-for-github-automated-code-reviews-with-gemini-3km5) (secondary)

**Amazon Q Developer for GitHub (Preview), being discontinued**
- The code review agent runs automatically when a PR is created or a closed PR is reopened. It gives "feedback on code quality, potential issues, and security concerns."
- It "generates fixes for the identified issues, which you can review and choose to commit to the pull request." Output is "a code review summary with threaded findings."
- Commands:
  - `/q review` re-runs a review. Subsequent commits do *not* trigger automatic reviews.
  - `/q` asks questions about findings.
  - `/q dev` runs the feature-development agent.
  - `/q help` shows help.
- Source: [AWS docs: Amazon Q Developer for GitHub](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/amazon-q-for-github.html) (primary)
- Secondary sources list code review language support as Java, JavaScript, Python, C#, TypeScript, Ruby, Go, C and C++. — [search aggregate incl. noviqip](https://noviqip.com/blogs/guides/amazon-q-developer-review-2026) (secondary, unverified)

**Kiro GitHub App (AWS's suggested successor)**
- The docs describe it as an agent that *acts on* review feedback, not an automated reviewer:
  - `/kiro all` addresses all reviewer comments across the PR.
  - `/kiro fix` addresses a single thread.
  - It also addresses failing GitHub Action checks.
  - The `kiro` label or a `/kiro` comment on an issue starts a task.
- The page "doesn't say the app performs automated code review." Page last updated Nov 17, 2026. — [Kiro docs: GitHub](https://kiro.dev/docs/web/github) (primary)

**Anthropic Claude Code Review (managed service)**
- Several agents examine the diff and surrounding code in parallel. A verification step filters false positives. Findings are deduplicated and ranked by severity.
- Each review posts:
  - inline comments on the lines concerned,
  - a summary in the review body,
  - a check run named "Claude Code Review".
- The check run "doesn't conclude as a failure." A review "doesn't approve or block" a PR by itself.
- By default it focuses on correctness ("bugs that would break production, not formatting preferences or missing test coverage").
- Comment commands: `@claude review` (one review) and `@claude review always` (subscribes the PR to push-triggered reviews).
- It resolves its own earlier comment threads. It reads code but does not build or run it.
- Sources: [Claude Code docs: Code Review](https://code.claude.com/docs/en/code-review); [Claude Code docs: Code Review costs](https://code.claude.com/docs/en/code-review-costs) (primary)
- Severity labels are 🔴 Important and 🟡 Nit, and are re-calibratable through REVIEW.md. — [Claude Code docs: Customize Code Review](https://code.claude.com/docs/en/code-review-customize) (primary)
- Launch date: March 9, 2026, as a research preview for Team and Enterprise. — [VentureBeat](https://venturebeat.com/technology/anthropic-rolls-out-code-review-for-claude-code-as-it-sues-over-pentagon); [tessl.io](https://tessl.io/blog/anthropic-launches-ai-code-review-agents-that-scan-pull-requests-for-bugs) (secondary)
- Other ways to get a Claude review:
  - local `/code-review` on any plan,
  - "Ultrareview" in a cloud sandbox,
  - Claude in your own CI through GitHub Actions or GitLab CI/CD on your runners with an API key,
  - custom reviewer subagents or skills.
  - Source: [Claude Code docs: Code Review, comparison table](https://code.claude.com/docs/en/code-review) (primary)

**OpenAI Codex code review**
- Triggers:
  - Comment `@codex review`. Codex reacts 👀 and then posts a standard GitHub code review.
  - Focused reviews such as `@codex review for issues in the database migration`.
  - Automatic review, set through a personal preference with a "Review trigger" setting.
- It flags only P0 and P1 issues in GitHub, and findings cite files and line ranges.
- Security Review (research preview) runs through `@codex security review` or an auto setting. The full report sits in the Codex task's "Security Report" tab.
- Source: [OpenAI/ChatGPT docs: Codex GitHub](https://learn.chatgpt.com/docs/third-party/github) (primary)

**GitLab Duo**
- There are two features:
  - **GitLab Duo Code Review:** non-agentic, single pass, limited to the MR and its diffs, no follow-up reviews.
  - **Code Review Flow:** agentic and multi-step. It has broader repository context, uses earlier Duo threads for follow-up reviews, and can re-review on push.
- Triggers: mention `@GitLabDuo`, or automatic review on MR creation or when a draft is marked ready.
- Source: [GitLab docs: Duo in merge requests](https://docs.gitlab.com/user/project/merge_requests/duo_in_merge_requests/) (primary)
- Comments are labeled with the name of the custom-instruction block that triggered them. — [GitLab docs mirror](https://gitlab.kph.go.th/help/user/project/merge_requests/duo_in_merge_requests.md) (primary content, mirror host)

**SonarQube AI CodeFix**
- An LLM proposes fixes for issues found by SonarQube's rule engine. It aims to resolve the issue "without changing the code's functionality."
- Surfaces:
  - a "Generate AI fix" button in the web UI,
  - "Open in IDE" in connected mode (SonarQube for VS Code and IntelliJ),
  - on SonarQube Cloud bound to Azure DevOps, it can open a PR from a fix.
- Source: [Sonar docs: AI CodeFix](https://docs.sonarsource.com/sonarqube-cloud/ai-capabilities/ai-codefix) (primary)

**DeepSource**
- The Open Source plan includes "1,000 PR reviews/month" and "1,000 automated formatting runs/month." AI Review and Autofix are pay-as-you-go on that plan.
- AI Review comes in two tiers: Standard and Advanced.
- Source: [DeepSource pricing](https://deepsource.com/pricing) (primary)

**Codacy**
- "AI Reviewer and merge gates for pull requests" give PR feedback and fix suggestions. — [Codacy pricing](https://www.codacy.com/pricing) (primary)
- AI Reviewer is described as a hybrid of deterministic checks and LLM review. It reads the PR description, linked Jira tickets and diffs. — [aicodereview.cc](https://aicodereview.cc/blog/codacy-review/) (secondary)

### Inferences
- Codex (P0/P1 only), Claude (verify step, correctness-first) and Gemini (MEDIUM threshold) all lead with noise reduction. "Low noise" no longer sets a reviewer apart. It is the baseline.
- Of the platforms reviewed, only Amazon Q (now being discontinued) and, by its own description, Codacy explicitly offer committable fixes in the PR flow. Claude Code Review never pushes commits, and Codex's GitHub page does not mention a fix command.

### Gaps
- I could not confirm the Gemini command names `/gemini review`, `/gemini summary` and `/gemini help` from the fetched official page, which mentions only `/gemini`. I remember them from training, but they are unverified.
- I did not verify whether Gemini posts GitHub "suggested change" blocks.
- I did not fetch the format of Duo review output (summary vs inline vs suggestions).
- I did not fetch Codacy AI Reviewer output details (severity, summary) from primary docs.
- I did not fetch the DeepSource AI Review output format.

---

## 2. Configuration (repo files, custom instructions, AGENTS.md/CLAUDE.md, path filters, thresholds)

### Takeaway
Each vendor has its own config surface:

| Vendor | Config |
|---|---|
| Gemini | `.gemini/config.yaml` + `.gemini/styleguide.md` |
| Claude | `REVIEW.md` + `CLAUDE.md`, read only from the protected base/default branch |
| Codex | `## Code Review Rules` sections in `AGENTS.md` |
| GitLab | `.gitlab/duo/mr-review-instructions.yaml` with glob `fileFilters` |

No vendor shares a format with another. A reviewer that reads all of them would be a real interoperability advantage.

### Cited Findings

**Gemini**
- Config lives at `.gemini/config.yaml` in the repo root, with a `styleguide.md` for custom rules.
- Schema:
  - `have_fun` (false)
  - `ignore_patterns` (glob list)
  - `memory_config.disabled`
  - `code_review.disable`
  - `code_review.comment_severity_threshold` (LOW, MEDIUM, HIGH or CRITICAL; default MEDIUM)
  - `code_review.max_review_comments` (-1 means unlimited)
  - `code_review.pull_request_opened.{help, summary, code_review, include_drafts}`
- Group-level settings for repos grouped by a Developer Connect connection are managed in the Google Cloud console (Preview). A repo's `config.yaml` overrides group settings.
- "Persistent memory" (improved response quality) can be enabled per repo group. It is incompatible with VPC Service Controls perimeters.
- Source: [Google Cloud docs: Customize repo review](https://docs.cloud.google.com/gemini/docs/code-review/customize-repo-review) (primary)

**Claude Code Review**
- `CLAUDE.md`: Claude reads the root file and the files in parent directories of each changed file as project context. Violations become findings.
- `REVIEW.md`: review-only instructions at the repo root, plus subdirectory REVIEW.md files when the branch is protected. It is freeform Markdown that can:
  - redefine what Important means,
  - cap nits ("at most five"),
  - skip paths or categories (e.g. lockfiles, generated code, anything CI enforces),
  - add always-check rules,
  - require evidence (`file:line` citations).
- Supports `@file` includes (max 8 files, 150,000 bytes combined) and `@.claude/skills/<x>/SKILL.md` includes (30,000-byte limit).
- Subdirectory REVIEW.md files are ignored under test, fixture, vendor and generated directory names.
- Security model: REVIEW.md is read from the base or default branch and "never from the pull request's own changes." Severity lowering, exclusions and nit caps are honored only when it is read from a protected branch.
- The local `/code-review` reads CLAUDE.md but not REVIEW.md.
- Source: [Claude Code docs: Customize Code Review](https://code.claude.com/docs/en/code-review-customize) (primary)
- An Owner sets the review level (Quick, Standard or Deep) per organization or per repo, and when reviews run (once after PR creation, after every push, or manual). There is no model choice. — [Claude Code docs: Code Review](https://code.claude.com/docs/en/code-review) (primary)

**Codex**
- Codex searches for `AGENTS.md` files and applies the rules that cover each changed file. Add a `## Code Review Rules` section with `###` groupings, root-level for repo-wide rules and nested for service-specific ones.
- OpenAI recommends starting with 2 or 3 concise rules and leaving formatting and lint checks to CI.
- Source: [OpenAI/ChatGPT docs: Codex GitHub](https://learn.chatgpt.com/docs/third-party/github) (primary)

**GitLab Duo**
- Project-level rules go in `.gitlab/duo/mr-review-instructions.yaml`. Group and instance rules come from a template project and combine with project rules.
- Each block has glob `fileFilters`.
- Source: [GitLab docs: Review instructions](https://docs.gitlab.com/user/gitlab_duo/customize_duo/review_instructions/) (primary)
- GitLab warns that group instructions are visible to anyone who can view MRs in the group. — [dev.to / Emil Reiter](https://dev.to/emilreiter/gitlab-duo-code-review-on-self-managed-which-one-runs-50da) (secondary)

**Amazon Q**
- A "Configuring registered installation details" page exists, but I did not fetch it. — [AWS docs](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/amazon-q-for-github.html) (primary)

**Kiro**
- It learns from PR feedback by the task creator. Steering files and AGENTS.md are not mentioned for the GitHub App. — [Kiro docs: GitHub](https://kiro.dev/docs/web/github) (primary)

### Inferences
- Claude's "read config only from the protected base branch" rule is a notable prompt-injection hardening: a PR cannot weaken its own review. An open-source reviewer should copy this rule and advertise it.
- Formats are fragmented (`.gemini/`, `REVIEW.md`, `AGENTS.md`, `.gitlab/duo/*.yaml`). Reading AGENTS.md, CLAUDE.md, REVIEW.md and `.gemini/styleguide.md` together is a cheap migration on-ramp.

### Gaps
- I did not verify whether Gemini reads AGENTS.md or GEMINI.md for code review.
- I did not fetch Codacy or DeepSource repo-level AI-review config files (`.deepsource.toml` details, Codacy config).
- I did not fetch Amazon Q's GitHub customization options.

---

## 3. Deterministic analysis and how AI is layered on top

### Takeaway
The pure-LLM reviewers (Gemini, Claude, Codex, Duo) do not run rules engines, builds or tests:
- Claude explicitly "works from reading the diff and the surrounding code, without building or running your code."
- Codex tells users to leave lint to CI.

The incumbents invert this. Deterministic SAST, SCA, secrets, coverage and duplication form the core, and the LLM proposes fixes or adds review commentary.

### Cited Findings
- **Claude Code Review** does not build or run code, and has read-only repository access inside a review. — [Claude Code docs: Code Review](https://code.claude.com/docs/en/code-review) (primary)
- **Codex** says to "leave formatting and lint checks to CI." Review rules "don't replace tests, branch protections, or required approvals." — [OpenAI/ChatGPT docs: Codex GitHub](https://learn.chatgpt.com/docs/third-party/github) (primary)
- **SonarQube AI CodeFix** works on issues found by the rule engine. Fixes follow quality profile settings.
  - With Sonar's hosted LLM, the affected snippet goes to the LLM through the AI CodeFix service, and the agreements say it is not used for training. The hosted LLM has a monthly allocation that resets on the 1st.
  - A fully self-hosted Server setup with a self-hosted LLM works without outbound internet, and Sonar's allocation limits don't apply to it.
  - Source: [Sonar docs: AI CodeFix](https://docs.sonarsource.com/sonarqube-cloud/ai-capabilities/ai-codefix) (primary)
- **SonarQube AI Code Assurance** has three parts:
  - project labels for projects that contain AI-generated code,
  - a default quality gate for those projects,
  - externally published project badges.
  - Source: [Sonar docs: AI Code Assurance](https://docs.sonarsource.com/sonarqube-server/ai-capabilities/ai-code-assurance) (primary)
- **DeepSource**
  - The Open Source plan lists static analysis, SAST, IaC and code coverage. Secrets detection and OWASP/CWE reports are not listed for it.
  - Team adds secrets detection, OWASP Top 10 and CWE/SANS Top 25 reports. The tier mapping in the pricing table is ambiguous.
  - SCA ("OSS Dependency Scanning") counts a target as a manifest plus lockfile. Team includes 3 targets, then $8/month per extra target, with license compliance.
  - Source: [DeepSource pricing](https://deepsource.com/pricing) (primary)
- **Codacy**
  - Local SAST, SCA and secrets scans on the free Developer tier, through CLI, IDE and agent.
  - Team adds cloud scans, coverage reports, merge policies and malicious-package detection.
  - Business adds DAST, license scanning, container scanning, "False positive detection and custom rules", an "AI Inventory and AI Risk Hub", and the "Verity for coding agents" add-on.
  - "Shared coding standards across 49 languages."
  - Source: [Codacy pricing](https://www.codacy.com/pricing) (primary)
- **Codacy Guardrails** scans AI-generated code in the IDE before commit (SAST, SCA, secrets, IaC) and lets the agent fix it. — [Codacy vs Cursor Bugbot (vendor page)](https://www.codacy.com/comparison/codacy-vs-cursor-bugbot) (primary vendor, marketing)
- **Amazon Q** review covers "code quality, potential issues, and security concerns." The docs don't say whether a deterministic engine sits underneath. — [AWS docs](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/amazon-q-for-github.html) (primary)

### Inferences
- There is a clear gap between LLM-only vendor reviewers and rules-first incumbents. A self-hosted reviewer that runs real tools (linters, SAST, secrets, SCA, tests) and gives those results to the LLM sits in between. None of the platform reviewers does this on its own infrastructure.

### Gaps
- I did not fetch Sonar duplication or coverage specifics or a rule count. Sonar MCP Server and agent features are not covered.
- I did not verify whether Codacy AI Reviewer passes deterministic findings into the LLM prompt (as opposed to running them in parallel).

---

## 4. Quality gates and PR decoration (status checks, blocking merges, new-code policies)

### Takeaway
The pure-AI reviewers are advisory by design:
- Claude's check run never fails.
- Codex review rules don't replace branch protection.

Blocking merge gates remain the incumbents' territory: Sonar quality gates, Codacy merge gates and coverage merge policies. Sonar's free Community Build reportedly lacks PR decoration.

### Cited Findings
- **Claude:** the check run "doesn't conclude as a failure." A review doesn't approve or block a PR by itself. Its result counts toward approvals only in repos with a "Claude Approvals" policy file. — [Claude Code docs: Code Review](https://code.claude.com/docs/en/code-review) (primary)
- **Codex:** review rules "don't replace tests, branch protections, or required approvals." — [OpenAI/ChatGPT docs: Codex GitHub](https://learn.chatgpt.com/docs/third-party/github) (primary)
- **Codacy:** "AI Reviewer and merge gates for pull requests" and "Coverage reports and merge policies" are on Team and above. — [Codacy pricing](https://www.codacy.com/pricing) (primary)
- **Sonar AI Code Assurance** includes a default quality gate for projects labeled as containing AI code. — [Sonar docs: AI Code Assurance](https://docs.sonarsource.com/sonarqube-server/ai-capabilities/ai-code-assurance) (primary)
- **Sonar Community Build** (free, self-hosted) supports quality gates on the main branch but "cannot decorate pull requests." — [dev.to / rahulxsingh](https://dev.to/rahulxsingh/sonarqube-vs-sonarcloud-self-hosted-vs-cloud-code-quality-2026-dkj) (secondary)
- **DeepSource** pricing page doesn't mention quality gates. — [DeepSource pricing](https://deepsource.com/pricing) (primary)

### Inferences
- Combining an AI reviewer with a configurable blocking gate (e.g. fail on CRITICAL findings, or on deterministic tool failures in new code) and PR decoration, all free and self-hosted, fills a gap. Sonar Community Build lacks PR decoration, and the AI vendors are advisory only.

### Gaps
- I did not fetch Sonar's official "clean as you code" / new-code definition docs or the PR-decoration edition matrix this session.
- I did not verify whether Gemini or Amazon Q post a status check.

---

## 5. Surfaces, platforms, IDE and CLI

### Takeaway
GitHub dominates:
- **GitHub-centric:** Gemini (GitHub.com, GHES, GHEC), Claude Code Review (GitHub incl. GHES, plus GHEC with data residency), Codex (GitHub; GitLab is a separate Beta page), Amazon Q (GitHub/GHEC only).
- **GitLab-native:** GitLab Duo.
- **Multi-host:** Codacy (GitHub, Bitbucket and GitLab cloud only, no self-hosted git), Sonar (Azure DevOps fix-PRs among others).

### Cited Findings
- **Gemini:** GitHub only (GitHub.com, GitHub Enterprise Server, GitHub Enterprise Cloud). GitLab and Bitbucket are not mentioned. Developer Connect connections are always in `us-east1`. — [Google Cloud docs: Review repo code](https://docs.cloud.google.com/gemini/docs/code-review/review-repo-code) (primary)
- **Claude Code Review:** GitHub, including GHES and GHEC with data residency. GitLab users must use Claude in GitLab CI/CD on their own runners instead. — [Claude Code docs: Code Review](https://code.claude.com/docs/en/code-review) (primary)
- **Codex:** GitHub page; it links a separate "GitLab (Beta)" page that I did not fetch. — [OpenAI/ChatGPT docs: Codex GitHub](https://learn.chatgpt.com/docs/third-party/github) (primary)
- **Amazon Q:** GitHub and GitHub Enterprise Cloud. Data is processed in the United States. — [AWS docs](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/amazon-q-for-github.html) (primary)
- **Codacy:**
  - Supported: GitHub Cloud, Bitbucket Cloud, GitLab Cloud.
  - Not supported: Azure Repos (waitlist) and self-hosted GitHub, GitLab or Bitbucket.
  - IDE plugins for VS Code, JetBrains and Cursor, plus a CLI and agent.
  - Source: [Codacy pricing](https://www.codacy.com/pricing) (primary)
- **Sonar:** AI CodeFix runs in the web UI and in SonarQube for VS Code and IntelliJ (connected mode). PR creation from a fix exists for Azure DevOps-bound projects. — [Sonar docs: AI CodeFix](https://docs.sonarsource.com/sonarqube-cloud/ai-capabilities/ai-codefix) (primary)
- **GitLab Duo:** Code Review Flow covers GitLab.com, Self-Managed and Dedicated. — [GitLab docs: Duo in merge requests](https://docs.gitlab.com/user/project/merge_requests/duo_in_merge_requests/) (primary)
- **CLI/local review options:**
  - Claude `/code-review` (any plan) — [Claude Code docs](https://code.claude.com/docs/en/code-review)
  - Codex CLI `/review`, which draws on general Codex usage — [repowise](https://repowise.dev/blog/comparisons/codex-code-review-setup-pricing) (secondary)

### Inferences
- Self-hosted GitLab, Gitea/Forgejo, Bitbucket Server and Azure DevOps are poorly served by the AI-native vendors. Codacy explicitly excludes self-hosted git hosts.

### Gaps
- Codex GitLab Beta details are not fetched.
- DeepSource supported hosts are not fetched this session.

---

## 6. Deployment (SaaS vs self-managed, data handling, model choice, BYO key)

### Takeaway
Self-hosting options:

| Vendor | Self-hosting |
|---|---|
| Sonar (Server Enterprise/Data Center with self-hosted LLM) | Truly air-gapped AI review |
| DeepSource (Enterprise only, with BYOK for Anthropic, OpenAI or Gemini) | Self-hosted |
| GitLab | Self-Managed |
| Claude Code Review | SaaS only. Runs on Anthropic infrastructure, not available with ZDR, HIPAA or CMEK, no model choice |
| Gemini, Codex, Amazon Q | Vendor-hosted |

### Cited Findings
- **Claude Code Review:**
  - Runs "on Anthropic infrastructure" and does not run in self-hosted environments.
  - Not available to organizations with Zero Data Retention or the HIPAA configuration, not covered under the BAA, and not yet available with CMEK.
  - Admins get no model choice.
  - Anyone can run Claude in their own CI with an API key or cloud-provider credentials.
  - Source: [Claude Code docs: Code Review](https://code.claude.com/docs/en/code-review) (primary)
- **Sonar AI CodeFix:** the Server can use a self-hosted LLM and "is designed to work without outbound internet access." Prompts and rule descriptions ship with the product. — [Sonar docs: AI CodeFix](https://docs.sonarsource.com/sonarqube-cloud/ai-capabilities/ai-codefix) (primary)
- **DeepSource:** self-hosted and airgapped deployment are Enterprise only. BYOK for AI Review covers Anthropic Claude, OpenAI or Google Gemini keys, and inference then runs on the customer's infrastructure (Enterprise only). — [DeepSource pricing](https://deepsource.com/pricing) (primary)
- **Codacy:** no self-hosted option listed. The only residency option is GitHub Enterprise with data residency (Business). — [Codacy pricing](https://www.codacy.com/pricing) (primary)
- **Amazon Q for GitHub:** data is processed in the US. It "does not currently use your content for service improvement." — [AWS docs](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/amazon-q-for-github.html) (primary)
- **Gemini:** an Enterprise version (Preview) is installed through Google Cloud under Google Cloud terms, separate from the Gemini Code Assist Enterprise product. — [Google Cloud docs: Review repo code](https://docs.cloud.google.com/gemini/docs/code-review/review-repo-code) (primary)

### Inferences
- BYO model, self-hosted and air-gapped AI review is available today only at enterprise price points (Sonar Server Enterprise, DeepSource Enterprise). An open-source self-hosted reviewer with BYO key or local models undercuts these directly. It also covers ZDR and HIPAA organizations that Claude Code Review explicitly excludes.

### Gaps
- Gemini data-use terms for the consumer edition are not fetched.
- I did not confirm whether GitLab Duo Code Review supports self-hosted models (Duo Self-Hosted).

---

## 7. Pricing and free tiers (incl. open source)

### Takeaway
- **Free for open source:** DeepSource (1,000 PR reviews/mo, AI pay-as-you-go) and Codacy ("Free forever for open-source projects").
- **Free with limits:** Amazon Q for GitHub (being discontinued).
- **Bundled with a subscription:** Codex (code review counts toward the plan's usage).
- **Expensive and usage-billed:** Claude Code Review (tokens, roughly $15 to $25 per review reported at launch).
- **Uncertain:** GitLab moved review to GitLab Credits (usage-based) for Code Review Flow. Sonar AI CodeFix requires paid tiers.

### Cited Findings
- **Claude Code Review:**
  - No flat per-review price. Billed on token usage through usage credits, separately from plan usage, billed to the organization.
  - Cost scales with review level, change size, code complexity and number of candidate findings. A new repo defaults to "After every push," which multiplies cost.
  - Monthly spend limits are available. Reviews are skipped with a PR comment when the budget runs out.
  - Team and Enterprise plans only.
  - Source: [Claude Code docs: Code Review costs](https://code.claude.com/docs/en/code-review-costs) (primary)
- **Claude cost estimates:** about $15 to $25 per review at launch. — [TechRadar](https://www.techradar.com/pro/anthropic-launches-a-new-code-review-tool-to-check-ai-generated-content-but-it-might-cost-you-more-than-youd-hope); [VentureBeat](https://venturebeat.com/technology/anthropic-rolls-out-code-review-for-claude-code-as-it-sues-over-pentagon) (secondary)
  - VentureBeat called it "substantially more expensive than alternatives," noting Copilot bundles review and CodeRabbit is cheaper. (secondary opinion)
  - The claim that "Eligible Claude Enterprise organizations can claim at least $10,000 in Code Review credits by January 15, 2027" is attributed to Anthropic's GA post. — [via search summary of repowise / codeant](https://repowise.dev/blog/comparisons/claude-code-review-pricing) (secondary, unverified)
- **Codex:** no per-review fee. GitHub reviews count toward a code-review usage category of the Codex/ChatGPT plan, and automatic review needs Plus or higher. On April 2, 2026, OpenAI reportedly moved Codex to token-based credits. — [repowise](https://repowise.dev/blog/comparisons/codex-code-review-setup-pricing); [cubic.dev](https://www.cubic.dev/blog/codex-code-review) (secondary; sources disagree on metering)
- **Amazon Q for GitHub:** free without an AWS account, with "limited number of lines for code reviews per month." Limits increase by registering with an AWS account. — [AWS docs](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/amazon-q-for-github.html) (primary)
- **GitLab:**
  - Duo Code Review requires the Duo Enterprise add-on.
  - Code Review Flow needs no add-on and consumes GitLab Credits.
  - GitLab 19.4 moved comment interactions to usage-based billing.
  - Source: [GitLab docs: Duo in merge requests](https://docs.gitlab.com/user/project/merge_requests/duo_in_merge_requests/) (primary)
  - A GitLab blog says Code Review Flow is available on Free, Premium and Ultimate. — [GitLab blog](https://about.gitlab.com/blog/customizing-gitlab-duo-chat-rules-prompts-workflows/) (primary vendor, ~6 months old)
- **DeepSource:**
  - Open Source plan: free, "free for open-source projects, and always will be," unlimited public repos, 1,000 PR reviews/mo, AI Review and Autofix pay-as-you-go.
  - Team: $24/user/mo billed yearly, unlimited PR reviews, unlimited Autofix. AI Review Standard is $8 and Advanced is $15 per 10K processed LOC. A $100 annual AI credit per user is included.
  - Enterprise: custom.
  - Source: [DeepSource pricing](https://deepsource.com/pricing) (primary)
  - The February 2026 restructure deprecated the old Free and Starter plans. — [search aggregate incl. toolworthy](https://www.toolworthy.ai/tool/deepsource) (secondary)
- **Codacy:**
  - Developer: free (local and IDE scans only).
  - Team: $18/dev/mo yearly or $21 monthly, up to 30 devs and 100 private repos, includes AI Reviewer.
  - Business: custom.
  - "Free forever for open-source projects."
  - Source: [Codacy pricing](https://www.codacy.com/pricing) (primary). Third-party sources quoting $15 appear stale. — [aicodereview.cc](https://aicodereview.cc/blog/codacy-review/) (secondary, conflicting)
- **Sonar AI CodeFix:** included in SonarQube Cloud Team and Enterprise, and SonarQube Server Enterprise and Data Center. Not included in Server Developer or the free Community Build. — [Sonar docs: AI CodeFix](https://docs.sonarsource.com/sonarqube-cloud/ai-capabilities/ai-codefix) (primary)
  - Quoted prices conflict widely: Server Enterprise "~$16,000/yr for 1M LOC," Cloud Team "~$32/mo for 100K LOC," Developer "$720/yr" vs "~$2,500/yr." — [baeseokjae](https://baeseokjae.github.io/posts/sonarqube-ai-codefix-review-2026/); [Capterra](https://www.capterra.com/p/210481/SonarQube/pricing/) (secondary, conflicting)
- **Gemini Enterprise (Preview):** quota "100+ pull requests per day." — [Google Cloud docs: Review repo code](https://docs.cloud.google.com/gemini/docs/code-review/review-repo-code) (primary)

### Inferences
- Pricing is moving to usage-based billing everywhere: Claude tokens, GitLab Credits, DeepSource per-LOC AI Review, and Codex credits. A self-hosted tool where users pay their LLM provider directly, at cost and with predictable caps, is a clear position. Claude's default "after every push" setting multiplying cost is a concrete pain point to cite.

### Gaps
- The Gemini consumer (free) edition quota and pricing are not verified. I recall it as free with daily PR limits, but this is unverified.
- Official Sonar list prices and SonarQube Cloud's free tier for public projects are not verified this session.
- Official Codex plan prices are not fetched.

---

## 8. Renames and discontinuations (Amazon Q Developer → Kiro)

### Takeaway
The Amazon Q Developer for GitHub App stops accepting new installs on **Nov 18, 2026**, and support ends **Jan 30, 2027**. AWS points users to Kiro and the Kiro GitHub App. Kiro's documented GitHub App resolves review comments and opens PRs. It is not documented as an automated PR reviewer. The Q IDE plugins and paid subscriptions reach end of support Apr 30, 2027.

### Cited Findings
- "On January 30, 2027, AWS will discontinue support for the Amazon Q Developer for GitHub App. New app installations will no longer be available starting November 18, 2026." Users are pointed to "Kiro and the Kiro GitHub App." — [AWS docs: Amazon Q Developer for GitHub](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/amazon-q-for-github.html) (primary)
- Q Developer IDE plugins and paid subscriptions reach end of support Apr 30, 2027, giving customers 12 months to move to Kiro. — [AWS DevOps blog (title page)](https://aws.amazon.com/blogs/devops/amazon-q-developer-end-of-support-announcement/) (primary, body not retrievable; details via search summary)
- New Q Developer IDE signups reportedly stopped May 15, 2026. The CLI became Kiro CLI from Nov 24, 2025. — [aiidelist](https://aiidelist.com/ide/amazon-q-developer); [javisreview](https://javisreview.com/review/amazon-q-developer-review-2026/) (secondary)
- One secondary source claims AWS announced a rename of Amazon Q Developer to Kiro on 2026-06-29. Other sources frame Kiro as a successor rather than a rebrand. — [zynovix](https://zynovix.github.io/amazon-q-developer-review-2026.html) (secondary, unverified, conflicting)
- The Kiro GitHub App documents `/kiro all` and `/kiro fix` to address reviewer comments. Automated review is not described (page updated Nov 17, 2026). — [Kiro docs: GitHub](https://kiro.dev/docs/web/github) (primary)
- GitLab moved `@GitLabDuo` comment interactions to the Duo Agent Platform in 19.1, made Code Review Flow routing GA in 19.3, and switched comment interactions to usage-based billing in 19.4. This is an architecture shift away from classic Duo Code Review, not a formal deprecation. — [GitLab docs: Duo in merge requests](https://docs.gitlab.com/user/project/merge_requests/duo_in_merge_requests/) (primary)
- One source claims DeepSource was acquired by Harness (announced Sep 9, 2026). This is single-source and uncorroborated. — [search aggregate](https://appsecsanta.com/deepsource) (secondary, unverified)

### Inferences
- AWS currently has no documented first-party automated PR reviewer for GitHub after Jan 2027. That is a migration window for an open-source reviewer targeting AWS-centric teams.

### Gaps
- I could not retrieve the body of the AWS end-of-support blog post. The exact Q-for-GitLab ("GitLab Duo with Amazon Q") status is unknown.

---

## 9. Published evaluations of review quality

### Takeaway
I found no independent, reproducible benchmark of these vendors' PR review quality in this session. The vendor docs make no quantitative quality claims on the fetched pages. Claude's docs include an explicit disclaimer that reviews "may miss bugs."

### Cited Findings
- Claude: "Code Review uses AI to review code and may miss bugs, security vulnerabilities, or other issues. A review with no findings doesn't mean your code is error-free or secure." Its analytics dashboard counts "comments that were auto-resolved because a developer addressed the issue," which is a vendor-side acceptance proxy. — [Claude Code docs: Code Review](https://code.claude.com/docs/en/code-review); [costs page](https://code.claude.com/docs/en/code-review-costs) (primary)
- Codex positions P0/P1-only output as a precision choice ("to keep comments focused on high-priority risks"). — [OpenAI/ChatGPT docs: Codex GitHub](https://learn.chatgpt.com/docs/third-party/github) (primary)
- Many 2026 "comparison" articles are written by competing vendors (codeant.ai, cubic.dev, qodo.ai, repowise, Codacy's own comparison pages) and should be treated as marketing. — e.g. [codeant.ai](https://codeant.ai/blogs/best-ai-code-review-tools-for-developers), [Codacy vs CodeRabbit](https://www.codacy.com/comparison/codacy-vs-coderabbit) (secondary/vendor)

### Inferences
- The lack of public, reproducible evaluations is itself a positioning opportunity. An open-source reviewer could publish an open eval harness (seeded-bug PRs, precision and recall, cost per PR).

### Gaps
- Anthropic launch-post internal stats (e.g. share of PRs with findings, percentage marked incorrect) were not fetched from a primary source. I recall such figures from launch coverage but did not verify them.
- I did not search for Google, OpenAI or GitLab published review-quality metrics, or third-party benchmarks such as Martian/withmartian code-review benchmarks.
