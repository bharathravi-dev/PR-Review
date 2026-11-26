# Review page v2: parity checklist

The review page has two versions served side by side by `pr-reviewer serve` and the Web App:

- **classic** at `/classic/` (the page that has always been there)
- **v2** at `/v2/` (the redesign in `_bmad-output/planning-artifacts/ux-designs/ux-pr-reviewer-review-page-v2-2026-11-26/`)

`/` opens the server's default: `pr-reviewer serve --ui classic|v2`, or `PR_REVIEWER_DEFAULT_UI=classic|v2` for the Web App.
A browser's own choice ("Try v2" / "Switch to classic") wins and is remembered in that browser.

The default stays **classic** until every item below works in v2, on both `serve` and the Web App (Epic 9 Story 9.9).

| Capability | serve | Web App |
|---|---|---|
| Open the page with serve's one-time key; locked page without it | [ ] | n/a |
| Sign in with GitHub; sign out | n/a | [ ] |
| Identity and AI readiness shown | [ ] | [ ] |
| Start a review from a PR link | [ ] | [ ] |
| List a repository's open PRs with their reviewed state | [ ] | [ ] |
| Progress while the review runs; survives a page reload | [ ] | [ ] |
| Report: status, coverage, gate reasons, projects, checks, limitations, rules checked | [ ] | [ ] |
| Findings: new first, pre-existing grouped and unticked, select, select all / none | [ ] | [ ] |
| Edit a finding's title, description and recommendation before posting | [ ] | [ ] |
| Preview the post; post as Comment or Request changes (when allowed) | [ ] | [ ] |
| Download Markdown and JSON | [ ] | [ ] |
| Stats: how posted findings fared | [ ] | [ ] |
| Settings: provider and model (serve); provider, model, endpoint, API key (Web App) | [ ] | [ ] |
| Past runs of a PR | n/a | [ ] |
| Version shown | [ ] | [ ] |
