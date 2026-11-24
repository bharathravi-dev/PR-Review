# Review rules: sunbird-cb-portal (iGOT Karmayogi portal)

Angular app (standalone components, signals, `@if`/`@for` control flow), RxJS, lodash, ngx-translate,
Jest specs, tslint. Edit this file to match how the team works; the reviewer applies it to every PR.

## Release hygiene
- PR title starts with a Jira key (`KB-12345 - …`).
- Base branch is the current release branch (`cbrelease-x.y.z`), not `main`/`master`, unless the PR says why.
- `@sunbird-cb/*` versions in `package.json` carry the same release suffix as the base branch
  (e.g. `-cbrelease-4.8.42` on `cbrelease-4.8.42`). Flag a bump to another release, a `^`/`~` range on these
  packages, or a version going backwards.
- No changes to `dist/`, built bundles or environment files with real URLs/keys.
- No unrelated changes mixed in (formatting churn, files outside the ticket's scope). Flag them so they can be split.

## Angular / RxJS
- Every `subscribe` in a component ends with `takeUntilDestroyed(this.destroyRef)`, `takeUntil(this.unsubscribe)`,
  `take(1)`, or is stored and unsubscribed in `ngOnDestroy`. Flag leaks.
- No nested `subscribe` inside `subscribe`; use `switchMap`/`mergeMap`/`forkJoin`. With `mergeMap`, check that
  out-of-order responses can't overwrite newer data (prefer `switchMap` for "latest wins").
- HTTP calls live in services, with the URL in the file's `API_END_POINTS` constant, not inline in components.
- Each new HTTP call has an error path (`catchError` with a sensible fallback, or a user-visible error state).
  A silent fallback that hides a real failure from the user should be called out.
- New operators/types are imported (`map`, `mergeMap`, `catchError`, `Observable`, `of`, …).
- Signals: `computed` must not have side effects; don't mutate arrays/objects held in a signal, set a new value.
- Avoid mutating objects that came from an API response or a shared service when other components read them.
- Prefer optional chaining or `_.get` over long `a && a.b && a.b.c` chains in new code.
- No `any` where the shape is known and an interface exists or is easy to add.
- No `console.log`, `debugger`, commented-out code, or `TODO` without a ticket.

## Templates, i18n, accessibility
- User-facing text goes through ngx-translate (`| translate` or `translate.instant`) with keys added to every
  locale file under `locale/`/`src/assets/i18n`. Flag hardcoded English labels, headings and messages,
  including strings built in TypeScript (filter headings, toasts, dialogs).
- Interactive elements are buttons/links (not clickable `div`s), have accessible names, and images have `alt`.
- Moving or reordering template blocks is intentional and matches the design; flag layout changes not explained in the PR.

## Tests
- New service methods and new component logic have Jest specs, including the error/empty path.
- Specs assert behaviour, not just that a function was called. Mocks match the real response shape.
- Removed or loosened assertions are justified.

## Security & data
- No secrets, tokens or internal hostnames in code.
- User IDs and other PII aren't logged or put into telemetry beyond what existing events already send.
- No `innerHTML`/`bypassSecurityTrust*` with data from an API without sanitising.
- Calls scoped to "the current user" take the user ID from `ConfigurationsService.userProfile`, not from the URL.

## Performance
- No extra API call per list item (N+1); batch IDs into one request.
- Large lists use `trackBy`/`track` and don't recompute heavy work on every change detection.
