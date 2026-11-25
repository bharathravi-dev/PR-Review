// Local per-user state: usage ledger (FR-12) and one-time notices. Never contains PR content or Credentials.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UsageEntry, UsageLedger } from '@pr-reviewer/core'
import type { CliDeps } from './deps.js'

/** $XDG_STATE_HOME/pr-reviewer, ~/.local/state/pr-reviewer, or %LOCALAPPDATA%\pr-reviewer. */
export function stateDir(deps: Pick<CliDeps, 'env' | 'homedir' | 'platform'>): string {
  if (deps.env.PR_REVIEWER_STATE_DIR) return deps.env.PR_REVIEWER_STATE_DIR
  if (deps.platform === 'win32') return join(deps.env.LOCALAPPDATA ?? join(deps.homedir, 'AppData', 'Local'), 'pr-reviewer')
  return join(deps.env.XDG_STATE_HOME ?? join(deps.homedir, '.local', 'state'), 'pr-reviewer')
}

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, path)
}

export interface MonthUsage {
  runs: number
  inputTokens: number
  outputTokens: number
  /** Metered spend with known cost (USD). */
  costUsd: number
  byProvider: Record<string, { runs: number; inputTokens: number; outputTokens: number; costUsd: number; billing: UsageEntry['billing'] }>
}

interface LedgerFile {
  version: 1
  months: Record<string, MonthUsage>
}

const month = (iso: string) => iso.slice(0, 7)

/** File-backed usage ledger, aggregated per calendar month (UTC); keeps the last 13 months. */
export function fileLedger(dir: string, now: () => number = Date.now): UsageLedger & { months(): Record<string, MonthUsage> } {
  const path = join(dir, 'usage.json')
  const load = () => readJson<LedgerFile>(path, { version: 1, months: {} })
  return {
    months: () => load().months,
    async monthToDateUsd() {
      return load().months[month(new Date(now()).toISOString())]?.costUsd ?? 0
    },
    async record(e) {
      const file = load()
      const m = (file.months[month(e.at)] ??= { runs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, byProvider: {} })
      m.runs += 1
      m.inputTokens += e.inputTokens
      m.outputTokens += e.outputTokens
      m.costUsd += e.costUsd
      const p = (m.byProvider[e.provider] ??= { runs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, billing: e.billing })
      p.runs += 1
      p.inputTokens += e.inputTokens
      p.outputTokens += e.outputTokens
      p.costUsd += e.costUsd
      const keep = Object.keys(file.months).sort().slice(-13)
      file.months = Object.fromEntries(keep.map((k) => [k, file.months[k]!]))
      writeJson(path, file)
    },
  }
}

/** Returns true the first time `id` is seen, and remembers it. */
export function firstTime(dir: string, id: string): boolean {
  const path = join(dir, 'notices.json')
  const seen = readJson<Record<string, string>>(path, {})
  if (seen[id]) return false
  try {
    writeJson(path, { ...seen, [id]: new Date().toISOString() })
  } catch {
    // Not remembering a notice is harmless.
  }
  return true
}
