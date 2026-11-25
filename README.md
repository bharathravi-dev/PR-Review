# pr-reviewer

Review GitHub pull requests before you merge them. `pr-reviewer` reads the PR in context, runs the checks
that can run deterministically, adds an AI review with the provider you choose, and can post the result
on the PR as precise inline comments plus one summary, without ever approving or merging.

Status: Release 1 in progress. Available now: the CLI with context loading, secret scanning, AI review
(Anthropic), posting, re-review without duplicates, Finding feedback, and stats. Coming: more AI
providers, compiler and lint checks in a sandbox, automatic reviews, a web app, and a browser extension.

## Quick start

Requirements: Node.js 22 or later, pnpm 12, and a GitHub login (`gh auth login`) or token.

```bash
pnpm install && pnpm build
export ANTHROPIC_API_KEY=...              # optional; without it the AI step is reported as not run
node packages/cli/bin/pr-reviewer.js review https://github.com/<owner>/<repo>/pull/<n>
```

Add `--post` to put the review on the PR. You see a preview of exactly what will be posted and are
asked to confirm; use `--yes` in scripts.

## Commands

| Command | What it does |
|---|---|
| `review <pr>` | Review a PR and print the report (`--out <dir>` for files, `--json`, `--post`) |
| `list <owner/repo>` | Open PRs and whether you reviewed their latest commit; pick one to review |
| `stats` | How your posted findings fared: resolved, dismissed, still open |
| `context <pr>` | Show what the review reads from GitHub |
| `config show` / `config path` | Your resolved settings and where they came from |

Exit codes: 0 passed, 1 passed with warnings (0 with `--warnings-ok`), 2 failed, 3 incomplete, 4 error,
5 cancelled, 6 post failed or blocked, 64 usage error, 78 configuration error.

## Configuration

Optional, in `~/.config/pr-reviewer/config.yml` (or `$XDG_CONFIG_HOME`, `%APPDATA%` on Windows):

```yaml
version: 1
github:
  host: github.com            # or your GitHub Enterprise host
providers:
  anthropic:
    type: anthropic
    model: claude-opus-5-5
reviewRules:
  - ~/review-rules/team.md    # Markdown; each top-level list item is a rule
publish:
  maxInlineComments: 30
  commitStatus: false         # true: also set a "pr-reviewer" commit status when posting
```

Credentials are never stored in this file. They come from environment variables, the OS keychain, or
your `gh` login, and are redacted from every output.

## From your phone (GitHub Actions)

Push this repository to your account, add the secrets `ANTHROPIC_API_KEY` and `GH_REVIEW_TOKEN`, then run
**Actions → PR review → Run workflow** with a PR link. Turn on "post" to put the review on the PR.

## Safety

- PR content is treated as data, never as instructions; the AI cannot run tools or post anything itself.
- Secrets found in a PR are reported by location and removed before anything is sent to the AI.
- Published text is sanitised: no HTML, no @-mentions, no links outside the reviewed repository.
- Posts never approve or merge, and a review of the same commit is never posted twice.

Moving from the old `review.mjs`? See [docs/migration.md](docs/migration.md).
