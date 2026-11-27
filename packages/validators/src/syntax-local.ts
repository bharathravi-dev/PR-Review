// Local syntax validation (needsSandbox: false): parses changed TS/JS, JSON, YAML, and .properties files
// in memory using bundled tools (ts5, core YAML parser, JSON.parse) without executing any repository code.
import { validateYamlSyntax, type Finding, type Validator } from '@pr-reviewer/core'
import ts from 'ts5'
import { finding } from './util.js'

const TS_JS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/
const JSONC_NAMES = /(^|\/)(tsconfig[^/]*|jsconfig[^/]*|\.eslintrc[^/]*)\.json$|(^|\/)\.vscode\/[^/]+\.json$/
const JSON_FILE = /\.json$/
const YAML_FILE = /\.ya?ml$/
const PROPS_FILE = /\.properties$/

const SUPPORTED_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|json|ya?ml|properties)$/

function scriptKind(path: string): ts.ScriptKind {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.cjs')) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function checkTsJsSyntax(path: string, text: string): Finding[] {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind(path))
  const diags = (sf as unknown as { parseDiagnostics?: readonly ts.DiagnosticWithLocation[] }).parseDiagnostics ?? []
  if (diags.length === 0) return []
  const d = diags[0]!
  const pos = d.start !== undefined ? sf.getLineAndCharacterOfPosition(d.start) : { line: 0, character: 0 }
  const msg = ts.flattenDiagnosticMessageText(d.messageText, ' ')
  return [
    finding({
      ruleId: 'syntax/ts-js-parse',
      category: 'CORRECTNESS',
      severity: 'MAJOR',
      confidence: 'HIGH',
      title: `Syntax error: ${msg}`,
      description: `Parser reported a syntax error at line ${pos.line + 1}, column ${pos.character + 1}: ${msg}`,
      recommendation: 'Fix the syntax error so the file parses cleanly.',
      location: { anchorKind: 'LINE', path, startLine: pos.line + 1, endLine: pos.line + 1 },
      provenance: { validator: 'syntax.local', tool: 'typescript-parser' },
    }),
  ]
}

function checkJsonSyntax(path: string, text: string): Finding[] {
  if (JSONC_NAMES.test(path)) {
    const jsonFile = ts.parseJsonText(path, text)
    const diags = (jsonFile as unknown as { parseDiagnostics?: readonly ts.DiagnosticWithLocation[] }).parseDiagnostics ?? []
    if (diags.length === 0) return []
    const d = diags[0]!
    const pos = d.start !== undefined ? jsonFile.getLineAndCharacterOfPosition(d.start) : { line: 0, character: 0 }
    const msg = ts.flattenDiagnosticMessageText(d.messageText, ' ')
    return [
      finding({
        ruleId: 'syntax/json-parse',
        category: 'BUILD',
        severity: 'MAJOR',
        confidence: 'HIGH',
        title: `Invalid JSON configuration: ${msg}`,
        description: `Failed to parse ${path} at line ${pos.line + 1}: ${msg}`,
        recommendation: 'Fix the JSON syntax error.',
        location: { anchorKind: 'LINE', path, startLine: pos.line + 1, endLine: pos.line + 1 },
        provenance: { validator: 'syntax.local', tool: 'jsonc-parser' },
      }),
    ]
  }
  try {
    JSON.parse(text)
    return []
  } catch (e) {
    const msg = (e as Error).message
    return [
      finding({
        ruleId: 'syntax/json-parse',
        category: 'CORRECTNESS',
        severity: 'MAJOR',
        confidence: 'HIGH',
        title: `Invalid JSON syntax`,
        description: `JSON.parse failed for ${path}: ${msg}`,
        recommendation: 'Fix the malformed JSON syntax (missing comma, trailing comma, or unclosed brace/quote).',
        location: { anchorKind: 'FILE', path },
        provenance: { validator: 'syntax.local', tool: 'json' },
      }),
    ]
  }
}

function checkYaml(path: string, text: string): Finding[] {
  const res = validateYamlSyntax(text)
  if (res.ok) return []
  return [
    finding({
      ruleId: 'syntax/yaml-parse',
      category: 'BUILD',
      severity: 'MAJOR',
      confidence: 'HIGH',
      title: `Invalid YAML syntax: ${res.message}`,
      description: `YAML parsing failed for ${path}${res.line ? ` at line ${res.line}` : ''}: ${res.message}`,
      recommendation: 'Fix indentation, quoting, or colons in the YAML file.',
      location: res.line ? { anchorKind: 'LINE', path, startLine: res.line, endLine: res.line } : { anchorKind: 'FILE', path },
      provenance: { validator: 'syntax.local', tool: 'yaml' },
    }),
  ]
}

function hasLineContinuation(raw: string): boolean {
  let backslashes = 0
  for (let i = raw.length - 1; i >= 0 && raw[i] === '\\'; i--) backslashes++
  return backslashes % 2 === 1
}

function checkProperties(path: string, text: string): Finding[] {
  const seen = new Map<string, number>()
  const findings: Finding[] = []
  const lines = text.split(/\r?\n/)
  let continuation = false
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!
    if (continuation) {
      continuation = hasLineContinuation(raw)
      continue
    }
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) continue
    continuation = hasLineContinuation(raw)
    const eq = trimmed.search(/[=:]/)
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    const firstLine = seen.get(key)
    if (firstLine !== undefined) {
      findings.push(
        finding({
          ruleId: 'syntax/properties-duplicate-key',
          category: 'CORRECTNESS',
          severity: 'MINOR',
          confidence: 'HIGH',
          title: `Duplicate property key: ${key}`,
          description: `Key \`${key}\` is defined again on line ${i + 1} (earlier definition at line ${firstLine}). The later value silently overrides the earlier one.`,
          recommendation: 'Remove the duplicate key or consolidate into a single definition.',
          location: { anchorKind: 'LINE', path, startLine: i + 1, endLine: i + 1 },
          provenance: { validator: 'syntax.local', tool: 'properties' },
        }),
      )
    } else {
      seen.set(key, i + 1)
    }
  }
  return findings
}

export const localSyntaxValidator: Validator = {
  id: 'syntax.local',
  version: '1',
  layers: ['SYNTAX'],
  needsSandbox: false,
  baseline: true,
  hermetic: true,
  supports: (ctx) =>
    ctx.pr.files.some((f) => f.status !== 'removed' && SUPPORTED_FILE.test(f.path))
      ? { applicable: true }
      : { applicable: false, reason: 'NOT_SUPPORTED', detail: 'No parseable TS/JS, JSON, YAML, or properties files changed.' },
  async run(ctx) {
    const findings: Finding[] = []
    let checked = 0
    let skipped = 0
    for (const file of ctx.pr.files) {
      if (file.status === 'removed' || !SUPPORTED_FILE.test(file.path)) continue
      const text = file.head?.text
      if (text === undefined) {
        skipped++
        continue
      }
      checked++
      if (TS_JS.test(file.path)) findings.push(...checkTsJsSyntax(file.path, text))
      else if (JSON_FILE.test(file.path)) findings.push(...checkJsonSyntax(file.path, text))
      else if (YAML_FILE.test(file.path)) findings.push(...checkYaml(file.path, text))
      else if (PROPS_FILE.test(file.path)) findings.push(...checkProperties(file.path, text))
    }
    if (checked === 0 && skipped > 0) {
      return {
        layers: [{ layer: 'SYNTAX', status: 'SKIPPED', reason: 'NOT_SUPPORTED', detail: `Syntax check skipped: all ${skipped} file(s) exceeded context size limit.` }],
        findings,
      }
    }
    const skipNote = skipped > 0 ? ` (${skipped} omitted due to size limit)` : ''
    return {
      layers: [
        {
          layer: 'SYNTAX',
          status: findings.length ? 'WARNING' : 'PASSED',
          detail: findings.length ? `${findings.length} syntax issue(s) across ${checked} checked file(s)${skipNote}.` : `Syntax checks passed on ${checked} changed file(s)${skipNote}.`,
        },
      ],
      findings,
    }
  },
}
