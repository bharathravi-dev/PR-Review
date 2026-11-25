// `pr-reviewer bench`: measures review quality against PRs with known issues (grounded precision, recall, F1), so
// changes to prompts, models, context, or checks are judged by numbers rather than impressions.
import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { EXIT_CODES, parsePrRef, type Finding, type ResolvedConfig, type ReviewProvider, type Secret } from '@pr-reviewer/core'
import { parse as parseYaml } from 'yaml'
import * as z from 'zod'
import type { CliDeps, CliIo } from './deps.js'
import { buildProvider, connectGitHub, executeReview, inlineSeverityFloor, providerEntry, providerName } from './engine.js'

const SEVERITIES = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO'] as const

/** A known issue a good review should find. Without a file and line it can only be matched by a judge. */
export const BenchIssue = z.object({
  path: z.string().optional(),
  line: z.number().int().positive().optional(),
  description: z.string(),
  severity: z.enum(SEVERITIES).optional(),
  /**
   * A low-value issue: a comment that matches it counts as neither right nor wrong, and missing it is not a miss
   * (the rule Augment applies to low-severity golden comments).
   */
  optional: z.boolean().optional(),
})
export type BenchIssue = z.infer<typeof BenchIssue>

/** One PR with the issues a good review should find (the gold set). */
export const BenchCase = z.object({ pr: z.string(), issues: z.array(BenchIssue) })
export const BenchDataset = z.object({
  name: z.string(),
  version: z.string().optional(),
  /** Where the gold set came from, for the results file. */
  source: z.string().optional(),
  cases: z.array(BenchCase).min(1),
})
export type BenchDataset = z.infer<typeof BenchDataset>

/** Lines a finding may be from a gold issue and still count (same file). */
export const LINE_WINDOW = 5

/** Proposes which review comments describe which known issues (indexes into both lists). */
export type Judge = (comments: readonly Finding[], issues: readonly BenchIssue[]) => Promise<Array<{ issue: number; comment: number }>>

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['matches'],
  properties: {
    matches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['issue', 'comment', 'reason'],
        properties: { issue: { type: 'integer' }, comment: { type: 'integer' }, reason: { type: 'string' } },
      },
    },
  },
}

/**
 * An LLM judge blind to which tool wrote the comments: one call per PR pairs each known issue with the review
 * comment that identifies the same root cause, if any.
 */
export function llmJudge(provider: ReviewProvider): Judge {
  return async (comments, issues) => {
    if (!comments.length || !issues.length) return []
    const known = issues.map((i, n) => `<issue id="${n}"${i.path ? ` path=${JSON.stringify(i.path)}` : ''}${i.line ? ` line="${i.line}"` : ''}>\n${i.description}\n</issue>`).join('\n')
    const said = comments
      .map((c, n) => `<comment id="${n}" path=${JSON.stringify(c.location.path ?? '')} line="${c.location.startLine ?? ''}">\n${c.title}\n\n${c.description}\n</comment>`)
      .join('\n')
    const res = await provider.complete({
      system: [
        'You grade a code review against the known issues of a pull request.',
        'For each known issue, decide whether one of the review comments identifies the same underlying problem (the same root cause), even if worded differently, placed on a nearby line, or proposing a different fix.',
        'A comment about a different problem in the same place is not a match. A vague comment that does not name the problem is not a match.',
        'Each issue matches at most one comment and each comment at most one issue. Return only the matches.',
      ].join(' '),
      prompt: `<known_issues>\n${known}\n</known_issues>\n<review_comments>\n${said}\n</review_comments>`,
      schema: JUDGE_SCHEMA,
      promptVersion: 2,
    })
    if (!res.ok) throw new Error(`judge failed: ${res.error.message}`)
    const out = res.value.output as { matches?: Array<{ issue?: unknown; comment?: unknown }> } | null
    return (out?.matches ?? []).flatMap((m) => (Number.isInteger(m.issue) && Number.isInteger(m.comment) ? [{ issue: m.issue as number, comment: m.comment as number }] : []))
  }
}

export interface CaseResult {
  pr: string
  gold: number
  comments: number
  matchedGold: number
  matchedComments: number
  bySeverity: Record<string, { gold: number; found: number }>
  tokens: number
  costUsd: number
  ms: number
  error?: string | undefined
}

type Scored = Pick<CaseResult, 'gold' | 'comments' | 'matchedGold' | 'matchedComments' | 'bySeverity'>

/** The review comments a reader would see inline: line-anchored, about the change, at or above the severity floor. */
export function postedComments(findings: readonly Finding[], floor: (typeof SEVERITIES)[number] = 'MINOR'): Finding[] {
  return findings.filter(
    (f) => f.location.anchorKind === 'LINE' && f.location.path && f.location.startLine && f.scope !== 'PRE_EXISTING' && SEVERITIES.indexOf(f.severity) <= SEVERITIES.indexOf(floor),
  )
}

/** Whether a comment is where a known issue is: same file, within ±LINE_WINDOW lines. Unknown parts don't constrain. */
function near(c: Finding, issue: BenchIssue): boolean {
  const loc = c.location
  if (issue.path && loc.path !== issue.path) return false
  if (issue.line === undefined) return true
  return issue.line >= loc.startLine! - LINE_WINDOW && issue.line <= (loc.endLine ?? loc.startLine!) + LINE_WINDOW
}

/**
 * Scores one review's inline comments against the known issues. Without a judge a comment matches a located issue
 * when it is near it; with a judge it must also describe the same root cause (and issues without a location are
 * matched by the judge alone). Each issue and each comment matches at most once; required issues are matched first.
 * Comments that match only an optional issue are left out of both counts.
 */
export async function scoreCase(comments: readonly Finding[], issues: readonly BenchIssue[], judge?: Judge): Promise<Scored> {
  const proposed = judge
    ? (await judge(comments, issues)).filter((p) => issues[p.issue] && comments[p.comment] && near(comments[p.comment]!, issues[p.issue]!))
    : issues.flatMap((issue, i) => (issue.path && issue.line ? comments.flatMap((c, j) => (near(c, issue) ? [{ issue: i, comment: j }] : [])) : []))
  const order = issues.map((issue, i) => ({ issue, i })).sort((a, b) => Number(a.issue.optional ?? false) - Number(b.issue.optional ?? false))
  const usedComment = new Map<number, boolean>()
  const bySeverity: Record<string, { gold: number; found: number }> = {}
  let matchedGold = 0
  for (const { issue, i } of order) {
    const bucket = issue.optional ? undefined : (bySeverity[issue.severity ?? 'UNRATED'] ??= { gold: 0, found: 0 })
    if (bucket) bucket.gold++
    const hit = proposed.find((p) => p.issue === i && !usedComment.has(p.comment))
    if (!hit) continue
    usedComment.set(hit.comment, !issue.optional)
    if (bucket) {
      matchedGold++
      bucket.found++
    }
  }
  const neutral = [...usedComment.values()].filter((required) => !required).length
  return {
    gold: issues.filter((i) => !i.optional).length,
    comments: comments.length - neutral,
    matchedGold,
    matchedComments: usedComment.size - neutral,
    bySeverity,
  }
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const stdev = (xs: number[]) => (xs.length > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / (xs.length - 1)) : 0)
const percentile = (xs: number[], p: number) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!
}

/** Grounded precision, recall, and F1 for one run, from per-case results. */
export function runMetrics(cases: readonly CaseResult[]): { precision: number; recall: number; f1: number } {
  const ok = cases.filter((c) => !c.error)
  const comments = ok.reduce((n, c) => n + c.comments, 0)
  const gold = ok.reduce((n, c) => n + c.gold, 0)
  const precision = comments ? ok.reduce((n, c) => n + c.matchedComments, 0) / comments : 0
  const recall = gold ? ok.reduce((n, c) => n + c.matchedGold, 0) / gold : 0
  return { precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0 }
}

/** Runs `fn` over `items` with at most `limit` in flight, keeping the input order in the result. */
async function pool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i]!)
      }
    }),
  )
  return out
}

export async function benchCommand(args: string[], io: CliIo, deps: CliDeps, secrets: Secret[], resolve: (profile?: string) => ResolvedConfig | number, usage: (m: string) => number): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        runs: { type: 'string' },
        judge: { type: 'string' },
        provider: { type: 'string' },
        model: { type: 'string' },
        out: { type: 'string' },
        profile: { type: 'string' },
        filter: { type: 'string' },
        limit: { type: 'string' },
        concurrency: { type: 'string' },
        verify: { type: 'boolean' },
        'no-tool-results': { type: 'boolean' },
      },
    })
  } catch (e) {
    return usage((e as Error).message)
  }
  const [file] = parsed.positionals
  if (!file) return usage('bench needs a dataset file (YAML or JSON): pr-reviewer bench <dataset> [--runs 3] [--judge <provider>]')
  const runs = Number(parsed.values.runs ?? 1)
  if (!Number.isInteger(runs) || runs < 1 || runs > 10) return usage('--runs must be 1 to 10')
  const concurrency = Number(parsed.values.concurrency ?? 1)
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) return usage('--concurrency must be 1 to 8')
  const limit = parsed.values.limit === undefined ? undefined : Number(parsed.values.limit)
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) return usage('--limit must be a positive whole number')
  let dataset: BenchDataset
  try {
    const raw = readFileSync(file, 'utf8')
    dataset = BenchDataset.parse(file.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw))
  } catch (e) {
    io.stderr(`Could not read the dataset: ${(e as Error).message.split('\n')[0]}\n`)
    return 78
  }
  const cases = dataset.cases.filter((c) => !parsed.values.filter || c.pr.includes(parsed.values.filter)).slice(0, limit)
  if (!cases.length) return usage(`No case in the dataset matches --filter ${parsed.values.filter}`)
  if (!parsed.values.judge && cases.some((c) => c.issues.some((i) => !i.path || !i.line))) {
    return usage('This dataset has issues without a file and line, which only a judge can match: add --judge <provider>.')
  }
  const resolved = resolve(parsed.values.profile)
  if (typeof resolved === 'number') return resolved
  // Every run must be a fresh review: a cached AI answer would make the runs identical and hide the variance.
  // --verify and --no-tool-results override the config so the same dataset can be compared with and without them.
  const ai = {
    ...resolved.settings.ai,
    ...(parsed.values.verify ? { verify: true } : {}),
    ...(parsed.values['no-tool-results'] ? { toolResults: false } : {}),
  }
  const config: ResolvedConfig = { ...resolved, settings: { ...resolved.settings, ai, cache: { ...resolved.settings.cache, enabled: false } } }
  let judge: Judge | undefined
  let sameFamily = false
  if (parsed.values.judge) {
    const p = await buildProvider(config, parsed.values.judge, undefined, deps, secrets)
    if (!p.ok) {
      io.stderr(`Judge "${parsed.values.judge}" is not available: ${p.error.message}\n`)
      return 78
    }
    judge = llmJudge(p.value)
    const reviewer = providerName(config, parsed.values.provider)
    sameFamily = reviewer === parsed.values.judge || providerEntry(config, reviewer)?.type === providerEntry(config, parsed.values.judge)?.type
  }

  const host = config.settings.github?.host ?? 'github.com'
  const reviewOne = async (c: BenchDataset['cases'][number], run: number): Promise<CaseResult> => {
    const started = Date.now()
    const failed = (error: string): CaseResult => ({ pr: c.pr, gold: 0, comments: 0, matchedGold: 0, matchedComments: 0, bySeverity: {}, tokens: 0, costUsd: 0, ms: Date.now() - started, error })
    const ref = parsePrRef(c.pr, host)
    if (!ref.ok) return failed(ref.error.message)
    try {
      const github = await connectGitHub(config, deps, secrets, ref.value.host)
      const { report } = await executeReview({ config, deps, secrets, ref: ref.value, github, provider: parsed.values.provider, model: parsed.values.model })
      const done = (report.ai?.attempts ?? []).filter((a) => a.usage)
      const tokens = done.reduce((n, a) => n + (a.usage?.input ?? 0) + (a.usage?.output ?? 0), 0)
      const costUsd = done.reduce((n, a) => n + (a.usage?.costUsd ?? 0), 0)
      if (report.layers.some((l) => l.layer === 'AI_REVIEW' && (l.status === 'ERROR' || l.status === 'SKIPPED'))) return { ...failed('AI review did not run'), tokens, costUsd }
      const scored = await scoreCase(postedComments(report.findings, inlineSeverityFloor(report, config)), c.issues, judge)
      io.stderr(`  run ${run}/${runs} ${c.pr}: ${scored.matchedGold}/${scored.gold} found, ${scored.comments} comment(s)\n`)
      return { pr: c.pr, ...scored, tokens, costUsd, ms: Date.now() - started }
    } catch (e) {
      io.stderr(`  run ${run}/${runs} ${c.pr}: failed (${(e as Error).message})\n`)
      return failed((e as Error).message)
    }
  }
  const allRuns: CaseResult[][] = []
  for (let r = 1; r <= runs; r++) allRuns.push(await pool(cases, concurrency, (c) => reviewOne(c, r)))

  const per = allRuns.map(runMetrics)
  const fmt = (xs: number[]) => `${(mean(xs) * 100).toFixed(1)}%${runs > 1 ? ` ± ${(stdev(xs) * 100).toFixed(1)}` : ''}`
  const flat = allRuns.flat()
  const ok = flat.filter((c) => !c.error)
  const severities = SEVERITIES.filter((s) => ok.some((c) => c.bySeverity[s])).concat(ok.some((c) => c.bySeverity.UNRATED) ? ['UNRATED' as never] : [])
  const avg = (pick: (c: CaseResult) => number) => (ok.length ? ok.reduce((n, c) => n + pick(c), 0) / ok.length : 0)
  const summary = {
    dataset: { name: dataset.name, version: dataset.version ?? null, source: dataset.source ?? null, cases: cases.length, filter: parsed.values.filter ?? null },
    runs,
    reviewer: { provider: providerName(config, parsed.values.provider), model: parsed.values.model ?? null, verify: ai.verify === true, toolResults: ai.toolResults !== false },
    matching: { lineWindow: LINE_WINDOW, judge: parsed.values.judge ?? null, judgeSharesReviewerFamily: judge ? sameFamily : null, comments: 'inline, about the change, at or above the inline severity floor' },
    precision: { mean: mean(per.map((m) => m.precision)), stdev: stdev(per.map((m) => m.precision)) },
    recall: { mean: mean(per.map((m) => m.recall)), stdev: stdev(per.map((m) => m.recall)) },
    f1: { mean: mean(per.map((m) => m.f1)), stdev: stdev(per.map((m) => m.f1)) },
    recallBySeverity: Object.fromEntries(
      severities.map((s) => {
        const g = ok.reduce((n, c) => n + (c.bySeverity[s]?.gold ?? 0), 0)
        return [s, g ? ok.reduce((n, c) => n + (c.bySeverity[s]?.found ?? 0), 0) / g : 0]
      }),
    ),
    commentsPerPr: avg((c) => c.comments),
    zeroCommentShare: ok.length ? ok.filter((c) => c.comments === 0).length / ok.length : 0,
    tokensPerPr: avg((c) => c.tokens),
    usdPerPr: avg((c) => c.costUsd),
    seconds: { p50: percentile(ok.map((c) => c.ms), 50) / 1000, p95: percentile(ok.map((c) => c.ms), 95) / 1000 },
    failedCases: flat.length - ok.length,
    cases: allRuns,
  }
  if (parsed.values.out) writeFileSync(parsed.values.out, `${JSON.stringify(summary, null, 2)}\n`)
  const money = summary.usdPerPr > 0 ? `, $${summary.usdPerPr.toFixed(3)}` : ''
  io.stdout(
    [
      `Benchmark ${dataset.name}${dataset.version ? ` v${dataset.version}` : ''}: ${cases.length} PR(s) × ${runs} run(s)${ai.verify ? ', with verification' : ''}${ai.toolResults === false ? ', without tool results' : ''}; matching ±${LINE_WINDOW} lines${judge ? ` + judge ${parsed.values.judge}` : ' (line match only: add --judge for root-cause matching)'}`,
      ...(sameFamily ? ['  note: the judge uses the same provider type as the reviewer, which may favour it; prefer a different model family'] : []),
      `  precision ${fmt(per.map((m) => m.precision))}   recall ${fmt(per.map((m) => m.recall))}   F1 ${fmt(per.map((m) => m.f1))}`,
      `  recall by severity: ${severities.map((s) => `${s.toLowerCase()} ${(summary.recallBySeverity[s]! * 100).toFixed(0)}%`).join(', ') || 'n/a'}`,
      `  per PR: ${summary.commentsPerPr.toFixed(1)} comments (${(summary.zeroCommentShare * 100).toFixed(0)}% with none), ${Math.round(summary.tokensPerPr)} tokens${money}, p50 ${summary.seconds.p50.toFixed(1)} s, p95 ${summary.seconds.p95.toFixed(1)} s${summary.failedCases ? `; ${summary.failedCases} case run(s) failed and are excluded` : ''}`,
      '',
    ].join('\n'),
  )
  return EXIT_CODES.passed
}
