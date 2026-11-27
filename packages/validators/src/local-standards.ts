// Local multi-language code standards & bug-pattern checks (needsSandbox: false).
// Runs in-process without Docker or executing untrusted repo plugins: AST checks for JS/TS (ts5)
// and deterministic added-line checks for Java/Kotlin, Python, and Go.
import type { Finding, Validator } from '@pr-reviewer/core'
import ts from 'ts5'
import { addedLines, finding, isCommentLine, isTestFile } from './util.js'

const TS_JS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/
const JAVA_KT = /\.(java|kt)$/
const PY = /\.py$/
const GO = /\.go$/
const SUPPORTED = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|java|kt|py|go)$/

interface LineRule {
  id: string
  ext: RegExp
  test: (text: string, line: number, added: ReadonlyMap<number, string>) => boolean
  excludePath?: RegExp
  severity: Finding['severity']
  confidence: Finding['confidence']
  category: Finding['category']
  title: string
  description: string
  recommendation: string
}

export const LOCAL_STANDARD_RULES: readonly LineRule[] = [
  // Java / Kotlin
  {
    id: 'standards/java-empty-catch',
    ext: JAVA_KT,
    test: (t) => /\bcatch\s*\([^)]+\)\s*\{\s*\}/.test(t),
    severity: 'MINOR',
    confidence: 'HIGH',
    category: 'CORRECTNESS',
    title: 'Empty catch block silently swallows exception',
    description: 'Catching an exception with an empty block hides failures and makes production debugging very hard.',
    recommendation: 'Log the exception with context or rethrow a domain exception.',
  },
  {
    id: 'standards/java-print-stack-trace',
    ext: JAVA_KT,
    test: (t) => /\.printStackTrace\s*\(/.test(t),
    severity: 'MINOR',
    confidence: 'HIGH',
    category: 'MAINTAINABILITY',
    title: 'printStackTrace() writes directly to stderr instead of logger',
    description: 'printStackTrace() bypasses structured application logging, log levels, and correlation IDs.',
    recommendation: 'Use your SLF4J/Log4j logger (e.g. logger.error("...", e)).',
  },
  {
    id: 'standards/java-stdout',
    ext: JAVA_KT,
    test: (t) => /\bSystem\.(out|err)\.print(?:ln|f)?\s*\(/.test(t),
    severity: 'MINOR',
    confidence: 'HIGH',
    category: 'MAINTAINABILITY',
    title: 'System.out/err logging in application code',
    description: 'Console printing blocks stdout synchronously and lacks structured formatting or log level control.',
    recommendation: 'Replace with a structured logger call.',
  },
  {
    id: 'standards/java-simple-date-format',
    ext: JAVA_KT,
    test: (t) => /\bnew\s+SimpleDateFormat\s*\(/.test(t),
    severity: 'MAJOR',
    confidence: 'MEDIUM',
    category: 'CORRECTNESS',
    title: 'SimpleDateFormat is not thread-safe',
    description: 'Sharing a SimpleDateFormat instance across threads (such as in a Spring bean) causes corrupted dates or exceptions under concurrency.',
    recommendation: 'Use java.time.format.DateTimeFormatter, which is immutable and thread-safe.',
  },
  {
    id: 'standards/java-field-injection',
    ext: /\.java$/,
    test: (t, line, added) => {
      if (!/^\s*@Autowired\b/.test(t)) return false
      // Same-line `@Autowired private Foo foo;` vs constructor/method on next added line.
      const rest = t.replace(/^\s*@Autowired(?:\([^)]*\))?\s*/, '')
      const sig = rest || (added.get(line + 1) ?? '')
      if (!sig) return false
      if (/^[A-Za-z0-9_<>,\s]*\([^)]*\)\s*\{?/.test(sig) && !sig.includes('=')) return false
      return true
    },
    severity: 'INFO',
    confidence: 'HIGH',
    category: 'MAINTAINABILITY',
    title: 'Field-level @Autowired injection',
    description: 'Field injection hides dependencies, prevents final fields, and makes unit testing without a Spring container harder.',
    recommendation: 'Prefer constructor injection with final fields.',
  },
  // Python
  {
    id: 'standards/py-bare-except',
    ext: PY,
    test: (t) => /^\s*except\s*:/.test(t),
    severity: 'MAJOR',
    confidence: 'HIGH',
    category: 'CORRECTNESS',
    title: 'Bare except: catches KeyboardInterrupt and SystemExit',
    description: 'A bare except clause catches BaseException subclasses including system exit and interrupt signals, hiding bugs.',
    recommendation: 'Catch specific exception classes (or at minimum `except Exception as exc:`).',
  },
  {
    id: 'standards/py-mutable-default',
    ext: PY,
    test: (t) => /^\s*(?:async\s+)?def\s+\w+\(.*=\s*(?:\[\s*\]|\{\s*\})\s*(?:[,)])/.test(t),
    severity: 'MAJOR',
    confidence: 'HIGH',
    category: 'CORRECTNESS',
    title: 'Mutable default argument in function definition',
    description: 'Default list/dict values in Python are evaluated once at function definition time and shared across every call.',
    recommendation: 'Default to `None` and initialize a new list/dict inside the function body.',
  },
  {
    id: 'standards/py-none-equality',
    ext: PY,
    test: (t) => /(?:==|!=)\s*None\b|\bNone\s*(?:==|!=)/.test(t),
    severity: 'MINOR',
    confidence: 'HIGH',
    category: 'CORRECTNESS',
    title: 'Equality comparison with None instead of identity check',
    description: 'Custom `__eq__` implementations can behave unexpectedly with `== None`; Python PEP 8 requires `is None` / `is not None`.',
    recommendation: 'Use `is None` or `is not None`.',
  },
  {
    id: 'standards/py-wildcard-import',
    ext: PY,
    test: (t) => /^\s*from\s+\S+\s+import\s+\*\s*$/.test(t),
    severity: 'MINOR',
    confidence: 'HIGH',
    category: 'MAINTAINABILITY',
    title: 'Wildcard import pollutes module namespace',
    description: 'Wildcard imports obscure where symbols come from and break static analysis.',
    recommendation: 'Import explicit symbol names instead of `*`.',
  },
  // Go
  {
    id: 'standards/go-ignored-error',
    ext: GO,
    test: (t) => /^\s*_\s*=\s*.*\.(?:Close|Write|Flush|Unmarshal|Encode|Decode)\s*\(/.test(t),
    severity: 'MINOR',
    confidence: 'MEDIUM',
    category: 'CORRECTNESS',
    title: 'Error return value explicitly discarded',
    description: 'Discarding errors from Close/Write/Unmarshal can hide truncated writes, I/O failures, or invalid payloads.',
    recommendation: 'Check and handle or log the returned error.',
  },
  {
    id: 'standards/go-panic',
    ext: GO,
    excludePath: /(^|\/)main\.go$/,
    test: (t) => /\bpanic\s*\(/.test(t),
    severity: 'MAJOR',
    confidence: 'MEDIUM',
    category: 'CORRECTNESS',
    title: 'panic() in non-entrypoint Go package',
    description: 'Calling panic() in library or request-handling code crashes the goroutine/process if unrecovered.',
    recommendation: 'Return an `error` to the caller instead of panicking.',
  },
]

function scriptKind(path: string): ts.ScriptKind {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.cjs')) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function checkJsTsAst(path: string, text: string, added: Map<number, string>): Finding[] {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind(path))
  const out: Finding[] = []
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
  const at = (n: ts.Node) => ({ anchorKind: 'LINE' as const, path, startLine: lineOf(n), endLine: lineOf(n) })

  const visit = (node: ts.Node) => {
    if (ts.isDebuggerStatement(node) && added.has(lineOf(node))) {
      out.push(
        finding({
          ruleId: 'standards/no-debugger',
          category: 'MAINTAINABILITY',
          severity: 'MINOR',
          confidence: 'HIGH',
          title: 'Leftover debugger statement',
          description: '`debugger;` pauses execution when devtools are attached and should not be committed.',
          recommendation: 'Remove the `debugger;` statement.',
          location: at(node),
          provenance: { validator: 'standards.local', tool: 'ts-ast' },
        }),
      )
    }

    if (ts.isCatchClause(node) && node.block.statements.length === 0 && added.has(lineOf(node))) {
      const inner = text.slice(node.block.getStart(sf) + 1, node.block.getEnd() - 1).trim()
      if (!inner) {
        out.push(
          finding({
            ruleId: 'standards/empty-catch',
            category: 'CORRECTNESS',
            severity: 'MINOR',
            confidence: 'HIGH',
            title: 'Empty catch block silently swallows error',
            description: 'Swallowing errors without logging or handling hides runtime failures.',
            recommendation: 'Handle, log, or rethrow the caught error (or add a comment explaining why ignoring it is safe).',
            location: at(node),
            provenance: { validator: 'standards.local', tool: 'ts-ast' },
          }),
        )
      }
    }

    if (ts.isBlock(node)) {
      let terminated = false
      for (const stmt of node.statements) {
        if (terminated && !ts.isFunctionDeclaration(stmt) && added.has(lineOf(stmt))) {
          out.push(
            finding({
              ruleId: 'standards/unreachable-code',
              category: 'CORRECTNESS',
              severity: 'MINOR',
              confidence: 'HIGH',
              title: 'Unreachable code after return/throw',
              description: 'This statement appears after an unconditional return, throw, break, or continue in the same block.',
              recommendation: 'Remove the dead code or fix the control flow.',
              location: at(stmt),
              provenance: { validator: 'standards.local', tool: 'ts-ast' },
            }),
          )
          break
        }
        if (ts.isReturnStatement(stmt) || ts.isThrowStatement(stmt) || ts.isBreakStatement(stmt) || ts.isContinueStatement(stmt)) {
          terminated = true
        }
      }
    }

    if (ts.isObjectLiteralExpression(node)) {
      const keys = new Set<string>()
      for (const prop of node.properties) {
        if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) continue
        const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) || ts.isNumericLiteral(prop.name) ? prop.name.text : undefined
        if (!key) continue
        if (keys.has(key) && added.has(lineOf(prop))) {
          out.push(
            finding({
              ruleId: 'standards/duplicate-key',
              category: 'CORRECTNESS',
              severity: 'MAJOR',
              confidence: 'HIGH',
              title: `Duplicate object property "${key}"`,
              description: `Property "${key}" is defined more than once in the same object literal; the later entry overwrites the earlier one.`,
              recommendation: `Keep a single "${key}" property.`,
              location: at(prop),
              provenance: { validator: 'standards.local', tool: 'ts-ast' },
            }),
          )
        } else {
          keys.add(key)
        }
      }
    }

    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && added.has(lineOf(node))) {
      const lhs = node.left.getText(sf).trim()
      const rhs = node.right.getText(sf).trim()
      if (lhs && lhs === rhs) {
        out.push(
          finding({
            ruleId: 'standards/self-assignment',
            category: 'CORRECTNESS',
            severity: 'MAJOR',
            confidence: 'HIGH',
            title: `Self-assignment: ${lhs} = ${rhs}`,
            description: 'Assigning an identifier or property to itself has no effect and usually indicates a typo.',
            recommendation: 'Check the intended right-hand side value or remove the assignment.',
            location: at(node),
            provenance: { validator: 'standards.local', tool: 'ts-ast' },
          }),
        )
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sf)
  return out
}

export const localStandardsValidator: Validator = {
  id: 'standards.local',
  version: '1',
  layers: ['STATIC_ANALYSIS'],
  needsSandbox: false,
  baseline: true,
  hermetic: true,
  supports: (ctx) =>
    ctx.pr.files.some((f) => f.status !== 'removed' && !isTestFile(f.path) && SUPPORTED.test(f.path))
      ? { applicable: true }
      : { applicable: false, reason: 'NOT_SUPPORTED', detail: 'No non-test source files changed for local standards checks.' },
  async run(ctx) {
    const findings: Finding[] = []
    let checked = 0
    let skippedTs = 0
    for (const file of ctx.pr.files) {
      if (file.status === 'removed' || isTestFile(file.path) || !SUPPORTED.test(file.path)) continue
      const added = addedLines(file)
      if (added.size === 0) continue
      if (TS_JS.test(file.path)) {
        if (file.head?.text === undefined) {
          skippedTs++
          continue
        }
        checked++
        findings.push(...checkJsTsAst(file.path, file.head.text, added))
        continue
      }
      checked++
      for (const [line, text] of added) {
        if (isCommentLine(text)) continue
        for (const rule of LOCAL_STANDARD_RULES) {
          if (!rule.ext.test(file.path)) continue
          if (rule.excludePath?.test(file.path)) continue
          if (!rule.test(text, line, added)) continue
          findings.push(
            finding({
              ruleId: rule.id,
              category: rule.category,
              severity: rule.severity,
              confidence: rule.confidence,
              title: rule.title,
              description: rule.description,
              recommendation: rule.recommendation,
              location: { anchorKind: 'LINE', path: file.path, startLine: line, endLine: line },
              provenance: { validator: 'standards.local', tool: 'local-standards' },
            }),
          )
        }
      }
    }
    if (checked === 0 && skippedTs > 0) {
      return {
        layers: [{ layer: 'STATIC_ANALYSIS', status: 'SKIPPED', reason: 'NOT_SUPPORTED', detail: `Local JS/TS AST checks skipped: all ${skippedTs} file(s) exceeded context size limit.` }],
        findings,
      }
    }
    const skipNote = skippedTs > 0 ? ` (${skippedTs} JS/TS file(s) omitted due to size limit)` : ''
    return {
      layers: [
        {
          layer: 'STATIC_ANALYSIS',
          status: findings.length ? 'WARNING' : 'PASSED',
          detail: findings.length
            ? `${findings.length} local standard/static issue(s) across ${checked} checked source file(s)${skipNote}.`
            : `Local code standards passed on ${checked} changed source file(s)${skipNote}.`,
        },
      ],
      findings,
    }
  },
}
