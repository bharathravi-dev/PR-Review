// Framework checks (FR-3, FR-4, Story 4.7): product-owned parsers, no repository tools, so no Sandbox (AD-5).
import { framework, majorOf, type Finding, type ProjectInfo, type Validator, type ValidatorContext } from '@pr-reviewer/core'
import ts from 'ts5'
import { addedLines, changedFile, finding } from './util.js'

const minor = (v: string | undefined) => Number(v?.split('.')[1] ?? 0)

function projectsWith(ctx: ValidatorContext, name: string): Array<{ project: ProjectInfo; major: number | undefined; version: string | undefined }> {
  return ctx.projects.flatMap((p) => {
    const f = framework(p, name)
    return f ? [{ project: p, major: majorOf(f.version), version: f.version }] : []
  })
}

// ── Angular ─────────────────────────────────────────────────────────────

/** A call in a template expression, outside string literals; `$any()` is Angular's own cast. */
const CALL = /(?:^|[^\w$'"])([A-Za-z_$][\w$]*)\s*\(/g
const stripStrings = (s: string) => s.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, "''")

/** Expressions on one template line that Angular re-evaluates on every change detection. */
function templateExpressions(line: string): string[] {
  const out: string[] = []
  for (const m of line.matchAll(/\{\{([^}]*)\}\}/g)) out.push(m[1]!)
  // Property and structural bindings; event bindings `(click)="..."` run only on events and are fine.
  for (const m of line.matchAll(/(?:\[[\w.@-]+\]|\*ng\w+|\[\([\w.-]+\)\])\s*=\s*"([^"]*)"/g)) out.push(m[1]!)
  return out
}

export const angularValidator: Validator = {
  id: 'framework.angular',
  version: '1',
  layers: ['FRAMEWORK'],
  needsSandbox: false,
  baseline: false,
  hermetic: true,
  supports(ctx) {
    const ng = projectsWith(ctx, 'Angular')
    if (ng.length === 0) return { applicable: false, reason: 'NOT_SUPPORTED', detail: 'No Angular project in this PR.' }
    const supported = ng.filter((n) => n.major === undefined || n.major >= 12)
    if (supported.length === 0) {
      return { applicable: false, reason: 'NOT_SUPPORTED', detail: `Angular ${ng.map((n) => n.version ?? '?').join(', ')} is below 12, which these checks support (unsupported version). Generic checks still run.` }
    }
    return { applicable: true }
  },
  async run(ctx) {
    const findings: Finding[] = []
    let files = 0
    for (const { project, major, version } of projectsWith(ctx, 'Angular')) {
      if (major !== undefined && major < 12) continue
      const v = major ?? 12
      for (const path of project.changedFiles) {
        const file = changedFile(ctx, path)
        if (!file || file.status === 'removed') continue
        const added = addedLines(file)
        if (path.endsWith('.html')) {
          files++
          for (const [line, text] of added) findings.push(...templateChecks(path, line, text, v, version))
        } else if (path.endsWith('.ts') && !path.endsWith('.spec.ts')) {
          files++
          const whole = file.head?.text ?? ''
          findings.push(...subscriptionChecks(path, added, whole, v))
        }
      }
    }
    return {
      layers: [{ layer: 'FRAMEWORK', status: findings.length ? 'WARNING' : 'PASSED', detail: `Angular checks on ${files} changed file(s).` }],
      findings,
    }
  },
}

function templateChecks(path: string, line: number, text: string, major: number, version: string | undefined): Finding[] {
  const out: Finding[] = []
  const loc = { anchorKind: 'LINE' as const, path, startLine: line, endLine: line }
  const calls = templateExpressions(text).flatMap((expr) =>
    [...stripStrings(expr.split(/\s\|\s|\|(?!\|)/)[0]!).matchAll(CALL)].map((m) => m[1]!).filter((n) => n !== '$any'),
  )
  if (calls.length > 0) {
    // From Angular 16, calling a signal in a template is the intended pattern; without types we can't tell.
    const signals = major >= 16
    out.push(
      finding({
        ruleId: 'angular/template-call',
        category: 'PERFORMANCE',
        severity: signals ? 'INFO' : 'MINOR',
        confidence: signals ? 'LOW' : 'MEDIUM',
        title: `Function call in a template binding: ${[...new Set(calls)].join(', ')}()`,
        description: `Angular evaluates template bindings on every change-detection cycle, so ${calls[0]}() runs far more often than it looks.${signals ? ` If ${calls[0]} is a signal (Angular ${version ?? major}), this is fine.` : ''}`,
        recommendation: signals
          ? 'If it is not a signal, use a computed() signal, a pure pipe, or a precomputed property.'
          : 'Use a pure pipe or compute the value once into a component property.',
        location: loc,
        provenance: { validator: 'framework.angular' },
      }),
    )
  }
  const ngFor = /\*ngFor\s*=\s*"([^"]*)"/.exec(text)
  if (ngFor && !/trackBy/.test(ngFor[1]!)) {
    out.push(
      finding({
        ruleId: 'angular/ngfor-trackby',
        category: 'PERFORMANCE',
        severity: 'MINOR',
        confidence: 'HIGH',
        title: '*ngFor without trackBy',
        description: 'Without trackBy, Angular re-creates the DOM for the whole list whenever the array is replaced.',
        recommendation:
          major >= 17
            ? 'Add "; trackBy: trackById", or use the built-in control flow available since Angular 17: @for (item of items; track item.id) { … }.'
            : 'Add "; trackBy: trackById" with a component method returning a stable id, e.g. trackById(_: number, item: Item) { return item.id }.',
        location: loc,
        provenance: { validator: 'framework.angular' },
      }),
    )
  }
  return out
}

const MANAGED = /takeUntil\(|takeUntilDestroyed\(|\.unsubscribe\(\)|\btake\(\s*1\s*\)|\bfirst\(\s*\)|firstValueFrom|lastValueFrom|DestroyRef/

function subscriptionChecks(path: string, added: Map<number, string>, whole: string, major: number): Finding[] {
  if (MANAGED.test(whole)) return []
  const out: Finding[] = []
  for (const [line, text] of added) {
    // HttpClient observables complete after one response; their subscriptions don't leak.
    if (!/\.subscribe\(/.test(text) || /\bhttp(Client)?\b|\.http\./i.test(text)) continue
    out.push(
      finding({
        ruleId: 'angular/unmanaged-subscription',
        category: 'CORRECTNESS',
        severity: 'MINOR',
        confidence: 'MEDIUM',
        title: 'Subscription is never unsubscribed',
        description: 'This file subscribes but never unsubscribes or limits the stream, so the subscription can outlive the component and leak memory or run handlers late.',
        recommendation:
          major >= 16
            ? 'Pipe through takeUntilDestroyed() (from @angular/core/rxjs-interop, available since Angular 16), or use the async pipe.'
            : 'Pipe through takeUntil(this.destroy$) and complete destroy$ in ngOnDestroy, or use the async pipe in the template.',
        location: { anchorKind: 'LINE', path, startLine: line, endLine: line },
        provenance: { validator: 'framework.angular' },
      }),
    )
  }
  return out
}

// ── React ───────────────────────────────────────────────────────────────

const HOOK = /^use[A-Z0-9]/
const COMPONENT_WRAPPERS = new Set(['memo', 'forwardRef', 'observer', 'withRouter', 'connect'])

export const reactValidator: Validator = {
  id: 'framework.react',
  version: '1',
  layers: ['FRAMEWORK'],
  needsSandbox: false,
  baseline: false,
  hermetic: true,
  supports(ctx) {
    return projectsWith(ctx, 'React').length > 0 ? { applicable: true } : { applicable: false, reason: 'NOT_SUPPORTED', detail: 'No React project in this PR.' }
  },
  async run(ctx) {
    const findings: Finding[] = []
    let files = 0
    for (const { project, major, version } of projectsWith(ctx, 'React')) {
      // Hooks exist from React 16.8.
      const hooks = major === undefined || major > 16 || (major === 16 && minor(version) >= 8)
      for (const path of project.changedFiles) {
        if (!/\.(jsx|tsx|js|ts)$/.test(path) || /\.(spec|test)\.[jt]sx?$/.test(path)) continue
        const file = changedFile(ctx, path)
        const text = file?.head?.text
        if (!file || !text) continue
        files++
        findings.push(...reactChecks(path, text, addedLines(file), hooks))
      }
    }
    return {
      layers: [{ layer: 'FRAMEWORK', status: findings.length ? 'WARNING' : 'PASSED', detail: `React checks on ${files} changed file(s).` }],
      findings,
    }
  },
}

function reactChecks(path: string, text: string, added: Map<number, string>, hooks: boolean): Finding[] {
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : path.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JSX
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind)
  const out: Finding[] = []
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
  const at = (n: ts.Node) => ({ anchorKind: 'LINE' as const, path, startLine: lineOf(n), endLine: lineOf(n) })

  const visit = (node: ts.Node) => {
    if (hooks && ts.isCallExpression(node)) {
      const name = ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'React' ? node.expression.name.text : undefined
      if (name && HOOK.test(name) && added.has(lineOf(node))) {
        const why = conditionalAncestor(node)
        if (why) {
          out.push(
            finding({
              ruleId: 'react/rules-of-hooks',
              category: 'CORRECTNESS',
              severity: 'MAJOR',
              confidence: 'HIGH',
              title: `${name}() is called ${why}`,
              description: 'React relies on hooks being called in the same order on every render. A hook inside a condition, loop, or callback can run a different number of times and corrupt component state.',
              recommendation: 'Call the hook unconditionally at the top level of the component or custom hook, and put the condition inside it (e.g. inside the effect).',
              location: at(node),
              provenance: { validator: 'framework.react' },
            }),
          )
        }
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'map') {
      const cb = node.arguments[0]
      if (cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) {
        for (const el of returnedJsx(cb)) {
          if (!added.has(lineOf(el)) || hasKey(el)) continue
          out.push(
            finding({
              ruleId: 'react/jsx-key',
              category: 'CORRECTNESS',
              severity: 'MINOR',
              confidence: 'HIGH',
              title: 'List item without a key',
              description: 'Elements rendered from .map() need a stable key so React can match them between renders; without one, state and focus can jump between items.',
              recommendation: ts.isJsxFragment(el) ? 'Replace <>…</> with <Fragment key={item.id}>…</Fragment>.' : 'Add key={item.id} (a stable id, not the array index) to the returned element.',
              location: at(el),
              provenance: { validator: 'framework.react' },
            }),
          )
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** Why a hook call is not at the top level of its component, or undefined. */
function conditionalAncestor(node: ts.Node): string | undefined {
  for (let child: ts.Node = node, p = node.parent; p; child = p, p = p.parent) {
    if (ts.isFunctionLike(p)) {
      // A hook inside a function passed to another call (e.g. useEffect(() => useX()), items.map(...)) is in a callback.
      const call = p.parent && ts.isCallExpression(p.parent) && p.parent.arguments.includes(p as ts.Expression) ? p.parent : undefined
      if (!call) return undefined
      // memo(), forwardRef() and similar wrap a component; hooks at its top level are fine.
      const callee = ts.isIdentifier(call.expression) ? call.expression.text : ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : ''
      return COMPONENT_WRAPPERS.has(callee) ? undefined : 'inside a callback'
    }
    if (ts.isIfStatement(p) && child !== p.expression) return 'inside a condition'
    if (ts.isConditionalExpression(p) && child !== p.condition) return 'inside a condition'
    if (ts.isBinaryExpression(p) && child === p.right && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(p.operatorToken.kind)) return 'inside a condition'
    if (ts.isSwitchStatement(p) || ts.isCaseClause(p)) return 'inside a condition'
    if (ts.isForStatement(p) || ts.isForInStatement(p) || ts.isForOfStatement(p) || ts.isWhileStatement(p) || ts.isDoStatement(p)) return 'inside a loop'
  }
  return undefined
}

type JsxRoot = ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment

function returnedJsx(fn: ts.ArrowFunction | ts.FunctionExpression): JsxRoot[] {
  const unwrap = (e: ts.Expression | undefined): JsxRoot[] => {
    if (!e) return []
    if (ts.isParenthesizedExpression(e)) return unwrap(e.expression)
    if (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e) || ts.isJsxFragment(e)) return [e]
    if (ts.isConditionalExpression(e)) return [...unwrap(e.whenTrue), ...unwrap(e.whenFalse)]
    return []
  }
  if (!ts.isBlock(fn.body)) return unwrap(fn.body)
  const out: JsxRoot[] = []
  const walk = (n: ts.Node) => {
    if (ts.isReturnStatement(n)) out.push(...unwrap(n.expression))
    else if (!ts.isFunctionLike(n)) ts.forEachChild(n, walk)
  }
  ts.forEachChild(fn.body, walk)
  return out
}

function hasKey(el: JsxRoot): boolean {
  if (ts.isJsxFragment(el)) return false
  const attrs = ts.isJsxElement(el) ? el.openingElement.attributes : el.attributes
  return attrs.properties.some((a) => (ts.isJsxAttribute(a) && a.name.getText() === 'key') || ts.isJsxSpreadAttribute(a))
}
