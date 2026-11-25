// `pr-reviewer mcp`: a Model Context Protocol server on stdio, so coding agents (Claude Code, Cursor, Codex, …) can
// review a PR and read its open findings as tools. It never posts: publishing stays a human action in the CLI,
// the review page, or the Web App. Protocol: JSON-RPC 2.0, one message per line; stdout carries only protocol.
import { createInterface } from 'node:readline'
import { agentPromptText, ownInlineComments, FPV, parsePrRef, type ResolvedConfig, type Secret } from '@pr-reviewer/core'
import type { CliDeps, CliIo } from './deps.js'
import { connectGitHub, executeReview } from './engine.js'
import { openFindings } from './fix.js'
import { VERSION } from './version.js'

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']

export const MCP_TOOLS = [
  {
    name: 'review_pr',
    description:
      'Review a GitHub pull request with pr-reviewer (deterministic checks and AI) and return the findings. Nothing is posted to GitHub. Takes one to several minutes.',
    inputSchema: {
      type: 'object',
      properties: {
        pr: { type: 'string', description: 'PR link or owner/repo#number' },
        provider: { type: 'string', description: 'AI provider name from the pr-reviewer config (optional)' },
      },
      required: ['pr'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: 'open_findings',
    description:
      "List the findings you (the configured GitHub user) posted on a PR with pr-reviewer that are not yet fixed or dismissed, each with a ready-to-use fix prompt. Read-only.",
    inputSchema: {
      type: 'object',
      properties: { pr: { type: 'string', description: 'PR link or owner/repo#number' } },
      required: ['pr'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
] as const

type Json = Record<string, unknown>
interface Request {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Json
}

/** Lines from stdin by default; injected in tests. */
export type LineSource = AsyncIterable<string>

export async function mcpCommand(io: CliIo, deps: CliDeps, secrets: Secret[], resolve: () => ResolvedConfig | number, lines?: LineSource): Promise<number> {
  const send = (msg: Json) => io.stdout(`${JSON.stringify(msg)}\n`)
  const reply = (id: Request['id'], result: Json) => send({ jsonrpc: '2.0', id: id ?? null, result })
  const fail = (id: Request['id'], code: number, message: string) => send({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
  const text = (t: string, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) })

  const config = resolve()
  if (typeof config === 'number') return config
  const host = config.settings.github?.host ?? 'github.com'

  const tools: Record<string, (args: Json) => Promise<Json>> = {
    review_pr: async (args) => {
      const ref = parsePrRef(String(args.pr ?? ''), host)
      if (!ref.ok) return text(ref.error.message, true)
      const github = await connectGitHub(config, deps, secrets, ref.value.host)
      const { report } = await executeReview({ config, deps, secrets, ref: ref.value, github, provider: typeof args.provider === 'string' ? args.provider : undefined, onNotice: (t) => io.stderr(`${t}\n`), onWarning: (w) => io.stderr(`warning: ${w}\n`) })
      const findings = report.findings
        .filter((f) => f.scope !== 'PRE_EXISTING')
        .map((f) => {
          const loc = f.location
          return {
            severity: f.severity,
            category: f.category,
            title: f.title,
            ...(loc.path ? { path: loc.path } : {}),
            ...(loc.startLine ? { lines: [loc.startLine, loc.endLine ?? loc.startLine] } : {}),
            description: f.description,
            ...(f.recommendation ? { recommendation: f.recommendation } : {}),
            ...(f.suggestion ? { suggestion: f.suggestion } : {}),
            source: f.sourceFamily === 'AI' ? 'AI' : (f.provenance.tool ?? f.provenance.validator),
            ...(loc.path && loc.startLine ? { fixPrompt: agentPromptText(f, loc.path, loc.startLine, loc.endLine ?? loc.startLine) } : {}),
          }
        })
      const result = {
        pr: `${ref.value.owner}/${ref.value.repo}#${ref.value.number}`,
        headSha: report.run.headSha,
        overallStatus: report.overallStatus,
        headline: report.coverage.headline,
        checks: report.layers.map((l) => ({ check: l.validator, status: l.status, ...(l.reason ? { reason: l.reason } : {}), ...(l.detail ? { detail: l.detail } : {}) })),
        ...(report.walkthrough ? { walkthrough: report.walkthrough } : {}),
        findings,
        preExisting: report.findings.length - findings.length,
        limitations: report.limitations,
        note: 'Nothing was posted. To post, run "pr-reviewer review <pr> --post" or use the review page.',
      }
      return text(JSON.stringify(result, null, 2))
    },
    open_findings: async (args) => {
      const ref = parsePrRef(String(args.pr ?? ''), host)
      if (!ref.ok) return text(ref.error.message, true)
      const github = await connectGitHub(config, deps, secrets, ref.value.host)
      if (!github.viewer) return text(`The GitHub identity is unknown: ${github.tokenError ?? github.viewerError ?? 'no token'}`, true)
      const published = await github.reader.listPublished(ref.value)
      if (!published.ok) return text(published.error.message, true)
      const thumbs = new Map<number, string[]>()
      for (const c of ownInlineComments(published.value, github.viewer.id, FPV)) {
        const t = await github.reader.listThumbsDown(ref.value, c.id)
        if (t.ok) thumbs.set(c.id, t.value)
      }
      const { open, withoutPrompt } = openFindings(published.value, github.viewer.id, thumbs)
      return text(JSON.stringify({ open: open.map((f) => ({ title: f.title, fixPrompt: f.prompt, ...(f.url ? { url: f.url } : {}) })), ...(withoutPrompt ? { withoutPrompt } : {}) }, null, 2))
    },
  }

  const handle = async (msg: Request): Promise<void> => {
    // Notifications (no id) never get a response; none of ours needs handling.
    if (msg.id === undefined) return
    switch (msg.method) {
      case 'initialize': {
        const asked = typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : PROTOCOL_VERSIONS[0]!
        return reply(msg.id, {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: 'pr-reviewer', version: VERSION },
          instructions: 'Review GitHub pull requests and read open review findings. These tools never post to GitHub.',
        })
      }
      case 'ping':
        return reply(msg.id, {})
      case 'tools/list':
        return reply(msg.id, { tools: MCP_TOOLS })
      case 'tools/call': {
        const name = String(msg.params?.name ?? '')
        const tool = tools[name]
        if (!tool) return fail(msg.id, -32602, `Unknown tool: ${name}`)
        try {
          return reply(msg.id, await tool((msg.params?.arguments as Json | undefined) ?? {}))
        } catch (e) {
          return reply(msg.id, text(`pr-reviewer failed: ${(e as Error).message}`, true))
        }
      }
      default:
        return fail(msg.id, -32601, `Method not found: ${msg.method}`)
    }
  }

  const source = lines ?? createInterface({ input: process.stdin, crlfDelay: Infinity })
  const pending: Array<Promise<void>> = []
  for await (const line of source) {
    if (!line.trim()) continue
    let msg: Request
    try {
      msg = JSON.parse(line) as Request
    } catch {
      fail(null, -32700, 'Parse error')
      continue
    }
    if (typeof msg !== 'object' || msg === null || typeof msg.method !== 'string') {
      if (msg && typeof msg === 'object' && 'id' in msg) fail((msg as Request).id, -32600, 'Invalid request')
      continue
    }
    // Long tool calls run concurrently with pings and other requests.
    pending.push(handle(msg))
  }
  await Promise.all(pending)
  return 0
}
