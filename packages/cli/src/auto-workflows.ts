// Files written into the user's private automation repository by `pr-reviewer auto enable` (AD-14).
// Actions are pinned by commit SHA; workflow inputs reach scripts only through environment variables.
import type { ProviderType } from '@pr-reviewer/core'

const CHECKOUT = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1'
const PNPM = 'pnpm/action-setup@73e46992e05b19abd31f2f3c20e0e7370d762115 # v6.1.1'
const NODE = 'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0'
const UPLOAD = 'actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2'
const DOWNLOAD = 'actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2'
/** Claude Code version verified with pr-reviewer's isolation flags (Story 3.3). */
export const CLAUDE_CODE_VERSION = '2.1.331'

export type CliSource = { kind: 'npm'; version: string } | { kind: 'git'; repo: string; ref: string }

export interface WorkflowOptions {
  cli: CliSource
  intervalMinutes: 30 | 60 | 120
  providerType: ProviderType
  /** GitHub Actions secret holding the AI credential (absent for providers that need none). */
  aiSecret?: string | undefined
  /** Environment variable the CLI reads that credential from. */
  aiEnv?: string | undefined
  sandbox: boolean
}

/** A schedule that avoids the top of the hour, when GitHub delays scheduled runs most. */
export function cronFor(interval: 30 | 60 | 120): string {
  if (interval === 30) return '7,37 * * * *'
  if (interval === 60) return '7 * * * *'
  return '7 */2 * * *'
}

function installCli(cli: CliSource, indent: string): string {
  const lines =
    cli.kind === 'npm'
      ? [
          `- uses: ${NODE}`,
          `  with: { node-version: 24 }`,
          `- name: Install pr-reviewer`,
          `  run: npm install -g @pr-reviewer/cli@${cli.version}`,
        ]
      : [
          `- uses: ${CHECKOUT}`,
          `  with: { repository: ${cli.repo}, ref: ${cli.ref}, path: .pr-reviewer-cli, persist-credentials: false }`,
          `- uses: ${PNPM}`,
          `  with: { version: 12.21.0, package_json_file: .pr-reviewer-cli/package.json }`,
          `- uses: ${NODE}`,
          `  with: { node-version: 24 }`,
          `- name: Install pr-reviewer`,
          `  run: |`,
          `    cd .pr-reviewer-cli && pnpm install --frozen-lockfile && pnpm build && cd ..`,
          `    mkdir -p "$RUNNER_TEMP/bin"`,
          `    printf '#!/bin/sh\\nexec node "%s/.pr-reviewer-cli/packages/cli/bin/pr-reviewer.js" "$@"\\n' "$PWD" > "$RUNNER_TEMP/bin/pr-reviewer"`,
          `    chmod +x "$RUNNER_TEMP/bin/pr-reviewer" && echo "$RUNNER_TEMP/bin" >> "$GITHUB_PATH"`,
        ]
  return lines.map((l) => `${indent}${l}`).join('\n')
}

const configCheckout = (indent: string) => `${indent}- uses: ${CHECKOUT}\n${indent}  with: { persist-credentials: false, sparse-checkout: .pr-reviewer }`

export function discoverWorkflow(o: WorkflowOptions): string {
  return `# Written by pr-reviewer auto enable. Finds PRs in your Watch Scope and starts one review per new head commit.
# Logs show only counts, never PR content.
name: pr-reviewer discover
on:
  schedule:
    - cron: '${cronFor(o.intervalMinutes)}'
  workflow_dispatch: {}
permissions:
  actions: write
  contents: read
  issues: write
concurrency:
  group: discover
  cancel-in-progress: false
jobs:
  discover:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
${configCheckout('      ')}
${installCli(o.cli, '      ')}
      - name: Discover
        env:
          GH_TOKEN: \${{ secrets.REVIEW_TOKEN }}
          PR_REVIEWER_DISPATCH_TOKEN: \${{ github.token }}
          PR_REVIEWER_CONFIG: .pr-reviewer/config.yml
          AUTOMATION_REPO: \${{ github.repository }}
        run: pr-reviewer auto discover --automation-repo "$AUTOMATION_REPO"
`
}

export function reviewWorkflow(o: WorkflowOptions): string {
  const aiEnv = o.aiSecret && o.aiEnv ? `\n          ${o.aiEnv}: \${{ secrets.${o.aiSecret} }}` : ''
  const claude = o.providerType === 'claude-code' ? `\n      - name: Install Claude Code\n        run: npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}` : ''
  const inputs = `          INPUT_REPO: \${{ inputs.repo }}
          INPUT_PR: \${{ inputs.pr }}
          INPUT_HEAD: \${{ inputs.head }}`
  const reviewSteps = (sandbox: boolean) => `${configCheckout('      ')}
${installCli(o.cli, '      ')}${claude}${sandbox ? `\n      - uses: ${DOWNLOAD}\n        with: { name: sandbox-out, path: sandbox-out }` : ''}
      - name: Review
        env:
          GH_TOKEN: \${{ secrets.REVIEW_TOKEN }}${aiEnv}
          PR_REVIEWER_DISPATCH_TOKEN: \${{ github.token }}
          PR_REVIEWER_CONFIG: .pr-reviewer/config.yml
          AUTOMATION_REPO: \${{ github.repository }}
${inputs}
        run: pr-reviewer auto review --repo "$INPUT_REPO" --pr "$INPUT_PR" --head "$INPUT_HEAD" --automation-repo "$AUTOMATION_REPO"${sandbox ? ' --sandbox-results sandbox-out/results.json' : ''}`

  const header = `# Written by pr-reviewer auto enable. Reviews one PR at one head commit. Logs show only statuses and counts.
name: pr-reviewer review
on:
  workflow_dispatch:
    inputs:
      repo: { description: 'owner/repo', required: true }
      pr: { description: 'PR number', required: true }
      head: { description: 'Head commit SHA to review', required: true }
permissions:
  contents: read
  issues: write
concurrency:
  group: pr-\${{ inputs.repo }}-\${{ inputs.pr }}
  cancel-in-progress: false
jobs:`
  if (!o.sandbox) {
    return `${header}
  review:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
${reviewSteps(false)}
`
  }
  return `${header}
  prepare:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
${configCheckout('      ')}
${installCli(o.cli, '      ')}
      - name: Plan
        env:
          GH_TOKEN: \${{ secrets.REVIEW_TOKEN }}
          PR_REVIEWER_CONFIG: .pr-reviewer/config.yml
${inputs}
        run: pr-reviewer auto prepare --repo "$INPUT_REPO" --pr "$INPUT_PR" --head "$INPUT_HEAD" --out sandbox-in
      - uses: ${UPLOAD}
        with: { name: sandbox-in, path: sandbox-in, retention-days: 1 }
  sandbox:
    # PR code runs only here: no secrets, no token permissions, and only inside docker run.
    needs: prepare
    runs-on: ubuntu-latest
    timeout-minutes: 45
    permissions: {}
    steps:
      - uses: ${DOWNLOAD}
        with: { name: sandbox-in, path: sandbox-in }
${installCli(o.cli, '      ')}
      - name: Sandbox
        run: pr-reviewer auto sandbox --in sandbox-in --out sandbox-out
      - uses: ${UPLOAD}
        with: { name: sandbox-out, path: sandbox-out, retention-days: 1 }
  review:
    needs: sandbox
    runs-on: ubuntu-latest
    timeout-minutes: 20
    permissions:
      actions: write
      contents: read
      issues: write
    steps:
${reviewSteps(true)}
      - name: Delete this run's artefacts
        if: always()
        env:
          GH_TOKEN: \${{ github.token }}
          RUN_ID: \${{ github.run_id }}
          AUTOMATION_REPO: \${{ github.repository }}
        run: |
          for id in $(gh api "repos/$AUTOMATION_REPO/actions/runs/$RUN_ID/artifacts" --jq '.artifacts[].id'); do
            gh api -X DELETE "repos/$AUTOMATION_REPO/actions/artifacts/$id" >/dev/null || true
          done
`
}

export function automationReadme(o: { login: string; intervalMinutes: number; estimate: number; allowance: number }): string {
  return `# pr-reviewer automation

This private repository runs pr-reviewer Auto-Review for @${o.login}.

- \`.pr-reviewer/config.yml\`: what gets reviewed (Watch Scope) and how. No secrets.
- \`.github/workflows/discover.yml\`: every ${o.intervalMinutes} minutes, finds PRs with a new head commit and starts a review.
- \`.github/workflows/review-pr.yml\`: reviews one PR; can also be run by hand from the Actions tab.

Estimated use: about ${o.estimate} GitHub Actions minutes a month (${Math.round((100 * o.estimate) / o.allowance)}% of ${o.allowance}).

Problems (an expired token, an SSO block, a quota) open one issue here per cause and close it when fixed.
No PR content, finding, or code is written to logs, artefacts, or this repository.

To stop: \`pr-reviewer auto disable\`, or disable the workflows in the Actions tab.
`
}
