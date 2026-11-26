# Self-hosting the PR Reviewer Web App

The Web App gives a team the review page in a browser: sign in with GitHub, paste a PR link, watch the
review, read the report, edit and choose findings, post them, and look back at earlier runs of the same PR.
It runs the same review engine and the same `ReviewService v1` API as `pr-reviewer serve`.

## 1. Create a GitHub OAuth app

GitHub → Settings → Developer settings → OAuth Apps → New OAuth App (for an organisation: the org's
settings). Set:

- **Homepage URL:** the address people will open, e.g. `https://reviews.example.com`
- **Authorization callback URL:** that address plus `/auth/callback`

Copy the client ID and generate a client secret.

## 2. Configure

Create `.env` next to `compose.yaml` (it is git-ignored):

```dotenv
PR_REVIEWER_PUBLIC_URL=https://reviews.example.com
PR_REVIEWER_GITHUB_CLIENT_ID=...
PR_REVIEWER_GITHUB_CLIENT_SECRET=...
# At least 32 random characters; encrypts stored tokens and keys. Keep it safe: losing it means users re-enter keys.
PR_REVIEWER_WEB_SECRET=...
# Who may sign in (at least one of these):
PR_REVIEWER_ALLOW_USERS=alice,bob
PR_REVIEWER_ALLOW_ORGS=my-org
# Optional:
# PR_REVIEWER_GITHUB_HOST=github.example.com         # GitHub Enterprise Server
# PR_REVIEWER_OAUTH_SCOPE=public_repo               # public repositories only (default: repo)
# PR_REVIEWER_ALLOWED_ENDPOINTS=https://llm.internal.example/v1   # extra OpenAI-compatible endpoints users may pick
# PR_REVIEWER_DEFAULT_UI=v2                         # which review page / opens: classic (default) or v2
# PR_REVIEWER_EXTENSION_IDS=<32-letter id>           # browser extensions allowed to connect (comma-separated)
```

Generate a secret with `openssl rand -base64 48`.

## 3. Run

```bash
docker compose up -d
```

Put it behind your usual HTTPS reverse proxy; the app sets secure cookies and HSTS when the public URL is
`https://`. Data (users, encrypted keys, sessions, run history) lives in the `pr-reviewer-data` volume.
Without Docker: `PR_REVIEWER_...=... node packages/cli/bin/pr-reviewer.js web --port 8080`.

## How it keeps people and keys apart

- Only people on the allow-list can sign in; everyone else is refused before a session exists. Org
  membership needs the `read:org` scope, which is requested only when `PR_REVIEWER_ALLOW_ORGS` is set.
- Each user reviews with **their own** GitHub sign-in and **their own** AI key, entered in the page's
  settings. Keys and tokens are encrypted at rest (AES-256-GCM) and never sent back to the browser.
- A user's runs and history are visible only to them. The server's own environment variables, keychain, and
  `gh` login are never used for anyone's review.
- Users can point an OpenAI-compatible provider only at OpenAI or endpoints you list, so the server cannot
  be used to reach internal addresses.
- Subscription logins (Claude Code, Codex) are not available in the Web App; they belong to a person's own
  machine.
- Changes come only from the app's own origin (CSRF), on the configured host only (DNS rebinding), with a
  strict Content Security Policy.

## Compile and lint

Off by default: the container has no access to a container runtime. Repository tools run only in a
Sandbox container; to enable them, give the app access to Docker (for example by mounting the Docker
socket) and set `PR_REVIEWER_SANDBOX=on`. That access is powerful: only do it on a host dedicated to this.
Reports always say when compile and lint did not run.

## Browser extension

Set `PR_REVIEWER_EXTENSION_IDS` to the ids of the pr-reviewer extensions your team may connect
(the id is shown on `chrome://extensions`). When a user picks **Web App** in the extension, it opens
`/auth/extension`; after they confirm, the extension receives a token that lasts 90 days. The token
works only for `/v1` requests that come from that extension's own origin. Users can see and revoke
their extension tokens at `/auth/extension/tokens`. No CORS headers are added for other sites.
