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
| 7 | GitHub App: install once, every PR reviewed on push (webhooks, in the Web App) | How every competitor is adopted | planned |
| 8 | Review local changes before a PR (`pr-reviewer review --local`) | Shift left, like IDE review | planned |
| 9 | Opt-in approval, gated (checks ran and passed, no finding at or above a threshold) | Copilot can now approve; ours stays off by default | planned |
| 10 | GitLab merge requests, then Bitbucket and Azure DevOps | CodeRabbit covers all four | planned |
| 11 | Jira and Linear ticket awareness | Ticket-aware reviews | planned |
| 12 | Publishing: npm package, Web App image on GHCR, extension zip on releases | People must be able to install it | planned |
| 13 | Published benchmark numbers (`bench` on a public dataset) | Trust in quality | planned |
| 14 | Team dashboard: accepted vs dismissed findings, by repo and person | Managers buy on evidence | planned |
| 15 | Security deep scan (static rules in the Sandbox) | CodeRabbit and Copilot now market security | planned |
| 16 | "Apply fix" from the review: commit a suggestion to the PR branch | One-click fixes | planned |
| 18 | BR.dev brand: orange accent, Inter, PR mark and icon, light and dark, contrast-checked (docs/brand.md) | Your own brand on every surface | done |
| 17 | Whole-codebase and cross-repo context (an index of the repository) | Greptile's main selling point | planned |
