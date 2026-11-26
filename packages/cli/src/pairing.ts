// Pairing the browser extension with `pr-reviewer serve` on this computer (Story 7.8).
// A short code printed in the terminal is exchanged once for a long-lived token; only its hash is stored.
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The port `serve` uses when pairing is in play, so the extension can find it again. */
export const PAIRED_PORT = 4747
export const PAIR_CODE_TTL_MS = 10 * 60_000
export const PAIR_CODE_MAX_TRIES = 5
const PAIRINGS_FILE = 'paired-extensions.json'
/** No 0/O, 1/I/L: the code is read off a terminal and typed by hand. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/

export interface Pairing {
  id: string
  origin: string
  tokenHash: string
  createdAt: string
}

export function isExtensionOrigin(origin: string | undefined): origin is string {
  return origin !== undefined && EXTENSION_ORIGIN.test(origin)
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex')

export function readPairings(dir: string): Pairing[] {
  try {
    const raw = JSON.parse(readFileSync(join(dir, PAIRINGS_FILE), 'utf8')) as { pairings?: unknown }
    return Array.isArray(raw.pairings) ? (raw.pairings as Pairing[]).filter((p) => typeof p?.tokenHash === 'string' && isExtensionOrigin(p.origin)) : []
  } catch {
    return []
  }
}

function writePairings(dir: string, pairings: Pairing[]): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = join(dir, PAIRINGS_FILE)
  writeFileSync(`${file}.tmp`, `${JSON.stringify({ version: 1, pairings }, null, 2)}\n`, { mode: 0o600 })
  renameSync(`${file}.tmp`, file)
}

/** Removes every pairing; returns how many there were. */
export function unpairAll(dir: string): number {
  const n = readPairings(dir).length
  writePairings(dir, [])
  return n
}

/** The pairing this token belongs to, when it comes from the origin it was issued to. */
export function pairedFor(dir: string, origin: string, token: string): Pairing | undefined {
  if (!token) return undefined
  const given = Buffer.from(hash(token), 'hex')
  return readPairings(dir).find((p) => p.origin === origin && timingSafeEqual(Buffer.from(p.tokenHash, 'hex'), given))
}

export function pairedOrigins(dir: string): Set<string> {
  return new Set(readPairings(dir).map((p) => p.origin))
}

export function newPairCode(): string {
  let code = ''
  for (let i = 0; i < 8; i++) code += ALPHABET[randomInt(ALPHABET.length)]
  return code
}

/** Shown as ABCD-EFGH; typed with or without the dash, any case, spaces ignored. */
export const formatPairCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`
const normalize = (typed: string) => typed.toUpperCase().replace(/[\s-]/g, '')

export type PairResult = { ok: true; token: string } | { ok: false; reason: 'wrong' | 'expired' }

/** One pairing window: the code works once, for ten minutes, and stops after five wrong tries. */
export function createPairingWindow(opts: { dir: string; code?: string; now?: () => number }) {
  const now = opts.now ?? Date.now
  const code = opts.code ?? newPairCode()
  const expiresAt = now() + PAIR_CODE_TTL_MS
  let tries = 0
  let used = false
  return {
    code,
    expiresAt,
    get open() {
      return !used && tries < PAIR_CODE_MAX_TRIES && now() < expiresAt
    },
    exchange(typed: unknown, origin: string): PairResult {
      if (used || tries >= PAIR_CODE_MAX_TRIES || now() >= expiresAt) return { ok: false, reason: 'expired' }
      const given = Buffer.from(typeof typed === 'string' ? normalize(typed) : '')
      const want = Buffer.from(code)
      if (given.length !== want.length || !timingSafeEqual(given, want)) {
        tries++
        return { ok: false, reason: tries >= PAIR_CODE_MAX_TRIES ? 'expired' : 'wrong' }
      }
      used = true
      const token = randomBytes(32).toString('base64url')
      const pairing: Pairing = { id: randomBytes(8).toString('hex'), origin, tokenHash: hash(token), createdAt: new Date(now()).toISOString() }
      // One pairing per extension: re-pairing replaces the old token.
      writePairings(opts.dir, [...readPairings(opts.dir).filter((p) => p.origin !== origin), pairing])
      return { ok: true, token }
    },
  }
}
