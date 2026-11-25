import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { DEFAULT_CONTEXT_LIMITS, EXIT_CODES, fetchContext, formatPrRef, parsePrRef, type PrContext } from '@pr-reviewer/core'
import { GitHubClient, GitHubPrReader, apiUrlForHost } from '@pr-reviewer/github'

/** Output sinks for the CLI; injected so tests don't touch the real process. */
export interface CliIo {
  stdout: (text: string) => void
  stderr: (text: string) => void
}

/** Effects the composition root needs; defaults come from the real process. */
export interface CliDeps {
  env: Readonly<Record<string, string | undefined>>
  fetch: typeof fetch
}

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string
}

const USAGE = `Usage: pr-reviewer <command> [options]

Review GitHub pull requests with deterministic checks and the AI provider of your choice.

Commands:
  context <pr>      Load a PR's context from GitHub (<pr> is a URL or owner/repo#number)
  help              Show this help

Options:
  -h, --help        Show this help
  -v, --version     Print the version

context options:
  --json            Print the full context as JSON
  --api-url <url>   GitHub API base URL (default: derived from the PR's host)
  --host <host>     Host for owner/repo#number references (default: github.com)

GitHub token: GITHUB_TOKEN or GH_TOKEN.
`

/** Runs the CLI with the given arguments (without the node/script prefix) and returns the exit code. */
export async function main(argv: readonly string[], io: CliIo, deps?: Partial<CliDeps>): Promise<number> {
  const [first, ...rest] = argv

  if (first === undefined || first === 'help' || first === '-h' || first === '--help') {
    io.stdout(USAGE)
    return EXIT_CODES.passed
  }

  if (first === '-v' || first === '--version') {
    if (rest.length > 0) return usageError(io, `Unexpected argument: ${rest[0]}`)
    io.stdout(`${pkg.version}\n`)
    return EXIT_CODES.passed
  }

  if (first === 'context') {
    return contextCommand(rest, io, { env: deps?.env ?? {}, fetch: deps?.fetch ?? globalThis.fetch })
  }

  const kind = first.startsWith('-') ? 'option' : 'command'
  return usageError(io, `Unknown ${kind}: ${first}`)
}

function usageError(io: CliIo, message: string): number {
  io.stderr(`${message}\n\n${USAGE}`)
  return EXIT_CODES.usage
}

async function contextCommand(args: string[], io: CliIo, deps: CliDeps): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: { json: { type: 'boolean' }, 'api-url': { type: 'string' }, host: { type: 'string' } },
    })
  } catch (e) {
    return usageError(io, (e as Error).message)
  }
  const [input, ...extra] = parsed.positionals
  if (!input || extra.length > 0) return usageError(io, 'context needs exactly one PR reference')

  const ref = parsePrRef(input, parsed.values.host ?? 'github.com')
  if (!ref.ok) return usageError(io, ref.error.message)

  const token = deps.env.GITHUB_TOKEN || deps.env.GH_TOKEN || undefined
  const client = new GitHubClient({
    apiUrl: parsed.values['api-url'] ?? apiUrlForHost(ref.value.host),
    token,
    fetch: deps.fetch,
    userAgent: `pr-reviewer/${pkg.version}`,
  })
  const res = await fetchContext(new GitHubPrReader(client), ref.value, DEFAULT_CONTEXT_LIMITS)
  if (!res.ok) {
    io.stderr(`Could not load ${formatPrRef(ref.value)}: ${res.error.message}\n`)
    return EXIT_CODES.error
  }
  io.stdout(parsed.values.json ? `${JSON.stringify(res.value, null, 2)}\n` : summarize(res.value))
  return EXIT_CODES.passed
}

function summarize(ctx: PrContext): string {
  const lines = [
    `${formatPrRef(ctx.ref)}  ${ctx.title}`,
    `author ${ctx.author}  state ${ctx.state}${ctx.draft ? ' (draft)' : ''}${ctx.fromFork ? '  from fork' : ''}`,
    `base ${ctx.baseRef}@${ctx.baseSha.slice(0, 7)}  head ${ctx.headRef}@${ctx.headSha.slice(0, 7)}  merge-base ${ctx.mergeBaseSha.slice(0, 7)}`,
    `${ctx.files.length} changed file(s), ${ctx.reviews.length} review(s), ${ctx.reviewComments.length + ctx.issueComments.length} comment(s)`,
    ...ctx.files.map((f) => `  ${f.status.padEnd(8)} ${f.previousPath ? `${f.previousPath} -> ` : ''}${f.path}${f.binary ? ' (binary)' : ''}`),
    ...ctx.truncated.map((t) => `note: ${t}`),
  ]
  return `${lines.join('\n')}\n`
}
