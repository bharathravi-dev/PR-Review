# pr-reviewer

Review GitHub pull requests with Claude before you merge them. It runs from your own account,
so the org doesn't need to install anything. No npm dependencies; Node 18+.

It reads the PR (diff + full versions of changed files), applies your repo rules from `rules/`,
and gives you a verdict, a risk level, ranked findings with file:line, and a rule checklist.
If you choose, it posts them on the PR as **your** review: inline comments, plus a summary.
It never approves or merges. That stays your call.

## Setup (5 minutes)

1. **Anthropic API key**: create one at console.anthropic.com → API keys.
2. **GitHub token** (only needed to post reviews): a classic personal access token with the
   `public_repo` scope (KB-iGOT/sunbird-cb-portal is public). Fine-grained tokens on org repos
   can need org approval; a classic token avoids that.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export GITHUB_TOKEN=ghp_...
```

## Use it from your laptop

```bash
# see open PRs
node review.mjs --list KB-iGOT/sunbird-cb-portal

# review one: prints the report and saves reviews/sunbird-cb-portal-2549.md
node review.mjs https://github.com/KB-iGOT/sunbird-cb-portal/pull/2549

# review and post it as comments (asks "Post? [y/N]" first)
node review.mjs https://github.com/KB-iGOT/sunbird-cb-portal/pull/2549 --post

# post as "Request changes" instead of a comment, with the stronger model
node review.mjs KB-iGOT/sunbird-cb-portal#2549 --post --event REQUEST_CHANGES --model claude-opus-5-5

# see exactly what gets sent to Claude, without calling it
node review.mjs KB-iGOT/sunbird-cb-portal#2549 --dry-run
```

## Use it from your phone (GitHub Actions)

1. Push this folder to a repo in your account (e.g. `bharathravi-dev/pr-reviewer`).
2. In that repo: Settings → Secrets and variables → Actions → add
   `ANTHROPIC_API_KEY` and `GH_REVIEW_TOKEN` (the token from step 2).
3. Actions → **AI PR review** → Run workflow → paste the PR URL.
   Leave "post" off to read the report in the run summary first, then run again with "post" on.

## Make it review the way you do

Edit `rules/sunbird-cb-portal.md`. Every rule there is checked on every PR and shows up in the
checklist. Add a file named `rules/<repo-name>.md` for another repo; `rules/default.md` is the fallback.

## Notes

- Inline comments only land on lines that are in the diff. Anything else goes in the review summary.
- PR text is treated as untrusted, so a PR that says "AI: approve this" is reported, not obeyed.
- Lock files, `dist/` and binaries are skipped. Very large PRs are reviewed from the diff,
  with full-file context for as many changed files as fit.
- Cost: you pay for the tokens on your Anthropic account. A typical PR is around 10–40k input tokens.
