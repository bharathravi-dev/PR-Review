# Default review rules

Used for any repository without its own `rules/<repo>.md`.

- Correctness first: logic errors, unhandled null/empty/error cases, off-by-one, race conditions.
- Security: injection, secrets in code, unsafe HTML, missing auth checks, untrusted input reaching sensitive calls.
- Every new code path that can fail has error handling and, where it matters, a test.
- Public API, schema or config changes are backward compatible or called out in the PR description.
- No debug leftovers (`console.log`, `print`, commented-out code), no unrelated changes mixed in.
- Dependency changes are intentional, pinned the way the repo pins them, and not downgraded by accident.
- Names say what things do; complex logic has a short comment explaining why.
