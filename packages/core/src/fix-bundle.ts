import type { Finding } from './findings.js'
import type { Report } from './report.js'

export interface FixBundleItem {
  index: number
  fingerprint?: string | undefined
  path: string
  startLine?: number | undefined
  endLine?: number | undefined
  severity: Finding['severity']
  category: Finding['category']
  title: string
  recommendation?: string | undefined
  suggestion?: string | undefined
}

export interface FixBundle {
  totalActionable: number
  withCodeSuggestions: number
  items: FixBundleItem[]
}

/** Collects every non-dismissed finding that has a concrete code suggestion or recommendation into one bundle. */
export function buildFixBundle(report: Report): FixBundle {
  const items: FixBundleItem[] = []
  for (const f of report.findings) {
    if (f.dismissed) continue
    if (!f.suggestion && !f.recommendation) continue
    items.push({
      index: items.length + 1,
      ...(f.fingerprint ? { fingerprint: f.fingerprint } : {}),
      path: f.location.path ?? '(PR-wide)',
      ...(f.location.startLine ? { startLine: f.location.startLine } : {}),
      ...(f.location.endLine ? { endLine: f.location.endLine } : {}),
      severity: f.severity,
      category: f.category,
      title: f.title,
      ...(f.recommendation ? { recommendation: f.recommendation } : {}),
      ...(f.suggestion ? { suggestion: f.suggestion } : {}),
    })
  }
  return {
    totalActionable: items.length,
    withCodeSuggestions: items.filter((i) => i.suggestion !== undefined).length,
    items,
  }
}

function safeFence(text: string): string {
  let max = 2
  for (const m of text.matchAll(/`+/g)) if (m[0].length > max) max = m[0].length
  return '`'.repeat(max + 1)
}

/** Renders the Recommended Fix Bundle grouped cleanly for terminal or Markdown output. */
export function renderFixBundleMarkdown(bundle: FixBundle, prLabel?: string): string {
  const out: string[] = [`# Recommended Fix Bundle${prLabel ? `: ${prLabel}` : ''}`, '']
  if (bundle.items.length === 0) {
    out.push('No automated suggestions or recommendations in this report.')
    return `${out.join('\n')}\n`
  }
  out.push(`${bundle.totalActionable} actionable finding(s) (${bundle.withCodeSuggestions} with direct code replacement suggestions).`, '')
  for (const item of bundle.items) {
    const loc = item.startLine ? `${item.path}:${item.startLine}${item.endLine && item.endLine !== item.startLine ? `-${item.endLine}` : ''}` : item.path
    out.push(`## ${item.index}. [${item.severity}] ${item.title}`, `File: \`${loc}\``, '')
    if (item.recommendation) out.push(`**Recommended fix:** ${item.recommendation}`, '')
    if (item.suggestion) {
      const fence = safeFence(item.suggestion)
      out.push('**Suggested replacement:**', fence, item.suggestion, fence, '')
    }
  }
  return `${out.join('\n')}\n`
}
