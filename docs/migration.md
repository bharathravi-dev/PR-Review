# Migrating from `review.mjs`

The single-file `review.mjs` tool has been replaced by the `pr-reviewer` CLI. Everything it did is still
possible; reviews are now layered (context, secret scanning, AI review, with more checks to come), never
posted twice for the same commit, and safe to re-run.

## Commands

| `review.mjs` | `pr-reviewer` |
|---|---|
| `node review.mjs <pr>` | `pr-reviewer review <pr>` |
| `--post` | `--post` (shows a preview and asks; add `--yes` in scripts) |
| `--yes` | `--yes` |
| `--event COMMENT\|REQUEST_CHANGES` | `--event COMMENT\|REQUEST_CHANGES` (REQUEST_CHANGES needs `publish.allowRequestChanges: true` in your config) |
| `--model <id>` | `--model <id>` |
| `--rules <file>` | `reviewRules:` list in your config (file paths or https:// URLs) |
| `--out <dir>` | `--out <dir>` (writes `report.md` and `report.json`) |
| `--dry-run` | `pr-reviewer context <pr> --json` shows what the review reads; run `review` without `--post` to see the result without posting |
| `--list owner/repo` | `pr-reviewer list owner/repo` (also shows which PRs you already reviewed) |

## Rules files

Copy your rules file anywhere and point your user config at it:

```yaml
# ~/.config/pr-reviewer/config.yml
version: 1
reviewRules:
  - ~/review-rules/team.md
  - https://example.com/our-review-rules.md
```

Every top-level list item becomes a rule; the Report lists them under "Review Rules checked". An example
is in [`docs/examples/rules/default.md`](examples/rules/default.md).

## Secrets and environment variables

| Old | New |
|---|---|
| `ANTHROPIC_API_KEY` | `ANTHROPIC_API_KEY` (or the OS keychain) |
| `GITHUB_TOKEN` | `GITHUB_TOKEN`, `GH_TOKEN`, the OS keychain, or your `gh` login |
| Actions secret `GH_REVIEW_TOKEN` | Unchanged; the workflow maps it to `GH_TOKEN` |

## What changed in behaviour

- The overall result comes from the gate, not from the model. AI-only findings never fail a review.
- Re-running on the same commit updates one summary comment instead of adding another review.
- On a new push, only new or changed findings are posted inline; earlier ones are listed as still open or resolved.
- React 👎 or reply `/dismiss` to a finding to stop it being posted again.
- The workflow no longer writes findings to the run summary or uploads them as artifacts.
- Old severities map as `blocker → BLOCKER`, `major → MAJOR`, `minor → MINOR`, `nit → INFO`.
