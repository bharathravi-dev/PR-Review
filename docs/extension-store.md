# PR Reviewer browser extension: store listing and release

## Build and package

```bash
pnpm build                  # builds packages/extension/build/ (load unpacked from chrome://extensions)
pnpm package:extension      # packages/extension/pr-reviewer-extension-<version>.zip, reproducible
```

The manifest version must equal the engine version (`packages/cli/package.json`); packaging refuses otherwise.
**Sign in with GitHub** (device flow, no token to paste) needs a GitHub OAuth app. Its client ID is public, so it is
committed in `packages/extension/oauth.json` and every build uses it (`PR_REVIEWER_GITHUB_CLIENT_ID` overrides it for a
fork). Without one, the panel offers token sign-in only. To create the app (once, by the project owner):

1. github.com → Settings → Developer settings → OAuth Apps → **New OAuth App** (or under the organisation's settings).
2. Name `PR Reviewer`; Homepage URL: the project's repository; Authorization callback URL: the same URL (device flow
   does not use it, but GitHub requires one).
3. Register, then tick **Enable Device Flow** and save. No client secret is needed; don't create one.
4. Put the **Client ID** in `packages/extension/oauth.json` as `githubClientId`, then `pnpm build`.

Sign-in asks for the `repo` scope (read pull requests, including private ones, and post reviews).

## Listing text

**Name:** PR Reviewer

**Summary (132 characters max):** Review GitHub pull requests from a side panel with your own AI key or your pr-reviewer. Nothing is
posted until you press Post.

**Description:**
PR Reviewer reviews the pull request you are looking at, in Chrome's side panel. It reads the change from GitHub, removes
secrets it finds, asks your own AI provider (Anthropic, OpenAI or a compatible endpoint) for a review, and shows the
findings with links to their lines. You choose which findings to post, preview the exact review, and post it as yourself.
It never approves a pull request and posts nothing on its own. There is no server and no analytics; your GitHub token
and AI key stay in this browser, encrypted.

Already run pr-reviewer? Connect the panel to your team's self-hosted Web App (sign in there and allow the extension),
or pair it with `pr-reviewer serve --pair` on your computer. Reviews then run with that pr-reviewer's settings, your
subscription and full checks (compile, lint, tests), and the extension never holds a GitHub token or AI key.

**Category:** Developer Tools

**Screenshots:** take them from `_bmad-output/planning-artifacts/ux-designs/ux-pr-reviewer-2026-11-26/mockups/`
(Welcome and setup, Run in progress, Report, Post, Review button) or from the built panel.

## Permissions and why

| Permission | Why |
|---|---|
| `sidePanel` | The whole interface is the side panel. |
| `identity` | Opens your team's Web App to sign in and allow the extension (`launchWebAuthFlow`); used only when you connect a Web App. |
| `storage` | Keeps settings (the token and key encrypted) and the last review of recent PRs in this browser. |
| `https://github.com/*` | Reads the active tab's URL to know which PR is shown, places the Review button in the PR header, and runs GitHub's device sign-in. |
| `https://api.github.com/*` | Reads the PR (files, diff, comments) and, only when you press Post, posts your review. |
| `https://api.anthropic.com/*`, `https://api.openai.com/*` | Sends the review request to the AI provider you chose, with your own key. |
| `https://api.osv.dev/*` | Looks up known vulnerabilities in packages the PR adds or upgrades. |
| Optional `https://*/*` | Requested one host at a time, only when you add a GitHub Enterprise host, an OpenAI-compatible endpoint, or your team's Web App. |
| Optional `http://127.0.0.1/*`, `http://localhost/*` | Requested only when you pair with `pr-reviewer serve --pair` on this computer. |

No `tabs` permission: host access to github.com is enough to read GitHub tabs' URLs. No remote code: everything
runs from the package (`script-src 'self'`).

## Privacy policy

Bundled as `privacy.html` and linked from the Welcome screen and Settings; publish the same text at the listing's
privacy-policy URL. Single purpose: reviewing GitHub pull requests.

## Before submitting

- [ ] `pnpm check` passes (includes the bundle checks: Manifest V3, permissions, CSP, no eval or remote code)
- [ ] Load the build unpacked; review a real PR in Standalone mode; post a review to a test PR
- [ ] Pair with `pr-reviewer serve --pair`, review and post (the confirm dialog names the computer); `--unpair` turns it off
- [ ] Connect to a Web App started with `PR_REVIEWER_EXTENSION_IDS=<the store id>`; review and post; revoke at `/auth/extension/tokens`
- [ ] The Review button appears in the PR header on github.com (light and dark) and follows navigation
- [ ] Panel accessibility: no axe violations on Welcome, setup, report, post and Settings (checked 2026-11-26 with
      the panel in Chrome against mocks); a keyboard and screen-reader pass
