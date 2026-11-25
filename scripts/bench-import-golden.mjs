#!/usr/bin/env node
// Builds a `pr-reviewer bench` dataset from the public "golden comments" set (Greptile's 50-PR benchmark as
// corrected by Augment): 5 open-source repositories × 10 PRs, each with the issues a good review should find.
//
//   node scripts/bench-import-golden.mjs [--org ai-code-review-evaluations] [--fork augment] [--projects cal_dot_com,sentry]
//                                        [--out bench/data/golden-50.json]
//
// The gold set is downloaded, not vendored: it has no licence, so it stays out of this repository. Each PR exists
// once per evaluated tool in the org (e.g. augment-sentry, coderabbit-sentry); --fork picks whose copy to review.
// The diffs are the same; the AI review never sees the other tool's comments.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    org: { type: 'string', default: 'ai-code-review-evaluations' },
    repo: { type: 'string', default: 'golden_comments' },
    dir: { type: 'string', default: 'code_review_benchmarks' },
    fork: { type: 'string', default: 'augment' },
    projects: { type: 'string' },
    out: { type: 'string', default: 'bench/data/golden-50.json' },
    api: { type: 'string', default: process.env.GITHUB_API_URL ?? 'https://api.github.com' },
  },
})

function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim()
  } catch {
    return undefined
  }
}
const auth = token()
async function gh(path, accept = 'application/vnd.github+json') {
  const res = await fetch(`${values.api}${path}`, { headers: { accept, 'user-agent': 'pr-reviewer-bench-import', ...(auth ? { authorization: `Bearer ${auth}` } : {}) } })
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`)
  return accept.endsWith('raw') ? res.text() : res.json()
}

// Augment counts low-severity golden comments as neither right nor wrong; "optional" does the same in `bench`.
const SEVERITY = { Critical: 'CRITICAL', High: 'MAJOR', Medium: 'MINOR', Low: 'INFO' }

const commit = await gh(`/repos/${values.org}/${values.repo}/commits/HEAD`)
const listing = await gh(`/repos/${values.org}/${values.repo}/contents/${values.dir}?ref=${commit.sha}`)
const wanted = values.projects?.split(',').map((p) => p.trim())
const cases = []
const skipped = []
for (const file of listing.filter((f) => f.name.endsWith('.json'))) {
  const project = file.name.replace(/\.json$/, '')
  if (wanted && !wanted.includes(project)) continue
  const golden = JSON.parse(await gh(`/repos/${values.org}/${values.repo}/contents/${values.dir}/${file.name}?ref=${commit.sha}`, 'application/vnd.github.raw'))
  const target = `${values.org}/${values.fork}-${project}`
  const pulls = await gh(`/repos/${target}/pulls?state=all&per_page=100`)
  const byTitle = new Map(pulls.map((p) => [p.title.trim(), p.number]))
  for (const pr of golden) {
    const number = byTitle.get(pr.pr_title.trim())
    if (!number) {
      skipped.push(`${project}: "${pr.pr_title}"`)
      continue
    }
    cases.push({
      pr: `${target}#${number}`,
      title: pr.pr_title,
      issues: pr.comments.map((c) => ({
        description: c.comment,
        ...(SEVERITY[c.severity] ? { severity: SEVERITY[c.severity] } : {}),
        ...(c.severity === 'Low' ? { optional: true } : {}),
      })),
    })
  }
}
const dataset = {
  name: `golden-${values.fork}`,
  version: commit.sha.slice(0, 7),
  source: `https://github.com/${values.org}/${values.repo}/tree/${commit.sha}/${values.dir}`,
  cases,
}
mkdirSync(dirname(values.out), { recursive: true })
writeFileSync(values.out, `${JSON.stringify(dataset, null, 2)}\n`)
const issues = cases.flatMap((c) => c.issues)
console.log(`Wrote ${values.out}: ${cases.length} PRs, ${issues.filter((i) => !i.optional).length} issues to find (+${issues.filter((i) => i.optional).length} optional).`)
if (skipped.length) console.log(`No PR with this title in the ${values.fork} copy, skipped:\n  ${skipped.join('\n  ')}`)
