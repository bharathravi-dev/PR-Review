// Local review page for `pr-reviewer serve`. A client of ReviewService v1 (AD-16).
// Every string from GitHub, the PR, or the AI is inserted with textContent, never as HTML.

const TOKEN_KEY = 'pr-reviewer-token'
const $ = (id) => document.getElementById(id)

/** Builds an element; children are nodes or strings (inserted as text). */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue
    if (k === 'class') el.className = v
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (k === 'checked' || k === 'disabled' || k === 'hidden') el[k] = Boolean(v)
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  for (const c of children.flat()) if (c !== undefined && c !== null && c !== false) el.append(c instanceof Node ? c : String(c))
  return el
}

/** Only https links from the server's data become anchors. */
function safeLink(url, text) {
  return typeof url === 'string' && /^https:\/\//i.test(url) ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, text) : document.createTextNode(text)
}

function readToken() {
  const m = /(?:^#|&)token=([A-Za-z0-9_-]+)/.exec(location.hash)
  if (m) {
    try {
      sessionStorage.setItem(TOKEN_KEY, m[1])
    } catch {}
    // Keep the key out of the address bar, history, and screenshots.
    history.replaceState(null, '', location.pathname + location.search)
    return m[1]
  }
  try {
    return sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

/** "local": `pr-reviewer serve` with a one-time key. "web": the team Web App, signed in with GitHub (cookie session). */
const MODE = document.querySelector('meta[name="pr-reviewer-mode"]')?.content === 'web' ? 'web' : 'local'
const RUN_KEY = 'pr-reviewer-run'
const token = MODE === 'local' ? readToken() : null
const authHeaders = () => (MODE === 'local' ? { authorization: `Bearer ${token}`, 'accept-schema': '1' } : { 'accept-schema': '1' })
const state = { session: null, runId: null, report: null, selected: new Set(), preview: null, digest: null, event: 'COMMENT', busy: false, edits: {} }

function remember(key, value) {
  try {
    if (value === null) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, value)
  } catch {}
}

function recall(key) {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function signedOut() {
  lock('Sign in with your GitHub account to review pull requests. Only people this server allows can sign in.')
  $('locked').querySelector('h1').textContent = 'Sign in'
  $('locked-action').hidden = false
}

function lock(message) {
  $('start').hidden = true
  $('progress').hidden = true
  $('report').hidden = true
  $('publish').hidden = true
  if (message) $('locked-text').textContent = message
  $('locked').hidden = false
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = authHeaders()
  if (body !== undefined) headers['content-type'] = 'application/json'
  let res
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    throw new Error('Cannot reach pr-reviewer. Is `pr-reviewer serve` still running?')
  }
  const text = await res.text()
  let data = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { text }
  }
  if (res.status === 401) {
    if (MODE === 'web') signedOut()
    else {
      remember(TOKEN_KEY, null)
      lock('This page’s key is no longer valid (pr-reviewer was restarted). Open the new link printed in your terminal.')
    }
    throw new Error('unauthorized')
  }
  return { status: res.status, ok: res.ok, data }
}

const errorText = (r) => r.data?.error?.message ?? `Request failed (HTTP ${r.status}).`

// ── Session ────────────────────────────────────────────────────────────────

async function loadSession() {
  const r = await api('/v1/session')
  if (!r.ok) throw new Error(errorText(r))
  state.session = r.data
  $('version').textContent = `v${r.data.version}`
  const gh = r.data.github
  const ai = r.data.ai
  const user = r.data.user
  $('identity').replaceChildren(
    h(
      'span',
      { class: `chip ${gh.login ? 'ok' : 'bad'}`, title: gh.login ? `Signed in to ${gh.host}` : gh.error },
      user?.avatarUrl && /^https:\/\/avatars\.githubusercontent\.com\//.test(user.avatarUrl) ? h('img', { src: user.avatarUrl, alt: '', class: 'avatar' }) : h('span', { class: 'dot' }),
      gh.login ? `${MODE === 'web' ? '' : 'GitHub: '}@${gh.login}` : 'GitHub: no token',
    ),
    h(
      MODE === 'web' ? 'button' : 'span',
      { class: `chip ${ai.ready ? 'ok' : 'bad'}`, title: ai.ready ? 'AI review is available' : ai.reason, type: 'button', onclick: MODE === 'web' ? () => toggleSettings() : undefined },
      h('span', { class: 'dot' }),
      `AI: ${ai.provider}${ai.model ? ` · ${ai.model}` : ''}${ai.ready ? '' : ' (not set up)'}`,
    ),
    MODE === 'web'
      ? h('button', { class: 'chip', type: 'button', onclick: async () => {
          await fetch('/auth/logout', { method: 'POST' }).catch(() => undefined)
          remember(RUN_KEY, null)
          signedOut()
        } }, 'Sign out')
      : '',
  )
  if (MODE === 'web' && !ai.ready) toggleSettings(true)
}

// ── Settings (Web App: the user's own AI key, kept on the server, encrypted) ─────

async function toggleSettings(show) {
  const box = $('settings')
  if (show === undefined) show = box.hidden
  if (!show) {
    box.hidden = true
    return
  }
  const r = await api('/v1/settings')
  if (!r.ok) return
  const s = r.data
  const type = h('select', { id: 'set-type' }, h('option', { value: 'anthropic' }, 'Anthropic (Claude) API key'), h('option', { value: 'openai-compatible' }, 'OpenAI or compatible API key'))
  type.value = s.provider.type
  const model = h('input', { id: 'set-model', type: 'text', placeholder: 'Model (optional for Anthropic)', value: s.provider.model ?? '' })
  const base = h('select', { id: 'set-base' }, s.allowedEndpoints.map((e) => h('option', { value: e }, e)))
  if (s.provider.baseUrl) base.value = s.provider.baseUrl
  const key = h('input', { id: 'set-key', type: 'password', autocomplete: 'off', placeholder: s.apiKeySaved ? 'Saved (leave empty to keep it)' : 'Paste your API key' })
  const status = h('p', { class: 'muted' }, s.apiKeySaved ? 'Your key is stored encrypted on this server and never shown again.' : 'Reviews need your own API key. It is stored encrypted on this server and used only for your reviews.')
  const baseRow = h('label', { class: 'field' }, 'Endpoint ', base)
  const sync = () => (baseRow.hidden = type.value !== 'openai-compatible')
  type.addEventListener('change', sync)
  sync()
  const save = async (removeKey) => {
    const body = { provider: { type: type.value, ...(model.value.trim() ? { model: model.value.trim() } : {}), ...(type.value === 'openai-compatible' ? { baseUrl: base.value } : {}) } }
    if (removeKey) body.apiKey = null
    else if (key.value.trim()) body.apiKey = key.value.trim()
    const res = await api('/v1/settings', { method: 'PUT', body })
    status.textContent = res.ok ? 'Saved.' : errorText(res)
    status.className = res.ok ? 'result ok' : 'result bad'
    key.value = ''
    if (res.ok) {
      await loadSession()
      if (res.data.apiKeySaved && !removeKey) setTimeout(() => toggleSettings(false), 1200)
    }
  }
  box.replaceChildren(
    h('h2', {}, 'AI settings'),
    h('div', { class: 'settings-grid' }, h('label', { class: 'field' }, 'Provider ', type), h('label', { class: 'field' }, 'Model ', model), baseRow, h('label', { class: 'field' }, 'API key ', key)),
    h('div', { class: 'publish-row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => save(false) }, 'Save'), s.apiKeySaved ? h('button', { class: 'btn', type: 'button', onclick: () => save(true) }, 'Remove key') : '', h('button', { class: 'btn link', type: 'button', onclick: () => toggleSettings(false) }, 'Close')),
    status,
  )
  box.hidden = false
}

// ── Pick an open PR (Story 8.3) ───────────────────────────────────────────

const REVIEWED = { CURRENT: ['reviewed', 'ok'], OUTDATED: ['new commits', 'warn'], NONE: ['not reviewed', ''], UNKNOWN: ['?', ''] }

async function listPulls(repo) {
  const box = $('pulls')
  box.replaceChildren(h('p', { class: 'muted' }, 'Loading…'))
  const r = await api(`/v1/pulls?repo=${encodeURIComponent(repo)}`)
  if (!r.ok) {
    box.replaceChildren(h('p', { class: 'error' }, errorText(r)))
    return
  }
  const { pulls, reviewerKnown } = r.data
  if (pulls.length === 0) {
    box.replaceChildren(h('p', { class: 'muted' }, `No open PRs in ${r.data.repo}.`))
    return
  }
  const rows = pulls.map((p) => {
    const [label, tone] = REVIEWED[p.reviewed] ?? REVIEWED.UNKNOWN
    const ref = `${r.data.repo}#${p.number}`
    return h(
      'tr',
      {},
      h('td', { class: 'mono' }, `#${p.number}`),
      h('td', {}, h('span', { class: `badge ${tone}` }, label)),
      h('td', {}, p.draft ? h('span', { class: 'badge' }, 'draft') : '', p.draft ? ' ' : '', p.title),
      h('td', { class: 'muted' }, p.author),
      h('td', {}, h('button', { class: 'btn small', type: 'button', onclick: () => startReview(r.data.host === 'github.com' ? ref : `https://${r.data.host}/${r.data.repo}/pull/${p.number}`) }, 'Review')),
    )
  })
  box.replaceChildren(
    h('div', { class: 'table-scroll' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'PR'), h('th', {}, 'You'), h('th', {}, 'Title'), h('th', {}, 'Author'), h('th', {}, ''))), h('tbody', {}, rows))),
    reviewerKnown ? '' : h('p', { class: 'muted' }, 'Reviewed state needs a GitHub token.'),
  )
}

// ── Addressed rate: how posted findings fared ──────────────────────────────

const SEVERITY_ROWS = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO', 'UNRATED']
const SOURCE_ROWS = { AI: 'AI review', TOOL: 'Tools', UNKNOWN: 'Older comments' }

async function loadStats() {
  const box = $('stats')
  box.replaceChildren(h('p', { class: 'muted' }, 'Reading your reviewed PRs from GitHub…'))
  const params = new URLSearchParams({ days: $('stats-days').value })
  const repo = $('stats-repo').value.trim()
  if (repo) params.set('repo', repo)
  const r = await api(`/v1/stats?${params}`)
  if (!r.ok) {
    box.replaceChildren(h('p', { class: 'error' }, errorText(r)))
    return
  }
  const s = r.data
  if (!s.prs.length) {
    box.replaceChildren(h('p', { class: 'muted' }, `No PRs reviewed with pr-reviewer since ${s.since}.`))
    return
  }
  const pct = (n, of) => (of ? `${Math.round((100 * n) / of)}%` : '–')
  const row = (label, o) => h('tr', {}, h('td', {}, label), h('td', { class: 'num' }, String(o.posted)), h('td', { class: 'num' }, pct(o.resolved, o.posted)), h('td', { class: 'num' }, pct(o.dismissed, o.posted)), h('td', { class: 'num' }, String(o.open)))
  const head = h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Posted'), h('th', {}, 'Addressed'), h('th', {}, 'Dismissed'), h('th', {}, 'Open')))
  const t = s.total
  const rows = [
    row('All inline findings', t),
    ...SEVERITY_ROWS.filter((k) => t.bySeverity[k]).map((k) => row(words(k), t.bySeverity[k])),
    ...Object.entries(t.bySource).map(([k, o]) => row(SOURCE_ROWS[k] ?? k, o)),
  ]
  box.replaceChildren(
    h('p', {}, h('strong', {}, s.addressedRate === null ? 'No inline findings posted' : `${Math.round(s.addressedRate * 100)}% addressed`), ` across ${s.prs.length} PR(s) since ${s.since}; ${t.summaryOnly} more in summaries only.`),
    h('div', { class: 'table-scroll' }, h('table', {}, head, h('tbody', {}, rows))),
    h('p', { class: 'muted' }, 'Addressed means the code at the comment changed afterwards; PRs still in progress lower it. Dismissed means 👎 or a /dismiss reply. Read from GitHub only.'),
  )
}

// ── Run and watch (Story 8.1) ──────────────────────────────────────────────

const STAGES = [
  ['fetchContext', 'Load the PR from GitHub'],
  ['detect', 'Detect projects and versions'],
  ['validate', 'Run checks (framework, dependencies, CI results, compile and lint)'],
  ['execute', 'Scan for secrets'],
  ['review', 'AI review'],
  ['dedupe', 'Combine findings'],
  ['gate', 'Decide the result'],
]

function renderProgress(pr) {
  const steps = STAGES.map(([id, label]) => h('li', { class: 'waiting', 'data-stage': id }, h('span', { class: 'state' }), h('span', {}, label, ' ', h('span', { class: 'detail' }))))
  $('progress').replaceChildren(
    h('div', { class: 'report-head' }, h('h2', {}, `Reviewing ${pr}`), h('span', { class: 'muted mono', id: 'elapsed' }, '0s')),
    h('ol', { class: 'steps' }, steps),
    h('div', { id: 'layers', class: 'section' }),
  )
  $('progress').hidden = false
}

function stepEl(stage) {
  return $('progress').querySelector(`[data-stage="${stage}"]`)
}

function setStep(stage, cls, detail) {
  const el = stepEl(stage)
  if (!el) return
  el.className = cls
  if (detail !== undefined) el.querySelector('.detail').textContent = detail
}

function onEvent(e) {
  const p = e.payload ?? {}
  if (e.type === 'STAGE_STARTED') {
    const detail = p.stage === 'review' ? `${p.provider ?? ''}${p.model ? ` · ${p.model}` : ''} — usually under two minutes` : ''
    setStep(p.stage, 'running', detail)
  } else if (e.type === 'STAGE_FINISHED') {
    let detail
    if (p.stage === 'fetchContext' && p.ok) detail = `${p.files} file(s) · head ${String(p.headSha).slice(0, 7)}`
    if (p.stage === 'detect' && Array.isArray(p.projects)) detail = p.projects.map((x) => `${x.path}: ${[x.language, ...x.frameworks].join(', ')}`).join(' · ')
    if (p.stage === 'validate') detail = `${p.findings} finding(s)${p.sandbox ? ' · ran in Sandbox' : ''}`
    setStep(p.stage, p.ok === false ? 'failed' : 'done', detail)
  } else if (e.type === 'LAYER_STATUS') {
    if (p.layer === 'AI_REVIEW' && p.status === 'SKIPPED') setStep('review', 'failed', `skipped: ${p.detail ?? p.reason ?? ''}`)
    if (p.layer === 'AI_REVIEW' && p.status === 'ERROR') setStep('review', 'failed', `failed: ${p.detail ?? p.reason ?? ''}`)
  } else if (e.type === 'FINDING_COUNT') {
    setStep('dedupe', 'done', `${p.count} finding(s)${p.dismissed ? `, ${p.dismissed} dismissed earlier` : ''}`)
  } else if (e.type === 'DONE' && p.error) {
    $('progress').append(h('p', { class: 'error' }, `The review failed: ${p.error}`))
  }
}

/** Reads the SSE stream with fetch (EventSource cannot send the bearer token), resuming with Last-Event-ID. */
async function streamEvents(runId) {
  let last = 0
  for (let attempt = 0; attempt < 5; attempt++) {
    const headers = authHeaders()
    if (last) headers['last-event-id'] = String(last)
    let res
    try {
      res = await fetch(`/v1/runs/${runId}/events`, { headers })
    } catch {
      await new Promise((r) => setTimeout(r, 1000))
      continue
    }
    if (res.status === 401) return MODE === 'web' ? signedOut() : lock('This page’s key is no longer valid. Open the new link printed in your terminal.')
    if (!res.ok || !res.body) throw new Error(`Progress stream failed (HTTP ${res.status}).`)
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    let buf = ''
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += value
        let i
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i)
          buf = buf.slice(i + 2)
          const data = chunk
            .split('\n')
            .filter((l) => l.startsWith('data: '))
            .map((l) => l.slice(6))
            .join('\n')
          if (!data) continue
          const ev = JSON.parse(data)
          last = ev.seq
          onEvent(ev)
          if (ev.type === 'DONE') return
        }
      }
    } catch {
      // Connection dropped; resume from the last event.
    }
  }
  throw new Error('Lost the connection to pr-reviewer while the review was running.')
}

async function startReview(pr) {
  if (state.busy) return
  state.busy = true
  $('pr').value = pr
  $('review-btn').disabled = true
  $('report').hidden = true
  $('publish').hidden = true
  state.preview = null
  renderProgress(pr)
  const started = Date.now()
  const timer = setInterval(() => {
    const el = $('elapsed')
    if (el) el.textContent = `${Math.round((Date.now() - started) / 1000)}s`
  }, 1000)
  try {
    const r = await api('/v1/runs', { method: 'POST', body: { pr } })
    if (!r.ok) throw new Error(errorText(r))
    state.runId = r.data.id
    remember(RUN_KEY, r.data.id)
    $('progress').querySelector('h2').textContent = `Reviewing ${r.data.pr}`
    await streamEvents(r.data.id)
    await showRun(r.data.id)
  } catch (e) {
    if (e.message !== 'unauthorized') $('progress').append(h('p', { class: 'error' }, e.message))
  } finally {
    clearInterval(timer)
    state.busy = false
    $('review-btn').disabled = false
  }
}

/** Shows a finished run's Report (also used for history and after a reload). */
async function showRun(id) {
  const rep = await api(`/v1/runs/${id}/report`)
  if (!rep.ok) throw new Error(errorText(rep))
  state.runId = id
  state.report = rep.data
  state.edits = {}
  state.preview = null
  state.selected = new Set(rep.data.findings.filter((f) => f.fingerprint && !f.dismissed).map((f) => f.fingerprint))
  $('progress').hidden = true
  renderReport()
  renderPublish()
  if (MODE === 'web') loadHistory(`${rep.data.run.repo.fullName}#${rep.data.run.pr}`)
}

/** After a reload, picks the last run back up: still running → reattach to its progress; finished → show it. */
async function resume() {
  const id = recall(RUN_KEY)
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return
  const r = await api(`/v1/runs/${id}/report`)
  if (r.status === 202) {
    state.busy = true
    renderProgress('your last review')
    try {
      await streamEvents(id)
      await showRun(id)
    } finally {
      state.busy = false
    }
  } else if (r.ok) await showRun(id)
  else remember(RUN_KEY, null)
}

// ── History (Web App, FR-34) ───────────────────────────────────────────────

async function loadHistory(pr) {
  const r = await api(`/v1/history?pr=${encodeURIComponent(pr)}`)
  if (!r.ok || !r.data.runs.length) return
  const rows = r.data.runs.map((x) =>
    h(
      'tr',
      { class: x.id === state.runId ? 'current' : '' },
      h('td', {}, new Date(x.startedAt).toLocaleString()),
      h('td', {}, h('span', { class: `badge ${STATUS_TONE[x.overallStatus] ?? ''}` }, words(x.overallStatus))),
      h('td', {}, String(x.findings)),
      h('td', {}, `${x.new} new · ${x.resolved} resolved · ${x.unchanged} unchanged`),
      h('td', {}, x.published ? words(x.published) : '—'),
      h('td', {}, x.id === state.runId ? h('span', { class: 'muted' }, 'shown') : h('button', { class: 'btn small', type: 'button', onclick: () => showRun(x.id) }, 'Open')),
    ),
  )
  $('report').append(
    h('div', { class: 'card' }, h('h2', {}, `History for ${pr}`), h('div', { class: 'table-scroll' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Result'), h('th', {}, 'Findings'), h('th', {}, 'Compared with the run before'), h('th', {}, 'Posted'), h('th', {}, ''))), h('tbody', {}, rows)))),
  )
}

// ── Report view ───────────────────────────────────────────────────────────

const STATUS_TONE = { PASSED: 'ok', PASSED_WITH_WARNINGS: 'warn', FAILED: 'bad', INCOMPLETE: 'warn', ERROR: 'bad', CANCELLED: '' }
const LAYER_TONE = { PASSED: 'ok', WARNING: 'warn', FAILED: 'bad', ERROR: 'bad', TIMEOUT: 'bad', SKIPPED: '', NOT_APPLICABLE: '' }
const words = (s) => String(s).replace(/_/g, ' ').toLowerCase()

function download(name, type, text) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = h('a', { href: url, download: name })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function renderReport() {
  const r = state.report
  const ref = `${r.run.repo.fullName}#${r.run.pr}`
  const prUrl = `https://${r.run.host}/${r.run.repo.fullName}/pull/${r.run.pr}`
  const base = `pr-review-${r.run.repo.fullName.replace('/', '-')}-${r.run.pr}`

  const head = h(
    'div',
    { class: 'card' },
    h(
      'div',
      { class: 'report-head' },
      h('div', {}, h('h1', {}, safeLink(prUrl, ref), r.title ? ` — ${r.title}` : ''), h('div', { class: 'muted mono' }, `head ${String(r.run.headSha ?? '?').slice(0, 7)}`)),
      h('span', { class: `badge status-big ${STATUS_TONE[r.overallStatus] ?? ''}` }, words(r.overallStatus)),
    ),
    h('p', { class: 'coverage' }, r.coverage.headline),
    r.projects?.length
      ? h(
          'ul',
          { class: 'list-plain muted' },
          r.projects.map((p) =>
            h('li', {}, h('span', { class: 'mono' }, p.path || '.'), ': ', p.support === 'best-effort' ? 'best-effort (unsupported technology)' : [p.language, ...p.frameworks.map((f) => `${f.name} ${f.version ?? f.declared ?? '?'}`), p.typescript?.version ? `TypeScript ${p.typescript.version}` : ''].filter(Boolean).join(', ')),
          ),
        )
      : '',
    r.gate.failedRules.length ? h('div', { class: 'gate' }, h('strong', {}, 'Why it failed'), h('ul', {}, r.gate.failedRules.map((x) => h('li', {}, x)))) : '',
    h(
      'div',
      { class: 'actions section' },
      h('button', { class: 'btn small', type: 'button', onclick: async () => {
        const res = await fetch(`/v1/runs/${state.runId}/report?format=markdown`, { headers: authHeaders() })
        if (res.ok) download(`${base}.md`, 'text/markdown', await res.text())
      } }, 'Download Markdown'),
      h('button', { class: 'btn small', type: 'button', onclick: () => download(`${base}.json`, 'application/json', `${JSON.stringify(r, null, 2)}\n`) }, 'Download JSON'),
    ),
  )

  const checks = h(
    'div',
    { class: 'card' },
    h('h2', {}, 'Checks'),
    h(
      'div',
      { class: 'table-scroll' },
      h(
        'table',
        {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Layer'), h('th', {}, 'Status'), h('th', {}, 'Detail'))),
        h(
          'tbody',
          {},
          r.layers.filter((l) => l.status !== 'NOT_APPLICABLE').map((l) =>
            h('tr', {}, h('td', {}, words(l.layer), h('div', { class: 'muted mono' }, l.validator)), h('td', {}, h('span', { class: `badge ${LAYER_TONE[l.status] ?? ''}` }, words(l.status))), h('td', {}, [l.reason ? words(l.reason) : '', l.detail ?? ''].filter(Boolean).join(': '))),
          ),
        ),
      ),
    ),
    r.ai?.attempts?.length
      ? h('p', { class: 'muted' }, r.ai.attempts.map((a) => `AI: ${a.provider} ${a.model} ${words(a.outcome)}${a.usage ? ` · ${a.usage.input ?? '?'} in / ${a.usage.output ?? '?'} out tokens` : ''}`).join(' · '))
      : '',
  )

  const counts = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO'].map((s) => [s, r.findings.filter((f) => f.severity === s).length]).filter(([, n]) => n)
  const findings = h(
    'div',
    { class: 'card' },
    h(
      'div',
      { class: 'findings-bar' },
      h('h2', {}, `Findings (${r.findings.length})`, counts.length ? h('span', { class: 'muted' }, ` · ${counts.map(([s, n]) => `${n} ${words(s)}`).join(', ')}`) : ''),
      r.findings.length
        ? h(
            'div',
            { class: 'actions' },
            h('button', { class: 'btn small', type: 'button', onclick: () => selectAll(true) }, 'Select all'),
            h('button', { class: 'btn small', type: 'button', onclick: () => selectAll(false) }, 'Select none'),
          )
        : '',
    ),
    r.findings.length ? h('div', { class: 'findings', id: 'finding-list' }, r.findings.map(renderFinding)) : h('p', { class: 'muted' }, 'No findings.'),
  )

  const extras = []
  if (r.limitations.length) extras.push(h('div', { class: 'card' }, h('h2', {}, 'Limitations'), h('ul', { class: 'list-plain' }, r.limitations.map((l) => h('li', {}, l)))))
  if (r.rulesChecklist.length) {
    extras.push(h('details', { class: 'card' }, h('summary', {}, `Review Rules checked (${r.rulesChecklist.length})`), h('ul', { class: 'list-plain' }, r.rulesChecklist.map((l) => h('li', {}, l)))))
  }

  $('report').replaceChildren(head, checks, findings, ...extras)
  $('report').hidden = false
}

function renderFinding(f) {
  const id = `f-${f.fingerprint ?? Math.random().toString(36).slice(2)}`
  const where = f.location.path ? `${f.location.path}${f.location.startLine ? `:${f.location.startLine}${f.location.endLine && f.location.endLine !== f.location.startLine ? `-${f.location.endLine}` : ''}` : ''}` : 'whole PR'
  const source = f.sourceFamily === 'AI' ? `AI${f.provenance?.model ? ` (${f.provenance.model})` : ''}` : f.provenance?.tool ?? f.provenance?.validator ?? f.sourceFamily
  const on = f.fingerprint && state.selected.has(f.fingerprint)
  return h(
    'article',
    { class: `finding${on ? '' : ' off'}`, 'data-fp': f.fingerprint ?? '' },
    h('input', {
      type: 'checkbox',
      id,
      checked: on,
      disabled: !f.fingerprint,
      'aria-label': `Include “${f.title}” in the post`,
      onchange: (ev) => {
        if (ev.target.checked) state.selected.add(f.fingerprint)
        else state.selected.delete(f.fingerprint)
        ev.target.closest('.finding').classList.toggle('off', !ev.target.checked)
        selectionChanged()
      },
    }),
    h('label', { for: id, class: 'title' }, h('span', { class: `badge sev-${f.severity}` }, words(f.severity)), ' ', f.title),
    h(
      'div',
      { class: 'meta' },
      h('span', { class: 'mono' }, where),
      h('span', {}, `· ${words(f.category)}`),
      h('span', {}, `· ${source}`),
      h('span', {}, `· confidence ${words(f.confidence)}`),
      f.scope && f.scope !== 'NEW' ? h('span', { class: 'badge' }, words(f.scope)) : '',
      f.disposition === 'ADVISORY' ? h('span', { class: 'badge info' }, 'advisory') : '',
      f.dismissed ? h('span', { class: 'badge warn', title: `Dismissed by ${f.dismissed.by}` }, `dismissed by ${f.dismissed.by}`) : '',
    ),
    h(
      'div',
      { class: 'body' },
      f.description,
      f.impact ? h('div', { class: 'section' }, h('span', { class: 'label' }, 'Why it matters: '), f.impact) : '',
      f.recommendation ? h('div', { class: 'section' }, h('span', { class: 'label' }, 'Recommendation: '), f.recommendation) : '',
      f.fingerprint ? editor(f) : '',
    ),
  )
}

/** Lets the user reword a Finding before it is posted (Story 6.3); the original Report is kept. */
function editor(f) {
  const wrap = h('details', { class: 'edit' }, h('summary', {}, state.edits[f.fingerprint] ? 'Edited wording (will be posted)' : 'Edit wording before posting'))
  const field = (name, label, value, rows) => {
    const area = h('textarea', { rows, 'aria-label': label })
    area.value = state.edits[f.fingerprint]?.[name] ?? value ?? ''
    area.addEventListener('input', () => {
      const e = { ...(state.edits[f.fingerprint] ?? {}) }
      if (area.value.trim() && area.value !== (value ?? '')) e[name] = area.value
      else delete e[name]
      if (Object.keys(e).length) state.edits[f.fingerprint] = e
      else delete state.edits[f.fingerprint]
      wrap.querySelector('summary').textContent = state.edits[f.fingerprint] ? 'Edited wording (will be posted)' : 'Edit wording before posting'
      selectionChanged()
    })
    return h('label', { class: 'field' }, label, area)
  }
  wrap.append(field('title', 'Title', f.title, 1), field('description', 'Description', f.description, 4), field('recommendation', 'Recommendation', f.recommendation, 2))
  return wrap
}

function selectAll(on) {
  for (const f of state.report.findings) {
    if (!f.fingerprint) continue
    if (on) state.selected.add(f.fingerprint)
    else state.selected.delete(f.fingerprint)
  }
  for (const el of document.querySelectorAll('#finding-list .finding')) {
    const box = el.querySelector('input[type="checkbox"]')
    if (box.disabled) continue
    box.checked = on
    el.classList.toggle('off', !on)
  }
  selectionChanged()
}

// ── Publish (Story 8.2) ────────────────────────────────────────────────────

function selectionChanged() {
  // A preview is only valid for the exact selection it was rendered from.
  if (state.preview) {
    state.preview = null
    state.digest = null
    renderPublish()
  }
}

function include() {
  const all = state.report.findings.filter((f) => f.fingerprint).map((f) => f.fingerprint)
  return all.every((fp) => state.selected.has(fp)) ? undefined : [...state.selected]
}

function stripMarker(text) {
  return String(text).replace(/\n*<!-- pr-reviewer [^>]* -->\s*$/, '')
}

function renderPublish(message) {
  const box = $('publish')
  const s = state.session
  const r = state.report
  if (!r || !s) return
  if (!s.github.login) {
    box.replaceChildren(h('h2', {}, 'Post to GitHub'), h('p', { class: 'muted' }, `Posting needs a GitHub token: ${s.github.error}. Set GITHUB_TOKEN or run gh auth login, then restart pr-reviewer serve.`))
    box.hidden = false
    return
  }
  const eventSel = h(
    'select',
    {
      id: 'event',
      'aria-label': 'Review type',
      onchange: (ev) => {
        state.event = ev.target.value
        selectionChanged()
      },
    },
    h('option', { value: 'COMMENT' }, 'Comment'),
    s.publish.allowRequestChanges ? h('option', { value: 'REQUEST_CHANGES' }, 'Request changes') : '',
  )
  if (state.event) eventSel.value = state.event

  const p = state.preview
  const children = [
    h('h2', {}, 'Post to GitHub'),
    h('p', { class: 'muted' }, `Posts as @${s.github.login}: one review with inline comments, plus one summary comment that is updated on later runs. Approving is never possible.`),
    h(
      'div',
      { class: 'publish-row' },
      eventSel,
      h('button', { class: 'btn', type: 'button', id: 'preview-btn', onclick: () => doPublish(true) }, p ? 'Refresh preview' : 'Preview post'),
      p ? h('button', { class: 'btn primary', type: 'button', id: 'post-btn', onclick: () => doPublish(false) }, `Post ${p.inline.length} inline comment(s) and the summary`) : '',
      h('span', { class: 'muted' }, `${state.selected.size} of ${r.findings.length} finding(s) selected`),
    ),
  ]
  if (message) children.push(message)
  if (p) {
    children.push(
      h('div', { class: 'section' }, h('h3', {}, `New inline comments (${p.inline.length})`),
        p.inline.length
          ? h('ul', { class: 'list-plain' }, p.inline.map((c) => h('li', {}, h('details', {}, h('summary', {}, h('span', { class: 'mono' }, `${c.path}:${c.startLine ? `${c.startLine}-` : ''}${c.line}`), ' ', stripMarker(c.body).split('\n')[0].replace(/\*\*/g, '')), h('pre', { class: 'preview' }, stripMarker(c.body))))))
          : h('p', { class: 'muted' }, 'None.')),
      p.stillOpen.length ? h('div', { class: 'section' }, h('h3', {}, `Still open from earlier reviews (${p.stillOpen.length}), not re-posted`), h('ul', { class: 'list-plain' }, p.stillOpen.map((x) => h('li', {}, x.url ? safeLink(x.url, x.title) : x.title)))) : '',
      p.resolved.length ? h('div', { class: 'section' }, h('h3', {}, `Resolved since the last review (${p.resolved.length})`), h('ul', { class: 'list-plain' }, p.resolved.map((x) => h('li', {}, x.url ? safeLink(x.url, x.title) : x.title)))) : '',
      h('div', { class: 'section' }, h('h3', {}, 'Summary comment'), h('pre', { class: 'preview' }, stripMarker(p.summaryBody))),
    )
  }
  box.replaceChildren(...children)
  box.hidden = false
}

async function doPublish(dryRun) {
  const buttons = $('publish').querySelectorAll('button')
  for (const b of buttons) b.disabled = true
  try {
    const body = { event: $('event').value, dryRun }
    const inc = include()
    if (inc) body.include = inc
    if (!dryRun) body.previewDigest = state.digest
    if (Object.keys(state.edits).length) body.edits = state.edits
    const r = await api(`/v1/runs/${state.runId}/publish`, { method: 'POST', body })
    if (r.status === 409 && r.data.preview) {
      state.preview = r.data.preview
      state.digest = r.data.digest
      return renderPublish(h('p', { class: 'result warn' }, r.data.error.message))
    }
    if (!r.ok) return renderPublish(h('p', { class: 'result bad' }, errorText(r)))
    if (dryRun) {
      state.preview = r.data.preview
      state.digest = r.data.digest
      return renderPublish()
    }
    const rec = r.data.record
    state.preview = null
    state.digest = null
    const links = h('span', {}, rec.reviewUrl ? h('span', {}, ' ', safeLink(rec.reviewUrl, 'Open the review')) : '', rec.summaryUrl ? h('span', {}, ' · ', safeLink(rec.summaryUrl, 'Open the summary')) : '')
    const cs = r.data.commitStatus
    const csText = cs?.outcome === 'SET' ? ' Commit status set.' : cs?.outcome === 'SKIPPED_NO_PERMISSION' ? ' Commit status skipped (no permission).' : cs?.outcome === 'FAILED' ? ` Commit status not set: ${cs.reason}.` : ''
    if (rec.status === 'PUBLISHED') return renderPublish(h('p', { class: 'result ok' }, `Posted ${rec.commentCount} inline comment(s) and the summary.${csText}`, links))
    if (rec.status === 'SKIPPED_DUPLICATE') return renderPublish(h('p', { class: 'result ok' }, `This commit was already reviewed with the same settings; the summary was updated.${csText}`, links))
    return renderPublish(h('p', { class: 'result bad' }, `Not posted (${words(rec.status)}): ${rec.reason ?? 'unknown reason'}`))
  } catch (e) {
    if (e.message !== 'unauthorized') renderPublish(h('p', { class: 'result bad' }, e.message))
  } finally {
    for (const b of $('publish').querySelectorAll('button')) b.disabled = false
  }
}

// ── Start ─────────────────────────────────────────────────────────────────

async function boot() {
  if (MODE === 'web') $('footer').textContent = 'Signed in with GitHub. Reviews use your own API key, stored encrypted on this server. Nothing is posted until you press Post.'
  if (MODE === 'local' && !token) return lock()
  $('start').hidden = false
  $('review-form').addEventListener('submit', (e) => {
    e.preventDefault()
    const pr = $('pr').value.trim()
    if (pr) startReview(pr)
  })
  $('list-form').addEventListener('submit', (e) => {
    e.preventDefault()
    const repo = $('repo').value.trim()
    if (repo) listPulls(repo)
  })
  $('stats-form').addEventListener('submit', (e) => {
    e.preventDefault()
    loadStats()
  })
  $('stats-box').addEventListener('toggle', () => {
    if ($('stats-box').open && !$('stats').childElementCount) loadStats()
  })
  // A ?pr= link only fills the box; a review (which may cost AI tokens) always needs a click.
  const prParam = new URLSearchParams(location.search).get('pr')
  if (prParam) $('pr').value = prParam
  try {
    await loadSession()
    await resume()
  } catch (e) {
    if (e.message !== 'unauthorized') $('identity').replaceChildren(h('span', { class: 'chip bad' }, e.message))
  }
}

boot()
