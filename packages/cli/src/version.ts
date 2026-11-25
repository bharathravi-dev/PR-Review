import { readFileSync } from 'node:fs'

/** The CLI package version (also the engine version recorded in Reports). */
export const VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version

export const USER_AGENT = `pr-reviewer/${VERSION}`

export const ENGINE_MAJOR = Number(VERSION.split('.')[0]) || 0
