# Changelog

## 0.1.3

### Anti-Hallucination Grounding, Per-File Tests, & Direct SonarQube API
- **Line, hunk & verbatim code quote grounding:** AI findings must match loaded `HEAD` lines or diff hunks (`Evidence Quote` verified within `±3` lines) — preventing fabricated line citations on large `diffOnly` files or invented symbols.
- **Verification pass on `standard` & chunked PRs:** Enables verification automatically on both `standard` and `deep` effort levels, verifies part-scoped findings on chunked PRs, and supports a second-opinion `verifyProvider`.
- **Syntax- & hunk-verified committable suggestions:** Splices every AI `suggestion` against `head.text` in memory and verifies AST/JSON/YAML syntax + single-hunk boundaries before emitting ` ```suggestion ` blocks.
- **Walkthrough prose contradiction guard & exact tool totals:** Cross-checks AI summaries against actual layer execution (`COMPILE`, `TESTS`), active finding counts, and truncated file coverage, and summarizes remaining rule counts past the 60-item `<tool_results>` cap.
- **Per-file unit test mapper (`tests.local`) & Direct SonarQube REST API (`sonar.api`):** Maps changed source files across TS/JS, Java/Kotlin, Python, and Go against repository tests without guessing when `HEAD` tree is unavailable, and imports SonarQube/SonarCloud quality gates & issues directly when `SONAR_HOST_URL` is configured.

### CI/CD Security, Learned Rules, Sandbox Tests, & Benchmark Precision
- **CI/CD & Container Security + Cross-Model Verification (`ci.workflows`, `ai.verifyProvider`):** Deterministic security checks on changed `.github/workflows/*.yml` and `Dockerfile`/`Containerfile` files (zero sandbox needed), plus optional second-opinion `ai.verifyProvider` and `ai.verifyModel` configuration.
- **Learned Rules Export & Per-Rule Analytics (`learnings --propose`, `stats`):** Format `/remember` and `/dismiss` feedback into idempotent rules with `--propose [--write <file>]`, and track addressed/dismissed rates per rule and category (`byRule`, `byCategory`).
- **Opt-In Sandboxed Unit Test Execution (`tests.sandbox`, `tests.go`):** Run project test suites inside the locked-down container via `validators.enable` (`tests.sandbox`, `tests.go`), parsing failing test files/lines into `TESTS` findings.
- **Benchmark Anti-Hallucination & Precision Reporting (`pr-reviewer bench`):** Track `groundedDropsTotal` / `verificationDropsTotal` and false-positive rate in `bench` and `scripts/bench-report.mjs`, with offline hallucination-trap regression tests.

## 0.1.2

### Multi-Language Compile, Lint, & Pre-Push Workflows
- **Java / Kotlin (`java.compile`):** Maven (`mvn -B -ntp -o test-compile`) and Gradle wrapper compile checks inside the `java` sandbox runtime, mapping errors back to changed PR lines.
- **Python (`python.lint`):** Pinned Ruff (`0.8.6`) syntax & lint diagnostics inside the `python` sandbox runtime.
- **Go (`go.vet`):** `go mod download` + `go vet ./...` inside the `go` sandbox runtime.
- **Git pre-push hook (`pr-reviewer hook`):** `install`, `uninstall`, and `status` commands running `pr-reviewer review --local` before pushing.
- **Direct Local Fix Application:** Apply line-anchored suggestions from Recommended Fix Bundle safely to the working tree (`[a]` in `--local` interactive mode) with diff preview and path-traversal protection (never auto-commits).

### Interactive Terminal UX, RAG Grounding, & Sandbox Fallback
- **Animated 7-stage CLI progress spinner:** Live TTY spinner with elapsed seconds, multi-part AI progress (`part X/Y`), and retrieved AI RAG context summary.
- **Interactive post-review menu:** `[p]` Post to GitHub, `[v]` Step-by-step finding selection, `[f]` View/save Recommended Fix Bundle (`fix-bundle.md`), `[o]` Seed & open local browser UI directly on the completed review.
- **Permission-gated Sandbox-to-Local fallback:** Uses Docker/Podman whenever available; prompts `[y/N]` in TTY before running host tools (or `--allow-local-tools` / `--no-local-tools` / `sandbox.localFallback`).
- **Clear file coverage & monorepo detection:** Explicit `Files checked:` and `AI RAG bundle:` headers, workspace root inheritance for Angular/TypeScript/`tsconfig.lib.json`, and polyglot subproject detection.

## 0.1.1
- Added in-process local validators (`syntax.local`, `standards.local`), expanded multi-language OWASP rules, `<language_standards>` RAG context, and OSV dependency CVE auditing across Maven (`pom.xml`), PyPI (`requirements*.txt`), and Go (`go.mod`).

## 0.1.0
- Initial public npm release of `@pr-reviewer/cli`.
