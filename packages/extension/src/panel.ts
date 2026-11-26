// Side panel (Epic 7). Story 7.1: open on a PR, review it Standalone in this page, show progress from run events
// and a read-only Report. Text from GitHub, the PR or the AI is always set as text, never as HTML.
import type { Finding, Report, RunEvent } from '@pr-reviewer/core'
import { prFromUrl, runStandaloneReview, type StandaloneSettings } from './compose.js'
import { h } from './dom.js'

const SETTINGS_KEY = 'standalone-settings'
const RUNNING_KEY = 'running-review'
const $ = (id: string) => document.getElementById(id)!

interface State {
  settings: StandaloneSettings | undefined
  pr: string | undefined
  running: { pr: string; events: RunEvent[]; cancelled: boolean } | undefined
  report: Report | undefined
  notice: string | undefined
  error: string | undefined
}
const state: State = { settings: undefined, pr: undefined, running: undefined, report: undefined, notice: undefined, error: undefined }

const words = (s: string | undefined) => String(s ?? '').replace(/_/g, ' ').toLowerCase()
const STATUS_TEXT: Record<string, string> = { PASSED: 'Passed', PASSED_WITH_WARNINGS: 'Passed with warnings', FAILED: 'Failed', INCOMPLETE: 'Incomplete', ERROR: 'Error', CANCELLED: 'Cancelled' }
const STATUS_TONE: Record<string, string> = { PASSED: 'ok', PASSED_WITH_WARNINGS: 'warn', FAILED: 'bad', INCOMPLETE: 'warn', ERROR: 'bad', CANCELLED: 'neutral' }
const SEV_TONE: Record<string, string> = { BLOCKER: 'bad', CRITICAL: 'bad', MAJOR: 'warn', MINOR: 'info', INFO: 'info' }

function announce(text: string, assertive = false): void {
  const el = $(assertive ? 'alert' : 'status')
  el.textContent = ''
  setTimeout(() => (el.textContent = text), 50)
}

/** Renders the surface; focus goes to its h1 only when the user's own action changed it. */
function render(userNav = false): void {
  const main = $('main')
  main.replaceChildren(view())
  $('mode-text').textContent = state.settings ? 'Standalone' : 'Not set up'
  $('mode').className = `chip ${state.settings ? 'ok' : 'neutral'}`
  if (userNav) (main.querySelector('h1') as HTMLElement | null)?.focus()
}

function view(): HTMLElement {
  if (!state.settings) return settingsForm()
  if (state.running) return runningView()
  if (state.report) return reportView(state.report)
  if (!state.pr) return h('section', { class: 'card' }, h('h1', { tabindex: '-1' }, 'Open a pull request to review it.'), h('p', { class: 'muted' }, 'This panel works on GitHub PR pages.'))
  return h(
    'section',
    { class: 'card' },
    h('h1', { tabindex: '-1' }, state.pr),
    state.notice ? h('p', { class: 'note warn' }, state.notice) : '',
    state.error ? h('p', { class: 'note bad' }, state.error) : '',
    h('button', { class: 'btn primary full', type: 'button', onclick: () => void review() }, 'Review this PR'),
    h('p', { class: 'muted' }, 'Nothing is posted until you press Post.'),
  )
}

// ── Settings (minimal for 7.1; Story 7.2 adds the guided, encrypted setup) ────

function settingsForm(): HTMLElement {
  const token = h('input', { id: 'gh', type: 'password', autocomplete: 'off', required: true }) as HTMLInputElement
  const type = h('select', { id: 'ptype' }, h('option', { value: 'anthropic' }, 'Anthropic'), h('option', { value: 'openai-compatible' }, 'OpenAI-compatible')) as HTMLSelectElement
  const key = h('input', { id: 'key', type: 'password', autocomplete: 'off', required: true }) as HTMLInputElement
  const model = h('input', { id: 'model', type: 'text', placeholder: 'Optional for Anthropic' }) as HTMLInputElement
  const err = h('p', { class: 'field-error', id: 'set-err' })
  const form = h(
    'form',
    { class: 'card' },
    h('h1', { tabindex: '-1' }, 'Set up Standalone reviews'),
    h('p', { class: 'muted' }, 'A GitHub token that can read the PR, and your own AI API key. They stay in this browser.'),
    h('label', { class: 'field', for: 'gh' }, 'GitHub token', token),
    h('label', { class: 'field', for: 'ptype' }, 'AI provider', type),
    h('label', { class: 'field', for: 'key' }, 'API key', key),
    h('label', { class: 'field', for: 'model' }, 'Model', model),
    err,
    h('button', { class: 'btn primary full', type: 'submit' }, 'Save'),
  )
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (!token.value.trim() || !key.value.trim()) {
      err.textContent = 'GitHub token and API key are both needed.'
      return
    }
    if (type.value === 'openai-compatible' && !model.value.trim()) {
      err.textContent = 'Model: an OpenAI-compatible provider needs a model name.'
      model.setAttribute('aria-invalid', 'true')
      return model.focus()
    }
    state.settings = { githubToken: token.value.trim(), provider: { type: type.value as 'anthropic' | 'openai-compatible', apiKey: key.value.trim(), ...(model.value.trim() ? { model: model.value.trim() } : {}) } }
    await chrome.storage.local.set({ [SETTINGS_KEY]: state.settings })
    announce('Saved.')
    render(true)
  })
  return form
}

// ── Running ────────────────────────────────────────────────────────────────

async function review(): Promise<void> {
  if (!state.settings || !state.pr || state.running) return
  const pr = state.pr
  state.running = { pr, events: [], cancelled: false }
  state.report = undefined
  state.notice = undefined
  state.error = undefined
  await chrome.storage.session.set({ [RUNNING_KEY]: pr })
  render(true)
  const run = state.running
  try {
    const report = await runStandaloneReview({
      pr,
      settings: state.settings,
      fetch: (...a) => fetch(...a),
      onEvent: (e) => {
        if (run.cancelled) return
        run.events.push(e)
        if (e.type === 'LAYER_STATUS' && e.payload.status !== 'NOT_APPLICABLE') announce(`${words(String(e.payload.layer))}: ${words(String(e.payload.status))}`)
        if (state.running === run) render()
      },
    })
    if (run.cancelled) return
    state.report = report
    announce(`Review finished: ${STATUS_TEXT[report.overallStatus] ?? report.overallStatus}, ${report.findings.length} findings.`)
  } catch (e) {
    if (!run.cancelled) {
      state.error = `The review failed: ${(e as Error).message}`
      announce(state.error, true)
    }
  } finally {
    if (state.running === run) state.running = undefined
    await chrome.storage.session.remove(RUNNING_KEY)
    render()
  }
}

function cancel(): void {
  if (!state.running) return
  state.running.cancelled = true
  state.running = undefined
  state.notice = 'Review cancelled.'
  void chrome.storage.session.remove(RUNNING_KEY)
  render(true)
}

const STAGES: Record<string, string> = { fetchContext: 'Reading the PR', detect: 'Detecting projects', validate: 'Running checks', execute: 'Scanning for secrets', review: 'AI review', dedupe: 'Merging findings', gate: 'Deciding the result' }

function runningView(): HTMLElement {
  const run = state.running!
  const rows: HTMLElement[] = []
  const started = run.events.filter((e) => e.type === 'STAGE_STARTED').map((e) => String(e.payload.stage))
  const finished = new Set(run.events.filter((e) => e.type === 'STAGE_FINISHED').map((e) => String(e.payload.stage)))
  for (const s of Object.keys(STAGES)) {
    const st = finished.has(s) ? ['Done', 'ok'] : started.includes(s) ? ['Running', 'running'] : ['Waiting', 'waiting']
    rows.push(h('li', { class: `step ${st[1]}` }, h('span', { class: 'node', 'aria-hidden': 'true' }), h('span', {}, STAGES[s], ' ', h('span', { class: 'state' }, st[0]))))
  }
  const skipped = run.events.filter((e) => e.type === 'LAYER_STATUS' && e.payload.status === 'SKIPPED').map((e) => `${words(String(e.payload.layer))}: SKIPPED (${words(String(e.payload.reason ?? ''))})`)
  return h(
    'section',
    { class: 'card' },
    h('h1', { tabindex: '-1' }, `Reviewing ${run.pr}`),
    h('ol', { class: 'steps' }, rows),
    skipped.length ? h('p', { class: 'muted' }, skipped.join(' · ')) : '',
    h('p', { class: 'note warn' }, 'Closing this panel stops the review.'),
    h('button', { class: 'btn', type: 'button', onclick: cancel }, 'Cancel'),
  )
}

// ── Report (read-only in 7.1) ──────────────────────────────────────────────

function where(f: Finding): string {
  const l = f.location
  if (!l.path) return 'whole PR'
  return `${l.path}${l.startLine ? `:${l.startLine}${l.endLine && l.endLine !== l.startLine ? `-${l.endLine}` : ''}` : ''}`
}

function reportView(r: Report): HTMLElement {
  const notRun = r.layers.filter((l) => l.status === 'SKIPPED' || l.status === 'ERROR' || l.status === 'TIMEOUT')
  return h(
    'section',
    { class: 'report' },
    h(
      'div',
      { class: 'card' },
      h('h1', { tabindex: '-1' }, `${r.run.repo.fullName}#${r.run.pr}`, r.title ? ` — ${r.title}` : ''),
      h('span', { class: `badge ${STATUS_TONE[r.overallStatus] ?? ''}` }, STATUS_TEXT[r.overallStatus] ?? r.overallStatus),
      h('p', { class: 'muted' }, r.coverage.headline),
      notRun.length ? h('ul', { class: 'plain muted' }, notRun.map((l) => h('li', {}, `${words(l.validator)}: ${l.status} (${words(l.reason)})`))) : '',
      r.gate.failedRules.length ? h('div', { class: 'note bad' }, h('strong', {}, 'Why it failed'), h('ul', {}, r.gate.failedRules.map((x) => h('li', {}, x)))) : '',
    ),
    r.findings.length
      ? h('ul', { class: 'findings' }, r.findings.map((f) => h('li', { class: 'finding' }, h('span', { class: `badge ${SEV_TONE[f.severity] ?? ''}` }, f.severity), h('h2', {}, f.title), h('p', { class: 'mono muted' }, where(f), ` · ${f.sourceFamily === 'AI' ? 'AI' : (f.provenance.tool ?? f.provenance.validator)} · ${words(f.confidence)}`), h('p', {}, f.description))))
      : h('p', { class: 'card' }, 'No findings.'),
    h('button', { class: 'btn full', type: 'button', onclick: () => ((state.report = undefined), render(true)) }, 'Review again'),
  )
}

// ── Boot ───────────────────────────────────────────────────────────────────

async function activePr(): Promise<string | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const pr = prFromUrl(tab?.url, state.settings?.host ?? 'github.com')
  return pr ? `${pr.owner}/${pr.repo}#${pr.number}` : undefined
}

async function boot(): Promise<void> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY)
  state.settings = stored[SETTINGS_KEY] as StandaloneSettings | undefined
  const interrupted = (await chrome.storage.session.get(RUNNING_KEY))[RUNNING_KEY]
  if (typeof interrupted === 'string') {
    state.notice = 'The last review was stopped when the panel closed.'
    await chrome.storage.session.remove(RUNNING_KEY)
  }
  state.pr = await activePr()
  render(true)
  const follow = async () => {
    const pr = await activePr()
    if (pr !== state.pr && !state.running) {
      state.pr = pr
      state.report = undefined
      render()
      if (pr) announce(`Showing ${pr}`)
    }
  }
  chrome.tabs.onActivated.addListener(() => void follow())
  chrome.tabs.onUpdated.addListener((_id, change) => change.url && void follow())
}

void boot()
