// `pr-reviewer respond <PR>`: answers `@pr-reviewer …` commands left on the PR since the last run (roadmap item 6).
// Run it by hand, from a schedule, or from a webhook; each command is answered once.
import { parseArgs } from 'node:util'
import { EXIT_CODES, handleCommand, parsePrRef, pendingCommands, type ResolvedConfig, type Secret } from '@pr-reviewer/core'
import { redactFile } from './compose.js'
import type { CliDeps, CliIo } from './deps.js'
import { buildProviderChain, connectGitHub, executeReview, performPublish, preparePublish } from './engine.js'

export async function respondCommand(args: string[], io: CliIo, deps: CliDeps, secrets: Secret[], resolve: (profile?: string) => ResolvedConfig | number, usage: (m: string) => number): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({ args, allowPositionals: true, options: { 'dry-run': { type: 'boolean' }, provider: { type: 'string' }, model: { type: 'string' }, profile: { type: 'string' } } })
  } catch (e) {
    return usage((e as Error).message)
  }
  const [prText, ...extra] = parsed.positionals
  if (!prText || extra.length) return usage('respond needs one PR: pr-reviewer respond <PR link or owner/repo#number> [--dry-run]')
  const config = resolve(parsed.values.profile)
  if (typeof config === 'number') return config
  const ref = parsePrRef(prText, config.settings.github?.host ?? 'github.com')
  if (!ref.ok) return usage(ref.error.message)
  const github = await connectGitHub(config, deps, secrets, ref.value.host)
  if (!github.viewer) {
    io.stderr(`respond needs to know who it is on GitHub: ${github.tokenError ?? github.viewerError ?? 'unknown'}\n`)
    return EXIT_CODES.error
  }
  const rid = github.viewer.id
  const [items, head] = await Promise.all([github.reader.listPublished(ref.value), github.reader.getHeadSha(ref.value)])
  if (!items.ok || !head.ok) {
    io.stderr(`Could not read the PR: ${!items.ok ? items.error.message : !head.ok ? head.error.message : ''}\n`)
    return EXIT_CODES.error
  }
  const pending = pendingCommands(items.value, rid)
  if (!pending.length) {
    io.stdout('No new commands.\n')
    return EXIT_CODES.passed
  }
  if (parsed.values['dry-run']) {
    io.stdout(`${pending.map((c) => `#${c.commentId} @${c.author}: ${c.verb}${c.text ? ` ${c.text.slice(0, 60)}` : ''}`).join('\n')}\n`)
    return EXIT_CODES.passed
  }
  const chain = await buildProviderChain(config, parsed.values.provider, parsed.values.model, deps, secrets)
  const provider = chain.find((c) => c.provider)?.provider
  for (const cmd of pending) {
    const outcome = await handleCommand(ref.value, head.value, cmd, items.value, rid, {
      reader: github.reader,
      writer: github.writer,
      provider,
      redact: redactFile,
      canAct: async (login) => {
        const r = await github.reader.canPush?.(ref.value, login)
        return r?.ok === true && r.value
      },
      review: async () => {
        const { report, context } = await executeReview({ config, deps, secrets, ref: ref.value, github, provider: parsed.values.provider, model: parsed.values.model })
        if (!context) return { ok: false, message: 'the PR could not be loaded' }
        const prepared = await preparePublish(report, context, ref.value, github, config, { event: 'COMMENT', unattended: true })
        if (!prepared.ok) return { ok: false, message: prepared.error.message }
        const { record } = await performPublish(report, prepared.value.plan, prepared.value.preview, ref.value, github, config)
        return { ok: record.status === 'PUBLISHED' || record.status === 'SKIPPED_DUPLICATE', message: record.reviewUrl ? `[Open the review](${record.reviewUrl})` : record.status.toLowerCase() }
      },
    })
    io.stdout(`${outcome}\n`)
  }
  return EXIT_CODES.passed
}
