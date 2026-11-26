// Learning from feedback: what this repository's maintainers said about earlier pr-reviewer comments, read from
// GitHub on every review (no store of its own). Signals on the reviewer's own inline comments, from people trusted
// to speak for the repository (the Reviewer Identity, or anyone who can push to it):
//   👎 or "/dismiss [why]"  → a DISMISSED learning ("don't raise this kind of finding here")
//   "/remember <text>"      → a REMEMBER learning, in their words
//   "/forget"               → drops what the thread taught so far (or remove the 👎 / delete the reply)
// Learnings only guide the AI (untrusted data in the prompt); they never change the gate.
import { ownMarker } from './marker.js'
import type { GitHubReader, RepoReviewComment } from './ports.js'
import type { RepoRef } from './pr-ref.js'
import type { Result } from './result.js'
import { ok } from './result.js'

export interface Learning {
  kind: 'REMEMBER' | 'DISMISSED'
  /** What the AI is shown (untrusted: written by people, cleaned and capped). */
  text: string
  /** Login of the person it came from. */
  by: string
  pr: number
  /** The pr-reviewer comment the feedback was given on. */
  url?: string | undefined
}

/** How far back, how many comments, and how much reaches the AI. */
export const LEARNING_WINDOW_DAYS = 180
export const MAX_LEARNING_COMMENTS = 300
export const MAX_LEARNINGS = 30
export const MAX_LEARNING_CHARS = 300
const MAX_REACTION_LOOKUPS = 20
const MAX_PERMISSION_LOOKUPS = 10

const REMEMBER = /^\s*(?:\/remember|(?:@|\/)pr-reviewer\s+remember)\b[:\s]*([\s\S]*)$/i
const DISMISS = /^\s*(?:\/dismiss|(?:@|\/)pr-reviewer\s+(?:dismiss|ignore))\b[:\s]*([\s\S]*)$/i
const FORGET = /^\s*\/forget\b/i
const HEADING = /^\*\*([A-Z]+) · ([^*]+)\*\* — (.+)$/m

/** Plain one-line text: no tags (so it cannot close a prompt block), no runs of whitespace, capped. */
export function cleanLearningText(text: string, max = MAX_LEARNING_CHARS): string {
  const flat = text
    .replace(/<!--[\s\S]*?(-->|$)/g, ' ')
    .replace(/<\/?[A-Za-z_][^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

/**
 * Turns feedback on the reviewer's own inline comments into learnings, newest first. `trusted` decides whose
 * feedback counts (by GitHub id when known, else login); `thumbsDown` maps comment id → logins that reacted 👎.
 */
export function collectLearnings(
  comments: readonly RepoReviewComment[],
  rid: number,
  fpv: number,
  trusted: (who: { id?: number | undefined; login: string }) => boolean,
  thumbsDown: ReadonlyMap<number, readonly string[]>,
): Learning[] {
  const replies = new Map<number, RepoReviewComment[]>()
  for (const c of comments) if (c.inReplyTo !== undefined) replies.set(c.inReplyTo, [...(replies.get(c.inReplyTo) ?? []), c])

  const threads: Array<{ at: string; fp: string; items: Learning[] }> = []
  for (const own of comments) {
    const m = ownMarker(own, rid)
    if (!m || m.kind !== 'inline' || m.fpv !== fpv || m.fp === '-') continue
    const h = HEADING.exec(own.body)
    const title = h?.[3]?.trim() ?? 'a finding'
    const what = `"${cleanLearningText(title, 160)}"${h ? ` (${h[1]} ${h[2]!.trim()}${own.path ? ` in ${own.path}` : ''})` : own.path ? ` (in ${own.path})` : ''}`
    const base = { pr: own.pr, ...(own.url ? { url: own.url } : {}) }
    let items: Learning[] = []
    let dismissed: Learning | undefined
    let at = own.createdAt ?? ''
    // A 👎 has no time; it counts as given before any reply, so a later /forget clears it.
    const thumb = (thumbsDown.get(own.id) ?? []).find((login) => trusted({ login }))
    if (thumb) dismissed = { kind: 'DISMISSED', text: `Dismissed ${what}.`, by: thumb, ...base }
    const thread = [...(replies.get(own.id) ?? [])].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
    for (const r of thread) {
      const by = r.authorLogin ?? 'unknown'
      if (!trusted({ id: r.authorId, login: by })) continue
      if (FORGET.test(r.body)) {
        items = []
        dismissed = undefined
        at = r.createdAt ?? at
        continue
      }
      const remember = REMEMBER.exec(r.body)
      const dismiss = DISMISS.exec(r.body)
      if (remember) {
        const text = cleanLearningText(remember[1] ?? '')
        if (text) items.push({ kind: 'REMEMBER', text, by, ...base })
      } else if (dismiss) {
        const why = cleanLearningText(dismiss[1] ?? '', 200)
        dismissed = { kind: 'DISMISSED', text: `Dismissed ${what}${why ? `: ${why}` : '.'}`, by, ...base }
      } else continue
      if ((r.createdAt ?? '') > at) at = r.createdAt ?? at
    }
    const all = [...(dismissed ? [dismissed] : []), ...items]
    if (all.length) threads.push({ at, fp: m.fp, items: all })
  }

  // Newest feedback first; one thread per finding fingerprint, and each remembered text once.
  threads.sort((a, b) => b.at.localeCompare(a.at))
  const seenFp = new Set<string>()
  const seenText = new Set<string>()
  const out: Learning[] = []
  for (const t of threads) {
    if (seenFp.has(t.fp)) continue
    seenFp.add(t.fp)
    for (const l of t.items) {
      const key = `${l.kind}:${l.text.toLowerCase()}`
      if (seenText.has(key)) continue
      seenText.add(key)
      out.push(l)
    }
  }
  return out.slice(0, MAX_LEARNINGS)
}

export interface LearningsRead {
  learnings: Learning[]
  /** Things the read could not do (e.g. permission checks skipped); shown as limitations. */
  notes: string[]
}

/**
 * Reads the repository's recent inline review comments and returns its learnings. Needs a reader that can list
 * repository-wide comments; one that cannot yields none. Trust beyond the Reviewer Identity needs `canPush`.
 */
export async function readLearnings(github: GitHubReader, repo: RepoRef, rid: number, fpv: number, nowMs: number): Promise<Result<LearningsRead>> {
  if (!github.listRepoReviewComments) return ok({ learnings: [], notes: [] })
  const since = new Date(nowMs - LEARNING_WINDOW_DAYS * 86_400_000).toISOString()
  const listed = await github.listRepoReviewComments(repo, { sinceIso: since, max: MAX_LEARNING_COMMENTS })
  if (!listed.ok) return listed
  const comments = listed.value.items
  const notes: string[] = []

  const ownIds = new Set(comments.filter((c) => ownMarker(c, rid)?.kind === 'inline').map((c) => c.id))
  const viewerLogin = comments.find((c) => c.authorId === rid && c.authorLogin)?.authorLogin
  const thumbsDown = new Map<number, string[]>()
  const reacted = comments.filter((c) => ownIds.has(c.id) && (c.thumbsDownCount ?? 0) > 0)
  if (reacted.length > MAX_REACTION_LOOKUPS) notes.push(`Learning: 👎 reactions were read on the ${MAX_REACTION_LOOKUPS} most recent of ${reacted.length} reacted comments only.`)
  await Promise.all(
    reacted.slice(0, MAX_REACTION_LOOKUPS).map(async (c) => {
      const res = await github.listThumbsDown({ ...repo, number: c.pr }, c.id)
      if (res.ok) thumbsDown.set(c.id, res.value)
    }),
  )

  // Who else may speak for the repository: people who can push to it, checked once each.
  const isCommand = (body: string) => REMEMBER.test(body) || DISMISS.test(body) || FORGET.test(body)
  const candidates = new Set<string>()
  for (const c of comments) if (c.inReplyTo !== undefined && ownIds.has(c.inReplyTo) && c.authorId !== rid && c.authorLogin && isCommand(c.body)) candidates.add(c.authorLogin)
  for (const logins of thumbsDown.values()) for (const l of logins) if (l !== viewerLogin) candidates.add(l)
  const pushers = new Set<string>()
  const toCheck = [...candidates]
  if (toCheck.length && !github.canPush) notes.push('Learning: only your own feedback counts here (repository permissions cannot be checked).')
  else if (toCheck.length > MAX_PERMISSION_LOOKUPS) notes.push(`Learning: feedback from ${toCheck.length - MAX_PERMISSION_LOOKUPS} more people was ignored (permission checks are capped at ${MAX_PERMISSION_LOOKUPS}).`)
  if (github.canPush) {
    const results = await Promise.all(toCheck.slice(0, MAX_PERMISSION_LOOKUPS).map(async (login) => [login, await github.canPush!(repo, login)] as const))
    for (const [login, res] of results) if (res.ok && res.value) pushers.add(login)
  }
  const trusted = (who: { id?: number | undefined; login: string }) => who.id === rid || (viewerLogin !== undefined && who.login === viewerLogin) || pushers.has(who.login)
  return ok({ learnings: collectLearnings(comments, rid, fpv, trusted, thumbsDown), notes })
}
