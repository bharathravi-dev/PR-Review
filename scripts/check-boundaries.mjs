#!/usr/bin/env node
// Enforces the architecture spine's boundary rules on packages/*/src:
//   AD-1  core is I/O-free and isomorphic: no Node built-ins, fetch, process,
//         require, eval, or new Function; no internal package imports.
//   AD-2  dependencies point inward: adapters import only @pr-reviewer/core;
//         Channels (cli, action, web, extension, gh-extension) may import anything.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

export const CHANNELS = new Set(['cli', 'action', 'web', 'extension', 'gh-extension'])
const BUILTINS = new Set(builtinModules.flatMap((m) => [m, m.split('/')[0]]))

const CORE_FORBIDDEN_CODE = [
  [/\bfetch\s*\(/, 'calls fetch (effects go through ports)'],
  [/\bprocess\s*[.[]/, 'reads process (effects go through ports)'],
  [/\brequire\s*\(/, 'uses require (ESM only)'],
  [/\beval\s*\(/, 'uses eval (no runtime code generation)'],
  [/\bnew\s+Function\s*\(/, 'uses new Function (no runtime code generation)'],
]

/** A specific owner/repo on a GitHub host baked into product code (FR-1). Host-only defaults are allowed. */
const REPO_LITERAL = /github\.[a-z.]+\/(?!api\b)[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+/

const IMPORT_RE = /(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;(])import\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:^|[\s;])import\s*['"]([^'"]+)['"]/gm

function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* sourceFiles(path)
    else if (/\.(ts|mts|js|mjs)$/.test(name) && !/\.test\.[mc]?[jt]s$/.test(name)) yield path
  }
}

function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function importsOf(code) {
  const specs = []
  for (const m of code.matchAll(IMPORT_RE)) specs.push(m[1] ?? m[2] ?? m[3])
  return specs
}

const isBuiltin = (spec) => spec.startsWith('node:') || BUILTINS.has(spec.split('/')[0])
const internalPackage = (spec) => spec.match(/^@pr-reviewer\/([^/]+)/)?.[1]

/** Returns a list of human-readable violations for the workspace at `root`. */
export function checkBoundaries(root) {
  const violations = []
  const packagesDir = join(root, 'packages')
  if (!existsSync(packagesDir)) return violations

  for (const pkg of readdirSync(packagesDir)) {
    const src = join(packagesDir, pkg, 'src')
    if (!existsSync(src)) continue
    const isCore = pkg === 'core'
    const isChannel = CHANNELS.has(pkg)

    for (const file of sourceFiles(src)) {
      const rel = relative(root, file)
      const code = stripComments(readFileSync(file, 'utf8'))
      for (const spec of importsOf(code)) {
        const target = internalPackage(spec)
        if (isCore && isBuiltin(spec)) violations.push(`${rel}: core imports Node built-in '${spec}' (AD-1)`)
        else if (isCore && target) violations.push(`${rel}: core imports internal package '${spec}' (AD-1)`)
        else if (!isCore && !isChannel && target && target !== 'core') {
          violations.push(`${rel}: adapter '${pkg}' imports '${spec}'; adapters may import only @pr-reviewer/core (AD-2)`)
        }
      }
      const repoLiteral = REPO_LITERAL.exec(code)
      if (repoLiteral) violations.push(`${rel}: hardcoded repository '${repoLiteral[0]}' (FR-1: everything comes from Configuration)`)
      if (isCore) {
        for (const [re, why] of CORE_FORBIDDEN_CODE) {
          if (re.test(code)) violations.push(`${rel}: core ${why} (AD-1)`)
        }
      }
    }

    const manifest = join(packagesDir, pkg, 'package.json')
    if (!isChannel && existsSync(manifest)) {
      const deps = Object.keys(JSON.parse(readFileSync(manifest, 'utf8')).dependencies ?? {})
      for (const dep of deps) {
        const target = internalPackage(dep)
        if (target && (isCore || target !== 'core')) {
          violations.push(`packages/${pkg}/package.json: depends on '${dep}' (AD-${isCore ? 1 : 2})`)
        }
      }
    }
  }
  return violations
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const violations = checkBoundaries(root)
  if (violations.length > 0) {
    process.stderr.write(`Architecture boundary violations:\n${violations.map((v) => `  - ${v}`).join('\n')}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write('Architecture boundaries OK (AD-1, AD-2)\n')
  }
}
