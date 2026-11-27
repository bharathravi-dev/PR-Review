# `pr-reviewer` — Setup & Usage Guide

End-to-end guide to installing `@pr-reviewer/cli`, connecting GitHub and your Cloud / Pro AI account, running reviews from the terminal, posting to GitHub PRs, and using interactive PR comment commands.

---

## 1. Prerequisites

- **Node.js 22 or later** (`node -v`)
- **GitHub account access** (via GitHub CLI `gh` or a GitHub Personal Access Token)
- **Cloud / Pro AI access** — any one of:
  - **Claude Pro / Max account** (via **Claude Code** CLI)
  - **ChatGPT Plus / Pro account** (via **Codex** CLI)
  - **Local Ollama** (`--provider ollama --model <model>`) — zero cloud cost, keeps code local
  - **Cloud API key** (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, OpenRouter, or any OpenAI-compatible endpoint)
- **Optional (for sandboxed compile & lint checks):** **Docker** or **Podman** running on your machine so `tsc` and ESLint/TSLint run safely in an isolated container for JS/TS PRs. If no container runtime is found in an interactive terminal, the CLI runs safe in-process local checks automatically and asks your permission (`[y/N]`) before falling back to local host tools.

---

## 2. Install the Package

Install the CLI globally from npm:

```bash
npm install -g @pr-reviewer/cli
```

Verify the installation:

```bash
pr-reviewer --version
```

*(Alternatively, you can run any command without installing globally via `npx @pr-reviewer/cli <command>`.)*

---

## 3. Connect GitHub

Choose either method below:

### Option A: GitHub CLI (Recommended)

```bash
gh auth login
```

Follow the interactive prompts (HTTPS, browser login). Confirm you are signed in:

```bash
gh auth status
```

### Option B: Environment Variable Token

Export a GitHub Personal Access Token in your shell profile (`~/.zshrc` or `~/.bashrc`):

```bash
export GITHUB_TOKEN=ghp_your_token_here
# or GH_TOKEN
```

> **Permissions needed:**
> - Reading public PRs works even without write scopes.
> - Posting reviews, inline comments, and answering `@pr-reviewer` comments requires **Pull requests (Read & Write)** and **Contents (Read)** (or `repo` scope on a classic token).

*(GitLab, Bitbucket, and Azure DevOps are also supported via `GITLAB_TOKEN`, `BITBUCKET_TOKEN`, or `AZURE_DEVOPS_TOKEN`.)*

---

## 4. Connect Your Pro Account / Cloud AI

`pr-reviewer` works directly with your **Pro subscription** (no separate API billing needed) or with a cloud API key.

### Option A: Claude Pro / Max Account (Claude Code)

1. Install **Claude Code** (`claude`).
2. Run `claude` once in your terminal and complete the browser sign-in with your Claude Pro/Max account.

*(If you already use Claude Code inside VS Code, Cursor, or Windsurf, `pr-reviewer` automatically finds that installation too.)*

### Option B: ChatGPT Plus / Pro Account (Codex CLI)

1. Install the **Codex CLI** (`codex`).
2. Run `codex login` and sign in with your ChatGPT account.

### Option C: Cloud API Key (Optional or Fallback)

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
# and/or
export OPENAI_API_KEY="sk-..."
```

> **How Pro subscription accounts are kept safe:** When `pr-reviewer` invokes `claude-code` or `codex`, it runs inside an empty temporary folder with no shell/file tools, no MCP servers, no custom hooks, and no access to your GitHub or API keys. Secrets in the PR are redacted before any AI call, and the PR is sent strictly as text.

---

## 5. Run First-Time Setup (`init`)

Run the setup wizard once:

```bash
pr-reviewer init
```

What `init` does:
1. Verifies your GitHub login (`✓ GitHub: signed in as @<username>`).
2. Auto-detects your installed Pro subscriptions (`claude-code`, `codex`) first, then any API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`).
3. Sends a tiny structured-output test request to confirm each provider works.
4. Lets you pick your primary default provider and sets the others as automatic fallbacks.
5. Writes your config file (check its location anytime with `pr-reviewer config path`, typically `~/.config/pr-reviewer/config.yml`).

Useful `init` flags:
- `pr-reviewer init --yes` — non-interactive; accepts the first working provider (subscriptions prioritized over API keys).
- `pr-reviewer init --force` — overwrites an existing config (saves a backup as `config.yml.bak`).
- `pr-reviewer init --skip-test` — skips the live test call during setup.

To inspect your active config at any time:

```bash
pr-reviewer config show
```

---

## 6. How to Run Reviews & CLI Commands

### A. Run a PR Review (Dry-Run Preview — Does Not Post)

```bash
pr-reviewer review https://github.com/<owner>/<repo>/pull/<number>
# or shorthand:
pr-reviewer review <owner>/<repo>#<number>
```

#### What happens and what the output looks like

1. **Live 7-stage progress & deterministic checks run first** (with an animated TTY spinner showing each stage, elapsed time, and retrieved AI RAG context):
   - `CONTEXT` (`github.context`) — fetches PR diff, metadata, linked Jira/Linear tickets, and repo rules (`REVIEW.md`, `AGENTS.md`, `CLAUDE.md`, `.github/pr-reviewer.yml`, etc.) from the base branch.
   - `EXTERNAL_RESULTS` (`ci.results`) — reads CI check statuses attached to the PR head commit.
   - `FRAMEWORK` (`framework.angular` / `framework.react`) — framework-specific checks when applicable.
   - `SYNTAX` (`syntax.local`) — in-process syntax checks (zero Docker) for TS/JS, JSON/JSONC, YAML, and `.properties` duplicate keys.
   - `STATIC_ANALYSIS` (`standards.local`) — in-process local code standards & bug patterns (zero Docker) for TS/JS, Java/Kotlin, Python, and Go.
   - `DEPENDENCIES` (`deps.audit`) — checks added/upgraded dependencies against OSV vulnerabilities (npm, Maven `pom.xml`, PyPI `requirements*.txt`, Go `go.mod`).
   - `COMPILE` (`ts.tsc`) & `LINT` (`lint.eslint` / `lint.tslint`) — runs inside Docker/Podman if JS/TS is touched and a container runtime is available; if no container runtime is found, the CLI asks `[y/N]` before falling back to host execution (or skips if declined / `--no-local-tools`).
   - `SECURITY` (`repo.build-config-changes`, `security.patterns`) — flags risky build/CI changes and multi-language OWASP security patterns.
   - `SECRETS` (`secrets.builtin`) — scans added lines and strips secrets before any AI call or output.
   - `AI_REVIEW` (`ai.review`) — runs your configured Pro/cloud/local model grounded with `<language_standards>`, related callers/tests, guidance files, learnings, and deterministic tool evidence.

2. **Markdown Report is printed to stdout**, containing:
   - **Overall status** (`PASSED`, `PASSED_WITH_WARNINGS`, or `FAILED`) and head commit SHA
   - **Coverage & RAG headers** — `Files checked:` (exact full-file vs. diff-only count), `AI RAG bundle:` (standards, callers/tests, guidance, learnings, tickets, tool evidence), and `Review depth:`
   - **Walkthrough** — plain-English summary, main risks, and estimated review effort (`1/5` to `5/5`)
   - **File-by-file change table**
   - **Checks table** (showing `PASSED`, `WARNING`, `FAILED`, `SKIPPED`, or `NOT_APPLICABLE`)
   - **Findings list** — each with severity (`BLOCKER`, `CRITICAL`, `MAJOR`, `MINOR`, `INFO`), category, file & line number, confidence (`HIGH`, `MEDIUM`, `LOW`), impact, recommendation, and optional suggested code fix
   - **Footer** — model used, token counts, and related files shown to the AI

#### Common `review` flags

| Flag | Purpose |
|---|---|
| `--post` | Show a publish preview and ask `[y/N]` before posting to the PR |
| `--yes` | Post immediately without interactive confirmation (requires `--post`) |
| `--event <e>` | `COMMENT` (default) or `REQUEST_CHANGES` (requires `publish.allowRequestChanges: true` in config) |
| `--local` | Review local branch & uncommitted changes before opening a PR (cannot combine with `--post` or `--yes`) |
| `--base <branch>` | Base branch to diff against when using `--local` (defaults to origin's default branch) |
| `--allow-local-tools` | Run repository compile/lint tools locally without prompting if Docker/Podman is unavailable |
| `--no-local-tools` | Never fall back to local host tools when Docker/Podman is unavailable (safe in-process checks still run) |
| `--provider <name>` | Override default AI provider (`claude-code`, `codex`, `anthropic`, `openai`, `ollama`, etc.) |
| `--model <id>` | Override model ID for that provider |
| `--effort <level>` | `adaptive` (default), `light`, `standard`, or `deep` |
| `--full` | Re-check every file instead of incremental review of newly changed commits |
| `--profile <name>` | Use a named config profile |
| `--host <host>` / `--api-url <url>` | Override GitHub Enterprise host or API URL |
| `--out <dir>` | Save `report.md`, `report.json`, and `fix-bundle.md` to `<dir>` |
| `--json` | Print the report as JSON instead of Markdown |
| `--warnings-ok` | Return exit code `0` instead of `1` on `PASSED_WITH_WARNINGS` |

---

### B. Interactive Post-Review Menu & Publishing to GitHub

When you run `pr-reviewer review <pr>` in an interactive terminal without `--post`, an action menu appears right below the report:

- `[p]` **Post review to GitHub** (prints exact preview and confirms `[y/N]`)
- `[v]` **Step through findings** one by one and pick which to post
- `[f]` **View / save Recommended Fix Bundle** (`fix-bundle.md`)
- `[o]` **Open in browser UI** — launches the local review page directly on the finished review
- `[q]` **Quit**

#### Option 1: Directly from the Command Line (`--post`)

```bash
pr-reviewer review https://github.com/<owner>/<repo>/pull/<number> --post
```

1. Runs the review and prints the exact **Publish Preview** (`──── Preview: what will be posted ... ────`).
2. Prompts:
   ```text
   Post this review to <owner>/<repo>#<number>? [y/N]
   ```
3. Enter `y` to publish.

For scripts or CI without a prompt:

```bash
pr-reviewer review <owner>/<repo>#<number> --post --yes
```

#### Option 2: Visual Review Page (`serve`) — Cherry-Pick Findings

If you want to review findings visually and tick/untick individual items (e.g., skipping `LOW` confidence advisory notes) before posting:

```bash
pr-reviewer serve --open
```

- Opens a private local web UI on `127.0.0.1` secured with a one-time URL key.
- Paste the PR link (or browse open PRs), watch checks stream live, select/deselect findings, preview the exact GitHub output, and click **Post**.
- Press `Ctrl+C` in the terminal to stop the server.
- Use `pr-reviewer serve --pair` if connecting the Chrome browser extension to your local CLI/Docker sandbox.

---

### C. Review Before Opening a PR (`review --local`)

Inside your local git repository:

```bash
pr-reviewer review --local
# or specify a base branch:
pr-reviewer review --local --base main
```

Runs the exact same checks, security scans, and AI review against your local changes (committed + uncommitted tracked files) without posting anything anywhere.

---

### D. Pick From Open PRs (`list`)

```bash
pr-reviewer list <owner>/<repo>
```

Shows open PRs (with whether you have already reviewed their latest commit) so you can choose one interactively to review. Supports `--limit <n>` and `--json`.

---

### E. Fix Open Findings Locally (`fix` and `ship`)

1. **`pr-reviewer fix <PR>`** — In a local checkout at the PR's head commit (e.g., after `gh pr checkout <number>`), passes your open posted findings to Claude Code or Codex to apply edits locally. Nothing is committed or pushed automatically; inspect `git diff` yourself.
   - `--only 1,3` — fix only specific numbered findings
   - `--print` — print the prompt instead of running an agent
   - `--agent claude-code|codex` — choose agent explicitly

2. **`pr-reviewer ship <PR>`** — In a clean checkout of the PR branch, loops: review → fix `MAJOR+` findings / failed CI with your coding agent → commit → push → wait for CI (up to `--rounds 3` by default). Never merges and never force-pushes. Add `--post` to post the final review and set a `pr-reviewer/ship` commit status.

---

### F. Other Useful CLI Commands

| Command | What it does |
|---|---|
| `pr-reviewer respond <PR>` | Answers pending `@pr-reviewer ...` commands left as PR comments (supports `--dry-run`) |
| `pr-reviewer stats` | Shows addressed vs. dismissed vs. still-open rates for posted findings (`--repo`, `--since YYYY-MM-DD`, `--json`) |
| `pr-reviewer learnings <owner/repo>` | Lists conventions learned from team feedback (`/remember`, `/dismiss`, 👎) |
| `pr-reviewer context <PR>` | Shows the raw PR context loaded from GitHub (`--json`) |
| `pr-reviewer mcp` | Runs as a read-only stdio MCP server for coding agents (`claude mcp add pr-reviewer -- pr-reviewer mcp`) |
| `pr-reviewer auto enable` | Sets up scheduled GitHub Actions automation in a private `pr-reviewer-automation` repo |
| `pr-reviewer app` | Runs the webhook-driven GitHub App server (see [github-app.md](./github-app.md)) |
| `pr-reviewer web` | Runs the self-hosted team Web App (see [web-app.md](./web-app.md)) |
| `pr-reviewer bench <dataset>` | Measures precision, recall, and F1 against labeled benchmark PRs |

#### CLI Exit Codes

| Code | Meaning |
|---|---|
| `0` | `PASSED` (or `PASSED_WITH_WARNINGS` when `--warnings-ok` is set) |
| `1` | `PASSED_WITH_WARNINGS` |
| `2` | `FAILED` |
| `3` | `INCOMPLETE` |
| `4` | `ERROR` |
| `5` | `CANCELLED` |
| `6` | Publish failed or blocked |
| `64` | Usage / invalid flag error |
| `78` | Configuration error |

---

## 7. PR Comments: What Gets Posted & How to Interact via Comments

### What a Posted Review Looks Like on GitHub

When you post a review (`--post` or via `serve` / `app` / `web`):

1. **Inline Review Comments (on changed lines):**
   - Posted on specific file lines for findings at or above the inline severity floor (`INFO` notes stay in the summary by default).
   - Includes severity, category, problem explanation, impact, and recommendation.
   - Includes a **one-click committable GitHub suggestion** when the exact code replacement is clear.
   - Includes a collapsible **"Prompt for your AI agent"** block you can paste into Claude Code, Codex, or Cursor.
2. **One Summary Comment (updated in place on re-reviews):**
   - Overall status badge, checks run/skipped, Walkthrough, effort score, file summary table, non-inline findings, what was fixed since the last run, what remains open, and token/cost totals.
3. **Smart Thread & Noise Hygiene:**
   - **Never duplicates:** Re-running `--post` on the same commit with the same settings updates the summary without creating duplicate review comments.
   - **Auto-resolves fixed threads:** On incremental re-reviews, threads whose issues were fixed in newer commits are resolved automatically.
   - **Pre-existing issues:** Issues in untouched code are labeled pre-existing and never fail the PR.

---

### Interactive PR Comment Commands (`@pr-reviewer`)

Team members **with push access** to the repository can talk directly to `pr-reviewer` inside PR comments or review comment replies (both `@pr-reviewer <cmd>` and `/pr-reviewer <cmd>` work):

| Comment Command | Where to Post | What It Does & How It Replies |
|---|---|---|
| `@pr-reviewer review` | Main PR conversation | Runs a fresh review of the PR and posts/updates the review comments and summary. Replies with a link to the new review. |
| `@pr-reviewer why [question]` | Reply inside a finding's review thread | Explains *why* that finding matters using the surrounding code in the repository. |
| `@pr-reviewer fix` | Reply inside a finding's review thread | Generates and replies with a **committable GitHub suggestion** block for those lines. |
| `@pr-reviewer ignore [reason]` | Reply inside a finding's review thread | Dismisses that finding so it is not raised again on future commits and records the dismissal for stats/learnings. |
| `@pr-reviewer remember <note>` | PR comment or thread | Saves a repository rule/convention (e.g., `@pr-reviewer remember we use UTC everywhere`) so future PR reviews in this repo follow it. |
| `@pr-reviewer help` | PR comment | Replies with the list of supported `@pr-reviewer` commands. |

#### Shorthand Feedback Replies & Reactions (on any `pr-reviewer` comment)

- **React `👎`** or reply **`/dismiss <reason>`** — marks the finding as dismissed (not useful) so it won't be posted again.
- **Reply `/remember <note>`** — teaches a persistent convention for the repository (active for 180 days, up to 30 learnings).
- **Reply `/forget`** (or remove the `👎` reaction) — undoes the dismissal or remembered note.

---

### How PR Comment Commands Get Executed

PR comment commands are processed in **one of two ways**:

1. **Manually or on a schedule from the CLI (`respond`):**
   ```bash
   # Preview pending @pr-reviewer comments without replying yet:
   pr-reviewer respond https://github.com/<owner>/<repo>/pull/<number> --dry-run

   # Answer all pending @pr-reviewer comments once:
   pr-reviewer respond https://github.com/<owner>/<repo>/pull/<number>
   ```
   Each comment is answered once (tracked via hidden reply markers so commands are never answered twice).
2. **Automatically in real time via the GitHub App:**
   When `pr-reviewer app` is deployed (see [github-app.md](./github-app.md)), GitHub webhooks trigger `pr-reviewer` immediately whenever someone opens/pushes to a PR or comments `@pr-reviewer ...`.

---

## 8. Quick Cheat Sheet (Day-to-Day Workflow)

```bash
# 1. One-time setup
npm install -g @pr-reviewer/cli
gh auth login
pr-reviewer init

# 2. Check your local branch before opening a PR
pr-reviewer review --local

# 3. Review a GitHub PR safely (dry run, terminal report only)
pr-reviewer review owner/repo#123

# 4. Post the review to GitHub (shows preview + asks confirmation)
pr-reviewer review owner/repo#123 --post

# 5. Or visually pick which findings to post in a local browser UI
pr-reviewer serve --open

# 6. Answer any @pr-reviewer comment commands left on the PR
pr-reviewer respond owner/repo#123
```
