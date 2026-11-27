# Release & Launch Runbook (`v0.1.2`)

Everything in `release/v0.1.2-prep` is verified, version-aligned (`0.1.2` across `@pr-reviewer/cli` and `packages/extension/public/manifest.json`), and ready to push and release.

---

## 1. Push the Feature Branches & Merge to `main`

```bash
# Push each branch to origin
git push -u origin feat/interactive-cli-rag-validation
git push -u origin feat/polyglot-validators-hooks
git push -u origin release/v0.1.2-prep
```

Merge (via PR or fast-forward) `release/v0.1.2-prep` into `main` once reviewed.

---

## 2. Configure GitHub Actions Secrets (One-Time Setup)

1. Go to [npmjs.com](https://www.npmjs.com/) → **Access Tokens** → generate an **Automation** (bypass-2FA) token with publish access to the `pr-reviewer` org.
2. Add it to GitHub Repository → **Settings → Secrets and variables → Actions** as **`NPM_TOKEN`**.

---

## 3. Tag & Trigger Automated Release (`v0.1.2`)

```bash
git checkout main
git pull
git tag v0.1.2
git push origin v0.1.2
```

`.github/workflows/release.yml` automatically:
1. Runs `pnpm check` (`lint` + `build` + full test suite).
2. Packs `@pr-reviewer/cli@0.1.2`, smoke-tests it, and publishes to npm with provenance.
3. Builds & pushes `ghcr.io/<owner>/pr-reviewer:v0.1.2` and `:latest`.
4. Builds `packages/extension/pr-reviewer-extension-0.1.2.zip` and attaches it to the GitHub Release.

**After the workflow completes:**
- Go to your GitHub Package (`ghcr.io/<owner>/pr-reviewer`) → **Package settings** → set visibility to **Public** so `docker pull ghcr.io/<owner>/pr-reviewer` works for everyone.

*(Or publish npm manually right away from a clean build: `pnpm build && pnpm package:cli && cd release/npm && npm publish --access public`.)*

---

## 4. Register & Deploy the GitHub App (Automatic Team Reviews)

Follow [github-app.md](./github-app.md):
1. Create the GitHub App with webhook `/webhooks/github`, secret (`openssl rand -hex 32`), and permissions (`Pull requests: R/W`, `Contents: R`, `Issues: R/W`, `Checks: R`, `Commit statuses: R/W`).
2. Subscribe to `Pull request`, `Issue comment`, and `Pull request review comment`.
3. Deploy via `docker compose --profile app up -d` behind HTTPS.

---

## 5. Run & Publish the 50-PR Benchmark

Follow [benchmarks.md](./benchmarks.md):

```bash
node scripts/bench-import-golden.mjs --out bench/data/golden-50.json
pr-reviewer bench bench/data/golden-50.json --judge openai --concurrency 2 --out bench/results/v0.1.2.json
node scripts/bench-report.mjs bench/results/v0.1.2.json
```

Update the table in [benchmarks.md](./benchmarks.md) with the verified precision, recall, and F1 numbers.
