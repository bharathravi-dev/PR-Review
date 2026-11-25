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

const token = readToken()
const state = { session: null, runId: null, report: null, selected: new Set(), preview: null, digest: null, event: 'COMMENT', busy: false }

function lock(message) {
  $('start').hidden = true
  $('progress').hidden = true
  $('report').hidden = true
  $('publish').hidden = true
  if (message) $('locked-text').textContent = message
  $('locked').hidden = false
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = { authorization: `Bearer ${token}`, 'accept-schema': '1' }
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
    try {
      sessionStorage.removeItem(TOKEN_KEY)
    } catch {}
    lock('This page’s key is no longer valid (pr-reviewer was restarted). Open the new link printed in your terminal.')
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
  $('identity').replaceChildren(
    h('span', { class: `chip ${gh.login ? 'ok' : 'bad'}`, title: gh.login ? `Signed in to ${gh.host}` : gh.error }, h('span', { class: 'dot' }), gh.login ? `GitHub: @${gh.login}` : 'GitHub: no token'),
    h(
      'span',
      { class: `chip ${ai.ready ? 'ok' : 'bad'}`, title: ai.ready ? 'AI review is available' : ai.reason },
      h('span', { class: 'dot' }),
      `AI: ${ai.provider}${ai.model ? ` · ${ai.model}` : ''}${ai.ready ? '' : ' (not set up)'}`,
    ),
  )
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

// ── Run and watch (Story 8.1) ──────────────────────────────────────────────

const STAGES = [
  ['fetchContext', 'Load the PR from GitHub'],
  ['execute', 'Run checks (secret scan)'],
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
    const headers = { authorization: `Bearer ${token}`, 'accept-schema': '1' }
    if (last) headers['last-event-id'] = String(last)
    let res
    try {
      res = await fetch(`/v1/runs/${runId}/events`, { headers })
    } catch {
      await new Promise((r) => setTimeout(r, 1000))
      continue
    }
    if (res.status === 401) return lock('This page’s key is no longer valid. Open the new link printed in your terminal.')
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
    $('progress').querySelector('h2').textContent = `Reviewing ${r.data.pr}`
    await streamEvents(r.data.id)
    const rep = await api(`/v1/runs/${r.data.id}/report`)
    if (!rep.ok) throw new Error(errorText(rep))
    state.report = rep.data
    state.selected = new Set(rep.data.findings.filter((f) => f.fingerprint && !f.dismissed).map((f) => f.fingerprint))
    $('progress').hidden = true
    renderReport()
    renderPublish()
  } catch (e) {
    if (e.message !== 'unauthorized') $('progress').append(h('p', { class: 'error' }, e.message))
  } finally {
    clearInterval(timer)
    state.busy = false
    $('review-btn').disabled = false
  }
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
    r.gate.failedRules.length ? h('div', { class: 'gate' }, h('strong', {}, 'Why it failed'), h('ul', {}, r.gate.failedRules.map((x) => h('li', {}, x)))) : '',
    h(
      'div',
      { class: 'actions section' },
      h('button', { class: 'btn small', type: 'button', onclick: async () => {
        const res = await fetch(`/v1/runs/${state.runId}/report?format=markdown`, { headers: { authorization: `Bearer ${token}` } })
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
          r.layers.map((l) =>
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
    ),
  )
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
  if (!token) return lock()
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
  // A ?pr= link only fills the box; a review (which may cost AI tokens) always needs a click.
  const prParam = new URLSearchParams(location.search).get('pr')
  if (prParam) $('pr').value = prParam
  try {
    await loadSession()
  } catch (e) {
    if (e.message !== 'unauthorized') $('identity').replaceChildren(h('span', { class: 'chip bad' }, e.message))
  }
}

boot()
