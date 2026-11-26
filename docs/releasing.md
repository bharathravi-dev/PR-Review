# Releasing

One tag publishes everything. Before the first release:

1. **npm:** create the `pr-reviewer` organisation on npmjs.com (the package is `@pr-reviewer/cli`), create an
   automation token, and add it to the repository as the Actions secret `NPM_TOKEN`.
2. **Container image:** nothing to set up; the workflow pushes to `ghcr.io/<owner>/pr-reviewer` with the
   repository's own token. Make the package public in its settings if others should pull it.
3. **Chrome Web Store:** the release carries the extension zip; upload it in the developer dashboard
   (docs/extension-store.md has the listing and checklist).

Then:

```bash
# bump the version in packages/cli/package.json and packages/extension/public/manifest.json (they must match)
git commit -am "Release 0.2.0"
git tag v0.2.0 && git push && git push --tags
```

The workflow runs `pnpm check`, packs the CLI with `node scripts/package-cli.mjs` (one self-contained package: the
workspace packages are bundled in, third-party libraries stay dependencies), installs and runs the packed CLI as a
smoke test, publishes it with provenance, pushes the image, and creates the GitHub release with the extension zip.

Try the package locally with `pnpm build && pnpm package:cli`, then `cd release/npm && npm install --omit=dev && node
bin/pr-reviewer.js --version`.
