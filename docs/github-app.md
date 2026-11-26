# The GitHub App

Install pr-reviewer once on an organisation or account, and every pull request is reviewed when it is opened, marked
ready, or pushed to; people with push access can talk to it with `@pr-reviewer` commands. Reviews post as the App's
bot (for example `pr-reviewer[bot]`). It never approves or merges.

## 1. Create the App

GitHub → Settings (or the organisation's settings) → Developer settings → GitHub Apps → **New GitHub App**.

- **Name:** pr-reviewer (or your own); **Homepage URL:** your repository or site.
- **Webhook URL:** `https://<your server>/webhooks/github`; **Webhook secret:** a random string of 16+ characters
  (`openssl rand -hex 32`).
- **Repository permissions:** Pull requests: **Read and write** (post reviews, reply in threads); Contents: **Read**
  (files at the head commit); Issues: **Read and write** (the summary comment and command replies); Checks: **Read** and
  Commit statuses: **Read and write** (CI results, the merge check); Metadata: **Read** (always).
- **Subscribe to events:** Pull request, Issue comment, Pull request review comment.
- **Where can it be installed:** only this account, unless you mean to share it.

Create it, note the **App ID**, and generate a **private key** (a `.pem` file). Then **Install App** on the
repositories to review.

## 2. Run it

```bash
cat > .env.app <<'ENV'
PR_REVIEWER_APP_ID=123456
PR_REVIEWER_APP_PRIVATE_KEY_FILE=/run/secrets/pr-reviewer-app.pem   # or PR_REVIEWER_APP_PRIVATE_KEY with \n escapes
PR_REVIEWER_WEBHOOK_SECRET=<the webhook secret>
ANTHROPIC_API_KEY=<key>            # the AI provider the reviews use (or OPENAI_API_KEY, or an Ollama provider in config)
# PR_REVIEWER_GITHUB_HOST=github.example.com   # GitHub Enterprise
# PR_REVIEWER_REVIEW_DRAFTS=true               # also review draft PRs
# PR_REVIEWER_CONFIG=/config/config.yml        # provider, rules, effort, limits (see the README's config reference)
ENV
docker compose --profile app up -d          # or: node packages/cli/bin/pr-reviewer.js app --port 3000
```

`GET /healthz` reports the queue. Put the server behind HTTPS (a reverse proxy or your platform's ingress).

## How it behaves

- **Reviews:** one per PR at a time; a burst of pushes becomes one review of the latest head. Later reviews are
  incremental (only files changed since the last review are re-checked by the AI), with adaptive effort.
- **Commands:** `@pr-reviewer review | why | fix | ignore | remember | help`, from people with push access only. Code
  shown to the AI is secret-scanned first, and comment text is data, never instructions.
- **Security:** every delivery's `X-Hub-Signature-256` is checked against the webhook secret; installation tokens
  live for at most an hour and are never logged; the App reads only what its permissions allow.
- **Compile and lint:** the App runs the deterministic checks and the AI review; the Sandbox (Docker) is not used by
  the App server.
