// A unified diff of two texts, for forges whose API returns file versions but no patch (Azure DevOps). Same shape
// as GitHub's `patch` field: hunks only, no file headers. Longest common subsequence by lines; files too large for
// the table return undefined, and the caller marks the diff as truncated.

const MAX_CELLS = 6_000_000

export function unifiedDiff(before: string, after: string, context = 3): string | undefined {
  const a = before === '' ? [] : before.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')
  const b = after === '' ? [] : after.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')
  // Common prefix and suffix are cut first: most edits are local, so the table stays small.
  let pre = 0
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++
  let suf = 0
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++
  const x = a.slice(pre, a.length - suf)
  const y = b.slice(pre, b.length - suf)
  if ((x.length + 1) * (y.length + 1) > MAX_CELLS) return undefined
  const w = y.length + 1
  const lcs = new Int32Array((x.length + 1) * w)
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) lcs[i * w + j] = x[i] === y[j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!)
  type Op = { t: ' ' | '-' | '+'; text: string; ai: number; bi: number }
  const ops: Op[] = []
  for (let k = 0; k < pre; k++) ops.push({ t: ' ', text: a[k]!, ai: k, bi: k })
  let i = 0
  let j = 0
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) ops.push({ t: ' ', text: x[i]!, ai: pre + i++, bi: pre + j++ })
    // Removals before additions, as unified diffs show a replaced line.
    else if (i < x.length && (j === y.length || lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!)) ops.push({ t: '-', text: x[i]!, ai: pre + i++, bi: pre + j })
    else ops.push({ t: '+', text: y[j]!, ai: pre + i, bi: pre + j++ })
  }
  for (let k = 0; k < suf; k++) ops.push({ t: ' ', text: a[a.length - suf + k]!, ai: a.length - suf + k, bi: b.length - suf + k })
  // Group changes into hunks with `context` unchanged lines around them.
  const changed = ops.map((o, k) => (o.t !== ' ' ? k : -1)).filter((k) => k >= 0)
  if (!changed.length) return ''
  const hunks: Array<[number, number]> = []
  for (const k of changed) {
    const lo = Math.max(0, k - context)
    const hi = Math.min(ops.length - 1, k + context)
    const last = hunks[hunks.length - 1]
    if (last && lo <= last[1] + 1) last[1] = hi
    else hunks.push([lo, hi])
  }
  return hunks
    .map(([lo, hi]) => {
      const part = ops.slice(lo, hi + 1)
      const oldLines = part.filter((o) => o.t !== '+').length
      const newLines = part.filter((o) => o.t !== '-').length
      const oldStart = oldLines ? part.find((o) => o.t !== '+')!.ai + 1 : part[0]!.ai
      const newStart = newLines ? part.find((o) => o.t !== '-')!.bi + 1 : part[0]!.bi
      return [`@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`, ...part.map((o) => `${o.t}${o.text}`)].join('\n')
    })
    .join('\n')
}
