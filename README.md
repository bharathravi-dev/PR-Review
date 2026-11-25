# pr-reviewer

Review GitHub pull requests before you merge them. `pr-reviewer` reads the PR in context, runs the checks
that can run deterministically, adds an AI review with the provider you choose, and can post the result
on the PR as precise inline comments plus one summary, without ever approving or merging.

Status: Release 1 in progress. Available now: the CLI and a local review page, with context loading,
secret scanning, AI review with your Claude or ChatGPT plan or an API key (Anthropic, OpenAI, or any
compatible endpoint), fallback and cost limits, posting, re-review without duplicates, Finding feedback,
and stats. Coming: compiler and lint checks in a sandbox, automatic reviews, a hosted web app, and a
browser extension.

## Quick start

Requirements: Node.js 22 or later, pnpm 12, and a GitHub login (`gh auth login`) or token.

```bash
pnpm install && pnpm build
node packages/cli/bin/pr-reviewer.js init      # finds your GitHub login and AI, tests them, writes your config
node packages/cli/bin/pr-reviewer.js review https://github.com/<owner>/<repo>/pull/<n>
```

`init` finds Claude Code (including the copy inside the VS Code, Cursor, or Windsurf extension) and the
Codex CLI, so a Claude or ChatGPT plan works without an API key. It also finds `ANTHROPIC_API_KEY` and
`OPENAI_API_KEY`.

Add `--post` to put the review on the PR. You see a preview of exactly what will be posted and are
asked to confirm; use `--yes` in scripts.

## Commands

| Command | What it does |
|---|---|
| `init` | Find your GitHub login and AI, test each with a small call, and write your config |
| `review <pr>` | Review a PR and print the report (`--out <dir>` for files, `--json`, `--post`) |
| `list <owner/repo>` | Open PRs and whether you reviewed their latest commit; pick one to review |
| `stats` | How your posted findings fared: resolved, dismissed, still open |
| `serve` | Open a review page in your browser (`--open`, `--port <n>`); see below |
| `context <pr>` | Show what the review reads from GitHub |
| `config show` / `config path` | Your resolved settings and where they came from |

Exit codes: 0 passed, 1 passed with warnings (0 with `--warnings-ok`), 2 failed, 3 incomplete, 4 error,
5 cancelled, 6 post failed or blocked, 64 usage error, 78 configuration error.

## Review from a page in your browser

```sh
pr-reviewer serve --open
```

This starts a page on your own machine (`127.0.0.1` only) using the same GitHub login and AI key as the
CLI. Paste a PR link or list a repository's open PRs, watch the review run, read the findings, tick the
ones you agree with, preview exactly what will be posted, and press Post. Nothing is posted before that.

The link printed in the terminal carries a one-time key, so only you can use the page while it runs.
Don't share the link; stop the page with Ctrl+C. The page speaks the `ReviewService v1` API
(`/v1/runs`, `/v1/runs/:id/events`, `/v1/runs/:id/report`, `/v1/runs/:id/publish`), which the browser
extension will also use.

## Configuration

Optional, in `~/.config/pr-reviewer/config.yml` (or `$XDG_CONFIG_HOME`, `%APPDATA%` on Windows):

```yaml
version: 1
github:
  host: github.com            # or your GitHub Enterprise host
defaultProvider: claude-code  # used unless --provider says otherwise
fallback: [anthropic]         # tried in order when the default is rate-limited, down, or logged out
providers:
  claude-code:
    type: claude-code         # your Claude plan via Claude Code; also: codex (your ChatGPT plan)
    model: opus               # optional
  anthropic:
    type: anthropic           # key: ANTHROPIC_API_KEY
    model: claude-opus-5-5
    pricing: { inputPerMTok: 5, outputPerMTok: 25 }   # optional; enables cost estimates and limits
  openrouter:
    type: openai-compatible   # OpenAI, OpenRouter, Ollama, Azure OpenAI, or a company gateway
    baseUrl: https://openrouter.ai/api/v1
    model: <model id>
    credential: provider:openrouter   # key: PR_REVIEWER_OPENROUTER_API_KEY or the OS keychain
limits:                       # apply to API-key providers that have pricing
  maxCostPerRunUsd: 1
  maxCostPerMonthUsd: 20
reviewRules:
  - ~/review-rules/team.md    # Markdown; each top-level list item is a rule
publish:
  maxInlineComments: 30
  commitStatus: false         # true: also set a "pr-reviewer" commit status when posting
```

Credentials are never stored in this file. They come from environment variables, the OS keychain, your
`gh` login, or the vendor CLI's own login, and are redacted from every output.

**Using your Claude or ChatGPT plan.** The `claude-code` and `codex` providers run your own logged-in
CLI, so each review uses your plan's allowance (a one-time notice says so). They run with no tools, no
MCP servers, no project or user customisations, in an empty temporary folder, without your GitHub or API
keys; the PR reaches them only as text. pr-reviewer never reads their login files.

**Usage and cost.** Each report lists the tokens used. With `pricing` set for a provider it also shows an
estimated cost, and `limits` stop the AI step before a call that would exceed them. Usage is then kept
locally in `~/.local/state/pr-reviewer/usage.json` (`$XDG_STATE_HOME`, or `%LOCALAPPDATA%` on Windows).

## From your phone (GitHub Actions)

Push this repository to your account, add the secrets `ANTHROPIC_API_KEY` and `GH_REVIEW_TOKEN`, then run
**Actions → PR review → Run workflow** with a PR link. Turn on "post" to put the review on the PR.

## Safety

- PR content is treated as data, never as instructions; the AI cannot run tools or post anything itself.
- Secrets found in a PR are reported by location and removed before anything is sent to the AI.
- Published text is sanitised: no HTML, no @-mentions, no links outside the reviewed repository.
- Posts never approve or merge, and a review of the same commit is never posted twice.

Moving from the old `review.mjs`? See [docs/migration.md](docs/migration.md).
