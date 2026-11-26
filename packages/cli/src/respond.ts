// `pr-reviewer respond <PR>`: answers `@pr-reviewer …` commands left on the PR since the last run (roadmap item 6).
// Run it by hand, from a schedule, or from the GitHub App's webhook; each command is answered once.
import { parseArgs } from 'node:util'
import { EXIT_CODES, handleCommand, parsePrRef, pendingCommands, type Channel, type PrRef, type ResolvedConfig, type Secret } from '@pr-reviewer/core'
import { redactFile } from './compose.js'
import type { CliDeps, CliIo } from './deps.js'
import { buildProviderChain, connectGitHub, executeReview, performPublish, preparePublish, type GitHubConnection } from './engine.js'

export interface PostedReview {
  ok: boolean
  message: string
}

/** Reviews a PR and posts the result unattended (as the connection's identity). Used by `respond` and the App. */
export async function reviewAndPost(o: { config: ResolvedConfig; deps: CliDeps; secrets: Secret[]; ref: PrRef; github: GitHubConnection; provider?: string | undefined; model?: string | undefined; channel?: Channel; log?: (t: string) => void }): Promise<PostedReview> {
  const { report, context } = await executeReview({ config: o.config, deps: o.deps, secrets: o.secrets, ref: o.ref, github: o.github, provider: o.provider, model: o.model, ...(o.channel ? { channel: o.channel } : {}), ...(o.log ? { onNotice: o.log } : {}) })
  if (!context) return { ok: false, message: 'the PR could not be loaded' }
  const prepared = await preparePublish(report, context, o.ref, o.github, o.config, { event: 'COMMENT', unattended: true })
  if (!prepared.ok) return { ok: false, message: prepared.error.message }
  const { record } = await performPublish(report, prepared.value.plan, prepared.value.preview, o.ref, o.github, o.config)
  return { ok: record.status === 'PUBLISHED' || record.status === 'SKIPPED_DUPLICATE', message: record.reviewUrl ? `[Open the review](${record.reviewUrl})` : record.status.toLowerCase() }
}

/** Answers the PR's pending commands with this connection; returns one line per command. */
export async function answerCommands(o: { config: ResolvedConfig; deps: CliDeps; secrets: Secret[]; ref: PrRef; github: GitHubConnection; provider?: string | undefined; model?: string | undefined; channel?: Channel; dryRun?: boolean }): Promise<{ ok: true; lines: string[] } | { ok: false; error: string }> {
  const { github, ref } = o
  if (!github.viewer) return { ok: false, error: `respond needs to know who it is on GitHub: ${github.tokenError ?? github.viewerError ?? 'unknown'}` }
  const rid = github.viewer.id
  const [items, head] = await Promise.all([github.reader.listPublished(ref), github.reader.getHeadSha(ref)])
  if (!items.ok) return { ok: false, error: `Could not read the PR: ${items.error.message}` }
  if (!head.ok) return { ok: false, error: `Could not read the PR: ${head.error.message}` }
  const pending = pendingCommands(items.value, rid)
  if (!pending.length) return { ok: true, lines: ['No new commands.'] }
  if (o.dryRun) return { ok: true, lines: pending.map((c) => `#${c.commentId} @${c.author}: ${c.verb}${c.text ? ` ${c.text.slice(0, 60)}` : ''}`) }
  const chain = await buildProviderChain(o.config, o.provider, o.model, o.deps, o.secrets)
  const provider = chain.find((c) => c.provider && (!o.channel || !c.provider.channels || c.provider.channels.includes(o.channel)))?.provider
  const lines: string[] = []
  for (const cmd of pending) {
    lines.push(
      await handleCommand(ref, head.value, cmd, items.value, rid, {
        reader: github.reader,
        writer: github.writer,
        provider,
        redact: redactFile,
        canAct: async (login) => {
          const r = await github.reader.canPush?.(ref, login)
          return r?.ok === true && r.value
        },
        review: () => reviewAndPost({ ...o }),
      }),
    )
  }
  return { ok: true, lines }
}

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
  const out = await answerCommands({ config, deps, secrets, ref: ref.value, github, provider: parsed.values.provider, model: parsed.values.model, dryRun: parsed.values['dry-run'] === true })
  if (!out.ok) {
    io.stderr(`${out.error}\n`)
    return EXIT_CODES.error
  }
  io.stdout(`${out.lines.join('\n')}\n`)
  return EXIT_CODES.passed
}
