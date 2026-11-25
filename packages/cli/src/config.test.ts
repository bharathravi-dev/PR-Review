import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { userConfigPath } from './config-file.js'
import { main } from './main.js'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function configFile(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'prr-config-'))
  dirs.push(dir)
  const path = join(dir, 'config.yml')
  writeFileSync(path, yaml)
  return path
}

async function run(argv: string[], env: Record<string, string>) {
  let out = ''
  let err = ''
  const code = await main(argv, { stdout: (t) => (out += t), stderr: (t) => (err += t) }, { env })
  return { code, out, err }
}

describe('config file location', () => {
  it('follows XDG, falls back to ~/.config, and uses APPDATA on Windows', () => {
    expect(userConfigPath({ env: { XDG_CONFIG_HOME: '/x' }, platform: 'linux', homedir: '/h' })).toBe('/x/pr-reviewer/config.yml')
    expect(userConfigPath({ env: {}, platform: 'darwin', homedir: '/h' })).toBe('/h/.config/pr-reviewer/config.yml')
    expect(userConfigPath({ env: { APPDATA: 'C:\\A' }, platform: 'win32', homedir: 'C:\\h' })).toContain('pr-reviewer')
    expect(userConfigPath({ env: { PR_REVIEWER_CONFIG: '/p.yml' }, platform: 'linux', homedir: '/h' })).toBe('/p.yml')
  })
})

describe('pr-reviewer config', () => {
  it('shows each value with the layer that set it', async () => {
    const path = configFile('version: 1\ngithub:\n  host: ghe.example.com\nprofiles:\n  ci:\n    defaultProvider: work\n')
    const r = await run(['config', 'show', '--profile', 'ci'], { PR_REVIEWER_CONFIG: path })
    expect(r.code).toBe(0)
    expect(r.out).toContain('github.host = "ghe.example.com"  (user)')
    expect(r.out).toContain('github.credential = "github"  (default)')
    expect(r.out).toContain('defaultProvider = "work"  (profile:ci)')
  })

  it('fails with the schema path for an invalid config (exit 78)', async () => {
    const path = configFile('version: 1\ngithub:\n  credential: ghp_should_not_be_here\n')
    const r = await run(['config', 'show'], { PR_REVIEWER_CONFIG: path })
    expect(r.code).toBe(78)
    expect(r.err).toContain('github.credential')
  })

  it('refuses a config written by a newer version and broken YAML', async () => {
    expect((await run(['config', 'show'], { PR_REVIEWER_CONFIG: configFile('version: 9\n') })).err).toContain('newer pr-reviewer')
    expect((await run(['config', 'show'], { PR_REVIEWER_CONFIG: configFile('version: [1\n') })).code).toBe(78)
  })

  it('works with no config file and prints the path', async () => {
    const r = await run(['config', 'show'], { PR_REVIEWER_CONFIG: '/nonexistent/config.yml' })
    expect(r.code).toBe(0)
    expect(r.out).toContain('github.host = "github.com"  (default)')
    expect((await run(['config', 'path'], { PR_REVIEWER_CONFIG: '/x.yml' })).out).toBe('/x.yml\n')
  })
})
