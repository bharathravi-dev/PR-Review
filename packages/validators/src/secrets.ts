import { parsePatch, Secret, type Finding, type LayerResult, type PrContext, type SecretScanOutcome } from '@pr-reviewer/core'

interface Rule {
  id: string
  title: string
  pattern: RegExp
  confidence: Finding['confidence']
  /** Capture group holding the secret value (0 = whole match). */
  group?: number
}

/** Built-in secret rules. Patterns are anchored on well-known token shapes to keep false positives low. */
export const SECRET_RULES: readonly Rule[] = [
  { id: 'aws-access-key-id', title: 'AWS access key ID', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, confidence: 'HIGH' },
  { id: 'github-token', title: 'GitHub token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{60,255})\b/g, confidence: 'HIGH' },
  { id: 'anthropic-api-key', title: 'Anthropic API key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, confidence: 'HIGH' },
  { id: 'openai-api-key', title: 'OpenAI API key', pattern: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}\b/g, confidence: 'MEDIUM' },
  { id: 'google-api-key', title: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g, confidence: 'HIGH' },
  { id: 'slack-token', title: 'Slack token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, confidence: 'HIGH' },
  { id: 'stripe-live-key', title: 'Stripe live key', pattern: /\b[rs]k_live_[0-9A-Za-z]{20,}\b/g, confidence: 'HIGH' },
  {
    id: 'private-key',
    title: 'Private key',
    pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )?PRIVATE KEY-----/g,
    confidence: 'HIGH',
  },
  {
    id: 'generic-assignment',
    title: 'Hardcoded credential',
    pattern: /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*['"]([^'"\s]{12,})['"]/gi,
    confidence: 'LOW',
    group: 1,
  },
]

const PRIVATE_KEY_HEADER = /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/

export interface SecretScanResult extends SecretScanOutcome {
  findings: Finding[]
  layer: LayerResult
}

/**
 * File-only Validator for the SECURITY layer (isomorphic; no Sandbox). Reports secrets on lines the PR
 * adds, by location only, and collects every matched value anywhere in the context for `redact`.
 */
export function scanSecrets(ctx: PrContext, now: () => number = () => 0): SecretScanResult {
  const started = now()
  const values = new Map<string, Secret>()
  const findings: Finding[] = []
  const collect = (text: string) => {
    for (const rule of SECRET_RULES) {
      for (const m of text.matchAll(rule.pattern)) {
        const v = m[rule.group ?? 0]
        if (v && !values.has(v)) values.set(v, new Secret(v))
      }
    }
  }

  collect(ctx.title)
  collect(ctx.body)
  for (const c of [...ctx.reviews, ...ctx.reviewComments, ...ctx.issueComments]) collect(c.body)

  for (const file of ctx.files) {
    if (file.head?.text) collect(file.head.text)
    if (file.base?.text) collect(file.base.text)
    if (!file.patch) continue
    collect(file.patch)
    const { added } = parsePatch(file.patch)
    const reported = new Set<string>()
    for (const { line, text } of added) {
      for (const rule of SECRET_RULES) {
        rule.pattern.lastIndex = 0
        const hit = rule.id === 'private-key' ? PRIVATE_KEY_HEADER.test(text) : rule.pattern.test(text)
        rule.pattern.lastIndex = 0
        if (!hit || reported.has(`${rule.id}:${line}`)) continue
        reported.add(`${rule.id}:${line}`)
        findings.push({
          ruleId: `secrets/${rule.id}`,
          category: 'SECURITY',
          severity: rule.confidence === 'LOW' ? 'MAJOR' : 'CRITICAL',
          confidence: rule.confidence,
          scope: 'UNKNOWN',
          sourceFamily: 'DETERMINISTIC',
          title: `${rule.title} committed`,
          description: `Line ${line} of ${file.path} adds what looks like a ${rule.title.toLowerCase()}. The value is not shown.`,
          impact: 'Anyone with read access to the repository or its history can use this credential.',
          recommendation: 'Remove it from the change, revoke or rotate it, and load it from a secret store or environment variable.',
          location: { anchorKind: 'LINE', path: file.path, startLine: line, endLine: line },
          provenance: { validator: 'secrets.builtin' },
        })
      }
    }
  }

  return {
    completed: true,
    values: [...values.values()],
    findings,
    layer: {
      layer: 'SECURITY',
      validator: 'secrets.builtin',
      status: findings.length > 0 ? 'FAILED' : 'PASSED',
      durationMs: Math.max(0, Math.round(now() - started)),
    },
  }
}
