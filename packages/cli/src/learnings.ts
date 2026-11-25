// `pr-reviewer learnings <owner/repo>`: what reviews of a repository have learned from its maintainers' feedback
// on earlier pr-reviewer comments (👎, /dismiss, /remember), read from GitHub as each review reads it.
import { parseArgs } from 'node:util'
import { EXIT_CODES, FPV, LEARNING_WINDOW_DAYS, parseRepoRef, readLearnings, type Learning, type ResolvedConfig, type Secret } from '@pr-reviewer/core'
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
  resolve: (profile: string | undefined) => ResolvedConfig | number,
  usageError: (message: string) => number,
): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({ args, allowPositionals: true, options: { json: { type: 'boolean' }, profile: { type: 'string' } } })
  } catch (e) {
    return usageError((e as Error).message)
  }
  const [input, ...extra] = parsed.positionals
  if (!input || extra.length > 0) return usageError('learnings needs exactly one repository (owner/repo or URL)')
  const config = resolve(parsed.values.profile)
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
  io.stdout(parsed.values.json ? `${JSON.stringify({ repo: name, enabled: !off, learnings: read.value.learnings, notes: read.value.notes }, null, 2)}\n` : formatLearnings(name, read.value.learnings, read.value.notes, off))
  return EXIT_CODES.passed
}
