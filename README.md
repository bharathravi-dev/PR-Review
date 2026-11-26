# pr-reviewer

Review GitHub pull requests before you merge them. `pr-reviewer` reads the PR in context, runs the checks
that can run deterministically, adds an AI review with the provider you choose, and can post the result
on the PR as precise inline comments plus one summary, without ever approving or merging.

Status: Release 1. Available now: the CLI and a local review page; project and version detection;
Angular 12+ and React checks; reuse of your CI and SonarQube results; known-vulnerability checks for new
dependencies; the repository's own `tsc`, ESLint, or TSLint in a container sandbox; secret scanning; AI
review with your Claude or ChatGPT plan or an API key; posting, re-review without duplicates, Finding
feedback, and stats; automatic reviews of PRs in your account; and a self-hosted Web App for teams. Coming: a
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
| `stats` | How your posted findings fared: addressed, dismissed, still open, by severity and by source |
| `fix <pr>` | Have your own Claude Code or Codex fix your open findings in your checkout of the PR |
| `learnings <owner/repo>` | What reviews learned from feedback on earlier comments, and how to undo it |
| `mcp` | Run as an MCP server so your coding agent can review a PR and read its open findings; never posts |
| `bench <dataset>` | Measure review quality: precision, recall, F1 against PRs with known issues |
| `auto enable` / `auto status` | Turn on automatic reviews in a private repository of yours; see below |
| `web` | Run the self-hosted Web App (see docs/web-app.md) |
| `serve` | Open a review page in your browser (`--open`, `--port <n>`, `--ui v2\|classic`, `--pair`, `--unpair`); see below |
| `context <pr>` | Show what the review reads from GitHub |
| `config show` / `config path` | Your resolved settings and where they came from |

Exit codes: 0 passed, 1 passed with warnings (0 with `--warnings-ok`), 2 failed, 3 incomplete, 4 error,
5 cancelled, 6 post failed or blocked, 64 usage error, 78 configuration error.

## GitLab

Merge requests work like PRs: `pr-reviewer review https://gitlab.com/group/project/-/merge_requests/12` (nested
groups too), with `GITLAB_TOKEN` (a token with the `api` scope). gitlab.com is recognised; list a self-hosted GitLab
under `gitlab: { hosts: [gitlab.example.com] }` in the config. Inline findings become diff discussions, the summary a
note; incremental reviews, commands, the merge check (a commit status) and opt-in approval work the same way.

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


**Two versions of the page.** `/` opens the new design (v2, also at `/v2/`); the earlier page is at `/classic/`.
"Switch to classic" (in v2's top bar, command bar and Settings) and "Try v2" move between them, and the browser
remembers your choice. To open classic by default, start with `--ui classic` (Web App: `PR_REVIEWER_DEFAULT_UI=classic`).
See [docs/review-page-v2.md](docs/review-page-v2.md).
## From the GitHub PR page: the browser extension (in progress)

`pnpm build` also builds a Chrome extension into `packages/extension/build/`. Load it unpacked from
`chrome://extensions` (Developer mode → Load unpacked), open a PR on github.com, and click the toolbar icon
or press Alt+Shift+R. In Standalone mode the review runs inside the side panel with your own GitHub token and
AI key; compile and lint are reported as not run (there is no Sandbox in the browser). Nothing is posted until you
preview and press Post. No AI key? Choose **Ollama** in the AI step to review with a local model (the panel lists
the models you have installed; the review never leaves your computer for the AI step). A Review button in the PR header
shows each PR's state. Store packaging and the listing:
[docs/extension-store.md](docs/extension-store.md).

**Connected mode** runs the review on a pr-reviewer you already have, with its settings, your subscription and the full
checks; the extension never holds your GitHub token or AI key:

- **This computer:** run `pr-reviewer serve --pair`, choose *This computer* in the panel and type the code it prints
  (it works once, for 10 minutes). `serve` then uses port 4747 by default so the panel finds it again; every post asks
  for confirmation; `pr-reviewer serve --unpair` removes the pairing.
- **Your team's Web App:** the operator adds the extension's ID to `PR_REVIEWER_EXTENSION_IDS`; choose *My team's Web
  App*, enter its address, sign in and allow the extension. Revoke it at `/auth/extension/tokens`.

## For a team: the Web App

```bash
cp .env.example .env    # or write .env as described in docs/web-app.md
docker compose up -d
```

Team members sign in with GitHub (only people or organisations you allow), paste a PR link, watch it run,
edit and choose findings, post them, and see what changed since earlier runs of the same PR. Each person
uses their own GitHub sign-in and AI key, stored encrypted on the server. See
[docs/web-app.md](docs/web-app.md).

## For a team, zero setup per PR: the GitHub App

Install it once and every PR is reviewed when opened or pushed to, and `@pr-reviewer` commands are answered, as the
App's bot. Create the App, then `docker compose --profile app up -d`: see [docs/github-app.md](docs/github-app.md).

## Automatic reviews

```bash
export PR_REVIEWER_REVIEW_TOKEN=<fine-grained token>   # enable explains exactly which permissions
pr-reviewer auto discover --dry-run                     # see what would be reviewed, changes nothing
pr-reviewer auto enable
```

`auto enable` creates a **private** repository in your account (`pr-reviewer-automation`) with two pinned
GitHub Actions workflows and a settings file, stores the review token and AI key as Actions secrets (via
`gh`), shows the estimated monthly Actions minutes, and starts a first run. Then, on a schedule chosen to
stay within 60% of your free minutes:

- PRs where your review is requested get a **pending review** only you can see; you edit and submit it.
- PRs in repositories you own get a normal review. Drafts, outside contributors, and organisations are
  off until you turn them on in `.pr-reviewer/config.yml`; a repository can opt out with
  `automatedReview: false` in its `.github/pr-reviewer.yml`.
- Each head commit is reviewed once; a new push is picked up by the next run.
- With `--sandbox`, compile and lint run in a separate job with no secrets and no permissions.
- Problems (expired token, SSO block, quota) open one issue per cause in the automation repository and
  close it when fixed. Logs show only statuses and counts, never PR content.

Your Claude subscription can be used only with `--subscription-opt-in` after a warning; an API key is the
recommended route for automatic reviews.

## What a posted review looks like

- **One review, inline where it matters.** Each finding on a changed line gets an inline comment with a
  **committable suggestion** (one click applies the fix) when the AI is confident of the exact change, and a
  **"Prompt for your AI agent"** block you can paste into Claude Code, Codex, or Cursor.
- **One summary comment, kept up to date**: overall result, what was checked, a **walkthrough** (overview,
  review-effort estimate, changes by file, and whether the change resolves each issue the PR says it
  closes), findings not shown inline, what is still open, what was fixed, and the tokens and cost of the
  review.
- **Low noise by default**: INFO-level notes stay in the summary (`publish.minInlineSeverity`), inline
  comments are capped (`publish.maxInlineComments`), and fixed findings have their threads resolved.
  Style-only lint rules (formatting, whitespace, quotes, commas, ordering, naming) are MINOR at most,
  whatever severity the repository configured. On the review page, new findings come first and
  pre-existing ones are grouped after them, unticked, so they reach the post only if you tick them.
- **Your team's existing guidance is used**: `REVIEW.md`, `AGENTS.md`, `CLAUDE.md`,
  `.github/copilot-instructions.md`, `.cursor/BUGBOT.md`, `.gemini/styleguide.md`, and `.coderabbit.yaml`
  are read from the base branch, so a PR cannot change how it is reviewed.
- **It learns from your feedback.** On any pr-reviewer comment, react 👎 or reply `/dismiss <why>` to say
  it was not useful, or reply `/remember <what to know>` to teach it something about the repository; later
  reviews of every PR in that repository take it into account. Only feedback from you and from people who
  can push to the repository counts. Reply `/forget` (or remove the 👎) to undo. `pr-reviewer learnings
  owner/repo` lists what it has learned. Learnings are read from GitHub on each review (the last 180 days,
  at most 30). They never remove a finding by themselves or touch tool checks: they only guide the AI, which
  is told to still raise BLOCKER and CRITICAL problems. `ai.learn: false` turns this off.

**Fixing findings.** In a checkout of the PR at its latest commit (e.g. after `gh pr checkout 123`),
`pr-reviewer fix 123` hands your open findings (not fixed, not dismissed) to your own Claude Code or Codex.
The agent may only read and edit files in that checkout: no shell, no web, no MCP servers, and none of the
repository's own agent settings or hooks. Nothing is committed or pushed; you review `git diff` and commit
yourself, and the next review closes what was fixed. `--only 1,3` picks findings, `--print` prints the
prompt for any other agent.

**Before you open a PR: `pr-reviewer review --local`.** Reviews the changes in your checkout (committed and
uncommitted tracked files) against where your branch left `main` (or `--base <branch>`), with the same checks, AI
review and Sandbox as a PR review. Nothing is posted; your checkout is not changed.

**Until it's ready: `pr-reviewer ship <PR>`.** In a clean checkout of your PR's head, ship reviews the PR, asks
your Claude Code or Codex to fix findings at MAJOR or above, failed checks, and failed CI, commits the fixes, pushes,
waits for CI, and reviews again, for up to three rounds (`--rounds`, `--min-severity`). It stops when the PR is ready,
when the agent changes nothing, or when the rounds run out, and lists what is still open. It never merges and never
force-pushes; `--post` posts the final review and sets a `pr-reviewer/ship` commit status that branch rules can require.

**Talk to it on the PR: `pr-reviewer respond <PR>`.** People with push access can comment `@pr-reviewer review`
(review again), and in reply to one of its comments `@pr-reviewer why` (explain it with the code), `@pr-reviewer fix`
(a committable suggestion for those lines), `@pr-reviewer ignore [why]` (dismiss), or `@pr-reviewer remember <note>`
(for future reviews). `respond` answers each command once; run it by hand or on a schedule. Code is shown to the AI
only after secret scanning, and comment text is treated as data, never as instructions.

**From your coding agent (MCP).** `pr-reviewer mcp` is an MCP server on stdio with two read-only tools:
`review_pr` (runs a review and returns the findings, each with a fix prompt) and `open_findings` (your posted
findings on a PR that are not yet fixed or dismissed). It uses your normal config and credentials, and never
posts: publishing stays with `review --post`, the review page, or the Web App. For Claude Code:
`claude mcp add pr-reviewer -- pr-reviewer mcp`.

**Is it useful?** `pr-reviewer stats` (and the "How your posted findings fared" panel on the review page)
shows the **addressed rate**: the share of posted findings whose code changed afterwards, by severity and
by source (AI or tools), next to the dismissed and still-open shares. It is computed from GitHub alone.

## Measuring review quality

```bash
pr-reviewer bench my-dataset.yml --runs 3 --judge openai --out results.json
```

A dataset lists PRs and the issues a good review should find: a `description`, and optionally `path`,
`line`, `severity`, and `optional: true` for low-value issues. `bench` reviews each PR (nothing is posted,
nothing is cached between runs) and reports **precision, recall, and F1** (mean ± spread over runs), recall
by severity, comments per PR, the share of PRs with no comments, tokens, cost, and p50/p95 time.

Only the comments a reader would see inline count: line-anchored, about the change, at or above your
inline severity floor. An issue with a location is matched by a comment in the same file within ±5 lines;
with `--judge`, a second model must also agree it is the same root cause, and issues without a location
are matched by the judge alone (one call per PR). A comment that matches only an optional issue counts as
neither right nor wrong. Choose a judge from a different model family than the reviewer.

**The public 50-PR set.** `node scripts/bench-import-golden.mjs` downloads the
[golden comments](https://github.com/ai-code-review-evaluations/golden_comments) that Augment published
for Greptile's benchmark (Sentry, Cal.com, Grafana, Discourse, Keycloak; 10 PRs each) into
`bench/data/golden-50.json`, so results sit next to the published tables for other tools. It is public and
old, so use it for comparison, not for tuning. Then, for example:

```bash
pr-reviewer bench bench/data/golden-50.json --filter cal_dot_com --judge openai --concurrency 2
```

Flags: `--runs` (1–10), `--judge <provider>`, `--provider`/`--model` for the reviewer, `--filter <text>`
(cases whose PR contains it), `--limit <n>`, `--concurrency` (1–8), `--out <file>`, and `--verify` /
`--no-tool-results` / `--no-related-files` to measure those settings against the same PRs. Benchmark runs
never use your feedback on those repositories (`ai.learn` is off for them).

## What gets checked

| Check | Runs | Needs |
|---|---|---|
| Projects, languages, framework and TypeScript versions | always | — |
| Angular 12+ templates and subscriptions; React hooks and list keys (advice matches your version) | when the PR touches such a project | — |
| Results of your CI for the exact head commit (SonarQube, Jenkins, Actions, …) | when present | — |
| Known vulnerabilities in packages the PR adds or upgrades ([OSV](https://osv.dev)) | when a lockfile changes | network |
| Changes to workflows, install scripts, and build or tool config | always | — |
| Secrets in added lines | always | — |
| Compile (`tsc`) and lint (your ESLint or TSLint config; a named default ruleset if you have none) | when the PR touches TS/JS | Docker or Podman |
| AI review | always | an AI provider |

Every check reports PASSED, FAILED, WARNING, SKIPPED, ERROR, TIMEOUT, or NOT_APPLICABLE with a reason,
and the report says plainly what did not run. Problems in code the PR did not touch are labelled
pre-existing and never fail the review.

**The sandbox.** Compile and lint run the repository's own tools, so they run only in a throwaway
container: the source is unpacked inside it, installs can reach only `registry.npmjs.org` (through an
allow-list proxy), analysis has no network at all, and no token or key is ever passed in. Without Docker
or Podman those checks are reported as not run.

**Code around the change.** Besides the changed files, the AI sees a few unchanged files at the head commit
(at most 8, 40,000 characters): local modules the change imports and uses, nearby files that import a
changed file and use the names it changes (callers), and the tests named after it. JavaScript, TypeScript
and Python imports are understood; other languages get their tests. Large files are shown as excerpts
around the relevant names. These files are scanned for secrets like the PR itself, and any that holds a
private key is left out. Finding callers reads up to 20 nearby files. The report lists what was shown;
`ai.relatedFiles: false` turns it off.

## Settings a repository can keep

A repository can commit `.github/pr-reviewer.yml` (and rules in `.github/pr-reviewer/rules/*.md`). They
are read from the PR's base branch, so a PR cannot change its own review:

```yaml
version: 1
reviewRules:
  - Components use OnPush change detection
paths:
  exclude: ['**/*.spec.ts', 'docs/**']
thresholds:
  failOn: MAJOR               # stricter gate; a repository can never make it looser
publish:
  maxInlineComments: 10       # can only lower your own limit
```

Anything else (AI provider, endpoints, keys, review type, sandbox settings) is ignored and listed in
the report.

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
    type: openai-compatible   # OpenAI, OpenRouter, Azure OpenAI, or a company gateway
    baseUrl: https://openrouter.ai/api/v1
    model: <model id>
    credential: provider:openrouter   # key: PR_REVIEWER_OPENROUTER_API_KEY or the OS keychain
  ollama:
    type: ollama              # a local model: no key, nothing leaves your machine for the AI step
    model: qwen3:8b           # as `ollama list` shows it; or: pr-reviewer review <pr> --provider ollama --model qwen3:8b
    # baseUrl: http://127.0.0.1:11434   contextLength: 32768 (largest context window asked of Ollama)
    # A PR too big for the context window is reviewed without related code, then in parts (up to 16),
    # and the findings are merged; the Report says how it was split.
sandbox:
  enabled: true               # false: never run repository tools
  registries: [registry.npmjs.org]
advisories:
  enabled: true               # url: a private OSV mirror
validators:
  disable: []                 # e.g. [framework.angular]
ai:
  toolResults: true           # false: keep compile, lint, audit, and CI results out of the AI prompt
  verify: false               # true: a second AI call checks each finding and drops what it can't confirm
  learn: true                 # false: ignore 👎, /dismiss, and /remember feedback from earlier reviews
  relatedFiles: true          # false: show the AI only the changed files, not their imports, callers, tests
  styleFindings: false        # true: keep the AI's style-only remarks (left out by default; repeats are always folded)
  incremental: true           # false: on later reviews re-check every file, not only those changed since the last review
  effort: adaptive            # light, standard, deep: fix the depth (adaptive: light for docs/small, deep for auth, secrets, CI, migrations)
publish:
  approve:                    # off by default; approves only when every condition holds, else comments
    enabled: false
    maxSeverity: MINOR        # any finding above this blocks approval
    requireLayers: [COMPILE, LINT]   # must have run and passed where they apply (needs the Sandbox)
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
