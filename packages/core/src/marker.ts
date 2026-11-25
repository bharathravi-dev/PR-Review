/** Marker grammar version (AD-11). Changing the grammar requires a new engine major (AD-21). */
export const MARKER_VERSION = 1

export type MarkerKind = 'summary' | 'review' | 'inline'

/** Fields carried by the hidden marker on everything the product publishes (AD-11). */
export interface MarkerFields {
  mv: number
  kind: MarkerKind
  /** Numeric GitHub id of the Reviewer Identity. */
  rid: number
  head: string
  cfg: string
  eng: number
  fpv: number
  key: string
  /** Fingerprint for inline comments, "-" otherwise. */
  fp: string
  /** Usage: input tokens / output tokens / cost in micros. */
  u: string
  /** Summary only: 16-hex prefixes of Findings listed only in the summary. */
  fps?: string[] | undefined
}

const MARKER_RE = /<!-- pr-reviewer ((?:[a-z]+=[^\s]* )*[a-z]+=[^\s]*) -->/g
const SAFE = /^[A-Za-z0-9,/_.-]*$/

/** Renders the marker. The literal "pr-reviewer" is fixed and never follows a product rename. */
export function formatMarker(m: MarkerFields): string {
  const parts = [
    `mv=${m.mv}`,
    `kind=${m.kind}`,
    `rid=${m.rid}`,
    `head=${m.head}`,
    `cfg=${m.cfg}`,
    `eng=${m.eng}`,
    `fpv=${m.fpv}`,
    `key=${m.key}`,
    `fp=${m.fp}`,
    `u=${m.u}`,
  ]
  if (m.kind === 'summary') parts.push(`fps=${(m.fps ?? []).join(',') || '-'}`)
  for (const p of parts) if (!SAFE.test(p.split('=')[1] ?? '')) throw new Error(`unsafe marker field: ${p}`)
  return `<!-- pr-reviewer ${parts.join(' ')} -->`
}

/**
 * Parses the last well-formed marker in `text`. Markers with an unknown `mv` are ignored entirely (AD-11);
 * malformed markers return undefined.
 */
export function parseMarker(text: string): MarkerFields | undefined {
  let last: string | undefined
  for (const m of text.matchAll(MARKER_RE)) last = m[1]
  if (!last) return undefined
  const f: Record<string, string> = {}
  for (const pair of last.split(' ')) {
    const i = pair.indexOf('=')
    f[pair.slice(0, i)] = pair.slice(i + 1)
  }
  const num = (v: string | undefined) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : undefined)
  const mv = num(f.mv)
  if (mv !== MARKER_VERSION) return undefined
  const kind = f.kind
  const rid = num(f.rid)
  const eng = num(f.eng)
  const fpv = num(f.fpv)
  if ((kind !== 'summary' && kind !== 'review' && kind !== 'inline') || rid === undefined || eng === undefined || fpv === undefined) return undefined
  if (!f.head || !f.cfg || !f.key || !f.fp || !f.u) return undefined
  return {
    mv,
    kind,
    rid,
    head: f.head,
    cfg: f.cfg,
    eng,
    fpv,
    key: f.key,
    fp: f.fp,
    u: f.u,
    ...(kind === 'summary' ? { fps: !f.fps || f.fps === '-' ? [] : f.fps.split(',') } : {}),
  }
}

/** Own output (AD-11): a well-formed marker AND the item's author is the Reviewer Identity AND the marker's rid matches. */
export function ownMarker(item: { authorId: number | undefined; body: string }, rid: number): MarkerFields | undefined {
  if (item.authorId !== rid) return undefined
  const m = parseMarker(item.body)
  return m && m.rid === rid ? m : undefined
}
