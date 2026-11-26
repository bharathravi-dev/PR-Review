// "Apply fix" (roadmap item 16): commit a finding's suggested change to the PR branch, from the review page or the
// extension. Only when the PR is still at the reviewed commit, and only the lines the finding points at change.
import type { Finding } from './findings.js'
import type { GitHubReader, GitHubWriter } from './ports.js'
import type { PrRef } from './pr-ref.js'
import type { Report } from './report.js'
import { err, ok, type Result } from './result.js'
import type { PrContext } from './schemas.js'

/** Replaces lines start..end (1-based, inclusive) with `replacement`, keeping the file's line endings. */
export function replaceLines(text: string, start: number, end: number, replacement: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const body = replacement.replace(/\r?\n$/, '').split(/\r?\n/)
  lines.splice(start - 1, end - start + 1, ...body)
  return lines.join(eol)
}

/** The finding a fix can be applied for: a suggestion on exact lines of a file. */
export function applicableFinding(report: Report, fingerprint: string): Finding | undefined {
  const f = report.findings.find((x) => x.fingerprint === fingerprint || x.fingerprints?.includes(fingerprint))
  return f?.suggestion !== undefined && f.location.anchorKind === 'LINE' && f.location.path && f.location.startLine ? f : undefined
}

/** Commits the suggestion; refuses when the PR moved, the file is gone, or nothing would change. */
export async function applyFix(
  ref: PrRef,
  report: Report,
  context: Pick<PrContext, 'headRef' | 'headRepo' | 'headSha'>,
  fingerprint: string,
  ports: { reader: GitHubReader; writer: GitHubWriter },
): Promise<Result<{ commitSha: string; url?: string | undefined }>> {
  const f = applicableFinding(report, fingerprint)
  if (!f) return err('no_suggestion', 'This finding has no suggested change to commit.')
  if (!ports.writer.commitFile) return err('not_supported', 'Committing fixes is not available here.')
  const head = await ports.reader.getHeadSha(ref)
  if (!head.ok) return head
  if (head.value !== report.run.headSha) return err('head_moved', 'The PR moved to a new commit since this review; review it again, then commit the fix.')
  const path = f.location.path!
  const file = await ports.reader.readFile(ref, path, head.value)
  if (!file.ok) return file
  if (file.value === undefined) return err('file_missing', `${path} is not in the PR's head any more.`)
  const start = f.location.startLine!
  const end = f.location.endLine ?? start
  const next = replaceLines(file.value, start, end, f.suggestion!)
  if (next === file.value) return err('no_change', 'The suggested change is already there.')
  const [owner, repo] = (context.headRepo ?? `${ref.owner}/${ref.repo}`).split(/\/(?=[^/]+$)/) as [string, string]
  return ports.writer.commitFile({ host: ref.host, owner, repo }, { branch: context.headRef, path, content: next, expectedHead: head.value, message: `Apply review suggestion: ${f.title}\n\nIn ${path} at lines ${start}-${end}, suggested by PR Reviewer.` })
}
