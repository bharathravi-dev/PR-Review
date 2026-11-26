# Brand: BR.dev

pr-reviewer is built by **BR.dev** (Bharath Ravi, [bharathravi.dev](https://bharathravi.dev/)). Its interfaces (the review
page, classic and v2; the browser extension's panel; the Web App's pages; the extension icon) use the BR.dev brand.

## Tokens

The same values are defined in `packages/cli/static/app.css`, `packages/cli/static/v2/app.css` and
`packages/extension/src/panel.css`; a test keeps them in sync.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--accent` | #FF7B02 | #FF7B02 | Primary buttons and other fills, the BR mark |
| `--accent-hover` | #E66A00 | #E66A00 | Primary button hover |
| `--accent-text` | #111827 | #090A1A | Text on orange (6.8:1 and 7.6:1) |
| `--accent-soft` | #FFF3E8 | orange 16% on #090A1A | Selected rows, soft highlights |
| `--accent-line` | #E66A00 | #FF7B02 | Selected borders and indicators (3:1 or more) |
| `--link` | #075DC5 (Royal Blue) | #FF7B02 | Links and accent text |
| `--focus` | #E66A00 | #FF7B02 | Focus rings |
| `--bg` / `--surface` | #F8F9FB / #FFFFFF | #090A1A / white 5% on #090A1A | Page and cards |
| `--text` / `--muted` | #111827 / #6B7280 | white 92% / 66% on #090A1A | Text |
| `--border` | #E5E7EB | white 14% on #090A1A | Dividers |
| `--ok` / `--bad` (dark) | — | #28A08C (Teal) / #FF4C3C (Coral) | Status on dark |

Orange on white is 2.6:1, too low for text, so on light backgrounds orange is used for fills (with #111827 text),
focus and marks, and links are Royal Blue. Status colours on light keep their accessible values. Dark surfaces are
mixes of white and #090A1A, so no new colours are introduced.

## Type

Inter (variable, SIL Open Font License, bundled in `fonts/` so nothing is loaded from other sites): headings 700,
subheadings and buttons 600, labels 500, body 400.

## Mark

The product's own mark is **PR**, drawn the way the BR.dev monogram is: orange letters on #090A1A in a rounded square
(the extension icon and the mark beside "PR Reviewer"). BR is Bharath Ravi's personal mark and is not used as the
product logo. The credit reads
"Built by BR.dev" with **BR** in orange and **.dev** in the text colour, linking to bharathravi.dev. Never VR.dev or
any other spelling. No gradients, glassmorphism or neon.
