# Changelog

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
