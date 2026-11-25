# Version / Fact Check — 2026-11-25

Legend: [V] verified on an official/primary page · [U] unverified, third-party, or inferred.

1. **Node.js**
   - Active LTS: **v26 "Lithium"** (Active LTS 2026-10-28, EOL **2029-04-30**). [V]
   - Maintenance LTS: **v24 "Krypton"** (EOL **2028-04-30**) and **v22 "Jod"** (EOL **2027-04-30**). v20 reached EOL 2026-03-24. [V]
   - No "Current" line right now: v25 hit EOL 2026-03-31; **v27 is in Alpha** (Current from 2027-04-22). From v27 on, there is one major a year and every line becomes LTS. [V]
   - Src: https://github.com/nodejs/Release · https://nodejs.org/en/about/previous-releases
2. **TypeScript**
   - Latest stable: **7.0.2** (7.1 Beta out 2026-10-20). [V] https://github.com/microsoft/TypeScript/releases
   - **TS 7 (Go-native compiler) has been released, not a preview:** announced 2026-07-08 and shipped as the `typescript` package with the `tsc` binary. **It has no programmatic API until 7.1** (use `@typescript/typescript6` for API consumers). It removes `baseUrl`, `moduleResolution: node/node10/classic` and `target: es5`. [V] https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
   - Node apps: `"module": "nodenext"` + `verbatimModuleSyntax`. Libraries: the handbook uses `"module": "node18"` (strictest), or `esnext` + `bundler` if the library is bundled. [V] https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options.html. `node20` is equivalent, but the handbook does not mention it. [U]
3. **Package managers**
   - pnpm: **12.x** is stable (a Rust rewrite; 12.21.0 was the newest seen), but npm `latest` still points to 11.x, so install it with the `latest-12` tag. Workspaces use `pnpm-workspace.yaml`, and v12 now flags unknown keys. [V] https://pnpm.io/blog/releases/12.0 (the 12.21.0 number comes from search only [U])
   - npm workspaces are still supported and fine for monorepos. [V] https://docs.npmjs.com/cli/v11/using-npm/workspaces (the docs label v11 "Legacy", so a newer npm major likely exists [U])
4. **Test / schema**
   - Vitest: latest major is **5** (5.0 on 2026-09-03, 5.1 on 2026-11-02). [V] https://vitest.dev/blog/. Third-party sources say 5.x requires Node ≥22.12 and Vite ≥6.4. [U]
   - Zod: latest major is **4** (the page mentions 4.6). It has native **`z.toJSONSchema(schema, opts)`** with targets draft-2020-12 (default), draft-07, draft-04 and openapi-3.0. [V] https://zod.dev/json-schema
5. **Claude Code `claude -p`** — https://code.claude.com/docs/en/cli-reference [V]
   - (a) No tools: `--tools ""` removes every built-in tool. MCP tools are not affected, so also pass `--disallowedTools "mcp__*"` (or `--strict-mcp-config` with no `--mcp-config`). `--disallowedTools "*"` also removes every tool.
   - (b) Isolation: `--bare` skips discovery of hooks, skills, commands, subagents, plugins, MCP servers, auto memory and **CLAUDE.md**. `--setting-sources user` (or another list from `user,project,local`) limits which settings files load. `--strict-mcp-config` ignores `.mcp.json` and `~/.claude.json` MCP servers. `--disable-slash-commands` turns off skills and commands. `--restricted` (v2.1.248+) loads only managed settings plus `--settings` and confines file tools to the working directories. `--safe-mode` disables all customizations. `--no-session-persistence` keeps the session off disk.
   - (c) Output: `--output-format text|json|stream-json`, and `--json-schema '<schema>'` returns validated JSON (print mode only).
   - (d) Model: `--model <alias|full-name>`, e.g. `sonnet`, `opus`, `haiku`, `fable`, or `claude-sonnet-5`. Related limits: `--max-turns`, `--max-budget-usd`.
6. **OpenAI Codex `codex exec`** — https://learn.chatgpt.com/docs/developer-commands?surface=cli · https://learn.chatgpt.com/docs/config-file/config-reference [V]
   - `--json` (JSONL events), `--output-schema <path>`, `-o/--output-last-message <path>`
   - `-s/--sandbox read-only|workspace-write|danger-full-access`, `--skip-git-repo-check`, `--ephemeral`, `-m/--model`, `-C/--cd`, `-c key=value`, `--profile`
   - Disable the shell: `--disable shell_tool` (= `-c features.shell_tool=false`; the `shell_tool` feature is "on by default").
   - Config isolation: `--ignore-user-config` skips `$CODEX_HOME/config.toml`, and `--ignore-rules` skips the `.rules` files. Project `.codex/` config, hooks and rules load **only for trusted projects** (`projects.<path>.trust_level`).
   - **No documented switch to skip project AGENTS.md.** The `project_doc_max_bytes` setting caps how much of it is read (default 32 KiB); `-c project_doc_max_bytes=0` may suppress it, but this is untested. [U] A separate `CODEX_HOME` or a clean working directory is the safe option.
7. **GitHub**
   - (a) **Yes.** Leaving out `event` creates a PENDING review ("To create a pending review … leave the event parameter blank"). [V] https://docs.github.com/en/rest/pulls/reviews. It is visible only to its author ("pending and only visible to you"). [V] https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/reviewing-proposed-changes-in-a-pull-request
   - (b) **Yes.** The Read role can "Submit reviews on pull requests". [V] https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization. Any signed-in user can comment on or review a public repo's PRs unless the repo is locked, has interaction limits, or has blocked that user. Read reviews cannot count toward required approvals. This comes from general knowledge, not the doc. [U]
   - (c) `PUT /repos/{o}/{r}/pulls/{n}/reviews/{id}` updates the review summary `body`. The doc does not limit it to pending reviews, and in practice it works on submitted ones too. [V endpoint / U for submitted]
   - (d) GitHub Free now includes **$12 USD/month of compute**, not a minutes figure (≈2,000 Linux 2-core minutes at $0.006/min, which is a calculation). [V] https://docs.github.com/en/get-started/learning-about-github/githubs-plans. Each job is rounded **up to the whole minute**. [V] https://docs.github.com/en/billing/reference/actions-runner-pricing. Standard runners are free for public repos.
   - (d') The 60-day disable rule applies **only to public repositories** ("In a public repository, scheduled workflows are automatically disabled when no repository activity has occurred in 60 days"). [V]
   - (e) The minimum `schedule` interval is **every 5 minutes**. Schedules run only from the default branch and can be delayed under load, especially at the top of the hour. [V] https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
8. **Chrome MV3**
   - The Side Panel API is stable since **Chrome 114** (MV3+, `"sidePanel"` permission). [V] https://developer.chrome.com/docs/extensions/reference/api/sidePanel
   - The service worker can `fetch()` any cross-origin HTTPS API covered by `host_permissions`. Content scripts are still bound by the same-origin policy. [V] https://developer.chrome.com/docs/extensions/develop/concepts/network-requests
   - CSP limits: `'unsafe-eval'` and remote code are not allowed. **`'wasm-unsafe-eval'` is allowed** and covers service workers, so WASM works if you add it to CSP. Libraries that use `eval`/`new Function` fail; run them in a sandboxed page instead. [V] https://developer.chrome.com/docs/extensions/develop/migrate/improve-security
   - The service worker stops after 30 s idle, after a single request runs over 5 min, or when a fetch response takes over 30 s. [V] https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
9. **Containers**
   - `docker run --network none` is still current; the container gets loopback only. [V] https://docs.docker.com/engine/network/drivers/none/
   - Podman's `--network none` works the same way, and it runs rootless by default (pasta networking). On macOS it runs through `podman machine` (a VM). It offers a Docker-compatible CLI. [V] https://docs.podman.io/en/latest/markdown/podman-run.1.html
