# Roadmap: market parity and beyond

Built one item at a time on `feat/market-parity`; each item lands as its own commit with tests. Compared with
CodeRabbit, GitHub Copilot code review, Greptile, Qodo Merge and Cursor Bugbot (November 2026).

Principles that stay: nothing is posted without a preview (or an explicit unattended setting); pr-reviewer never
merges; approving is opt-in and gated; any AI model (key, subscription, or local); self-hostable; no analytics.

| # | Item | Why | Status |
|---|---|---|---|
| 1 | License file and CI (`pnpm check` on pushes and PRs) | Public repo needs a license; contributors need CI | done |
| 2 | `pr-reviewer ship`: review → fix with your coding agent → push → wait for CI → re-review, until clean; then mark ready | The author's loop, like Claude Code's ship; never merges | done |
| 3 | Less noise: merge findings repeated across files; keep style-only AI findings out | Buyers judge reviewers on false positives | done |
| 4 | Incremental reviews (only what changed since the last reviewed commit) and the result as a merge check | Copilot and CodeRabbit both do this | done (merge check: `publish.commitStatus`, and ship's `pr-reviewer/ship` status) |
| 5 | Adaptive effort: quick pass for small, low-risk PRs; full review for risky ones | Faster and cheaper; fixes local-model slowness | done |
| 6 | Replies in the PR thread: `@pr-reviewer why`, `fix`, `ignore`, `review` | Conversation is expected | done (`pr-reviewer respond`; webhooks arrive with item 7) |
| 7 | GitHub App: install once, every PR reviewed on push (webhooks, in the Web App) | How every competitor is adopted | done (`pr-reviewer app`, docs/github-app.md) |
| 8 | Review local changes before a PR (`pr-reviewer review --local`) | Shift left, like IDE review | done |
| 9 | Opt-in approval, gated (checks ran and passed, no finding at or above a threshold) | Copilot can now approve; ours stays off by default | done (`publish.approve`) |
| 10 | GitLab merge requests, then Bitbucket and Azure DevOps | CodeRabbit covers all four | GitLab done (gitlab.com and self-hosted); Bitbucket and Azure DevOps planned |
| 11 | Jira and Linear ticket awareness | Ticket-aware reviews | done |
| 12 | Publishing: npm package, Web App image on GHCR, extension zip on releases | People must be able to install it | done (tag vX.Y.Z → `.github/workflows/release.yml`; docs/releasing.md) |
| 13 | Published benchmark numbers (`bench` on a public dataset) | Trust in quality | method, tooling and baseline done (docs/benchmarks.md); a full 50-PR run uses the Claude plan, so it is run on request |
| 14 | Team dashboard: accepted vs dismissed findings, by repo and person | Managers buy on evidence | done (Web App Team view, `PR_REVIEWER_ADMINS`) |
| 15 | Security deep scan (static rules in the Sandbox) | CodeRabbit and Copilot now market security | done (`security.patterns`: injection, XSS, TLS off, JWT, deserialisation, CORS, weak hashes, insecure random) |
| 16 | "Apply fix" from the review: commit a suggestion to the PR branch | One-click fixes | done (review page, extension, `@pr-reviewer fix`; GitHub and GitLab) |
| 18 | BR.dev brand: orange accent, Inter, PR mark and icon, light and dark, contrast-checked (docs/brand.md) | Your own brand on every surface | done |
| 17 | Whole-codebase and cross-repo context (an index of the repository) | Greptile's main selling point | planned |
