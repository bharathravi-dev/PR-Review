// The Web App's store (StorePort, AD-25): users, encrypted Credentials, sessions, and run history, as files under one
// data directory. Credentials are encrypted at rest with AES-256-GCM; session ids are stored only as hashes.
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Report } from '@pr-reviewer/core'

export interface WebUser {
  id: number
  login: string
  avatarUrl?: string | undefined
}

export interface UserSettings {
  provider: { type: 'anthropic' | 'openai-compatible'; model?: string | undefined; baseUrl?: string | undefined }
}

export interface StoredRun {
  id: string
  pr: string
  startedAt: string
  overallStatus: string
  findings: number
  fingerprints: string[]
  published?: string | undefined
  report: Report
}

const SESSION_TTL_MS = 7 * 24 * 3600_000

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 })
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 })
  renameSync(tmp, path)
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return undefined
  }
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

export class WebStore {
  readonly #root: string
  readonly #key: Buffer

  /** `secret` (≥ 32 characters) derives the encryption key; losing it makes stored Credentials unreadable. */
  constructor(root: string, secret: string) {
    if (secret.length < 32) throw new Error('PR_REVIEWER_WEB_SECRET must be at least 32 characters.')
    this.#root = root
    this.#key = scryptSync(secret, 'pr-reviewer-web-store-v1', 32)
    mkdirSync(root, { recursive: true, mode: 0o700 })
  }

  userDir(id: number): string {
    return join(this.#root, 'users', String(id))
  }

  #encrypt(plain: string): string {
    const iv = randomBytes(12)
    const c = createCipheriv('aes-256-gcm', this.#key, iv)
    const data = Buffer.concat([c.update(plain, 'utf8'), c.final()])
    return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${data.toString('base64')}`
  }

  #decrypt(box: string | undefined): string | undefined {
    const parts = box?.split(':')
    if (!parts || parts.length !== 4 || parts[0] !== 'v1') return undefined
    try {
      const d = createDecipheriv('aes-256-gcm', this.#key, Buffer.from(parts[1]!, 'base64'))
      d.setAuthTag(Buffer.from(parts[2]!, 'base64'))
      return Buffer.concat([d.update(Buffer.from(parts[3]!, 'base64')), d.final()]).toString('utf8')
    } catch {
      return undefined
    }
  }

  saveUser(user: WebUser, githubToken: string): void {
    writeJson(join(this.userDir(user.id), 'profile.json'), { ...user, updatedAt: new Date().toISOString() })
    writeJson(join(this.userDir(user.id), 'github-token.json'), { box: this.#encrypt(githubToken) })
  }

  user(id: number): WebUser | undefined {
    return readJson<WebUser>(join(this.userDir(id), 'profile.json'))
  }

  githubToken(id: number): string | undefined {
    return this.#decrypt(readJson<{ box: string }>(join(this.userDir(id), 'github-token.json'))?.box)
  }

  settings(id: number): UserSettings {
    return readJson<UserSettings>(join(this.userDir(id), 'settings.json')) ?? { provider: { type: 'anthropic' } }
  }

  saveSettings(id: number, settings: UserSettings): void {
    writeJson(join(this.userDir(id), 'settings.json'), settings)
  }

  apiKey(id: number): string | undefined {
    return this.#decrypt(readJson<{ box: string }>(join(this.userDir(id), 'api-key.json'))?.box)
  }

  saveApiKey(id: number, key: string | null): void {
    const path = join(this.userDir(id), 'api-key.json')
    if (key === null) rmSync(path, { force: true })
    else writeJson(path, { box: this.#encrypt(key) })
  }

  /** Creates a session and returns its id (only its hash is stored). */
  createSession(userId: number): string {
    const sid = randomBytes(32).toString('base64url')
    writeJson(join(this.#root, 'sessions', `${sha256(sid)}.json`), { userId, expiresAt: Date.now() + SESSION_TTL_MS })
    return sid
  }

  session(sid: string | undefined): number | undefined {
    if (!sid || !/^[A-Za-z0-9_-]{43}$/.test(sid)) return undefined
    const s = readJson<{ userId: number; expiresAt: number }>(join(this.#root, 'sessions', `${sha256(sid)}.json`))
    if (!s) return undefined
    if (s.expiresAt < Date.now()) {
      this.endSession(sid)
      return undefined
    }
    return s.userId
  }

  endSession(sid: string): void {
    if (/^[A-Za-z0-9_-]{43}$/.test(sid)) rmSync(join(this.#root, 'sessions', `${sha256(sid)}.json`), { force: true })
  }

  saveRun(userId: number, run: StoredRun): void {
    writeJson(join(this.userDir(userId), 'runs', `${run.id}.json`), run)
  }

  run(userId: number, id: string): StoredRun | undefined {
    if (!/^[0-9a-f-]{36}$/.test(id)) return undefined
    const raw = readJson<StoredRun>(join(this.userDir(userId), 'runs', `${id}.json`))
    if (!raw) return undefined
    // Stored values are re-parsed with their schema on read (AD-26).
    const report = Report.safeParse(raw.report)
    return report.success ? { ...raw, report: report.data } : undefined
  }

  /** Runs, newest first (ids are UUIDv7, so they sort by time). */
  runs(userId: number, limit = 50): Array<Omit<StoredRun, 'report'>> {
    let names: string[]
    try {
      names = readdirSync(join(this.userDir(userId), 'runs')).filter((n) => n.endsWith('.json'))
    } catch {
      return []
    }
    return names
      .sort()
      .reverse()
      .slice(0, limit * 4)
      .flatMap((n) => {
        const r = readJson<StoredRun>(join(this.userDir(userId), 'runs', n))
        if (!r) return []
        const { report: _r, ...rest } = r
        return [rest]
      })
      .slice(0, limit)
  }
}
