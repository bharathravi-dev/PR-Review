import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { err, ok, parseUserConfig, type Result, type UserConfig } from '@pr-reviewer/core'
import { parse } from 'yaml'

export interface ConfigLocationEnv {
  env: Readonly<Record<string, string | undefined>>
  platform: string
  homedir: string
}

/** User config path: XDG_CONFIG_HOME, else ~/.config on macOS/Linux; %APPDATA% on Windows (AD-13). */
export function userConfigPath({ env, platform, homedir }: ConfigLocationEnv): string {
  if (env.PR_REVIEWER_CONFIG) return env.PR_REVIEWER_CONFIG
  if (platform === 'win32') return join(env.APPDATA ?? join(homedir, 'AppData', 'Roaming'), 'pr-reviewer', 'config.yml')
  return join(env.XDG_CONFIG_HOME || join(homedir, '.config'), 'pr-reviewer', 'config.yml')
}

/** Reads and validates the user config; a missing file is not an error. */
export function loadUserConfig(path: string): Result<UserConfig | undefined> {
  if (!existsSync(path)) return ok(undefined)
  let raw: unknown
  try {
    raw = parse(readFileSync(path, 'utf8'))
  } catch (e) {
    return err('config_unreadable', `Could not read ${path}: ${(e as Error).message}`)
  }
  const parsed = parseUserConfig(raw)
  if (!parsed.ok) return err(parsed.error.code, `${path}: ${parsed.error.message}`)
  return parsed
}
