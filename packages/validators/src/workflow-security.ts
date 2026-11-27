import type { Finding, Validator } from '@pr-reviewer/core'
import { finding } from './util.js'

const WORKFLOW_FILE = /^\.github\/workflows\/[^/]+\.ya?ml$/i
const CONTAINER_FILE = /(^|\/)(Dockerfile|Containerfile)([^/]*)$/

const PINNED_SHA = /@[a-f0-9]{40}(?:\s|#|$)/i
const MUTABLE_REF = /@(main|master|dev|develop|HEAD)\b/i
const UNTRUSTED_EXPR = /\$\{\{\s*github\.event\.(?:issue|pull_request|comment|review|head_commit|commits|workflow_run)\.[^}]+\}\}/

function scanWorkflow(path: string, text: string): Finding[] {
  const out: Finding[] = []
  const lines = text.split(/\r?\n/)
  const uncommented = lines.filter((l) => !l.trim().startsWith('#')).join('\n')
  const usesPrTarget = /\bpull_request_target\b/.test(uncommented)
  const checksOutPrHead = /actions\/checkout/.test(uncommented) && /github\.event\.pull_request\.head\.(ref|sha)/.test(uncommented)
  if (usesPrTarget && checksOutPrHead) {
    const lineIdx = lines.findIndex((l) => /pull_request_target/.test(l))
    out.push(
      finding({
        ruleId: 'workflow/pull-request-target-checkout',
        category: 'SECURITY',
        severity: 'CRITICAL',
        confidence: 'HIGH',
        title: 'pull_request_target checks out untrusted PR head code',
        description: `${path} triggers on \`pull_request_target\` (with write permissions & repository secrets) while checking out the fork's PR head commit.`,
        recommendation: 'Avoid checking out PR head under `pull_request_target`, or isolate untrusted execution into a read-only `pull_request` workflow.',
        location: { anchorKind: 'LINE', path, startLine: lineIdx >= 0 ? lineIdx + 1 : 1, endLine: lineIdx >= 0 ? lineIdx + 1 : 1 },
        provenance: { validator: 'ci.workflows', tool: 'workflow-audit' },
      }),
    )
  }

  let hasWriteAll = false
  let hasPermissions = false
  let hasJob = false
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    if (/^\s*runs-on\s*:/.test(raw)) hasJob = true
    if (/^\s*permissions\s*:/.test(raw)) {
      hasPermissions = true
      if (/permissions\s*:\s*write-all\b/i.test(raw)) {
        hasWriteAll = true
        out.push(
          finding({
            ruleId: 'workflow/excessive-permissions',
            category: 'SECURITY',
            severity: 'MAJOR',
            confidence: 'HIGH',
            title: 'Workflow grants `permissions: write-all`',
            description: `${path} enables full \`write-all\` GITHUB_TOKEN permissions instead of least-privilege scopes.`,
            recommendation: 'Grant only minimal permissions (e.g. `contents: read`).',
            location: { anchorKind: 'LINE', path, startLine: i + 1, endLine: i + 1 },
            provenance: { validator: 'ci.workflows', tool: 'workflow-audit' },
          }),
        )
      }
    }

    if (UNTRUSTED_EXPR.test(raw) && (/run\s*:/.test(raw) || /^\s+[^#]*(?:echo|curl|node|python|bash|sh|git)\b/.test(raw))) {
      out.push(
        finding({
          ruleId: 'workflow/script-injection',
          category: 'SECURITY',
          severity: 'CRITICAL',
          confidence: 'HIGH',
          title: 'Untrusted GitHub event expression interpolated in shell step',
          description: `${path}:${i + 1} interpolates \`github.event.*\` directly inside a shell script, allowing attacker-controlled PR/issue titles or bodies to inject commands.`,
          recommendation: 'Pass `${{ github.event.* }}` through an intermediate `env:` variable instead of inline `${{ ... }}` expansion.',
          location: { anchorKind: 'LINE', path, startLine: i + 1, endLine: i + 1 },
          provenance: { validator: 'ci.workflows', tool: 'workflow-audit' },
        }),
      )
    }

    const usesMatch = /^\s*(?:-\s*)?uses\s*:\s*([^\s#]+)/.exec(raw)
    if (usesMatch) {
      const ref = usesMatch[1]!
      if (!ref.startsWith('./') && !ref.startsWith('docker://')) {
        const isFirstParty = /^(actions|github)\//.test(ref)
        if ((!isFirstParty && !PINNED_SHA.test(`${ref} `)) || MUTABLE_REF.test(ref)) {
          out.push(
            finding({
              ruleId: 'workflow/unpinned-action',
              category: 'SECURITY',
              severity: 'MINOR',
              confidence: 'HIGH',
              title: `GitHub Action is not pinned to a full commit SHA (${ref})`,
              description: `${path}:${i + 1} references \`${ref}\` via a mutable tag or branch instead of an immutable 40-character SHA.`,
              recommendation: 'Pin third-party and mutable action references to a full 40-char commit SHA with a version comment.',
              location: { anchorKind: 'LINE', path, startLine: i + 1, endLine: i + 1 },
              provenance: { validator: 'ci.workflows', tool: 'workflow-audit' },
            }),
          )
        }
      }
    }
  }

  if (hasJob && !hasPermissions && !hasWriteAll) {
    out.push(
      finding({
        ruleId: 'workflow/missing-permissions',
        category: 'SECURITY',
        severity: 'MINOR',
        confidence: 'MEDIUM',
        title: 'Workflow does not declare explicit `permissions:`',
        description: `${path} relies on repository default ` + '`GITHUB_TOKEN` permissions without narrowing scopes.',
        recommendation: 'Add an explicit top-level `permissions: read-all` or narrow per-job permissions block.',
        location: { anchorKind: 'FILE', path },
        provenance: { validator: 'ci.workflows', tool: 'workflow-audit' },
      }),
    )
  }
  return out
}

function scanContainer(path: string, text: string): Finding[] {
  const out: Finding[] = []
  const lines = text.split(/\r?\n/)
  let hasFrom = false
  let hasUser = false
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const fromMatch = /^FROM\s+(?:--platform=\S+\s+)?(\S+)/i.exec(trimmed)
    if (fromMatch) {
      hasFrom = true
      const img = fromMatch[1]!
      if (img !== 'scratch' && !img.includes('$') && (img.endsWith(':latest') || (!img.includes(':') && !img.includes('@sha256:')))) {
        out.push(
          finding({
            ruleId: 'container/latest-tag',
            category: 'SECURITY',
            severity: 'MINOR',
            confidence: 'HIGH',
            title: `Base image \`${img}\` is unpinned or uses \`:latest\``,
            description: `${path}:${i + 1} uses an unpinned container base tag, reducing build reproducibility and supply-chain safety.`,
            recommendation: 'Pin base images to an explicit version tag and/or immutable `@sha256:` digest.',
            location: { anchorKind: 'LINE', path, startLine: i + 1, endLine: i + 1 },
            provenance: { validator: 'ci.workflows', tool: 'container-audit' },
          }),
        )
      }
    }

    if (/^(?:RUN\s+.*(?:curl|wget)\b[^|]*\|\s*(?:bash|sh)\b|ADD\s+https?:\/\/)/i.test(trimmed)) {
      out.push(
        finding({
          ruleId: 'container/pipe-to-shell',
          category: 'SECURITY',
          severity: 'CRITICAL',
          confidence: 'HIGH',
          title: 'Container downloads unverified remote payload or pipes directly to shell',
          description: `${path}:${i + 1} fetches remote code without checksum verification (\`curl|sh\` or \`ADD http(s)\`).`,
          recommendation: 'Download artifacts with explicit SHA-256 checksum verification instead of piping remote scripts directly to a shell.',
          location: { anchorKind: 'LINE', path, startLine: i + 1, endLine: i + 1 },
          provenance: { validator: 'ci.workflows', tool: 'container-audit' },
        }),
      )
    }

    const userMatch = /^USER\s+(\S+)/i.exec(trimmed)
    if (userMatch) {
      if (/^(0|root)(:|$)/.test(userMatch[1]!)) {
        out.push(
          finding({
            ruleId: 'container/runs-as-root',
            category: 'SECURITY',
            severity: 'MINOR',
            confidence: 'HIGH',
            title: 'Container explicitly runs as root (`USER root` / `0`)',
            description: `${path}:${i + 1} leaves the container running as UID 0.`,
            recommendation: 'Switch to a dedicated non-root user before `CMD` / `ENTRYPOINT`.',
            location: { anchorKind: 'LINE', path, startLine: i + 1, endLine: i + 1 },
            provenance: { validator: 'ci.workflows', tool: 'container-audit' },
          }),
        )
      } else {
        hasUser = true
      }
    }
  }

  if (hasFrom && !hasUser) {
    out.push(
      finding({
        ruleId: 'container/no-nonroot-user',
        category: 'SECURITY',
        severity: 'INFO',
        confidence: 'MEDIUM',
        title: 'Container image has no non-root `USER` instruction',
        description: `${path} does not set a non-root \`USER\`, so processes default to root inside the container.`,
        recommendation: 'Add a non-privileged `USER` before `CMD` / `ENTRYPOINT` unless root is strictly required.',
        location: { anchorKind: 'FILE', path },
        provenance: { validator: 'ci.workflows', tool: 'container-audit' },
      }),
    )
  }
  return out
}

/** Deterministic security checks for GitHub Actions workflows and Dockerfiles (no sandbox required). */
export const workflowSecurityValidator: Validator = {
  id: 'ci.workflows',
  version: '1',
  layers: ['SECURITY'],
  needsSandbox: false,
  baseline: true,
  hermetic: true,
  supports: (ctx) =>
    ctx.pr.files.some((f) => f.status !== 'removed' && (WORKFLOW_FILE.test(f.path) || CONTAINER_FILE.test(f.path)))
      ? { applicable: true }
      : { applicable: false, reason: 'NOT_SUPPORTED', detail: 'No GitHub Actions workflows or container build files changed.' },
  async run(ctx) {
    const findings: Finding[] = []
    let checked = 0
    for (const f of ctx.pr.files) {
      if (f.status === 'removed' || f.head?.text === undefined) continue
      if (WORKFLOW_FILE.test(f.path)) {
        checked++
        findings.push(...scanWorkflow(f.path, f.head.text))
      } else if (CONTAINER_FILE.test(f.path)) {
        checked++
        findings.push(...scanContainer(f.path, f.head.text))
      }
    }
    const criticalOrMajor = findings.some((f) => f.severity === 'CRITICAL' || f.severity === 'MAJOR')
    return {
      layers: [
        {
          layer: 'SECURITY',
          status: criticalOrMajor ? 'FAILED' : findings.length ? 'WARNING' : 'PASSED',
          detail: findings.length ? `${findings.length} CI/container security finding(s) across ${checked} file(s).` : `Workflow/container security checks passed on ${checked} file(s).`,
        },
      ],
      findings,
    }
  },
}
