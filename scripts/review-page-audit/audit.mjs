// Accessibility audit of review page v2 (Epic 9 Story 9.9): runs axe-core (WCAG 2.1 A/AA + best practice) in headless
// Chrome on every surface, in light and dark, at 1440px and 320px, against a mock ReviewService (no GitHub, no AI).
// Usage: pnpm audit:v2   (CHROME_PATH overrides the browser; exits 1 on any violation)
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const dir = dirname(fileURLToPath(import.meta.url))
const root = join(dir, '..', '..')
const staticDir = join(root, 'packages', 'cli', 'static')
const axe = join(root, 'node_modules', 'axe-core', 'axe.min.js')
const chrome = process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome')
const work = mkdtempSync(join(tmpdir(), 'prr-audit-'))
const surfaces = ['start', 'overview', 'attention', 'pre', 'checks', 'walkthrough', 'stats', 'settings', 'drawer']
const out = {}
for (const theme of ['light', 'dark']) for (const width of [1440, 320]) for (const surface of surfaces) {
  const srv = spawn(process.execPath, [join(dir, 'mock-service.mjs'), staticDir, '4798', surface, theme, axe], { stdio: 'ignore' })
  await new Promise((r) => setTimeout(r, 700))
  const prof = join(work, 'profile')
  rmSync(prof, { recursive: true, force: true })
  let dom = ''
  try {
    dom = execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${prof}`, `--window-size=${width},900`, '--virtual-time-budget=9000', '--dump-dom', 'http://127.0.0.1:4798/v2/'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000 })
  } finally {
    srv.kill()
  }
  const m = /<pre id="axe-results">([\s\S]*?)<\/pre>/.exec(dom)
  const raw = m ? m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : null
  const v = raw ? JSON.parse(raw) : [{ id: 'NO-RESULT', impact: 'n/a', help: 'axe did not report', nodes: [] }]
  for (const x of v) {
    const key = `${x.id} (${x.impact})`
    out[key] ??= { help: x.help, where: new Set(), nodes: new Set() }
    out[key].where.add(`${surface}/${theme}/${width}`)
    for (const n of x.nodes) out[key].nodes.add(n)
  }
}
for (const [k, v] of Object.entries(out)) console.log(`${k}: ${v.help}\n  on: ${[...v.where].join(', ')}\n  e.g. ${[...v.nodes].slice(0, 3).join('\n       ')}`)
rmSync(work, { recursive: true, force: true })
if (!Object.keys(out).length) console.log('No axe violations on any surface, theme or width.')
else process.exitCode = 1
