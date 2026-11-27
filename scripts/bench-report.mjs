// Turns `pr-reviewer bench` results into the table in docs/benchmarks.md (roadmap item 13).
//   node scripts/bench-report.mjs bench/results/*.json > docs/benchmarks-results.md
// Only complete runs are reported: a run with failed cases is listed separately, because its numbers are biased.
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

const files = process.argv.slice(2)
if (!files.length) {
  console.error('usage: node scripts/bench-report.mjs <result.json> [...]')
  process.exit(64)
}
const pct = (x) => (typeof x === 'number' ? `${Math.round(x * 100)}%` : '—')
const fpRate = (p) => (typeof p === 'number' ? `${Math.round((1 - p) * 100)}%` : '—')
const rows = []
const partial = []
for (const f of files) {
  const r = JSON.parse(readFileSync(f, 'utf8'))
  const who = [r.reviewer?.provider, r.reviewer?.model, r.reviewer?.verify ? 'verify' : ''].filter(Boolean).join(' ')
  const scope = `${r.dataset?.name ?? '?'}${r.dataset?.filter ? ` (${r.dataset.filter})` : ''}, ${r.dataset?.cases ?? '?'} PRs × ${r.runs ?? 1}`
  const drops = typeof r.groundedDropsTotal === 'number' || typeof r.verificationDropsTotal === 'number' ? `${r.groundedDropsTotal ?? 0}g/${r.verificationDropsTotal ?? 0}v` : '—'
  const line = `| ${basename(f, '.json')} | ${who || '?'} | ${scope} | ${pct(r.precision?.mean)} | ${fpRate(r.precision?.mean)} | ${pct(r.recall?.mean)} | ${pct(r.f1?.mean)} | ${r.commentsPerPr ?? '—'} | ${drops} | ${Math.round(r.seconds?.p50 ?? 0)} s |`
  if (r.failedCases) partial.push(`${line} ${r.failedCases} |`)
  else rows.push(line)
}
const head = '| Run | Reviewer | Dataset | Precision | FP Rate | Recall | F1 | Comments/PR | Guard Drops | Time p50 |\n|---|---|---|---|---|---|---|---|---|---|'
console.log(`## Results\n\n${rows.length ? `${head}\n${rows.join('\n')}` : 'No complete runs yet.'}\n`)
if (partial.length) console.log(`### Incomplete runs (not comparable)\n\n${head.replace('Time p50 |', 'Time p50 | Failed |').replace('|---|---|---|---|---|---|---|---|---|---|', '|---|---|---|---|---|---|---|---|---|---|---|')}\n${partial.join('\n')}\n`)
