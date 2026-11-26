import { parseDocument } from 'yaml'
import type { ProjectInfo } from './detect.js'

export interface StandardBundle {
  stack: string
  rules: readonly string[]
}

const STACK_RULES: Record<string, readonly string[]> = {
  'TypeScript / JavaScript': [
    'Check null/undefined handling, unsafe `as` type casts, and unhandled rejected promises (missing `await` or `.catch`).',
    'Verify error paths do not silently swallow exceptions (`catch {}`) or leak internal stack traces/tokens to callers.',
    'Check async/event handlers and timers/streams for cleanup and race conditions on shared state.',
  ],
  Java: [
    'Check null safety (`.equals()` on nullable values, `Optional.get()` without `isPresent()`), swallowed exceptions, and HTTP error status mapping (4xx vs 5xx).',
    'Verify IO/network resources use try-with-resources, and shared Spring singletons do not hold mutable state or non-thread-safe instances like `SimpleDateFormat`.',
    'For controller/endpoint changes, verify authentication/authorization boundaries, header trust, input validation, and backward compatibility of removed or renamed routes.',
  ],
  Kotlin: [
    'Check unsafe `!!` non-null assertions, swallowed exceptions, and coroutine cancellation/dispatcher handling.',
    'For controller/endpoint changes, verify auth boundaries, input validation, and API compatibility.',
  ],
  Python: [
    'Check bare `except:` / broad `Exception` swallowing, mutable default arguments, and unclosed resources (prefer `with`).',
    'Check blocking I/O inside `async` functions and SQL/command parameterization.',
  ],
  Go: [
    'Check ignored `err` values, misplaced `defer` calls inside loops or before error checks, and `context.Context` propagation.',
    'Check shared map/slice mutations for data races and `panic` in library/request paths.',
  ],
  Angular: [
    'Check RxJS subscriptions for lifecycle cleanup (`takeUntilDestroyed` or `async` pipe), template method calls, and missing `trackBy` / `track` on loops.',
    'Check HTML/URL sanitization (`bypassSecurityTrust*`) and route guards on new views.',
  ],
  React: [
    'Check Rules of Hooks (no hooks inside conditions/loops/callbacks), `useEffect` dependency completeness and cleanup, and stable `key` props in lists.',
    'Check direct state mutation and `dangerouslySetInnerHTML` sanitization.',
  ],
  'Config / CI / Containers': [
    'Check workflow permissions (`permissions:`), pinned third-party action versions, and untrusted PR inputs in `run:` blocks.',
    'Check exposed secrets, overly permissive network/CORS/TLS settings, and breaking build or environment variable changes.',
  ],
}

const EXT_TO_STACK: ReadonlyArray<[RegExp, string]> = [
  [/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/, 'TypeScript / JavaScript'],
  [/\.java$/, 'Java'],
  [/\.kt$/, 'Kotlin'],
  [/\.py$/, 'Python'],
  [/\.go$/, 'Go'],
  [/^\.github\/(workflows|actions)\/|Dockerfile|docker-compose.*\.ya?ml$|\.gitlab-ci\.yml$/i, 'Config / CI / Containers'],
]

/**
 * Retrieves concise, relevant engineering & security standards for the stacks touched by the PR (RAG grounding).
 * Only stacks matching the detected projects or changed files are included so prompts stay compact.
 */
export function retrieveLanguageStandards(opts: {
  projects: readonly ProjectInfo[]
  changedPaths: readonly string[]
}): StandardBundle[] {
  const stacks = new Set<string>()
  for (const p of opts.projects) {
    if (p.language === 'TypeScript' || p.language === 'JavaScript') stacks.add('TypeScript / JavaScript')
    else if (p.language !== 'unknown') stacks.add(p.language)
    for (const f of p.frameworks) {
      if (f.name === 'Angular' || f.name === 'React') stacks.add(f.name)
    }
  }
  for (const path of opts.changedPaths) {
    for (const [re, stack] of EXT_TO_STACK) {
      if (re.test(path)) stacks.add(stack)
    }
  }
  return [...stacks]
    .filter((s) => Boolean(STACK_RULES[s]))
    .map((stack) => ({ stack, rules: STACK_RULES[stack]! }))
}

/** Validates YAML syntax using core's bundled YAML parser (used by local syntax validators without extra deps). */
export function validateYamlSyntax(text: string): { ok: true } | { ok: false; line?: number | undefined; message: string } {
  const doc = parseDocument(text)
  const first = doc.errors[0]
  if (!first) return { ok: true }
  const line = first.linePos?.[0]?.line
  return { ok: false, ...(line ? { line } : {}), message: first.message.split('\n')[0] ?? 'Invalid YAML syntax' }
}
