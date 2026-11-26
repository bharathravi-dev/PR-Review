# Review page v2: parity checklist

The review page has two versions served side by side by `pr-reviewer serve` and the Web App:

- **classic** at `/classic/` (the page that has always been there)
- **v2** at `/v2/` (the redesign in `_bmad-output/planning-artifacts/ux-designs/ux-pr-reviewer-review-page-v2-2026-11-26/`)

`/` opens the server's default: `pr-reviewer serve --ui classic|v2`, or `PR_REVIEWER_DEFAULT_UI=classic|v2` for the Web App.
A browser's own choice ("Try v2" / "Switch to classic") wins and is remembered in that browser.

The default stays **classic** until every item below works in v2, on both `serve` and the Web App (Epic 9 Story 9.9).
v2 implements every item; each was checked in a real browser against a mock of `ReviewService v1`. An item is ticked
only after it has been used against a real `serve` or Web App.

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

## Accessibility

**Automated:** `pnpm audit:v2` runs axe-core (WCAG 2.1 A and AA, plus best practice) in headless Chrome on every v2
surface (Start, Overview, Needs attention, Pre-existing, Checks, Walkthrough, Stats, Settings, the post drawer), in
light and dark, at 1440px and 320px, against a mock `ReviewService v1`. It exits non-zero on any violation. Set
`CHROME_PATH` if Chrome is not in the default place. Last run (2026-11-26): no violations.

**By hand** (a keyboard and a screen reader, e.g. VoiceOver or NVDA), before v2 becomes the default:

- [ ] Everything works with the keyboard alone; Tab order is sidebar → list → detail; F6 cycles regions
- [ ] Single-key shortcuts never fire while typing in a field, a select, the palette, or with a dialog open
- [ ] Esc closes the innermost layer first; Esc in the editor never discards unsaved text
- [ ] j / k move between findings and the screen reader reads the shown finding; Enter moves into the detail
- [ ] The palette is announced as a combobox with results; the drawer and shortcuts sheet as dialogs
- [ ] Run progress is announced at layer level, not on every event; the result is announced once
- [ ] Toasts are announced once and never take focus; their actions are reachable elsewhere
- [ ] Diff rows read "added" / "removed" with line numbers; code blocks are reachable and scrollable
- [ ] 320px and 200% zoom: no horizontal page scroll; the detail opens over the list with a working back
- [ ] Windows High Contrast / forced colours: selection, focus and status stay visible
