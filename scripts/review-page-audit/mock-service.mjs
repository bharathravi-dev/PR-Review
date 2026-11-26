// Mock ReviewService v1 for looking at review page v2 in a real browser, without GitHub or an AI provider.
// Used by audit.mjs; also handy to look at v2 by hand: node mock-service.mjs <static dir> <port> <surface: overview|attention|pre|start|stats|settings|checks|walkthrough> [theme]
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const [staticDir, port = '4799', surface = 'overview', theme = 'light', axePath = ''] = process.argv.slice(2)
const RUN = '018f0000-0000-7000-8000-000000000001'
const fp = (n) => n.toString(16).padStart(64, '0')
const tslintRules = ['no-consecutive-blank-lines', 'trailing-comma', 'no-consecutive-blank-lines', 'prefer-const', 'brace-style', 'one-line', 'brace-style', 'one-line', 'prefer-const', 'one-line', 'brace-style', 'brace-style', 'one-line', 'prefer-template', 'align', 'object-shorthand-properties-first', 'no-increment-decrement', 'align', 'object-shorthand-properties-first', 'no-increment-decrement']
const path = 'project/ws/app/src/lib/routes/home/components/info-modal/info-modal.component.ts'
const html = 'project/ws/app/src/lib/routes/home/components/info-modal/info-modal.component.html'
const findings = [
  { fingerprint: fp(1), ruleId: 'ai/correctness', category: 'CORRECTNESS', severity: 'MINOR', confidence: 'HIGH', scope: 'NEW', sourceFamily: 'AI', provenance: { validator: 'ai.review', model: 'claude-opus-5-5' }, title: 'Progress text shows the wrong item and an out-of-range count between downloads', description: 'The progress block is now shown whenever `!isComplete`. During the 300 ms wait after each download, `items[currentIndex]` is undefined, so the dialog shows "Downloading report for (N+1/N)".', impact: 'Users see a wrong organisation name and an impossible count such as (4/3) at the end of every batch.', recommendation: 'Increment `currentIndex` only when the next download actually starts, or clamp the displayed index.', suggestion: '      Downloading {{ items[shown]?.name }} ({{ shown + 1 }}/{{ items.length }})', location: { anchorKind: 'LINE', path: html, startLine: 72, endLine: 72 } },
  { fingerprint: fp(2), ruleId: 'ai/correctness', category: 'CORRECTNESS', severity: 'MINOR', confidence: 'MEDIUM', scope: 'NEW', sourceFamily: 'AI', provenance: { validator: 'ai.review', model: 'claude-opus-5-5' }, title: 'Download link without target may navigate the app away when the download attribute is ignored', description: '`a.target = "_blank"` was removed, so the generated link now opens in the current window. Browsers ignore `download` for cross-origin URLs.', impact: 'An error response for one report could take the user out of the app in the middle of a batch.', recommendation: 'Fetch the file as a blob and download it through an object URL.', location: { anchorKind: 'LINE', path, startLine: 124, endLine: 127 } },
  { fingerprint: fp(3), ruleId: 'ai/maintainability', category: 'MAINTAINABILITY', severity: 'INFO', confidence: 'LOW', scope: 'NEW', sourceFamily: 'AI', provenance: { validator: 'ai.review', model: 'claude-opus-5-5' }, title: 'Consider logging the final failure of a batch', description: 'Failures are swallowed after the last retry.', location: { anchorKind: 'LINE', path, startLine: 140, endLine: 140 } },
  ...tslintRules.map((r, i) => ({ fingerprint: fp(100 + i), ruleId: `tslint/${r}`, category: 'STYLE', severity: 'MINOR', confidence: 'HIGH', scope: 'PRE_EXISTING', sourceFamily: 'DETERMINISTIC', provenance: { validator: 'lint.tslint', tool: 'tslint' }, title: `${r.replace(/-/g, ' ')} (${r})`, description: `TSLint reports: ${r}`, location: { anchorKind: 'LINE', path, startLine: 7 + i * 7, endLine: 7 + i * 7 } })),
]
const report = {
  schemaVersion: 1,
  run: { id: RUN, host: 'github.com', repo: { fullName: 'kb-igot/sunbird-cb-orgportal' }, pr: 796, headSha: '6e53c3e0b1a2', startedAt: new Date().toISOString() },
  title: 'Multiple reports download issue',
  overallStatus: 'PASSED_WITH_WARNINGS',
  layers: [
    { layer: 'CONTEXT', validator: 'github.context', status: 'PASSED', durationMs: 1100 },
    { layer: 'SECURITY', validator: 'repo.build-config-changes', status: 'PASSED', detail: 'No build, tool, or CI configuration changed.', durationMs: 40 },
    { layer: 'LINT', validator: 'lint.tslint', status: 'WARNING', detail: "project/ws/app: 20 problem(s) in changed files, with the repository's own tslint.json.", durationMs: 38000 },
    { layer: 'SECRETS', validator: 'secrets.builtin', status: 'PASSED', durationMs: 12 },
    { layer: 'AI_REVIEW', validator: 'ai.review', status: 'WARNING', durationMs: 52000 },
  ],
  coverage: { ran: [], notRun: [], headline: 'Checks run: CONTEXT, LINT, SECURITY, SECRETS, AI_REVIEW.' },
  findings,
  limitations: ['The lockfile is out of date with package.json; installed without freezing it.'],
  gate: { result: 'PASSED_WITH_WARNINGS', failedRules: [] },
  ai: { attempts: [{ provider: 'claude-code', model: 'claude-opus-5-5', outcome: 'SUCCEEDED', usage: { input: 8508, output: 1685 } }] },
  rulesChecklist: [],
  walkthrough: { summary: 'The batch download flow now shows progress for every report. Two edge cases can show the wrong item or navigate the app away. Nothing blocks merging.', files: [{ path, change: 'Queues downloads and advances an index after each finishes.' }, { path: html, change: 'Shows the progress block until the batch completes.' }], effort: 2 },
  projects: [{ path: 'project/ws/app', language: 'JavaScript', frameworks: [], support: 'supported' }],
  learnings: [{ kind: 'REMEMBER', text: 'Our download helper already retries; do not flag missing retries.', by: 'maintainer', pr: 780, url: 'https://github.com/kb-igot/sunbird-cb-orgportal/pull/780' }],
}
const hunks = {
  schemaVersion: 1,
  unavailable: [],
  files: [
    { path: html, truncated: false, hunks: [{ header: '@@ -68,6 +68,6 @@', lines: [{ kind: 'context', oldLine: 68, newLine: 68, text: '<div class="progress">' }, { kind: 'del', oldLine: 69, text: '  <p *ngIf="isDownloading">' }, { kind: 'add', newLine: 69, text: '  <p *ngIf="!isComplete">' }, { kind: 'context', oldLine: 70, newLine: 70, text: '    Downloading report for' }, { kind: 'context', oldLine: 71, newLine: 71, text: '    {{ items[currentIndex]?.orgName }}' }, { kind: 'context', oldLine: 72, newLine: 72, text: '      ({{ currentIndex + 1 }}/{{ items.length }})' }, { kind: 'context', oldLine: 73, newLine: 73, text: '  </p>' }] }] },
    { path, truncated: false, hunks: [{ header: '@@ -120,9 +120,8 @@', lines: [{ kind: 'context', oldLine: 120, newLine: 120, text: '  private downloadNext() {' }, { kind: 'context', oldLine: 121, newLine: 121, text: '    const a = document.createElement("a")' }, { kind: 'del', oldLine: 122, text: '    a.target = "_blank"' }, { kind: 'context', oldLine: 123, newLine: 122, text: '    a.href = this.items[this.currentIndex].url' }, { kind: 'add', newLine: 123, text: '    a.download = ""' }, { kind: 'context', oldLine: 124, newLine: 124, text: '    a.click()' }, { kind: 'context', oldLine: 125, newLine: 125, text: '    this.currentIndex++' }] }] },
  ],
}
const preview = { inline: [{ path: html, line: 72, body: '**MINOR · correctness** — Progress text shows the wrong item…' }, { path, startLine: 124, line: 127, body: '**MINOR · correctness** — Download link without target…' }], stillOpen: [{ title: 'Retries without backoff', url: 'https://github.com/kb-igot/sunbird-cb-orgportal/pull/796#discussion_r1' }], resolved: [{ title: 'Unbounded queue', url: 'https://github.com/kb-igot/sunbird-cb-orgportal/pull/796#discussion_r2' }], summaryBody: '## PR Reviewer: PASSED_WITH_WARNINGS\nHead 6e53c3e · 2 finding(s) (2 minor) · 2 new inline\n20 pre-existing finding(s) not included.' }

const json = (res, status, body) => (res.writeHead(status, { 'content-type': 'application/json' }), res.end(JSON.stringify(body)))
createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const p = url.pathname
  if (p === '/v1/session') return json(res, 200, { schemaVersion: 1, version: '0.1.0', github: { host: 'github.com', login: 'bharathravi-dev' }, ai: { provider: 'claude-code', ready: true }, publish: { allowRequestChanges: true } })
  if (p === `/v1/runs/${RUN}/report`) return json(res, 200, report)
  if (p === `/v1/runs/${RUN}/hunks`) return json(res, 200, hunks)
  if (p === `/v1/runs/${RUN}/publish`) return json(res, 200, { preview, digest: 'd'.repeat(64) })
  if (p === '/v1/stats') return json(res, 200, { since: '2026-10-27', addressedRate: 0.58, prs: [{ pr: 'kb-igot/sunbird-cb-orgportal#796', posted: 2, resolved: 0, dismissed: 0 }], total: { posted: 64, resolved: 37, dismissed: 6, open: 21, summaryOnly: 3, bySeverity: { MAJOR: { posted: 18, resolved: 13, dismissed: 1, open: 4 }, MINOR: { posted: 41, resolved: 22, dismissed: 4, open: 15 } }, bySource: { AI: { posted: 39, resolved: 24, dismissed: 3, open: 12 }, TOOL: { posted: 25, resolved: 13, dismissed: 3, open: 9 } } } })
  if (p.startsWith('/v1/')) return json(res, 404, { error: { message: 'not found' } })
  // Static files; v2's index gets a preset run and surface for the screenshot.
  if (p === '/axe.min.js' && axePath) return (res.writeHead(200, { 'content-type': 'text/javascript' }), res.end(readFileSync(axePath)))
  let file = p === '/' || p === '/v2/' ? 'v2/index.html' : p.slice(1)
  try {
    let body = readFileSync(join(staticDir, file))
    if (file === 'v2/index.html') {
      const keys = { attention: ['g', 'a'], pre: ['g', 'p'], checks: ['g', 'c'], walkthrough: ['g', 'w'], stats: ['g', 's'], settings: null, start: ['g', 'n'], drawer: ['p'] }[surface]
      const preset = `<script>sessionStorage.setItem('pr-reviewer-token','t');${surface === 'start' ? '' : `sessionStorage.setItem('pr-reviewer-run','${RUN}');`}localStorage.setItem('pr-reviewer-theme',JSON.stringify('${theme}'));setTimeout(()=>{${keys ? keys.map((k, i) => `document.dispatchEvent(new KeyboardEvent('keydown',{key:'${k}',bubbles:true}));`).join('') : ''}${surface === 'settings' ? "document.getElementById('nav-settings')?.click();" : ''}},1200)${axePath ? ";setTimeout(()=>axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice']}}).then(r=>{const pre=document.createElement('pre');pre.id='axe-results';pre.textContent=JSON.stringify(r.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.slice(0,4).map(n=>n.target.join(' ')+' :: '+(n.failureSummary||'').split('\\n').slice(1,2).join(''))})));document.body.append(pre)}),3200)" : ''}</script>${axePath ? '<script src="/axe.min.js"></script>' : ''}`
      body = Buffer.from(body.toString().replace('<link rel="stylesheet"', `${preset}<link rel="stylesheet"`))
    }
    const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'
    res.writeHead(200, { 'content-type': type })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end()
  }
}).listen(Number(port), '127.0.0.1', () => console.log(`mock on ${port}`))
