// `pr-reviewer bench`: measures review quality against PRs with known issues (grounded precision, recall, F1), so
// changes to prompts, models, context, or checks are judged by numbers rather than impressions.
import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { EXIT_CODES, parsePrRef, type Finding, type ResolvedConfig, type ReviewProvider, type Secret } from '@pr-reviewer/core'
import { parse as parseYaml } from 'yaml'
import * as z from 'zod'
import type { CliDeps, CliIo } from './deps.js'
import { buildProvider, connectGitHub, executeReview } from './engine.js'

/** One PR with the issues a good review should find (the gold set). */
export const BenchCase = z.object({
  pr: z.string(),
  issues: z.array(
    z.object({
      path: z.string(),
      line: z.number().int().positive(),
      description: z.string(),
      severity: z.enum(['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO']).optional(),
    }),
  ),
})
export const BenchDataset = z.object({ name: z.string(), version: z.string().optional(), cases: z.array(BenchCase).min(1) })
export type BenchDataset = z.infer<typeof BenchDataset>

/** Lines a finding may be from a gold issue and still count (same file). */
export const LINE_WINDOW = 5

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sameIssue', 'reason'],
  properties: { sameIssue: { type: 'boolean' }, reason: { type: 'string' } },
}

export type Judge = (finding: Finding, issue: BenchDataset['cases'][number]['issues'][number]) => Promise<boolean>

/** An LLM judge blind to which tool wrote the comment: does the comment describe the same root cause? */
export function llmJudge(provider: ReviewProvider): Judge {
  return async (f, issue) => {
    const res = await provider.complete({
      system:
        'You compare a code review comment with a known issue in a pull request. Answer sameIssue=true only when the comment identifies the same underlying problem (the same root cause), even if worded differently or proposing a different fix. A comment about a different problem at the same place is not a match.',
      prompt: `<known_issue>\n${issue.description}\n</known_issue>\n<review_comment>\n${f.title}\n\n${f.description}\n</review_comment>`,
      schema: JUDGE_SCHEMA,
      promptVersion: 1,
    })
    return res.ok && typeof res.value.output === 'object' && res.value.output !== null && (res.value.output as { sameIssue?: unknown }).sameIssue === true
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
  ms: number
  error?: string | undefined
}

/**
 * Scores one review: only inline (line-anchored) findings count, as reviewers see them. A finding matches a gold
 * issue in the same file within ±LINE_WINDOW lines, confirmed by the judge when one is given. Each gold issue and
 * each finding matches at most once.
 */
export async function scoreCase(findings: readonly Finding[], issues: BenchDataset['cases'][number]['issues'], judge?: Judge): Promise<Pick<CaseResult, 'gold' | 'comments' | 'matchedGold' | 'matchedComments' | 'bySeverity'>> {
  const comments = findings.filter((f) => f.location.anchorKind === 'LINE' && f.location.path && f.location.startLine && f.scope !== 'PRE_EXISTING')
  const usedComment = new Set<number>()
  const bySeverity: Record<string, { gold: number; found: number }> = {}
  let matchedGold = 0
  for (const issue of issues) {
    const sev = issue.severity ?? 'UNRATED'
    const bucket = (bySeverity[sev] ??= { gold: 0, found: 0 })
    bucket.gold++
    for (let i = 0; i < comments.length; i++) {
      if (usedComment.has(i)) continue
      const loc = comments[i]!.location
      const near = loc.path === issue.path && issue.line >= loc.startLine! - LINE_WINDOW && issue.line <= (loc.endLine ?? loc.startLine!) + LINE_WINDOW
      if (!near || (judge && !(await judge(comments[i]!, issue)))) continue
      usedComment.add(i)
      matchedGold++
      bucket.found++
      break
    }
  }
  return { gold: issues.length, comments: comments.length, matchedGold, matchedComments: usedComment.size, bySeverity }
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const stdev = (xs: number[]) => (xs.length > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / (xs.length - 1)) : 0)

/** Grounded precision, recall, and F1 for one run, from per-case results. */
export function runMetrics(cases: readonly CaseResult[]): { precision: number; recall: number; f1: number } {
  const ok = cases.filter((c) => !c.error)
  const comments = ok.reduce((n, c) => n + c.comments, 0)
  const gold = ok.reduce((n, c) => n + c.gold, 0)
  const precision = comments ? ok.reduce((n, c) => n + c.matchedComments, 0) / comments : 0
  const recall = gold ? ok.reduce((n, c) => n + c.matchedGold, 0) / gold : 0
  return { precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0 }
}

export async function benchCommand(args: string[], io: CliIo, deps: CliDeps, secrets: Secret[], resolve: (profile?: string) => ResolvedConfig | number, usage: (m: string) => number): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: { runs: { type: 'string' }, judge: { type: 'string' }, provider: { type: 'string' }, model: { type: 'string' }, out: { type: 'string' }, profile: { type: 'string' } },
    })
  } catch (e) {
    return usage((e as Error).message)
  }
  const [file] = parsed.positionals
  if (!file) return usage('bench needs a dataset file (YAML or JSON): pr-reviewer bench <dataset> [--runs 3] [--judge <provider>]')
  const runs = Number(parsed.values.runs ?? 1)
  if (!Number.isInteger(runs) || runs < 1 || runs > 10) return usage('--runs must be 1 to 10')
  let dataset: BenchDataset
  try {
    const raw = readFileSync(file, 'utf8')
    dataset = BenchDataset.parse(file.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw))
  } catch (e) {
    io.stderr(`Could not read the dataset: ${(e as Error).message.split('\n')[0]}\n`)
    return 78
  }
  const config = resolve(parsed.values.profile)
  if (typeof config === 'number') return config
  let judge: Judge | undefined
  if (parsed.values.judge) {
    const p = await buildProvider(config, parsed.values.judge, undefined, deps, secrets)
    if (!p.ok) {
      io.stderr(`Judge "${parsed.values.judge}" is not available: ${p.error.message}\n`)
      return 78
    }
    judge = llmJudge(p.value)
  }
  const host = config.settings.github?.host ?? 'github.com'
  const allRuns: CaseResult[][] = []
  for (let r = 0; r < runs; r++) {
    const results: CaseResult[] = []
    for (const c of dataset.cases) {
      const started = Date.now()
      const ref = parsePrRef(c.pr, host)
      if (!ref.ok) {
        results.push({ pr: c.pr, gold: c.issues.length, comments: 0, matchedGold: 0, matchedComments: 0, bySeverity: {}, tokens: 0, ms: 0, error: ref.error.message })
        continue
      }
      const github = await connectGitHub(config, deps, secrets, ref.value.host)
      const { report } = await executeReview({ config, deps, secrets, ref: ref.value, github, provider: parsed.values.provider, model: parsed.values.model })
      const scored = await scoreCase(report.findings, c.issues, judge)
      const tokens = (report.ai?.attempts ?? []).reduce((n, a) => n + (a.usage?.input ?? 0) + (a.usage?.output ?? 0), 0)
      const aiFailed = report.layers.some((l) => l.layer === 'AI_REVIEW' && (l.status === 'ERROR' || l.status === 'SKIPPED'))
      results.push({ pr: c.pr, ...scored, tokens, ms: Date.now() - started, ...(aiFailed ? { error: 'AI review did not run' } : {}) })
      io.stderr(`  run ${r + 1}/${runs} ${c.pr}: ${scored.matchedGold}/${scored.gold} found, ${scored.comments} comment(s)\n`)
    }
    allRuns.push(results)
  }

  const per = allRuns.map(runMetrics)
  const fmt = (xs: number[]) => `${(mean(xs) * 100).toFixed(1)}%${runs > 1 ? ` ± ${(stdev(xs) * 100).toFixed(1)}` : ''}`
  const flat = allRuns.flat()
  const ok = flat.filter((c) => !c.error)
  const severities = [...new Set(ok.flatMap((c) => Object.keys(c.bySeverity)))]
  const summary = {
    dataset: { name: dataset.name, version: dataset.version ?? null, cases: dataset.cases.length },
    runs,
    matching: { lineWindow: LINE_WINDOW, judge: parsed.values.judge ?? null },
    precision: { mean: mean(per.map((m) => m.precision)), stdev: stdev(per.map((m) => m.precision)) },
    recall: { mean: mean(per.map((m) => m.recall)), stdev: stdev(per.map((m) => m.recall)) },
    f1: { mean: mean(per.map((m) => m.f1)), stdev: stdev(per.map((m) => m.f1)) },
    recallBySeverity: Object.fromEntries(severities.map((s) => [s, (() => { const g = ok.reduce((n, c) => n + (c.bySeverity[s]?.gold ?? 0), 0); return g ? ok.reduce((n, c) => n + (c.bySeverity[s]?.found ?? 0), 0) / g : 0 })()])),
    commentsPerPr: ok.length ? ok.reduce((n, c) => n + c.comments, 0) / ok.length : 0,
    tokensPerPr: ok.length ? ok.reduce((n, c) => n + c.tokens, 0) / ok.length : 0,
    secondsPerPr: ok.length ? ok.reduce((n, c) => n + c.ms, 0) / ok.length / 1000 : 0,
    failedCases: flat.filter((c) => c.error).length,
    cases: allRuns,
  }
  if (parsed.values.out) writeFileSync(parsed.values.out, `${JSON.stringify(summary, null, 2)}\n`)
  io.stdout(
    [
      `Benchmark ${dataset.name}${dataset.version ? ` v${dataset.version}` : ''}: ${dataset.cases.length} PR(s) × ${runs} run(s); matching ±${LINE_WINDOW} lines${judge ? ` + judge ${parsed.values.judge}` : ' (line match only: add --judge for root-cause matching)'}`,
      `  precision ${fmt(per.map((m) => m.precision))}   recall ${fmt(per.map((m) => m.recall))}   F1 ${fmt(per.map((m) => m.f1))}`,
      `  recall by severity: ${severities.map((s) => `${s.toLowerCase()} ${(summary.recallBySeverity[s]! * 100).toFixed(0)}%`).join(', ') || 'n/a'}`,
      `  per PR: ${summary.commentsPerPr.toFixed(1)} comments, ${Math.round(summary.tokensPerPr)} tokens, ${summary.secondsPerPr.toFixed(1)} s${summary.failedCases ? `; ${summary.failedCases} case run(s) failed and are excluded` : ''}`,
      '',
    ].join('\n'),
  )
  return EXIT_CODES.passed
}
