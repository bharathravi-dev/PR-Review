// Review page v2 (Epic 9 Stories 9.4–9.8). Contract: ux-designs/ux-pr-reviewer-review-page-v2-2026-11-26
// (DESIGN.md, EXPERIENCE.md). A client of ReviewService v1, like classic. Every string from GitHub, the PR or
// the AI is set as text, never as HTML.
import { followPreference, rememberUi, switchTo } from '/ui-switch.js'
import { groupFindings, isPreExisting } from '../findings-view.js'
import { api, authHeaders, downloadMarkdown, errorText, MODE, streamEvents, token, whenUnauthorized } from './api.js'
import { $, copyText, fill, h, kbd, safeLink } from './dom.js'
import { bindingProblems, createKeymap, DEFAULT_BINDINGS, keyLabels } from './keys.js'
import {
  agentPrompt,
  combinedPrompt,
  defaultSelectionV2,
  duration,
  filesWithFindings,
  filterFindings,
  fixCommand,
  liveTimeline,
  SEVERITY_TONE,
  sinceStrip,
  STATUS_TONE,
  statusText,
  tiles,
  timeline,
  verdictSentence,
  where,
  words,
} from './model.js'

followPreference('v2')

const MAC = /Mac|iPhone|iPad/.test(navigator.platform)
const RUN_KEY = 'pr-reviewer-run'
const RECENT_KEY = 'pr-reviewer-recent'
const THEME_KEY = 'pr-reviewer-theme'
const KEYS_KEY = 'pr-reviewer-keys'
const store = {
  get(k, fallback) {
    try {
      const v = localStorage.getItem(k)
      return v === null ? fallback : JSON.parse(v)
    } catch {
      return fallback
    }
  },
  set(k, v) {
    try {
      if (v === undefined) localStorage.removeItem(k)
      else localStorage.setItem(k, JSON.stringify(v))
    } catch {}
  },
}

const state = {
  surface: 'start',
  session: null,
  sessionError: null,
  locked: false,
  signedOut: false,
  run: null, // { id, pr, status: 'running' | 'done' | 'failed', events, error, startedAt }
  report: null,
  hunks: null, // { files: Map(path → hunks), unavailable: Set, error }
  since: null,
  history: [],
  selected: new Set(),
  edits: {},
  editing: null, // fingerprint whose wording is open
  shown: null,
  filters: { severity: new Set(), confidence: new Set(), file: null },
  narrowDetail: false,
  preview: null,
  digest: null,
  event: 'COMMENT',
  postResult: null,
  hintShown: false,
  keyMode: store.get(KEYS_KEY, {}).mode ?? 'on',
  bindings: { ...DEFAULT_BINDINGS, ...(store.get(KEYS_KEY, {}).bindings ?? {}) },
}
let keymap = createKeymap(state.bindings, state.keyMode)

// ── Announcements and toasts ───────────────────────────────────────────────

let statusTimer
function announce(text, assertive = false) {
  const el = $(assertive ? 'alert' : 'status')
  if (!el) return
  clearTimeout(statusTimer)
  el.textContent = ''
  statusTimer = setTimeout(() => (el.textContent = text), 50)
}

/** Toasts never take focus; info ones leave after 8 s of visible time, errors stay until closed. */
function toast(text, { action, kind = 'info' } = {}) {
  const box = $('toasts')
  const close = () => el.remove()
  const el = h(
    'div',
    { class: `toast ${kind}` },
    h('span', {}, text),
    action ? h('button', { class: 'toast-action', type: 'button', onclick: () => (close(), action.run()) }, action.label) : '',
    h('button', { class: 'toast-close', type: 'button', 'aria-label': 'Close notification', onclick: close }, '✕'),
  )
  box.append(el)
  while (box.children.length > 3) box.firstElementChild.remove()
  announce(text, kind === 'error')
  if (kind === 'error') return
  let left = 8000
  const tick = () => {
    if (!el.isConnected) return
    if (!document.hidden && !el.matches(':hover, :focus-within')) left -= 500
    if (left <= 0) close()
    else setTimeout(tick, 500)
  }
  setTimeout(tick, 500)
}

// ── Rendering frame ────────────────────────────────────────────────────────

/** Re-renders; on a user-initiated change focus goes to the new h1, otherwise focus stays where it was. */
function render({ userNav = false, focusId } = {}) {
  const active = document.activeElement?.id
  renderSidebar()
  renderMain()
  const target = (focusId && $(focusId)) || (userNav ? document.querySelector('#main h1') : active ? $(active) : null)
  if (target) target.focus({ preventScroll: !userNav })
  document.title = `${surfaceTitle()}${state.report ? `: ${prName()}` : ''} · PR Reviewer`
}

function go(surface, opts = {}) {
  state.surface = surface
  state.narrowDetail = false
  render({ userNav: true, ...(surface === 'start' && !opts.focusId ? { focusId: 'start-cmd' } : {}), ...opts })
}

const prName = () => (state.report ? `${state.report.run.repo.fullName}#${state.report.run.pr}` : (state.run?.pr ?? ''))
const SURFACES = { start: 'Start', overview: 'Overview', attention: 'Needs attention', pre: 'Pre-existing', checks: 'Checks', walkthrough: 'Walkthrough', stats: 'Stats', settings: 'Settings', locked: 'Locked', signin: 'Sign in' }
const surfaceTitle = () => SURFACES[state.surface] ?? 'PR Reviewer'

function renderSidebar() {
  const nav = $('side')
  const r = state.report
  const groups = r ? groupFindings(r.findings) : { fresh: [], pre: [] }
  const item = (surface, label, count) =>
    h(
      'button',
      { type: 'button', id: `nav-${surface}`, class: `nav${state.surface === surface ? ' on' : ''}`, 'aria-current': state.surface === surface ? 'page' : undefined, 'aria-label': count !== undefined ? `${label}, ${count}` : label, title: label, onclick: () => go(surface) },
      h('span', { class: 'nav-icon', 'aria-hidden': 'true' }, NAV_ICONS[surface]),
      h('span', { class: 'nav-label' }, label),
      count !== undefined ? h('span', { class: 'count' }, String(count)) : '',
    )
  const runNav = state.run
    ? [
        item('overview', 'Overview'),
        item('attention', 'Needs attention', state.run.status === 'running' ? '…' : groups.fresh.length),
        item('pre', 'Pre-existing', state.run.status === 'running' ? '…' : groups.pre.length),
        item('checks', 'Checks'),
        item('walkthrough', 'Walkthrough'),
      ]
    : []
  const files = r ? filesWithFindings(r.findings) : []
  const s = state.session
  const gh = s?.github
  const ai = s?.ai
  fill(
    nav,
    h('a', { class: 'skip', href: '#main', onclick: (e) => (e.preventDefault(), ($('list-h') ?? $('main').querySelector('h1') ?? $('main'))?.focus()) }, state.report ? 'Skip to findings' : 'Skip to content'),
    h('div', { class: 'brand' }, h('span', { class: 'logo', 'aria-hidden': 'true' }), h('span', { class: 'nav-label' }, 'PR Reviewer')),
    h(
      'button',
      { type: 'button', id: 'cmd-field', class: 'cmd-field', 'aria-label': 'Search or run a command', 'aria-keyshortcuts': MAC ? 'Meta+K' : 'Control+K', onclick: () => openPalette() },
      h('span', { class: 'nav-label' }, 'Search or run a command'),
      h('span', { class: 'nav-icon', 'aria-hidden': 'true' }, '⌕'),
      kbd(MAC ? '⌘' : 'Ctrl', 'K'),
    ),
    ...runNav,
    files.length
      ? h(
          'div',
          { class: 'files' },
          h('div', { class: 'overline nav-label' }, 'Files'),
          files.map((f) =>
            h(
              'button',
              { type: 'button', class: `file nav-label${state.filters.file === f.path ? ' on' : ''}`, 'aria-pressed': state.filters.file === f.path ? 'true' : 'false', title: f.path, onclick: () => ((state.filters.file = state.filters.file === f.path ? null : f.path), go('attention')) },
              h('span', { class: 'mono' }, f.path.split('/').pop()),
              h('span', { class: 'count' }, String(f.n)),
            ),
          ),
        )
      : '',
    runNav.length ? h('hr') : '',
    item('start', 'Start'),
    item('stats', 'Stats'),
    item('settings', 'Settings'),
    h(
      'details',
      { class: 'identity' },
      h(
        'summary',
        { id: 'identity-button', 'aria-label': `Account: ${gh?.login ? `GitHub @${gh.login}` : 'GitHub not signed in'}; ${ai ? `AI ${ai.provider} ${ai.ready ? 'ready' : 'not set up'}` : 'AI checking'}` },
        h('span', { class: `dot ${gh?.login ? 'ok' : 'bad'}`, 'aria-hidden': 'true' }),
        h('span', { class: 'nav-label' }, gh?.login ? `GitHub: @${gh.login}` : 'GitHub: not signed in'),
        h('br'),
        h('span', { class: `dot ${ai?.ready ? 'ok' : 'bad'}`, 'aria-hidden': 'true' }),
        h('span', { class: 'nav-label' }, ai ? `AI: ${ai.provider}${ai.ready ? ' ready' : ' not set up'}` : 'AI: …'),
      ),
      h(
        'div',
        { class: 'menu' },
        h('button', { type: 'button', onclick: () => go('settings') }, 'Settings'),
        h('button', { type: 'button', onclick: () => switchTo('classic') }, 'Switch to classic'),
        MODE === 'web' ? h('button', { type: 'button', onclick: signOut }, 'Sign out') : '',
        h('span', { class: 'muted' }, s ? `pr-reviewer v${s.version}` : ''),
      ),
    ),
  )
}

const NAV_ICONS = { start: '⌕', overview: '◎', attention: '!', pre: '≡', checks: '✓', walkthrough: '¶', stats: '▤', settings: '⚙' }

function renderMain() {
  const main = $('main')
  main.className = ''
  const views = { start: viewStart, overview: viewOverview, attention: () => viewFindings('attention'), pre: () => viewFindings('pre'), checks: viewChecks, walkthrough: viewWalkthrough, stats: viewStats, settings: viewSettings, locked: viewLocked, signin: viewSignIn }
  const view = (views[state.surface] ?? viewStart)()
  fill(main, view)
}

// ── Locked / sign in ───────────────────────────────────────────────────────

function viewLocked() {
  return h('section', { class: 'pane narrow-pane' }, h('h1', { tabindex: '-1' }, 'Open this page from your terminal'), h('p', {}, 'Use the link `pr-reviewer serve` printed; it carries the page’s one-time key.'))
}

function viewSignIn() {
  return h('section', { class: 'pane narrow-pane' }, h('h1', { tabindex: '-1' }, 'Sign in to review pull requests'), h('p', {}, h('a', { class: 'btn primary', href: '/auth/login' }, 'Sign in with GitHub')))
}

async function signOut() {
  await fetch('/auth/logout', { method: 'POST' }).catch(() => undefined)
  location.assign('/v2/')
}

// ── Start and the command palette ──────────────────────────────────────────

const PR_LINK = /^(?:https?:\/\/[^/\s]+\/)?([\w.-]+\/[\w.-]+)(?:\/pull\/|#)(\d+)\b/
const REPO = /^(?:https?:\/\/[^/\s]+\/)?([\w.-]+\/[\w.-]+)\/?$/

function actions() {
  const list = [
    { label: 'New review', run: () => go('start'), key: 'goStart' },
    { label: 'Show stats', run: () => go('stats'), key: 'goStats' },
    { label: 'Settings', run: () => go('settings') },
    { label: 'Keyboard shortcuts', run: () => openSheet(), key: 'help' },
    { label: 'Switch to classic', run: () => switchTo('classic') },
    { label: 'Theme: system', run: () => setTheme('system') },
    { label: 'Theme: light', run: () => setTheme('light') },
    { label: 'Theme: dark', run: () => setTheme('dark') },
    { label: 'Review with another AI provider…', run: () => go('settings') },
  ]
  if (state.report) {
    list.unshift(
      { label: 'Go to Needs attention', run: () => go('attention'), key: 'goAttention' },
      { label: 'Select all new findings', run: () => selectAll(true) },
      { label: 'Select none', run: () => selectAll(false) },
      { label: 'Preview post', run: () => openDrawer(), key: 'post' },
      { label: 'Fix included findings with your agent', run: () => go('attention', { focusId: 'fix-agent' }) },
    )
  }
  return list
}

/** Results for a query: a PR to review, a repository's open PRs, recent reviews, actions. */
async function paletteResults(q, signal) {
  const text = q.trim()
  const out = []
  const pr = PR_LINK.exec(text)
  if (pr) out.push({ group: 'Review', label: `Review ${pr[1]}#${pr[2]}`, run: () => startReview(`${pr[1]}#${pr[2]}`) })
  const repo = !pr && REPO.exec(text)
  if (repo) {
    const r = await api(`/v1/pulls?repo=${encodeURIComponent(repo[1])}`).catch((e) => ({ ok: false, data: { error: { message: e.message } } }))
    if (signal.aborted) return []
    if (!r.ok) out.push({ group: `Open PRs in ${repo[1]}`, label: errorText(r), disabled: true })
    else if (!r.data.pulls?.length) out.push({ group: `Open PRs in ${repo[1]}`, label: 'No open PRs.', disabled: true })
    else
      for (const p of r.data.pulls) {
        const state_ = { CURRENT: 'reviewed, current', OUTDATED: 'reviewed an older commit', NONE: 'not reviewed', UNKNOWN: 'reviewed state unknown (?)' }[p.reviewed] ?? ''
        out.push({ group: `Open PRs in ${repo[1]}`, label: `#${p.number} ${p.title}`, hint: state_, run: () => startReview(`${repo[1]}#${p.number}`) })
      }
  }
  const recent = store.get(RECENT_KEY, [])
  for (const x of recent.filter((x) => !text || x.pr.toLowerCase().includes(text.toLowerCase())).slice(0, 5)) {
    out.push({ group: 'Recent reviews', label: x.pr, hint: x.status ? statusText(x.status) : '', run: () => openRun(x.id, x.pr) })
  }
  const lower = text.toLowerCase()
  for (const a of actions().filter((a) => !text || a.label.toLowerCase().includes(lower))) {
    out.push({ group: 'Actions', label: a.label, run: a.run, keys: a.key ? state.bindings[a.key] : undefined })
  }
  if (text && !pr && !repo && !out.length) out.push({ group: '', label: 'That isn’t a PR link or owner/repo#number.', disabled: true })
  return out
}

/** A combobox with a listbox of results; used inline on Start and inside the palette dialog. */
function commandBox({ id, onDone }) {
  const listId = `${id}-list`
  const input = h('input', { id, type: 'text', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': listId, 'aria-autocomplete': 'list', autocomplete: 'off', spellcheck: false, placeholder: 'Paste a PR link, or type owner/repo to see its open PRs' })
  const list = h('ul', { id: listId, role: 'listbox', class: 'results', 'aria-label': 'Results' })
  const error = h('p', { class: 'field-error', id: `${id}-error` })
  let items = []
  let active = -1
  let ctrl
  let timer
  const paint = () => {
    list.replaceChildren()
    let group = null
    items.forEach((it, i) => {
      if (it.group !== group && it.group) list.append(h('li', { role: 'presentation', class: 'group' }, it.group))
      group = it.group
      list.append(
        h(
          'li',
          { id: `${id}-opt-${i}`, role: 'option', 'aria-selected': i === active ? 'true' : 'false', 'aria-disabled': it.disabled ? 'true' : undefined, class: `opt${i === active ? ' on' : ''}${it.disabled ? ' disabled' : ''}`, onmousedown: (e) => e.preventDefault(), onclick: () => choose(i) },
          h('span', {}, it.label),
          it.hint ? h('small', {}, ` · ${it.hint}`) : '',
          it.keys ? h('span', { class: 'keys' }, kbd(...keyLabels(it.keys, MAC))) : '',
        ),
      )
    })
    input.setAttribute('aria-expanded', items.length ? 'true' : 'false')
    if (active >= 0) input.setAttribute('aria-activedescendant', `${id}-opt-${active}`)
    else input.removeAttribute('aria-activedescendant')
  }
  const refresh = async () => {
    ctrl?.abort()
    ctrl = new AbortController()
    const signal = ctrl.signal
    error.textContent = ''
    if (REPO.exec(input.value.trim()) && !PR_LINK.exec(input.value.trim())) {
      items = [{ group: '', label: 'Looking up open PRs…', disabled: true }]
      paint()
    }
    const next = await paletteResults(input.value, signal)
    if (signal.aborted) return
    items = next
    active = items.findIndex((x) => !x.disabled)
    paint()
  }
  const choose = (i) => {
    const it = items[i]
    if (!it || it.disabled) return
    onDone?.()
    it.run()
  }
  input.addEventListener('input', () => {
    clearTimeout(timer)
    timer = setTimeout(refresh, 250)
  })
  input.addEventListener('focus', () => items.length || refresh())
  input.addEventListener('keydown', (e) => {
    const enabled = items.map((x, i) => (x.disabled ? -1 : i)).filter((i) => i >= 0)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!enabled.length) return
      const at = enabled.indexOf(active)
      active = enabled[(at + (e.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length]
      paint()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (active >= 0) choose(active)
      else if (input.value.trim()) error.textContent = 'That isn’t a PR link or owner/repo#number.'
    }
  })
  return { input, list, error, root: h('div', { class: 'command' }, h('label', { for: id, class: 'sr-only' }, 'Command'), h('div', { class: 'command-input' }, h('span', { 'aria-hidden': 'true' }, '⌕'), input), error, list) }
}

function viewStart() {
  const box = commandBox({ id: 'start-cmd' })
  const s = state.session
  const problems = []
  if (s && !s.github?.login) problems.push(MODE === 'local' ? `GitHub: ${s.github?.error ?? 'no token'}. Run gh auth login or set GITHUB_TOKEN, then restart pr-reviewer serve.` : 'GitHub sign-in is missing.')
  if (s && !s.ai?.ready) problems.push(`AI provider ${s.ai.provider} is not ready: ${s.ai.reason ?? 'not set up'}.${MODE === 'web' ? ' Open Settings to add your key.' : ' Check your pr-reviewer config.'}`)
  if (state.sessionError) problems.push(state.sessionError)
  const recent = store.get(RECENT_KEY, [])
  return h(
    'section',
    { class: 'pane start' },
    h('h1', { tabindex: '-1' }, 'Review a pull request'),
    h('p', { class: 'muted' }, 'Paste a PR link, or type owner/repo to see its open PRs.'),
    problems.length ? h('div', { class: 'banner bad' }, problems.map((p) => h('p', {}, p))) : '',
    box.root,
    h(
      'section',
      { class: 'recent', 'aria-labelledby': 'recent-h' },
      h('h2', { id: 'recent-h', class: 'overline' }, 'Recent reviews'),
      recent.length
        ? h('ul', { class: 'plain' }, recent.map((x) => h('li', {}, h('button', { type: 'button', class: 'recent-row', onclick: () => openRun(x.id, x.pr) }, h('b', {}, x.pr), x.title ? ` · ${x.title}` : '', x.status ? h('span', { class: `pill ${STATUS_TONE[x.status] ?? ''}` }, statusText(x.status)) : '', h('span', { class: 'muted' }, new Date(x.at).toLocaleString())))))
        : h('p', { class: 'muted' }, 'No reviews yet. Paste a PR link to start.'),
    ),
  )
}

function openPalette() {
  const dlg = $('palette')
  if (dlg.open) return
  const box = commandBox({ id: 'pal-cmd', onDone: () => dlg.close() })
  dlg.replaceChildren(h('div', { class: 'dialog-head' }, h('h2', { class: 'sr-only' }, 'Command palette'), h('button', { class: 'btn small', type: 'button', 'aria-label': 'Close', onclick: () => dlg.close() }, '✕')), box.root)
  dlg.showModal()
  box.input.focus()
}

// ── Running a review ───────────────────────────────────────────────────────

function remember(run, extra = {}) {
  const list = store.get(RECENT_KEY, []).filter((x) => x.id !== run.id && x.pr !== run.pr)
  list.unshift({ id: run.id, pr: run.pr, at: Date.now(), ...extra })
  store.set(RECENT_KEY, list.slice(0, 10))
}

let painting = false
function repaintSoon() {
  if (painting) return
  painting = true
  requestAnimationFrame(() => {
    painting = false
    if (['overview', 'checks'].includes(state.surface)) render()
    else renderSidebar()
  })
}

const announced = new Set()
function onRunEvent(e) {
  state.run.events.push(e)
  const p = e.payload ?? {}
  if (e.type === 'LAYER_STATUS' && p.status !== 'NOT_APPLICABLE') {
    const msg = `${words(p.layer)}: ${words(p.status)}${p.reason ? `, ${words(p.reason)}` : ''}`
    if (!announced.has(msg)) {
      announced.add(msg)
      clearTimeout(onRunEvent.t)
      onRunEvent.q = [...(onRunEvent.q ?? []), msg]
      onRunEvent.t = setTimeout(() => (announce(onRunEvent.q.join('. ')), (onRunEvent.q = [])), 3000)
    }
  }
  repaintSoon()
}

async function startReview(pr) {
  if (state.run?.status === 'running') return toast('A review is already running. Wait for it to finish.', { kind: 'error' })
  const r = await api('/v1/runs', { method: 'POST', body: { pr } }).catch((e) => ({ ok: false, status: 0, data: { error: { message: e.message } } }))
  if (!r.ok) {
    const msg = errorText(r)
    if (state.surface === 'start') {
      const err = $('start-cmd-error')
      if (err) err.textContent = msg
    }
    return toast(msg, { kind: 'error' })
  }
  beginRun(r.data.id, r.data.pr)
  go('overview')
  follow()
}

function beginRun(id, pr) {
  state.run = { id, pr, status: 'running', events: [], startedAt: Date.now() }
  Object.assign(state, { report: null, hunks: null, since: null, history: [], selected: new Set(), edits: {}, editing: null, shown: null, preview: null, digest: null, postResult: null })
  state.filters = { severity: new Set(), confidence: new Set(), file: null }
  announced.clear()
  try {
    sessionStorage.setItem(RUN_KEY, id)
  } catch {}
  remember(state.run)
}

async function follow() {
  const run = state.run
  const tick = setInterval(() => state.surface === 'overview' && $('elapsed') && ($('elapsed').textContent = duration(Date.now() - run.startedAt)), 10000)
  try {
    await streamEvents(run.id, onRunEvent)
    await loadReport(run.id)
  } catch (e) {
    if (e.message === 'unauthorized') return
    run.status = 'failed'
    run.error = e.message
    render()
    toast(`The review failed: ${e.message}`, { kind: 'error', action: { label: 'Retry', run: () => startReview(run.pr) } })
  } finally {
    clearInterval(tick)
  }
}

async function loadReport(id) {
  const r = await api(`/v1/runs/${id}/report`)
  if (r.status === 202) return
  if (!r.ok) throw new Error(errorText(r))
  const report = r.data
  state.run = { ...(state.run ?? { id, events: [] }), id, pr: `${report.run.repo.fullName}#${report.run.pr}`, status: 'done' }
  state.report = report
  state.selected = defaultSelectionV2(report.findings)
  state.shown = groupFindings(report.findings).fresh[0]?.fingerprint ?? null
  remember(state.run, { status: report.overallStatus, title: report.title })
  const fresh = groupFindings(report.findings).fresh.length
  if (state.surface !== 'overview' || document.hidden) toast(`Review finished · ${fresh} new finding${fresh === 1 ? '' : 's'}`, { action: { label: 'Show findings', run: () => go('attention') } })
  announce(`Review finished: ${statusText(report.overallStatus)}, ${fresh} new finding${fresh === 1 ? '' : 's'}.`)
  render()
  loadExtras(id)
}

async function loadExtras(id) {
  const [hunks, preview, history] = await Promise.all([
    api(`/v1/runs/${id}/hunks`).catch(() => ({ ok: false })),
    state.session?.github?.login ? api(`/v1/runs/${id}/publish`, { method: 'POST', body: { dryRun: true } }).catch(() => ({ ok: false })) : { ok: false },
    MODE === 'web' && state.report ? api(`/v1/history?pr=${encodeURIComponent(prName())}`).catch(() => ({ ok: false })) : { ok: false },
  ])
  if (state.run?.id !== id) return
  state.hunks = hunks.ok ? { files: new Map(hunks.data.files.map((f) => [f.path, f.hunks])), unavailable: new Set(hunks.data.unavailable) } : { files: new Map(), unavailable: new Set(), error: true }
  if (preview.ok) state.since = sinceStrip(preview.data.preview, state.report)
  if (history.ok) state.history = history.data.runs ?? []
  render()
}

async function openRun(id, pr) {
  beginRun(id, pr)
  const r = await api(`/v1/runs/${id}/report`).catch((e) => ({ ok: false, data: { error: { message: e.message } } }))
  if (r.status === 202) {
    go('overview')
    return follow()
  }
  if (!r.ok) {
    state.run = null
    go('start')
    return toast(`That review is no longer available: ${errorText(r)}`, { kind: 'error' })
  }
  await loadReport(id)
  go('overview')
}

/** After a reload: reattach to the last run (running) or show its Report (finished); only the current state is announced. */
async function resume() {
  let id = null
  try {
    id = sessionStorage.getItem(RUN_KEY)
  } catch {}
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return false
  const recent = store.get(RECENT_KEY, []).find((x) => x.id === id)
  const r = await api(`/v1/runs/${id}/report`).catch(() => ({ ok: false }))
  if (r.status === 202) {
    beginRun(id, recent?.pr ?? 'your last review')
    state.surface = 'overview'
    render()
    announce('Reattached to the review in progress.')
    follow()
    return true
  }
  if (r.ok) {
    beginRun(id, recent?.pr ?? '')
    state.surface = 'overview'
    await loadReport(id)
    return true
  }
  return false
}

// ── Overview ───────────────────────────────────────────────────────────────

function viewOverview() {
  const run = state.run
  if (!run) return viewStart()
  const r = state.report
  const running = run.status === 'running'
  const failed = run.status === 'failed'
  const rows = r ? timeline(r.layers) : liveTimeline(run.events)
  return h(
    'section',
    { class: 'pane overview' },
    h('div', { class: 'crumb mono' }, `${run.pr}${r?.run.headSha ? ` · head ${r.run.headSha.slice(0, 7)}` : ''}${running ? ' · reviewing · ' : ''}`, running ? h('span', { id: 'elapsed' }, duration(Date.now() - run.startedAt)) : ''),
    h(
      'div',
      { class: `hero${r ? ` tone-${STATUS_TONE[r.overallStatus] ?? 'neutral'}` : ''}` },
      h('h1', { tabindex: '-1' }, r?.title ?? run.pr),
      running ? h('span', { class: 'pill running' }, 'Reviewing') : failed ? h('span', { class: 'pill bad' }, 'Error') : h('span', { class: `pill ${STATUS_TONE[r.overallStatus] ?? ''}` }, statusText(r.overallStatus)),
      h('p', { class: 'lede' }, running ? 'Results appear here when the review finishes. You can leave this page; the review keeps running.' : failed ? `The review failed: ${run.error}` : verdictSentence(r)),
      failed ? h('button', { class: 'btn primary', type: 'button', onclick: () => startReview(run.pr) }, 'Retry') : '',
      r?.gate.failedRules.length ? h('div', { class: 'gate' }, h('strong', {}, 'Why it failed'), h('ul', {}, r.gate.failedRules.map((x) => h('li', {}, x)))) : '',
    ),
    state.since
      ? h(
          'p',
          { class: 'since' },
          'Since the last review: ',
          h('button', { type: 'button', class: 'linkish ok', onclick: () => openDrawer() }, `${state.since.resolved} resolved`),
          ' · ',
          h('button', { type: 'button', class: 'linkish warn', onclick: () => go('attention') }, `${state.since.stillOpen} still open`),
          ' · ',
          h('button', { type: 'button', class: 'linkish accent', onclick: () => go('attention') }, `${state.since.fresh} new`),
        )
      : '',
    h(
      'div',
      { class: 'tiles' },
      r
        ? tiles(r).map((t) => h('button', { type: 'button', class: `tile${t.lead ? ' lead' : ''}`, onclick: () => go(t.id) }, h('b', {}, t.value), h('span', {}, t.caption)))
        : [0, 1, 2, 3].map(() => h('div', { class: 'tile', 'aria-hidden': 'true' }, h('span', { class: 'sk' }), h('span', { class: 'sk s' }))),
    ),
    h(
      'div',
      { class: 'two' },
      r
        ? h(
            'section',
            { class: 'panel', 'aria-labelledby': 'na-h' },
            h('h2', { id: 'na-h', class: 'overline' }, 'Needs attention'),
            groupFindings(r.findings).fresh.length
              ? h('ul', { class: 'plain' }, groupFindings(r.findings).fresh.slice(0, 5).map((f) => h('li', {}, h('button', { type: 'button', class: 'att-row', onclick: () => ((state.shown = f.fingerprint), go('attention', { focusId: 'detail-h' })) }, h('span', { class: `sev ${SEVERITY_TONE[f.severity]}` }, f.severity), h('span', {}, h('b', {}, f.title), h('span', { class: 'mono muted' }, where(f)))))))
              : h('p', { class: 'muted' }, 'No new findings.'),
          )
        : '',
      h('section', { class: 'panel', 'aria-labelledby': 'run-h' }, h('h2', { id: 'run-h', class: 'overline' }, 'Run'), timelineList(rows)),
    ),
    MODE === 'web' && state.history.length > 1
      ? h(
          'section',
          { class: 'panel', 'aria-labelledby': 'hist-h' },
          h('h2', { id: 'hist-h', class: 'overline' }, 'Earlier runs'),
          h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Head'), h('th', {}, 'Result'), h('th', {}, ''))), h('tbody', {}, state.history.map((x) => h('tr', {}, h('td', {}, new Date(x.startedAt).toLocaleString()), h('td', { class: 'mono' }, String(x.headSha ?? '').slice(0, 7)), h('td', {}, statusText(x.overallStatus)), h('td', {}, x.id === run.id ? 'this run' : h('button', { class: 'btn small', type: 'button', onclick: () => openRun(x.id, run.pr) }, 'Open')))))),
        )
      : '',
  )
}

function timelineList(rows) {
  if (!rows.length) return h('p', { class: 'muted' }, 'Starting…')
  return h(
    'ol',
    { class: 'timeline' },
    rows.map((row) =>
      h(
        'li',
        { class: `step ${row.tone}` },
        h('span', { class: 'node', 'aria-hidden': 'true' }),
        h('div', {}, h('b', {}, row.name), ' ', h('span', { class: 'state' }, row.word), row.detail ? h('small', {}, row.detail) : ''),
        row.ms !== undefined ? h('span', { class: 'mono muted' }, duration(row.ms)) : '',
      ),
    ),
  )
}

// ── Needs attention / Pre-existing ─────────────────────────────────────────

function viewFindings(which) {
  const r = state.report
  if (!r) return viewOverview()
  const { fresh, pre } = groupFindings(r.findings)
  const all = which === 'pre' ? pre : fresh
  const list = filterFindings(all, state.filters)
  if (!list.some((f) => f.fingerprint === state.shown)) state.shown = list[0]?.fingerprint ?? null
  const shown = list.find((f) => f.fingerprint === state.shown)
  const included = r.findings.filter((f) => f.fingerprint && state.selected.has(f.fingerprint))
  $('main').className = `split${state.narrowDetail ? ' show-detail' : ''}`
  const chip = (set, value, label) =>
    h('button', { type: 'button', class: `chip${set.has(value) ? ' on' : ''}`, 'aria-pressed': set.has(value) ? 'true' : 'false', onclick: () => (set.has(value) ? set.delete(value) : set.add(value), render({ focusId: `chip-${value}` })), id: `chip-${value}` }, set.has(value) ? '✓ ' : '', label)
  const sevs = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO'].filter((s) => all.some((f) => f.severity === s))
  const confs = ['HIGH', 'MEDIUM', 'LOW'].filter((c) => all.some((f) => f.confidence === c))
  const listPane = h(
    'section',
    { class: 'list', id: 'list', 'aria-labelledby': 'list-h' },
    h(
      'div',
      { class: 'list-head' },
      h('h1', { id: 'list-h', tabindex: '-1' }, which === 'pre' ? 'Pre-existing' : 'Needs attention'),
      h('p', { class: 'muted mono' }, `${prName()} · ${all.length} ${which === 'pre' ? 'pre-existing' : 'new'} · ${included.length} included`),
      which === 'attention'
        ? h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn small', onclick: () => selectAll(true) }, 'Select all'), h('button', { type: 'button', class: 'btn small', onclick: () => selectAll(false) }, 'Select none'), h('button', { type: 'button', class: 'btn small', id: 'fix-agent', onclick: (e) => toggleAgentPanel(e.currentTarget) }, `⚡ Fix ${included.length} included with your agent`))
        : h('p', { class: 'muted' }, 'Problems in code this PR did not introduce. They never fail the review; tick one to mention it in the summary.'),
      h('div', { class: 'agent-slot', id: 'agent-slot' }),
    ),
    all.length ? h('div', { class: 'toolbar', role: 'group', 'aria-label': 'Filters' }, sevs.map((s) => chip(state.filters.severity, s, words(s))), confs.map((c) => chip(state.filters.confidence, c, `${words(c)} confidence`)), state.filters.file ? h('button', { type: 'button', class: 'chip on', 'aria-pressed': 'true', onclick: () => ((state.filters.file = null), render()) }, `✓ ${state.filters.file.split('/').pop()}`) : '') : '',
    list.length
      ? h('ul', { class: 'rows', 'aria-label': which === 'pre' ? 'Pre-existing findings' : 'New findings' }, list.map((f) => findingRow(f)))
      : h('p', { class: 'muted pad' }, all.length ? 'No findings match these filters. ' : which === 'pre' ? 'No pre-existing findings.' : 'No new findings.', all.length ? h('button', { type: 'button', class: 'linkish accent', onclick: () => ((state.filters = { severity: new Set(), confidence: new Set(), file: null }), render()) }, 'Clear filters') : ''),
    which === 'attention' && pre.length ? h('button', { type: 'button', class: 'pre-row', onclick: () => go('pre') }, `${pre.length} pre-existing · Show`) : '',
  )
  const detailPane = h('section', { class: 'detail', id: 'detail', 'aria-label': 'Finding' }, shown ? findingThread(shown, list) : h('p', { class: 'muted pad' }, 'Select a finding.'))
  return [listPane, detailPane, postBar(included)]
}

function findingRow(f) {
  const id = `row-${f.fingerprint}`
  const on = state.selected.has(f.fingerprint)
  const current = f.fingerprint === state.shown
  return h(
    'li',
    { class: `frow${current ? ' current' : ''}${on ? '' : ' off'}` },
    h(
      'label',
      { class: 'check' },
      h('input', { type: 'checkbox', checked: on, disabled: !f.fingerprint, onchange: (e) => setIncluded(f, e.target.checked) }),
      h('span', { class: 'sr-only' }, `Include in post: ${f.severity} ${f.title}, ${where(f)}`),
    ),
    h(
      'button',
      { type: 'button', id, class: 'title-btn', 'aria-current': current ? 'true' : undefined, 'data-fp': f.fingerprint, onclick: () => showFinding(f.fingerprint, true) },
      h('span', { class: 't' }, f.title, state.edits[f.fingerprint] ? h('span', { class: 'edited' }, ' · edited') : ''),
      h('span', { class: 'm mono', title: where(f) }, `${shortWhere(f)} · ${f.sourceFamily === 'AI' ? 'AI' : (f.provenance?.tool ?? 'tool')} · ${words(f.confidence)}`),
      h('span', { class: 'badges' }, h('span', { class: `sev ${SEVERITY_TONE[f.severity]}` }, f.severity), on ? '' : h('span', { class: 'sev neutral' }, f.confidence === 'LOW' ? 'Low confidence · not included' : 'Not included')),
    ),
  )
}

/** The last two path segments with the lines ("info-modal/info-modal.component.html:72"); the full path is the tooltip. */
function shortWhere(f) {
  const full = where(f)
  const parts = full.split('/')
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : full
}

function showFinding(fp, moveFocus) {
  state.shown = fp
  state.narrowDetail = true
  render({ focusId: moveFocus ? 'detail-h' : `row-${fp}` })
}

function setIncluded(f, on) {
  if (on) state.selected.add(f.fingerprint)
  else {
    state.selected.delete(f.fingerprint)
    if (!state.hintShown) {
      state.hintShown = true
      toast('Excluded from this post. To teach future reviews of this repository, react 👎 or reply /dismiss <why> on GitHub.')
    }
  }
  state.preview = null
  state.digest = null
  render()
  announce(`${state.selected.size} of ${state.report.findings.length} included`)
}

function selectAll(on) {
  state.selected = on ? defaultSelectionV2(state.report.findings) : new Set()
  for (const f of groupFindings(state.report.findings).fresh) if (on && f.fingerprint && !f.dismissed) state.selected.add(f.fingerprint)
  state.preview = null
  render()
  announce(`${state.selected.size} of ${state.report.findings.length} included`)
}

function codeLines(f) {
  const l = f.location
  if (!l?.path || l.anchorKind !== 'LINE' || !l.startLine) return { kind: 'none' }
  if (!state.hunks) return { kind: 'loading' }
  const hunks = state.hunks.files.get(l.path)
  if (!hunks) return { kind: state.hunks.error || state.hunks.unavailable.has(l.path) ? 'unavailable' : 'none' }
  const start = l.startLine - 3
  const end = (l.endLine ?? l.startLine) + 3
  const rows = []
  for (const hunk of hunks) {
    let next = hunk.lines.find((x) => x.newLine !== undefined)?.newLine ?? 1
    const keep = hunk.lines.filter((x) => {
      if (x.newLine !== undefined) next = x.newLine + 1
      const pos = x.newLine ?? next
      return pos >= start && pos <= end
    })
    if (keep.length) rows.push({ header: hunk.header, lines: keep })
  }
  return rows.length ? { kind: 'code', rows } : { kind: 'none' }
}

function codeTable(f) {
  const c = codeLines(f)
  const blob = `https://${state.report.run.host}/${state.report.run.repo.fullName}/blob/${state.report.run.headSha}/${f.location.path}${f.location.startLine ? `#L${f.location.startLine}${f.location.endLine && f.location.endLine !== f.location.startLine ? `-L${f.location.endLine}` : ''}` : ''}`
  const head = h('div', { class: 'file-head mono' }, h('span', {}, f.location.path ?? 'whole PR'), f.location.path ? safeLink(blob, 'open on GitHub ↗', state.report.run.host) : '')
  if (c.kind === 'loading') return h('div', { class: 'code' }, head, h('p', { class: 'muted pad' }, 'Loading the code…'))
  if (c.kind === 'unavailable') return h('div', { class: 'code' }, head, h('p', { class: 'muted pad' }, 'The code for this finding could not be loaded.'))
  if (c.kind === 'none') return f.location.path ? h('div', { class: 'code' }, head, h('p', { class: 'muted pad' }, 'Not in this PR’s diff.')) : ''
  return h(
    'div',
    { class: 'code' },
    head,
    h(
      'div',
      { class: 'code-scroll', tabindex: '0', role: 'region', 'aria-label': `Code for ${f.title}` },
      h(
        'table',
        { class: 'diff' },
        h('caption', { class: 'sr-only' }, `Changes in ${f.location.path} around line ${f.location.startLine}`),
        h('thead', { class: 'sr-only' }, h('tr', {}, h('th', {}, 'Old line'), h('th', {}, 'New line'), h('th', {}, 'Change'), h('th', {}, 'Code'))),
        h(
          'tbody',
          {},
          c.rows.flatMap((hk) => [
            h('tr', { class: 'hunk' }, h('td', { colspan: '4' }, hk.header)),
            ...hk.lines.map((x) => h('tr', { class: x.kind }, h('td', { class: 'ln' }, x.oldLine ?? ''), h('td', { class: 'ln' }, x.newLine ?? ''), h('td', { class: 'sign' }, x.kind === 'add' ? '+' : x.kind === 'del' ? '−' : '', h('span', { class: 'sr-only' }, x.kind === 'add' ? 'added' : x.kind === 'del' ? 'removed' : '')), h('td', { class: 'src' }, x.text))),
          ]),
        ),
      ),
    ),
  )
}

/** Minimal, safe Markdown for previews: paragraphs, `code`, **bold**; built as DOM nodes, never HTML. */
function md(text) {
  return String(text ?? '')
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((p) =>
      h(
        'p',
        {},
        p.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((part) => (part.startsWith('`') && part.endsWith('`') && part.length > 2 ? h('code', {}, part.slice(1, -1)) : part.startsWith('**') && part.endsWith('**') && part.length > 4 ? h('strong', {}, part.slice(2, -2)) : part)),
      ),
    )
}

function findingThread(f, list) {
  const e = state.edits[f.fingerprint] ?? {}
  const i = list.findIndex((x) => x.fingerprint === f.fingerprint)
  const on = state.selected.has(f.fingerprint)
  return h(
    'article',
    { class: 'thread' },
    h('button', { type: 'button', class: 'back linkish accent', onclick: () => ((state.narrowDetail = false), render({ focusId: `row-${f.fingerprint}` })) }, `← ${state.surface === 'pre' ? 'Pre-existing' : 'Needs attention'}`, h('span', { class: 'muted' }, ` · ${i + 1} of ${list.length}`)),
    h(
      'div',
      { class: 'badges' },
      h('span', { class: `sev ${SEVERITY_TONE[f.severity]}` }, f.severity),
      h('span', { class: 'chip' }, words(f.category)),
      h('span', { class: 'chip' }, `${f.sourceFamily === 'AI' ? `AI${f.provenance?.model ? ` (${f.provenance.model})` : ''}` : (f.provenance?.tool ?? f.provenance?.validator ?? 'tool')} · ${words(f.confidence)} confidence`),
      f.scope && f.scope !== 'NEW' ? h('span', { class: 'chip' }, words(f.scope)) : '',
      f.disposition === 'ADVISORY' ? h('span', { class: 'chip' }, 'advisory') : '',
      f.dismissed ? h('span', { class: 'chip warn' }, `dismissed by ${f.dismissed.by}`) : '',
    ),
    h('h2', { id: 'detail-h', tabindex: '-1' }, e.title ?? f.title),
    codeTable(f),
    state.editing === f.fingerprint
      ? editor(f)
      : h(
          'div',
          { class: 'comment' },
          md(e.description ?? f.description),
          f.impact ? h('div', { class: 'why' }, h('strong', {}, 'Why it matters. '), f.impact) : '',
          (e.recommendation ?? f.recommendation) ? h('div', {}, h('strong', {}, 'Recommendation. '), md(e.recommendation ?? f.recommendation)) : '',
          f.suggestion ? h('div', { class: 'suggestion' }, h('div', { class: 'file-head' }, h('span', {}, 'Suggested change'), h('span', { class: 'muted' }, 'posts as a committable suggestion')), h('pre', { class: 'mono' }, f.suggestion)) : '',
        ),
    h(
      'div',
      { class: 'row-actions' },
      h('button', { type: 'button', class: 'btn', id: 'act-edit', 'aria-keyshortcuts': state.bindings.edit, onclick: () => openEditor(f) }, 'Edit wording ', kbd(state.bindings.edit)),
      h('button', { type: 'button', class: 'btn', 'aria-keyshortcuts': state.bindings.toggle, onclick: () => setIncluded(f, !on) }, on ? 'Exclude ' : 'Include ', kbd(state.bindings.toggle)),
      h('button', { type: 'button', class: 'btn', 'aria-keyshortcuts': state.bindings.copyPrompt, onclick: () => copyPrompt(f) }, 'Copy agent prompt ', kbd(state.bindings.copyPrompt)),
    ),
  )
}

async function copyPrompt(f) {
  const ok = await copyText(agentPrompt(f, state.edits[f.fingerprint] ?? {}))
  announce(ok ? 'Agent prompt copied.' : 'Could not copy; select the text instead.')
}

function toggleAgentPanel(anchor) {
  const slot = $('agent-slot')
  if (slot.firstChild) return slot.replaceChildren()
  const r = state.report
  const included = r.findings.filter((f) => f.fingerprint && state.selected.has(f.fingerprint))
  const cmd = fixCommand(r)
  slot.replaceChildren(
    h(
      'div',
      { class: 'agent-panel', role: 'region', 'aria-label': 'Fix with your agent' },
      h('p', {}, `In a checkout of the PR, run this to let your own Claude Code or Codex fix the ${included.length} included finding(s):`),
      h('pre', { class: 'mono' }, cmd),
      h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn small', onclick: async () => announce((await copyText(cmd)) ? 'Command copied.' : 'Could not copy.') }, 'Copy command'), h('button', { type: 'button', class: 'btn small', onclick: async () => announce((await copyText(combinedPrompt(prName(), included, state.edits))) ? 'Combined prompt copied.' : 'Could not copy.') }, 'Copy combined prompt')),
      h('p', { class: 'muted' }, 'Nothing runs from this page.'),
    ),
  )
  anchor.setAttribute('aria-expanded', 'true')
}

// ── Inline editor ──────────────────────────────────────────────────────────

function openEditor(f) {
  state.editing = f.fingerprint
  render({ focusId: 'ed-title' })
}

function editor(f) {
  const e = state.edits[f.fingerprint] ?? {}
  const field = (key, label, value, multiline) => {
    const input = multiline ? h('textarea', { id: `ed-${key}`, rows: key === 'description' ? 5 : 3 }, value ?? '') : h('input', { id: `ed-${key}`, type: 'text', value: value ?? '' })
    const preview = h('div', { class: 'md-preview', 'aria-label': `${label} preview` }, multiline ? md(value) : value ?? '')
    input.addEventListener('input', () => preview.replaceChildren(...(multiline ? md(input.value) : [input.value])))
    return h('div', { class: 'ed-field' }, h('label', { for: `ed-${key}` }, label), h('div', { class: 'ed-split' }, input, preview))
  }
  const form = h(
    'form',
    { class: 'editor', 'aria-label': 'Edit wording' },
    field('title', 'Title', e.title ?? f.title, false),
    field('description', 'Description (Markdown)', e.description ?? f.description, true),
    field('recommendation', 'Recommendation (Markdown)', e.recommendation ?? f.recommendation, true),
    h('p', { class: 'muted' }, 'The suggested change, if any, is posted as it is.'),
    h('div', { class: 'row-actions' }, h('button', { type: 'submit', class: 'btn primary' }, 'Save ', kbd(MAC ? '⌘' : 'Ctrl', '↵')), h('button', { type: 'button', class: 'btn', id: 'ed-cancel', onclick: () => closeEditor(f, false) }, 'Cancel')),
  )
  const dirty = () => ['title', 'description', 'recommendation'].some((k) => (form.querySelector(`#ed-${k}`).value ?? '') !== ((e[k] ?? f[k]) ?? ''))
  form.addEventListener('submit', (ev) => {
    ev.preventDefault()
    const next = {}
    for (const k of ['title', 'description', 'recommendation']) {
      const v = form.querySelector(`#ed-${k}`).value
      if (v !== (f[k] ?? '') && (k === 'recommendation' || v.trim())) next[k] = v
    }
    if (Object.keys(next).length) state.edits[f.fingerprint] = next
    else delete state.edits[f.fingerprint]
    closeEditor(f, true)
  })
  form.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault()
      form.requestSubmit()
    } else if (ev.key === 'Escape') {
      ev.preventDefault()
      ev.stopPropagation()
      if (dirty()) {
        $('ed-cancel').focus()
        announce('Unsaved changes. Press Cancel to discard, or Save.', true)
      } else closeEditor(f, false)
    }
  })
  return form
}

function closeEditor(f, saved) {
  state.editing = null
  state.preview = null
  state.digest = null
  render({ focusId: 'act-edit' })
  if (saved) announce('Wording saved for the post.')
}

// ── Post drawer ────────────────────────────────────────────────────────────

function postBar(included) {
  return h(
    'div',
    { class: 'postbar' },
    h('span', {}, `${included.length} included · posts as @${state.session?.github?.login ?? '…'}`),
    h('button', { type: 'button', class: 'btn primary', id: 'open-post', 'aria-keyshortcuts': state.bindings.post, onclick: () => openDrawer() }, 'Preview post ', kbd(state.bindings.post)),
  )
}

const include = () => {
  const all = state.report.findings.filter((f) => f.fingerprint).map((f) => f.fingerprint)
  return all.every((fp) => state.selected.has(fp)) ? undefined : [...state.selected]
}

async function openDrawer() {
  if (!state.report) return
  const dlg = $('drawer')
  if (!dlg.open) dlg.showModal()
  state.postResult = null
  await buildPreview()
}

async function buildPreview() {
  const dlg = $('drawer')
  paintDrawer('Building the preview…')
  const body = { event: state.event, dryRun: true }
  const inc = include()
  if (inc) body.include = inc
  if (Object.keys(state.edits).length) body.edits = state.edits
  const r = await api(`/v1/runs/${state.run.id}/publish`, { method: 'POST', body }).catch((e) => ({ ok: false, data: { error: { message: e.message } } }))
  if (!dlg.open) return
  if (!r.ok) return paintDrawer(null, { kind: 'bad', text: errorText(r) })
  state.preview = r.data.preview
  state.digest = r.data.digest
  paintDrawer()
  announce(`Preview ready: ${state.preview.inline.length} inline comment${state.preview.inline.length === 1 ? '' : 's'} and the summary.`)
}

function paintDrawer(loading, result = state.postResult) {
  const dlg = $('drawer')
  const s = state.session
  const p = state.preview
  const type = h('select', { id: 'post-event', onchange: (e) => ((state.event = e.target.value), buildPreview()) }, h('option', { value: 'COMMENT' }, 'Comment'), s?.publish?.allowRequestChanges ? h('option', { value: 'REQUEST_CHANGES' }, 'Request changes') : '')
  type.value = state.event
  const strip = (t) => String(t).replace(/\n*<!-- pr-reviewer [^>]* -->\s*$/, '')
  fill(
    dlg,
    h('div', { class: 'dialog-head' }, h('h2', { id: 'drawer-h', tabindex: '-1' }, 'Post to GitHub'), h('button', { type: 'button', class: 'btn small', onclick: () => dlg.close() }, '✕ Close')),
    h('p', { class: 'muted' }, `Posts as @${s?.github?.login ?? '?'}: one review with inline comments, plus one summary comment that is updated on later runs. Approving is never possible.`),
    h('label', { class: 'field' }, 'Review type ', type),
    loading ? h('p', { class: 'muted' }, loading) : '',
    p && !loading
      ? [
          h('h3', { class: 'overline' }, `New inline comments (${p.inline.length})`),
          p.inline.length ? h('ul', { class: 'plain' }, p.inline.map((c) => h('li', {}, h('details', {}, h('summary', { class: 'mono' }, `${c.path}:${c.startLine ? `${c.startLine}-` : ''}${c.line}`), h('pre', { class: 'mono' }, strip(c.body)))))) : h('p', { class: 'muted' }, 'None.'),
          p.stillOpen.length ? [h('h3', { class: 'overline' }, `Still open from earlier reviews (${p.stillOpen.length}), not re-posted`), h('ul', { class: 'plain' }, p.stillOpen.map((x) => h('li', {}, x.url ? safeLink(x.url, x.title, state.report.run.host) : x.title)))] : '',
          p.resolved.length ? [h('h3', { class: 'overline' }, `Resolved since the last review (${p.resolved.length})`), h('ul', { class: 'plain' }, p.resolved.map((x) => h('li', {}, x.url ? safeLink(x.url, x.title, state.report.run.host) : x.title)))] : '',
          h('h3', { class: 'overline' }, 'Summary comment'),
          h('pre', { class: 'mono summary' }, strip(p.summaryBody)),
          h('button', { type: 'button', class: 'btn primary', id: 'post-btn', onclick: post }, `Post ${p.inline.length} inline comment${p.inline.length === 1 ? '' : 's'} and the summary`),
        ]
      : '',
    result ? h('div', { class: `result ${result.kind}`, id: 'post-result', tabindex: '-1' }, result.text, result.links ?? '') : '',
    h('div', { class: 'agent-row' }, h('button', { type: 'button', class: 'linkish accent', onclick: () => (dlg.close(), go('attention', { focusId: 'fix-agent' })) }, 'Or fix the included findings with your agent')),
  )
  if (!loading && !result) $('drawer-h')?.focus()
}

async function post() {
  const btn = $('post-btn')
  btn.disabled = true
  btn.textContent = 'Posting…'
  const body = { event: state.event, previewDigest: state.digest }
  const inc = include()
  if (inc) body.include = inc
  if (Object.keys(state.edits).length) body.edits = state.edits
  const r = await api(`/v1/runs/${state.run.id}/publish`, { method: 'POST', body }).catch((e) => ({ ok: false, data: { error: { message: e.message } } }))
  if (r.status === 409 && r.data.preview) {
    state.preview = r.data.preview
    state.digest = r.data.digest
    state.postResult = { kind: 'warn', text: `${r.data.error.message} Check the new preview, then post.` }
  } else if (!r.ok) state.postResult = { kind: 'bad', text: errorText(r) }
  else {
    const rec = r.data.record
    const links = h('span', {}, rec.reviewUrl ? [' ', safeLink(rec.reviewUrl, 'Open the review', state.report.run.host)] : '', rec.summaryUrl ? [' · ', safeLink(rec.summaryUrl, 'Open the summary', state.report.run.host)] : '')
    if (rec.status === 'PUBLISHED') state.postResult = { kind: 'ok', text: `Posted ${rec.commentCount} inline comment(s) and the summary as @${state.session?.github?.login}.`, links }
    else if (rec.status === 'SKIPPED_DUPLICATE') state.postResult = { kind: 'ok', text: 'Already posted for this commit; nothing new was posted. The summary was updated.', links }
    else state.postResult = { kind: 'bad', text: `Not posted (${words(rec.status)}): ${rec.reason ?? 'unknown reason'}${rec.status === 'CANCELLED' ? ' Review again to post on the new commit.' : ''}` }
    state.preview = rec.status === 'PUBLISHED' ? null : state.preview
  }
  paintDrawer()
  $('post-result')?.focus()
  announce(state.postResult.text, state.postResult.kind === 'bad')
}

// ── Checks, Walkthrough ────────────────────────────────────────────────────

function viewChecks() {
  const r = state.report
  if (!r) return viewOverview()
  return h(
    'section',
    { class: 'pane' },
    h('h1', { tabindex: '-1' }, 'Checks'),
    h('p', { class: 'muted' }, r.coverage.headline),
    r.effort ? h('p', { class: 'muted' }, `Review depth: ${r.effort.level} (${r.effort.reasons.join('; ')})${r.incremental ? ` · re-checked only what changed since ${r.incremental.since.slice(0, 7)}` : ''}`) : '',
    h('div', { class: 'panel' }, timelineList(timeline(r.layers))),
    r.projects?.length ? h('div', { class: 'panel' }, h('h2', { class: 'overline' }, 'Projects'), h('ul', { class: 'plain' }, r.projects.map((p) => h('li', {}, h('span', { class: 'mono' }, p.path || '.'), ': ', p.support === 'best-effort' ? 'best-effort (unsupported technology)' : [p.language, ...p.frameworks.map((f) => `${f.name} ${f.version ?? f.declared ?? '?'}`), p.typescript?.version ? `TypeScript ${p.typescript.version}` : ''].filter(Boolean).join(', '))))) : '',
    r.limitations.length ? h('div', { class: 'panel' }, h('h2', { class: 'overline' }, 'Limitations'), h('ul', { class: 'plain' }, r.limitations.map((l) => h('li', {}, l)))) : '',
  )
}

function viewWalkthrough() {
  const r = state.report
  if (!r) return viewOverview()
  const w = r.walkthrough
  const base = `pr-review-${r.run.repo.fullName.replace('/', '-')}-${r.run.pr}`
  const download = (name, type, text) => {
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name })
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  return h(
    'section',
    { class: 'pane' },
    h('h1', { tabindex: '-1' }, 'Walkthrough'),
    w ? h('div', { class: 'panel' }, h('h2', { class: 'overline' }, 'Summary'), h('p', {}, w.summary), w.effort ? h('p', { class: 'muted' }, `Estimated review effort ${w.effort} / 5`) : '') : h('p', { class: 'muted' }, 'No walkthrough for this run.'),
    w?.issues?.length ? h('div', { class: 'panel' }, h('h2', { class: 'overline' }, 'Linked issues'), h('ul', { class: 'plain' }, w.issues.map((i) => h('li', {}, `${i.repo}#${i.number} ${i.title}: `, h('strong', {}, words(i.status)), `. ${i.note}`)))) : '',
    w?.files?.length ? h('div', { class: 'panel' }, h('h2', { class: 'overline' }, 'Changes by file'), h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'File'), h('th', {}, 'Change'))), h('tbody', {}, w.files.map((f) => h('tr', {}, h('td', { class: 'mono' }, f.path), h('td', {}, f.change)))))) : '',
    r.relatedFiles?.length ? h('div', { class: 'panel' }, h('h2', { class: 'overline' }, 'Related code shown to the AI'), h('ul', { class: 'plain' }, r.relatedFiles.map((x) => h('li', {}, h('span', { class: 'mono' }, x.path), ` (${x.relation}${x.excerpt ? ', excerpts' : ''})`)))) : '',
    r.learnings?.length ? h('div', { class: 'panel' }, h('h2', { class: 'overline' }, `Learned from this repository (${r.learnings.length})`), h('ul', { class: 'plain' }, r.learnings.map((l) => h('li', {}, l.kind === 'REMEMBER' ? 'Remember: ' : '', l.text, h('span', { class: 'muted' }, ` · ${l.by} on #${l.pr} `), l.url ? safeLink(l.url, 'comment', r.run.host) : '')))) : '',
    r.rulesChecklist.length ? h('div', { class: 'panel' }, h('h2', { class: 'overline' }, `Review Rules checked (${r.rulesChecklist.length})`), h('ul', { class: 'plain' }, r.rulesChecklist.map((x) => h('li', {}, x)))) : '',
    h(
      'div',
      { class: 'panel' },
      h('h2', { class: 'overline' }, 'Run details'),
      h('p', {}, (r.ai?.attempts ?? []).map((a) => `${a.stage === 'verify' ? 'verification: ' : ''}${a.provider} ${a.model} ${words(a.outcome)}${a.usage ? ` · ${a.usage.input ?? '?'} in / ${a.usage.output ?? '?'} out tokens` : ''}`).join(' · ') || 'No AI call.'),
      h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn small', onclick: async () => { const t = await downloadMarkdown(state.run.id); if (t) download(`${base}.md`, 'text/markdown', t) } }, 'Download Markdown'), h('button', { type: 'button', class: 'btn small', onclick: () => download(`${base}.json`, 'application/json', `${JSON.stringify(r, null, 2)}\n`) }, 'Download JSON')),
    ),
  )
}

// ── Stats ──────────────────────────────────────────────────────────────────

let statsCache = null
function viewStats() {
  const pane = h('section', { class: 'pane' }, h('h1', { tabindex: '-1' }, 'How your posted findings fared'), h('p', { class: 'muted' }, 'Read from GitHub only.'))
  const days = statsCache?.days ?? 30
  const seg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Period' }, [7, 30, 90].map((d) => h('button', { type: 'button', 'aria-pressed': d === days ? 'true' : 'false', class: d === days ? 'on' : '', onclick: () => loadStats(d) }, `${d === days ? '✓ ' : ''}${d} days`)))
  const body = h('div', { id: 'stats-body' }, statsCache?.html ?? h('p', { class: 'muted' }, 'Loading…'))
  pane.append(seg, body)
  if (!statsCache) setTimeout(() => loadStats(30), 0)
  return pane
}

async function loadStats(days) {
  statsCache = { days, html: h('p', { class: 'muted' }, 'Reading your reviewed PRs from GitHub…') }
  if (state.surface === 'stats') render()
  const r = await api(`/v1/stats?days=${days}`).catch((e) => ({ ok: false, data: { error: { message: e.message } } }))
  const pct = (n, of) => (of ? `${Math.round((100 * n) / of)}%` : '–')
  let html
  if (!r.ok) html = h('p', { class: 'field-error' }, errorText(r))
  else if (!r.data.prs.length) html = h('p', { class: 'muted' }, `No posted findings in the last ${days} days.`)
  else {
    const t = r.data.total
    const row = (label, o) => h('tr', {}, h('td', {}, label), h('td', { class: 'num' }, String(o.posted)), h('td', { class: 'num' }, pct(o.resolved, o.posted)), h('td', { class: 'num' }, pct(o.dismissed, o.posted)), h('td', { class: 'num' }, String(o.open)))
    const head = h('thead', {}, h('tr', {}, h('th', {}, 'Group'), h('th', { class: 'num' }, 'Posted'), h('th', { class: 'num' }, 'Addressed'), h('th', { class: 'num' }, 'Dismissed'), h('th', { class: 'num' }, 'Open')))
    html = [
      h('div', { class: 'tiles' }, h('div', { class: 'tile' }, h('b', {}, String(t.posted)), h('span', {}, 'inline findings posted')), h('div', { class: 'tile' }, h('b', {}, pct(t.resolved, t.posted)), h('span', {}, 'addressed (code changed)')), h('div', { class: 'tile' }, h('b', {}, pct(t.dismissed, t.posted)), h('span', {}, 'dismissed (👎 or /dismiss)')), h('div', { class: 'tile' }, h('b', {}, String(t.open)), h('span', {}, 'still open'))),
      h('div', { class: 'panel' }, h('h2', { class: 'overline' }, 'By severity and source'), h('table', {}, head, h('tbody', {}, [...Object.entries(t.bySeverity).map(([k, o]) => row(words(k), o)), ...Object.entries(t.bySource).map(([k, o]) => row({ AI: 'AI review', TOOL: 'Tools', UNKNOWN: 'Older comments' }[k] ?? k, o))]))),
      h('div', { class: 'panel' }, h('h2', { class: 'overline' }, 'By PR'), h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'PR'), h('th', { class: 'num' }, 'Posted'), h('th', { class: 'num' }, 'Resolved'), h('th', { class: 'num' }, 'Dismissed'))), h('tbody', {}, r.data.prs.map((x) => h('tr', {}, h('td', { class: 'mono' }, x.pr), h('td', { class: 'num' }, String(x.posted)), h('td', { class: 'num' }, String(x.resolved)), h('td', { class: 'num' }, String(x.dismissed))))))),
    ]
  }
  statsCache = { days, html }
  if (state.surface === 'stats') render()
}

// ── Settings ───────────────────────────────────────────────────────────────

let webSettings = null
function viewSettings() {
  const s = state.session
  const pane = h('section', { class: 'pane narrow-pane' }, h('h1', { tabindex: '-1' }, 'Settings'))
  const review = h('div', { class: 'panel' }, h('h2', { class: 'overline' }, 'Review'))
  if (MODE === 'local') {
    review.append(h('p', {}, `AI provider: ${s?.ai?.provider ?? '…'}${s?.ai?.model ? ` · ${s.ai.model}` : ''} — ${s?.ai?.ready ? 'ready' : `not ready: ${s?.ai?.reason ?? ''}`}`), h('p', { class: 'muted' }, 'Set in your pr-reviewer config (pr-reviewer config path); changes apply to the next review.'))
  } else if (!webSettings) {
    review.append(h('p', { class: 'muted' }, 'Loading…'))
    api('/v1/settings').then((r) => r.ok && ((webSettings = r.data), state.surface === 'settings' && render()))
  } else {
    const ws = webSettings
    const type = h('select', { id: 'set-type' }, h('option', { value: 'anthropic' }, 'Anthropic (Claude) API key'), h('option', { value: 'openai-compatible' }, 'OpenAI or compatible API key'))
    type.value = ws.provider.type
    const model = h('input', { id: 'set-model', type: 'text', value: ws.provider.model ?? '', placeholder: 'Model (optional for Anthropic)' })
    const base = h('select', { id: 'set-base' }, ws.allowedEndpoints.map((e) => h('option', { value: e }, e)))
    if (ws.provider.baseUrl) base.value = ws.provider.baseUrl
    const baseRow = h('div', { class: 'field' }, h('label', { for: 'set-base' }, 'Endpoint'), base)
    const key = h('input', { id: 'set-key', type: 'password', autocomplete: 'off', placeholder: ws.apiKeySaved ? 'Saved (leave empty to keep it)' : 'Paste your API key', 'aria-describedby': 'set-msg' })
    const msg = h('p', { id: 'set-msg', class: 'muted', role: 'status' }, ws.apiKeySaved ? 'Your key is stored encrypted on this server and never shown again.' : 'Reviews need your own API key. It is stored encrypted on this server and used only for your reviews.')
    const sync = () => (baseRow.hidden = type.value !== 'openai-compatible')
    type.addEventListener('change', sync)
    sync()
    const save = async (removeKey) => {
      const body = { provider: { type: type.value, ...(model.value.trim() ? { model: model.value.trim() } : {}), ...(type.value === 'openai-compatible' ? { baseUrl: base.value } : {}) } }
      if (removeKey) body.apiKey = null
      else if (key.value.trim()) body.apiKey = key.value.trim()
      msg.textContent = 'Saving…'
      const r = await api('/v1/settings', { method: 'PUT', body })
      if (!r.ok) {
        msg.className = 'field-error'
        msg.textContent = `AI key: ${errorText(r)}`
        key.setAttribute('aria-invalid', 'true')
        return key.focus()
      }
      webSettings = r.data
      await loadSession()
      announce(removeKey ? 'Key removed.' : 'Saved.')
      render({ focusId: 'set-type' })
    }
    review.append(
      h('div', { class: 'field' }, h('label', { for: 'set-type' }, 'Provider'), type),
      h('div', { class: 'field' }, h('label', { for: 'set-model' }, 'Model'), model),
      baseRow,
      h('div', { class: 'field' }, h('label', { for: 'set-key' }, 'API key'), key),
      msg,
      h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn primary', onclick: () => save(false) }, 'Save'), ws.apiKeySaved ? h('button', { type: 'button', class: 'btn', onclick: () => save(true) }, 'Remove key') : ''),
    )
  }
  const theme = store.get(THEME_KEY, 'system')
  const seg = (label, options, current, onPick) => h('div', { class: 'field' }, h('span', { class: 'label' }, label), h('div', { class: 'segmented', role: 'group', 'aria-label': label }, options.map(([v, t]) => h('button', { type: 'button', class: v === current ? 'on' : '', 'aria-pressed': v === current ? 'true' : 'false', onclick: () => onPick(v) }, `${v === current ? '✓ ' : ''}${t}`))))
  const page = h(
    'div',
    { class: 'panel' },
    h('h2', { class: 'overline' }, 'Page'),
    seg('Theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], theme, (v) => (setTheme(v), render())),
    seg('Default view in this browser', [['v2', 'v2'], ['classic', 'Classic']], 'v2', (v) => (v === 'classic' ? switchTo('classic') : rememberUi('v2'))),
  )
  const mode = state.keyMode
  const bindingInputs = Object.entries(state.bindings).map(([action, b]) => h('div', { class: 'field compact' }, h('label', { for: `key-${action}` }, words(action.replace(/([A-Z])/g, ' $1'))), h('input', { id: `key-${action}`, type: 'text', value: b, 'data-action': action })))
  const keysMsg = h('p', { id: 'keys-msg', role: 'status', class: 'muted' })
  const keyboard = h(
    'div',
    { class: 'panel' },
    h('h2', { class: 'overline' }, 'Keyboard'),
    seg('Single-key shortcuts', [['on', 'On'], ['focus', 'Only in the list or detail'], ['off', 'Off']], mode, (v) => saveKeys(v, state.bindings)),
    h('p', { class: 'muted' }, 'Off turns off every single-key shortcut, including g chords, ? and /; ⌘K / Ctrl+K and Esc stay.'),
    h('details', {}, h('summary', {}, 'Change keys'), h('div', { class: 'keys-grid' }, bindingInputs), keysMsg, h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn primary', onclick: () => {
      const next = { ...state.bindings }
      for (const i of document.querySelectorAll('[data-action]')) next[i.dataset.action] = i.value.trim()
      const problems = bindingProblems(next)
      if (problems.length) {
        keysMsg.className = 'field-error'
        keysMsg.textContent = problems.join('; ')
        return
      }
      saveKeys(state.keyMode, next)
    } }, 'Save keys'), h('button', { type: 'button', class: 'btn', onclick: () => saveKeys(state.keyMode, { ...DEFAULT_BINDINGS }) }, 'Reset'))),
  )
  pane.append(review, page, keyboard)
  return pane
}

function saveKeys(mode, bindings) {
  state.keyMode = mode
  state.bindings = bindings
  keymap = createKeymap(bindings, mode)
  store.set(KEYS_KEY, { mode, bindings })
  announce('Keyboard settings saved.')
  render()
}

function setTheme(v) {
  store.set(THEME_KEY, v)
  if (v === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', v)
}

// ── Shortcuts sheet ────────────────────────────────────────────────────────

function openSheet() {
  for (const id of ['palette', 'drawer']) if ($(id).open) $(id).close()
  const dlg = $('sheet')
  const labels = { palette: 'Command palette', help: 'This sheet', goStart: 'Go to Start', goOverview: 'Go to Overview', goAttention: 'Go to Needs attention', goPre: 'Go to Pre-existing', goChecks: 'Go to Checks', goWalkthrough: 'Go to Walkthrough', goStats: 'Go to Stats', filter: 'Filter the list', next: 'Next finding', prev: 'Previous finding', toggle: 'Include / exclude', edit: 'Edit wording', copyPrompt: 'Copy agent prompt', post: 'Preview post' }
  fill(
    dlg,
    h('div', { class: 'dialog-head' }, h('h2', { id: 'sheet-h', tabindex: '-1' }, 'Keyboard shortcuts'), h('button', { type: 'button', class: 'btn small', onclick: () => dlg.close() }, '✕ Close')),
    h('p', { class: 'muted' }, state.keyMode === 'off' ? 'Single-key shortcuts are off. ' : state.keyMode === 'focus' ? 'Single-key shortcuts work only with focus in the list or detail. ' : '', h('button', { type: 'button', class: 'linkish accent', onclick: () => (dlg.close(), go('settings')) }, 'Change in Settings')),
    h('table', { class: 'keys' }, h('tbody', {}, Object.entries(state.bindings).map(([a, b]) => h('tr', {}, h('td', {}, labels[a] ?? a), h('td', {}, kbd(...keyLabels(b, MAC))))))),
    h('p', { class: 'muted' }, 'Esc closes the innermost layer first. F6 moves between the sidebar, list, detail and notifications.'),
  )
  dlg.showModal()
  $('sheet-h').focus()
}

// ── Keyboard ───────────────────────────────────────────────────────────────

const visibleList = () => {
  if (!state.report) return []
  const { fresh, pre } = groupFindings(state.report.findings)
  return filterFindings(state.surface === 'pre' ? pre : fresh, state.filters)
}

function moveSelection(step) {
  const list = visibleList()
  if (!list.length) return
  const i = Math.max(0, list.findIndex((f) => f.fingerprint === state.shown))
  const next = list[Math.min(list.length - 1, Math.max(0, i + step))]
  state.shown = next.fingerprint
  render({ focusId: `row-${next.fingerprint}` })
  announce(`Showing ${list.indexOf(next) + 1} of ${list.length}: ${next.title}`)
}

const ACTIONS = {
  palette: () => openPalette(),
  help: () => openSheet(),
  goStart: () => go('start'),
  goOverview: () => state.run && go('overview'),
  goAttention: () => state.report && go('attention'),
  goPre: () => state.report && go('pre'),
  goChecks: () => state.report && go('checks'),
  goWalkthrough: () => state.report && go('walkthrough'),
  goStats: () => go('stats'),
  filter: () => document.querySelector('.toolbar .chip')?.focus(),
  next: () => moveSelection(1),
  prev: () => moveSelection(-1),
  toggle: () => {
    const f = visibleList().find((x) => x.fingerprint === state.shown)
    if (f) setIncluded(f, !state.selected.has(f.fingerprint))
  },
  edit: () => {
    const f = visibleList().find((x) => x.fingerprint === state.shown)
    if (f) openEditor(f)
  },
  copyPrompt: () => {
    const f = visibleList().find((x) => x.fingerprint === state.shown)
    if (f) copyPrompt(f)
  },
  post: () => state.report && openDrawer(),
}

document.addEventListener('keydown', (e) => {
  const dialogOpen = ['palette', 'drawer', 'sheet'].some((id) => $(id)?.open)
  const inFindings = !!document.activeElement?.closest?.('#list, #detail')
  if (e.key === 'Escape' && !dialogOpen && !e.defaultPrevented) {
    if (state.narrowDetail && inFindings) {
      state.narrowDetail = false
      render({ focusId: `row-${state.shown}` })
    }
    return
  }
  if (e.key === 'F6') {
    e.preventDefault()
    const regions = ['side', 'list', 'detail', 'toasts'].map((id) => $(id)).filter((x) => x && x.offsetParent !== null)
    const at = regions.findIndex((r) => r.contains(document.activeElement))
    const next = regions[(at + (e.shiftKey ? -1 : 1) + regions.length) % regions.length]
    if (next) (next.querySelector('[aria-current="true"], button, a, input, [tabindex]') ?? next).focus()
    return
  }
  const action = keymap.handle(e, { dialogOpen, inFindings })
  if (action && ACTIONS[action]) {
    e.preventDefault()
    ACTIONS[action]()
  }
})

// ── Boot ───────────────────────────────────────────────────────────────────

async function loadSession() {
  const r = await api('/v1/session')
  if (!r.ok) throw new Error(errorText(r))
  state.session = r.data
}

function shell() {
  setTheme(store.get(THEME_KEY, 'system'))
  document.body.replaceChildren(
    h('div', { class: 'shell' }, h('nav', { id: 'side', 'aria-label': 'Review navigation' }), h('main', { id: 'main', tabindex: '-1' })),
    h('div', { id: 'status', role: 'status', class: 'sr-only' }),
    h('div', { id: 'alert', role: 'alert', class: 'sr-only' }),
    h('section', { id: 'toasts', 'aria-label': 'Notifications', tabindex: '-1' }),
    h('dialog', { id: 'palette', class: 'palette', 'aria-label': 'Command palette' }),
    h('dialog', { id: 'drawer', class: 'drawer', 'aria-labelledby': 'drawer-h' }),
    h('dialog', { id: 'sheet', class: 'sheet', 'aria-labelledby': 'sheet-h' }),
  )
  $('drawer').addEventListener('close', () => $('open-post')?.focus())
}

async function boot() {
  shell()
  whenUnauthorized(() => {
    if (MODE === 'local') state.locked = true
    else state.signedOut = true
    go(MODE === 'local' ? 'locked' : 'signin')
  })
  if (MODE === 'local' && !token) return go('locked')
  try {
    await loadSession()
  } catch (e) {
    if (e.message === 'unauthorized') return
    state.sessionError = e.message
  }
  if (MODE === 'web' && state.session && !state.session.ai?.ready) {
    state.surface = 'settings'
    render({ userNav: true })
    return
  }
  if (await resume().catch(() => false)) return render({ userNav: true })
  go('start')
}

boot()
