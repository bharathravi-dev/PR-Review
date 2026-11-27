// `pr-reviewer learnings <owner/repo>`: what reviews of a repository have learned from its maintainers' feedback
// on earlier pr-reviewer comments (👎, /dismiss, /remember), read from GitHub as each review reads it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { EXIT_CODES, FPV, LEARNING_WINDOW_DAYS, parseRepoRef, proposeRulesMarkdown, readLearnings, type Learning, type ResolvedConfig, type Secret } from '@pr-reviewer/core'
import type { CliDeps, CliIo } from './deps.js'
import { connectGitHub } from './engine.js'

export function formatLearnings(repo: string, learnings: readonly Learning[], notes: readonly string[], off: boolean): string {
  const out = [`Learned from feedback on ${repo} (last ${LEARNING_WINDOW_DAYS} days): ${learnings.length}`]
  if (off) out.push('Learning is off in your config (ai.learn: false); reviews do not use these.')
  learnings.forEach((l, i) => {
    out.push(`  ${String(i + 1).padStart(2)}. ${l.kind === 'REMEMBER' ? '[remember] ' : ''}${l.text}`, `      ${l.by} on #${l.pr}${l.url ? `  ${l.url}` : ''}`)
  })
  if (learnings.length === 0) {
    out.push('  Nothing yet. Reply "/remember <what to know>" or "/dismiss <why>" to a pr-reviewer comment, or react 👎.')
  }
  out.push(...notes.map((n) => `  note: ${n}`))
  out.push('Feedback counts from you and from people who can push to the repository. To undo one, reply "/forget" to that comment or remove the 👎.')
  return `${out.join('\n')}\n`
}

export async function learningsCommand(
  args: string[],
  io: CliIo,
  deps: CliDeps,
  secrets: Secret[],
  resolveConfigFn: (profile: string | undefined) => ResolvedConfig | number,
  usageError: (message: string) => number,
): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        json: { type: 'boolean' },
        profile: { type: 'string' },
        propose: { type: 'boolean' },
        write: { type: 'string' },
      },
    })
  } catch (e) {
    return usageError((e as Error).message)
  }
  const [input, ...extra] = parsed.positionals
  if (!input || extra.length > 0) return usageError('learnings needs exactly one repository (owner/repo or URL)')
  if (parsed.values.write && !parsed.values.propose) return usageError('--write requires --propose')
  const config = resolveConfigFn(parsed.values.profile)
  if (typeof config === 'number') return config
  const repo = parseRepoRef(input, config.settings.github?.host ?? 'github.com')
  if (!repo.ok) return usageError(repo.error.message)

  const github = await connectGitHub(config, deps, secrets, repo.value.host)
  if (!github.viewer) {
    io.stderr(`learnings needs your GitHub identity: ${github.tokenError ?? github.viewerError ?? 'no token'}\n`)
    return EXIT_CODES.error
  }
  const read = await readLearnings(github.reader, repo.value, github.viewer.id, FPV, Date.now())
  if (!read.ok) {
    io.stderr(`${read.error.message}\n`)
    return EXIT_CODES.error
  }
  const off = config.settings.ai?.learn === false
  const name = `${repo.value.owner}/${repo.value.repo}`

  if (parsed.values.propose) {
    const cwd = deps.cwd ?? process.cwd()
    let existing = ''
    let targetPath: string | undefined
    if (parsed.values.write) {
      const candidate = resolve(cwd, parsed.values.write)
      const rel = relative(cwd, candidate)
      if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
        return usageError('--write target must be a relative path inside the repository directory')
      }
      targetPath = candidate
      if (existsSync(candidate)) existing = readFileSync(candidate, 'utf8')
    }
    const proposed = proposeRulesMarkdown(name, read.value.learnings, existing)
    if (targetPath) {
      if (proposed.addedCount === 0) {
        io.stdout(parsed.values.json ? `${JSON.stringify({ repo: name, target: parsed.values.write, ...proposed }, null, 2)}\n` : `All ${read.value.learnings.length} learning(s) are already present in ${parsed.values.write}.\n`)
        return EXIT_CODES.passed
      }
      mkdirSync(dirname(targetPath), { recursive: true })
      const sep = existing && !existing.endsWith('\n') ? '\n\n' : existing ? '\n' : ''
      writeFileSync(targetPath, `${existing}${sep}${proposed.markdown}`, 'utf8')
      io.stdout(parsed.values.json ? `${JSON.stringify({ repo: name, target: parsed.values.write, ...proposed }, null, 2)}\n` : `Added ${proposed.addedCount} rule(s) to ${parsed.values.write} (skipped ${proposed.skippedExisting} already present).\n`)
      return EXIT_CODES.passed
    }
    if (parsed.values.json) {
      io.stdout(`${JSON.stringify({ repo: name, enabled: !off, ...proposed, learnings: read.value.learnings }, null, 2)}\n`)
    } else {
      io.stdout(proposed.markdown || `No learnings to propose for ${name}.\n`)
    }
    return EXIT_CODES.passed
  }

  io.stdout(parsed.values.json ? `${JSON.stringify({ repo: name, enabled: !off, learnings: read.value.learnings, notes: read.value.notes }, null, 2)}\n` : formatLearnings(name, read.value.learnings, read.value.notes, off))
  return EXIT_CODES.passed
}
