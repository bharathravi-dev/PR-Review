// Side panel (Epic 7). Stories 7.1–7.4: Welcome and consent, Standalone setup (token or device sign-in, AI key
// test, encrypted storage), review in this page, findings to include, links into the diff, preview and post,
// following the tab, recent reviews, background runs, offline. Contract: ux-designs/ux-pr-reviewer-2026-11-26.
// Text from GitHub, the PR or the AI is always set as text, never as HTML.
import type { Finding, PublishPlan, PublishPreview, PublishRecord, Report, RunEvent } from '@pr-reviewer/core'
import {
  currentHead,
  diffAnchor,
  pollDeviceFlow,
  postReview,
  prFromUrl,
  previewPost,
  runStandalone,
  startDeviceFlow,
  testAiKey,
  testGitHubToken,
  type Edits,
  type StandaloneResult,
  type StandaloneSettings,
} from './compose.js'
import { h } from './dom.js'
import { browserSecureStore } from './secure-store.js'
import { MAX_STORED, prKey, type PrState } from './state.js'

const secure = browserSecureStore()
const SETTINGS = 'standalone-settings'
const CONSENT = 'consent-given'
const REVIEWS = 'stored-reviews'
const PR_STATE = 'pr-state'
const RUNNING = 'running-review'
const $ = (id: string) => document.getElementById(id)!
const net: typeof fetch = (...a) => fetch(...a)

type Surface = 'welcome' | 'setup-github' | 'setup-ai' | 'home' | 'post' | 'settings'
interface Run {
  pr: string
  events: RunEvent[]
  cancelled: boolean
}
interface Stored {
  report: Report
  at: number
}
const state = {
  surface: 'welcome' as Surface,
  consent: false,
  settings: undefined as StandaloneSettings | undefined,
  login: undefined as string | undefined,
  draft: {} as Partial<StandaloneSettings>,
  pr: undefined as string | undefined,
  runs: new Map<string, Run>(),
  results: new Map<string, StandaloneResult>(),
  stored: {} as Record<string, Stored>,
  head: new Map<string, string | undefined>(),
  selected: new Map<string, Set<string>>(),
  edits: new Map<string, Edits>(),
  filter: new Set<string>(),
  shown: undefined as { plan: PublishPlan; preview: PublishPreview; report: Report } | undefined,
  postResult: undefined as { tone: string; text: string; links?: HTMLElement } | undefined,
  notice: undefined as string | undefined,
  error: undefined as string | undefined,
  online: navigator.onLine,
  pendingPr: undefined as string | undefined,
}

const words = (s: unknown) => String(s ?? '').replace(/_/g, ' ').toLowerCase()
const STATUS_TEXT: Record<string, string> = { PASSED: 'Passed', PASSED_WITH_WARNINGS: 'Passed with warnings', FAILED: 'Failed', INCOMPLETE: 'Incomplete', ERROR: 'Error', CANCELLED: 'Cancelled' }
const STATUS_TONE: Record<string, string> = { PASSED: 'ok', PASSED_WITH_WARNINGS: 'warn', FAILED: 'bad', INCOMPLETE: 'warn', ERROR: 'bad', CANCELLED: 'neutral' }
const SEV_TONE: Record<string, string> = { BLOCKER: 'bad', CRITICAL: 'bad', MAJOR: 'warn', MINOR: 'info', INFO: 'info' }
const SEVERITIES = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO']

function announce(text: string, assertive = false): void {
  const el = $(assertive ? 'alert' : 'status')
  el.textContent = ''
  setTimeout(() => (el.textContent = text), 50)
}

function render(userNav = false, focusId?: string): void {
  const active = document.activeElement?.id
  $('main').replaceChildren(...[view()].flat())
  const chip = $('mode')
  const text = !state.online ? 'Offline' : !state.settings ? 'Not set up' : state.login === undefined ? 'Standalone' : state.login ? 'Standalone' : 'Standalone · signed out'
  $('mode-text').textContent = text
  chip.className = `chip ${!state.online || state.login === '' ? 'bad' : state.settings ? 'ok' : 'neutral'}`
  const target = (focusId && document.getElementById(focusId)) || (userNav ? ($('main').querySelector('h1') as HTMLElement | null) : active ? document.getElementById(active) : null)
  target?.focus()
}

function go(surface: Surface, focusId?: string): void {
  state.surface = surface
  render(true, focusId)
}

// ── Stored state (also read by the Review button on the page, Story 7.5) ────

async function savePrState(pr: string, s: PrState | undefined): Promise<void> {
  const all = ((await chrome.storage.local.get(PR_STATE))[PR_STATE] as Record<string, PrState> | undefined) ?? {}
  if (s) all[prKey(pr)] = s
  else delete all[prKey(pr)]
  await chrome.storage.local.set({ [PR_STATE]: all })
}

async function storeReport(pr: string, report: Report): Promise<void> {
  state.stored[pr] = { report, at: Date.now() }
  const keep = Object.entries(state.stored).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_STORED)
  state.stored = Object.fromEntries(keep)
  await chrome.storage.local.set({ [REVIEWS]: state.stored })
  const fresh = report.findings.filter((f) => f.scope !== 'PRE_EXISTING').length
  await savePrState(pr, { status: 'done', findings: fresh, headSha: report.run.headSha ?? '' })
}

// ── Views ──────────────────────────────────────────────────────────────────

function view(): HTMLElement | HTMLElement[] {
  if (!state.consent || state.surface === 'welcome') return welcome()
  if (state.surface === 'setup-github') return setupGitHub()
  if (state.surface === 'setup-ai') return setupAi()
  if (state.surface === 'settings') return settingsView()
  if (!state.settings) return welcome()
  if (state.surface === 'post') return postView()
  return homeView()
}

function welcome(): HTMLElement {
  const choice = (title: string, desc: string, enabled: boolean, tag?: string) =>
    h(
      'label',
      { class: `choice${enabled ? '' : ' disabled'}` },
      h('input', { type: 'radio', name: 'mode', checked: enabled && title === 'Standalone', disabled: !enabled }),
      h('span', { class: 't' }, title, tag ? h('span', { class: 'muted' }, ` · ${tag}`) : ''),
      h('span', { class: 'd' }, desc),
    )
  return h(
    'section',
    { class: 'stack' },
    h('div', { class: 'card' }, h('h1', { tabindex: '-1' }, state.pendingPr ? `Set up to review ${state.pendingPr}` : 'Welcome to PR Reviewer'), h('p', { class: 'muted' }, 'Choose how reviews run. You can change this later in Settings.')),
    h(
      'div',
      { class: 'card' },
      h('h2', {}, 'What is sent where'),
      h(
        'ul',
        { class: 'bullets' },
        h('li', {}, 'GitHub: requests to read the PR and, only when you press Post, to post your review.'),
        h('li', {}, 'Your AI provider: the PR’s diff and files, with detected secrets removed.'),
        h('li', {}, 'Nothing goes anywhere else. No analytics.'),
        h('li', {}, 'Your recent reviews, including short code excerpts, stay in this browser until you clear them.'),
      ),
      h('a', { href: chrome.runtime.getURL('privacy.html'), target: '_blank' }, 'Privacy policy'),
      h('p', { class: 'muted' }, 'Tip: press F6 to move between the page and this panel.'),
    ),
    choice('Standalone', 'Your own AI API key and GitHub sign-in. Compile and lint do not run.', true),
    choice('My team’s Web App', 'Reviews run on your team’s self-hosted pr-reviewer. Not available yet.', false, 'full checks'),
    choice('This computer', 'Pair with pr-reviewer on this computer. Not available yet.', false, 'full checks'),
    h('button', { class: 'btn primary full', type: 'button', onclick: async () => {
      state.consent = true
      await chrome.storage.local.set({ [CONSENT]: true })
      go(state.settings ? 'home' : 'setup-github')
    } }, 'Continue with Standalone'),
  )
}

function steps(n: 1 | 2): HTMLElement {
  return h('div', { class: 'progress' }, h('span', { class: n > 1 ? 'done' : 'now' }, n > 1 ? '✓ GitHub' : '1 GitHub'), h('span', { class: n === 2 ? 'now' : '' }, '2 AI provider'))
}

function setupGitHub(): HTMLElement {
  const err = h('p', { class: 'field-error', id: 'gh-err', role: 'alert' })
  const token = h('input', { id: 'gh', type: 'password', autocomplete: 'off', 'aria-describedby': 'gh-err gh-help' }) as HTMLInputElement
  const useToken = async () => {
    err.textContent = 'Testing…'
    const t = token.value.trim()
    const r = t ? await testGitHubToken(t, net, state.draft.host).catch((e: Error) => ({ ok: false as const, message: e.message })) : { ok: false as const, message: 'Paste a token first.' }
    if (!r.ok) {
      err.textContent = `GitHub token: ${r.message}`
      token.setAttribute('aria-invalid', 'true')
      return token.focus()
    }
    state.draft.githubToken = t
    state.login = r.login
    announce(`Signed in to GitHub as @${r.login}`)
    go('setup-ai')
  }
  const device = __GITHUB_CLIENT_ID__ ? deviceBlock() : ''
  return h(
    'section',
    { class: 'stack' },
    steps(1),
    h('div', { class: 'card' }, h('h1', { tabindex: '-1' }, 'Connect GitHub'), device, h('h2', {}, device ? 'Or use a token' : 'Use a token'), h('p', { class: 'muted', id: 'gh-help' }, 'A fine-grained token with Pull requests: read and Contents: read (add Pull requests: write to post). Classic tokens need repo or public_repo.'), h('label', { class: 'field', for: 'gh' }, 'GitHub token', token), err, h('button', { class: 'btn primary full', type: 'button', onclick: () => void useToken() }, 'Test and continue')),
  )
}

function deviceBlock(): HTMLElement {
  const box = h('div', { class: 'device' }, h('button', { class: 'btn primary full', type: 'button', onclick: () => void run() }, 'Sign in with GitHub'))
  const run = async () => {
    try {
      const s = await startDeviceFlow(__GITHUB_CLIENT_ID__, net)
      const expires = new Date(s.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      box.replaceChildren(
        h('p', {}, 'Enter this code on the GitHub page that opened, then approve.'),
        h('div', { class: 'code', 'aria-label': `Code: ${s.userCode.split('').join(' ')}` }, s.userCode),
        h('button', { class: 'btn', type: 'button', onclick: async () => (await navigator.clipboard.writeText(s.userCode).catch(() => undefined), announce('Code copied.')) }, 'Copy code'),
        h('p', { class: 'muted' }, `Waiting for approval · expires at ${expires}`),
      )
      await chrome.tabs.create({ url: s.verificationUri, active: true })
      let interval = s.interval
      let warned = false
      for (;;) {
        await new Promise((r) => setTimeout(r, interval * 1000))
        if (!warned && s.expiresAt - Date.now() < 120_000) {
          warned = true
          announce('The sign-in code expires in two minutes.')
        }
        const p = await pollDeviceFlow(__GITHUB_CLIENT_ID__, s.deviceCode, net)
        if (p.status === 'pending') continue
        if (p.status === 'slow_down') {
          interval = p.interval
          continue
        }
        if (p.status === 'approved') {
          const who = await testGitHubToken(p.token, net)
          state.draft.githubToken = p.token
          state.login = who.ok ? who.login : undefined
          announce(`Signed in to GitHub${who.ok ? ` as @${who.login}` : ''}`)
          return go('setup-ai')
        }
        box.replaceChildren(h('p', { class: 'field-error', role: 'alert' }, p.status === 'expired' ? 'This code expired.' : p.status === 'denied' ? 'Sign-in was declined on GitHub.' : `Sign-in failed: ${p.message}`), h('button', { class: 'btn', type: 'button', onclick: () => void run() }, 'Get a new code'))
        return
      }
    } catch (e) {
      box.replaceChildren(h('p', { class: 'field-error', role: 'alert' }, (e as Error).message), h('button', { class: 'btn', type: 'button', onclick: () => void run() }, 'Try again'))
    }
  }
  return box
}

function setupAi(): HTMLElement {
  const type = h('select', { id: 'ptype' }, h('option', { value: 'anthropic' }, 'Anthropic'), h('option', { value: 'openai-compatible' }, 'OpenAI or compatible')) as HTMLSelectElement
  type.value = state.draft.provider?.type ?? 'anthropic'
  const key = h('input', { id: 'key', type: 'password', autocomplete: 'off', 'aria-describedby': 'ai-msg' }) as HTMLInputElement
  const model = h('input', { id: 'model', type: 'text', placeholder: 'Optional for Anthropic', value: state.draft.provider?.model ?? '' }) as HTMLInputElement
  const base = h('input', { id: 'base', type: 'text', placeholder: 'https://api.openai.com/v1', value: state.draft.provider?.baseUrl ?? '' }) as HTMLInputElement
  const baseRow = h('label', { class: 'field', for: 'base' }, 'Endpoint', base)
  const msg = h('p', { id: 'ai-msg', class: 'muted', role: 'status' }, 'Stored in this browser only, where web pages cannot read it, encrypted at rest. Used only for calls to your provider.')
  const sync = () => (baseRow.hidden = type.value !== 'openai-compatible')
  type.addEventListener('change', sync)
  sync()
  const save = async () => {
    const provider: StandaloneSettings['provider'] = { type: type.value as 'anthropic' | 'openai-compatible', apiKey: key.value.trim(), ...(model.value.trim() ? { model: model.value.trim() } : {}), ...(type.value === 'openai-compatible' && base.value.trim() ? { baseUrl: base.value.trim() } : {}) }
    if (!provider.apiKey) {
      msg.className = 'field-error'
      msg.textContent = 'AI key: paste your key first.'
      return key.focus()
    }
    if (provider.type === 'openai-compatible' && !provider.model) {
      msg.className = 'field-error'
      msg.textContent = 'Model: an OpenAI-compatible provider needs a model name.'
      model.setAttribute('aria-invalid', 'true')
      return model.focus()
    }
    if (provider.baseUrl && !/^https:\/\//.test(provider.baseUrl)) {
      msg.className = 'field-error'
      msg.textContent = 'Endpoint: only https:// endpoints are allowed.'
      return base.focus()
    }
    msg.className = 'muted'
    msg.textContent = 'Testing…'
    const r = await testAiKey(provider, net)
    if (!r.ok) {
      msg.className = 'field-error'
      msg.textContent = r.message
      key.setAttribute('aria-invalid', 'true')
      return key.focus()
    }
    msg.className = 'ok-line'
    msg.textContent = r.message
    state.settings = { githubToken: state.draft.githubToken!, ...(state.draft.host ? { host: state.draft.host } : {}), provider }
    await secure.set(SETTINGS, state.settings)
    state.draft = {}
    announce('Saved.')
    const pr = state.pendingPr
    state.pendingPr = undefined
    go('home')
    if (pr && pr === state.pr) void review()
  }
  return h(
    'section',
    { class: 'stack' },
    steps(2),
    state.login ? h('p', { class: 'ok-line' }, `Signed in to GitHub as @${state.login}`) : '',
    h('div', { class: 'card' }, h('h1', { tabindex: '-1' }, 'Your AI provider'), h('label', { class: 'field', for: 'ptype' }, 'Provider', type), h('label', { class: 'field', for: 'key' }, 'API key', key), h('label', { class: 'field', for: 'model' }, 'Model', model), baseRow, msg, h('button', { class: 'btn primary full', type: 'button', onclick: () => void save() }, state.pendingPr ? `Test, save and review ${state.pendingPr}` : 'Test and save')),
  )
}

function settingsView(): HTMLElement {
  const dlg = h('dialog', { id: 'confirm', 'aria-labelledby': 'confirm-h' }) as HTMLDialogElement
  const confirmClear = () => {
    dlg.replaceChildren(
      h('h2', { id: 'confirm-h' }, 'Clear stored reviews?'),
      h('p', {}, `${Object.keys(state.stored).length} review(s) kept in this browser will be removed.`),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', id: 'confirm-cancel', onclick: () => dlg.close() }, 'Cancel'), h('button', { class: 'btn primary', type: 'button', onclick: async () => {
        state.stored = {}
        await chrome.storage.local.set({ [REVIEWS]: {}, [PR_STATE]: {} })
        dlg.close()
        announce('Stored reviews cleared.')
        render()
      } }, 'Clear')),
    )
    dlg.showModal()
    ;(document.getElementById('confirm-cancel') as HTMLElement).focus()
  }
  const s = state.settings
  return h(
    'section',
    { class: 'stack' },
    h('div', { class: 'card' }, h('h1', { tabindex: '-1' }, 'Settings'), h('button', { class: 'btn', type: 'button', onclick: () => go('home') }, '← Back')),
    h('div', { class: 'card' }, h('h2', {}, 'Mode and connection'), h('p', {}, 'Standalone', state.login ? ` · GitHub @${state.login}` : ''), h('p', { class: 'muted' }, s ? `AI: ${s.provider.type === 'anthropic' ? 'Anthropic' : (s.provider.baseUrl ?? 'OpenAI')}${s.provider.model ? ` · ${s.provider.model}` : ''}` : 'Not set up')),
    h(
      'div',
      { class: 'card' },
      h('h2', {}, 'Credentials'),
      h('button', { class: 'btn', type: 'button', onclick: async () => {
        if (!state.settings) return
        state.settings = undefined
        await secure.remove(SETTINGS)
        state.login = undefined
        announce('GitHub token and AI key removed.')
        go('setup-github')
      } }, 'Remove GitHub token and AI key'),
      h('button', { class: 'btn', type: 'button', onclick: () => {
        state.draft = state.settings ? { githubToken: state.settings.githubToken } : {}
        go('setup-ai')
      } }, 'Change AI provider or key'),
    ),
    h('div', { class: 'card' }, h('h2', {}, 'Stored reviews'), h('p', { class: 'muted' }, `${Object.keys(state.stored).length} of at most ${MAX_STORED} kept in this browser.`), h('button', { class: 'btn', type: 'button', onclick: confirmClear, disabled: !Object.keys(state.stored).length }, 'Clear stored reviews')),
    h('div', { class: 'card' }, h('a', { href: chrome.runtime.getURL('privacy.html'), target: '_blank' }, 'Privacy policy')),
    dlg,
  )
}

// ── Home: PR, running, report ──────────────────────────────────────────────

function backgroundStrip(): HTMLElement | '' {
  const other = [...state.runs.keys()].find((p) => p !== state.pr)
  return other ? h('p', { class: 'strip' }, `Reviewing ${other} in the background`) : ''
}

function homeView(): HTMLElement | HTMLElement[] {
  const head = h('div', { class: 'toprow' }, h('button', { class: 'btn small', type: 'button', onclick: () => go('settings'), 'aria-label': 'Settings' }, '⚙ Settings'))
  if (!state.pr) {
    const recent = Object.entries(state.stored).sort((a, b) => b[1].at - a[1].at).slice(0, 10)
    return [head, backgroundStrip(), h('section', { class: 'card' }, h('h1', { tabindex: '-1' }, 'Open a pull request to review it.'), h('h2', {}, 'Recent reviews'), recent.length ? h('ul', { class: 'plain' }, recent.map(([pr, s]) => h('li', {}, h('b', {}, pr), ' ', h('span', { class: `badge ${STATUS_TONE[s.report.overallStatus] ?? ''}` }, STATUS_TEXT[s.report.overallStatus] ?? ''), h('span', { class: 'muted' }, ` · ${new Date(s.at).toLocaleString()}`)))) : h('p', { class: 'muted' }, 'No reviews yet.'))].filter(Boolean) as HTMLElement[]
  }
  const run = state.runs.get(state.pr)
  if (run) return [head, runningView(run)]
  const report = state.results.get(state.pr)?.report ?? state.stored[state.pr]?.report
  if (report) return [head, backgroundStrip(), ...reportView(state.pr, report)].filter(Boolean) as HTMLElement[]
  return [
    head,
    backgroundStrip(),
    h(
      'section',
      { class: 'card' },
      h('h1', { tabindex: '-1' }, state.pr),
      state.notice ? h('p', { class: 'note warn' }, state.notice) : '',
      state.error ? h('div', { class: 'note bad' }, state.error, ' ', h('button', { class: 'btn small', type: 'button', onclick: () => void review() }, 'Retry')) : '',
      h('button', { class: 'btn primary full', type: 'button', disabled: !state.online, onclick: () => void review() }, 'Review this PR'),
      !state.online ? h('p', { class: 'field-error' }, 'You are offline; reviewing needs GitHub and your AI provider.') : '',
      h('p', { class: 'muted' }, 'Nothing is posted until you press Post.'),
    ),
  ].filter(Boolean) as HTMLElement[]
}

async function review(): Promise<void> {
  if (!state.settings || !state.pr || state.runs.has(state.pr)) return
  const pr = state.pr
  const run: Run = { pr, events: [], cancelled: false }
  state.runs.set(pr, run)
  state.results.delete(pr)
  delete state.stored[pr]
  state.notice = undefined
  state.error = undefined
  state.shown = undefined
  state.postResult = undefined
  await chrome.storage.session.set({ [RUNNING]: pr })
  await savePrState(pr, { status: 'running', findings: 0, headSha: '' })
  render(true)
  try {
    const result = await runStandalone({
      pr,
      settings: state.settings,
      fetch: net,
      onEvent: (e) => {
        if (run.cancelled) return
        run.events.push(e)
        if (e.type === 'LAYER_STATUS' && e.payload.status !== 'NOT_APPLICABLE') announce(`${words(e.payload.layer)}: ${words(e.payload.status)}`)
        if (state.pr === pr) render()
      },
    })
    if (run.cancelled) return
    state.results.set(pr, result)
    state.head.set(pr, result.report.run.headSha)
    state.selected.set(pr, defaultSelection(result.report.findings))
    await storeReport(pr, result.report)
    const fresh = result.report.findings.filter((f) => f.scope !== 'PRE_EXISTING').length
    announce(`Review finished: ${STATUS_TEXT[result.report.overallStatus] ?? result.report.overallStatus}, ${fresh} new findings.`)
  } catch (e) {
    if (!run.cancelled) {
      const msg = (e as Error).message
      state.error = `The review failed: ${msg}`
      if (/401|unauthori|bad credentials/i.test(msg)) state.login = ''
      announce(state.error, true)
      await savePrState(pr, undefined)
    }
  } finally {
    state.runs.delete(pr)
    if (!state.runs.size) await chrome.storage.session.remove(RUNNING)
    if (state.pr === pr || !state.pr) render()
  }
}

function cancel(run: Run): void {
  run.cancelled = true
  state.runs.delete(run.pr)
  state.notice = 'Review cancelled.'
  void chrome.storage.session.remove(RUNNING)
  void savePrState(run.pr, undefined)
  render(true)
}

const STAGES: Record<string, string> = { fetchContext: 'Reading the PR', detect: 'Detecting projects', validate: 'Running checks', execute: 'Scanning for secrets', review: 'AI review', dedupe: 'Merging findings', gate: 'Deciding the result' }

function runningView(run: Run): HTMLElement {
  const started = run.events.filter((e) => e.type === 'STAGE_STARTED').map((e) => String(e.payload.stage))
  const finished = new Set(run.events.filter((e) => e.type === 'STAGE_FINISHED').map((e) => String(e.payload.stage)))
  const rows = Object.keys(STAGES).map((s) => {
    const st = finished.has(s) ? ['Done', 'ok'] : started.includes(s) ? ['Running', 'running'] : ['Waiting', 'waiting']
    return h('li', { class: `step ${st[1]}` }, h('span', { class: 'node', 'aria-hidden': 'true' }), h('span', {}, STAGES[s], ' ', h('span', { class: 'state' }, st[0])))
  })
  const skipped = run.events.filter((e) => e.type === 'LAYER_STATUS' && e.payload.status === 'SKIPPED').map((e) => `${words(e.payload.layer)}: SKIPPED (${words(e.payload.reason)})`)
  return h('section', { class: 'card' }, h('h1', { tabindex: '-1' }, `Reviewing ${run.pr}`), h('ol', { class: 'steps' }, rows), skipped.length ? h('p', { class: 'muted' }, skipped.join(' · ')) : '', h('p', { class: 'note warn' }, 'Closing this panel stops the review.'), h('button', { class: 'btn', type: 'button', onclick: () => cancel(run) }, 'Cancel'))
}

function defaultSelection(findings: readonly Finding[]): Set<string> {
  return new Set(findings.filter((f) => f.fingerprint && !f.dismissed && f.scope !== 'PRE_EXISTING').map((f) => f.fingerprint!))
}

function where(f: Finding): string {
  const l = f.location
  if (!l.path) return 'whole PR'
  return `${l.path}${l.startLine ? `:${l.startLine}${l.endLine && l.endLine !== l.startLine ? `-${l.endLine}` : ''}` : ''}`
}

function reportView(pr: string, r: Report): HTMLElement[] {
  const live = state.results.has(pr)
  const head = state.head.get(pr)
  const outdated = head !== undefined && r.run.headSha !== undefined && head !== r.run.headSha
  const sel = state.selected.get(pr) ?? defaultSelection(r.findings)
  state.selected.set(pr, sel)
  const fresh = r.findings.filter((f) => f.scope !== 'PRE_EXISTING')
  const pre = r.findings.filter((f) => f.scope === 'PRE_EXISTING')
  const visible = (fs: Finding[]) => (state.filter.size ? fs.filter((f) => state.filter.has(f.severity)) : fs)
  const counts = SEVERITIES.map((s) => [s, fresh.filter((f) => f.severity === s).length] as const).filter(([, n]) => n)
  const notRun = r.layers.filter((l) => ['SKIPPED', 'ERROR', 'TIMEOUT'].includes(l.status))
  const card = (f: Finding) => {
    const on = !!f.fingerprint && sel.has(f.fingerprint)
    const label = f.scope === 'PRE_EXISTING' ? 'Pre-existing' : f.dismissed ? 'Dismissed' : 'Not included'
    const link = h('a', { href: '#', class: 'path mono', 'aria-label': `${where(f)}, open in the page` }, where(f))
    link.addEventListener('click', async (e) => {
      e.preventDefault()
      if (!f.location.path) return
      const url = await diffAnchor(r.run.host, r.run.repo.fullName, r.run.pr, f.location.path, f.location.startLine)
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if ((e as MouseEvent).metaKey || (e as MouseEvent).ctrlKey || tab?.id === undefined) await chrome.tabs.create({ url, active: false })
      else await chrome.tabs.update(tab.id, { url })
      announce(`Opened ${where(f)} in the page`)
    })
    return h(
      'li',
      { class: `finding${on ? '' : ' off'}` },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: on, disabled: !f.fingerprint, onchange: (e: Event) => {
        if ((e.target as HTMLInputElement).checked) sel.add(f.fingerprint!)
        else sel.delete(f.fingerprint!)
        state.shown = undefined
        render()
        announce(`${sel.size} of ${r.findings.length} included`)
      } }), h('span', { class: 'sr-only' }, `Include in post: ${f.severity} ${f.title}, ${where(f)}`)),
      h('div', { class: 'body' }, h('div', { class: 'badges' }, h('span', { class: `badge ${SEV_TONE[f.severity] ?? ''}` }, f.severity), on ? '' : h('span', { class: 'badge' }, label)), h('h2', {}, f.title), h('p', { class: 'meta' }, link, ` · ${f.sourceFamily === 'AI' ? 'AI' : (f.provenance.tool ?? f.provenance.validator)} · ${words(f.confidence)}`), h('p', {}, f.description), f.recommendation || f.suggestion ? h('details', {}, h('summary', {}, `Recommendation for ${f.title}`), f.recommendation ? h('p', {}, f.recommendation) : '', f.suggestion ? h('pre', { class: 'mono' }, f.suggestion) : '') : ''),
    )
  }
  const chip = (s: string, n: number) => h('button', { type: 'button', class: `chip${state.filter.has(s) ? ' on' : ''}`, 'aria-pressed': state.filter.has(s) ? 'true' : 'false', onclick: () => (state.filter.has(s) ? state.filter.delete(s) : state.filter.add(s), render()) }, state.filter.has(s) ? '✓ ' : '', `${n} ${words(s)}`)
  const blocked = !live ? 'Posting needs a fresh review in this panel. Review again to post.' : outdated ? 'Posting is off: this review is of an older commit.' : !state.online ? 'Posting is off: you are offline.' : ''
  return [
    outdated ? h('div', { class: 'note warn' }, `This review is of an older commit (${String(r.run.headSha).slice(0, 7)}). `, h('button', { class: 'btn primary small', type: 'button', onclick: () => void review() }, 'Review again')) : '',
    h(
      'div',
      { class: 'card' },
      h('h1', { tabindex: '-1' }, `${r.run.repo.fullName}#${r.run.pr}`, r.title ? ` — ${r.title}` : ''),
      h('span', { class: `badge ${STATUS_TONE[r.overallStatus] ?? ''}` }, STATUS_TEXT[r.overallStatus] ?? r.overallStatus),
      h('p', { class: 'muted' }, r.coverage.headline),
      notRun.length ? h('ul', { class: 'plain muted' }, notRun.map((l) => h('li', {}, `${words(l.validator)}: ${l.status} (${words(l.reason)})`))) : '',
      r.gate.failedRules.length ? h('div', { class: 'note bad' }, h('strong', {}, 'Why it failed'), h('ul', {}, r.gate.failedRules.map((x) => h('li', {}, x)))) : '',
      h('details', {}, h('summary', {}, 'Details'), r.walkthrough ? h('p', {}, r.walkthrough.summary) : '', h('ul', { class: 'plain muted' }, r.layers.filter((l) => l.status !== 'NOT_APPLICABLE').map((l) => h('li', {}, `${words(l.layer)}: ${words(l.status)}${l.detail ? ` — ${l.detail}` : ''}`))), r.relatedFiles?.length ? h('p', { class: 'muted' }, `Related code shown to the AI: ${r.relatedFiles.map((x) => x.path).join(', ')}`) : '', r.ai?.attempts?.length ? h('p', { class: 'muted' }, r.ai.attempts.map((a) => `${a.provider} ${a.model} · ${a.usage?.input ?? '?'} in / ${a.usage?.output ?? '?'} out tokens`).join(' · ')) : ''),
    ),
    fresh.length || pre.length
      ? h(
          'div',
          { class: 'toolbar', role: 'group', 'aria-label': 'Findings' },
          counts.map(([s, n]) => chip(s, n)),
          h('button', { type: 'button', class: 'btn small', onclick: () => (fresh.forEach((f) => f.fingerprint && !f.dismissed && sel.add(f.fingerprint)), render(), announce(`${sel.size} included`)) }, 'Select all'),
          h('button', { type: 'button', class: 'btn small', onclick: () => (sel.clear(), render(), announce('None included')) }, 'Select none'),
        )
      : '',
    fresh.length ? h('ul', { class: 'findings', 'aria-label': 'New findings' }, visible(fresh).length ? visible(fresh).map(card) : h('li', { class: 'muted' }, 'No findings match this filter.')) : h('p', { class: 'card' }, 'No new findings.'),
    pre.length ? h('details', { class: 'pre' }, h('summary', {}, `${pre.length} pre-existing · Show`), h('ul', { class: 'findings' }, visible(pre).map(card))) : '',
    h('div', { class: 'card' }, h('button', { class: 'btn primary full', type: 'button', 'aria-disabled': blocked ? 'true' : undefined, 'aria-describedby': blocked ? 'post-why' : undefined, onclick: () => !blocked && go('post') }, 'Post to GitHub'), blocked ? h('p', { id: 'post-why' }, blocked) : h('p', { class: 'muted' }, `${sel.size} of ${r.findings.length} included. Nothing is posted until you press Post.`), h('button', { class: 'btn full', type: 'button', onclick: () => void review() }, 'Review again')),
  ].filter(Boolean) as HTMLElement[]
}

// ── Post ───────────────────────────────────────────────────────────────────

function postView(): HTMLElement {
  const pr = state.pr!
  const result = state.results.get(pr)
  if (!result || !state.settings) return h('section', { class: 'card' }, h('h1', { tabindex: '-1' }, 'Post to GitHub'), h('p', {}, 'Review again to post.'), h('button', { class: 'btn', type: 'button', onclick: () => go('home') }, '← Report'))
  const sel = state.selected.get(pr) ?? new Set<string>()
  const all = result.report.findings.filter((f) => f.fingerprint).map((f) => f.fingerprint!)
  const include = all.every((fp) => sel.has(fp)) ? undefined : [...sel]
  const shown = state.shown
  const strip = (t: string) => t.replace(/\n*<!-- pr-reviewer [^>]* -->\s*$/, '')
  const doPreview = async () => {
    state.postResult = undefined
    try {
      state.shown = await previewPost(result, state.settings!, net, { event: 'COMMENT', include, edits: state.edits.get(pr) ?? {} })
      announce(`Preview ready: ${state.shown.preview.inline.length} inline comments and the summary.`)
    } catch (e) {
      state.postResult = { tone: 'bad', text: (e as Error).message }
    }
    render(false, 'post-btn')
  }
  const doPost = async () => {
    if (!state.shown) return
    const btn = document.getElementById('post-btn') as HTMLButtonElement
    btn.disabled = true
    btn.textContent = 'Posting…'
    let rec: PublishRecord
    try {
      rec = await postReview(result, state.settings!, net, state.shown)
    } catch (e) {
      state.postResult = { tone: 'bad', text: `GitHub refused: ${(e as Error).message}` }
      return render(false, 'post-result')
    }
    const links = h('span', {}, rec.reviewUrl ? [' ', h('a', { href: rec.reviewUrl, target: '_blank' }, 'Open the review')] : '', rec.summaryUrl ? [' · ', h('a', { href: rec.summaryUrl, target: '_blank' }, 'Open the summary')] : '')
    if (rec.status === 'PUBLISHED') state.postResult = { tone: 'ok', text: `Posted ${rec.commentCount ?? 0} inline comment(s) and the summary as @${result.viewer?.login ?? ''}.`, links }
    else if (rec.status === 'SKIPPED_DUPLICATE') state.postResult = { tone: 'ok', text: 'Already posted for this commit; nothing new was posted.', links }
    else state.postResult = { tone: 'bad', text: `Not posted (${words(rec.status)}): ${rec.reason ?? 'unknown reason'}${rec.status === 'CANCELLED' ? ' Review again to post on the new commit.' : ''}` }
    state.shown = rec.status === 'PUBLISHED' ? undefined : state.shown
    announce(state.postResult.text, state.postResult.tone === 'bad')
    render(false, 'post-result')
  }
  return h(
    'section',
    { class: 'stack' },
    h('button', { class: 'btn small', type: 'button', onclick: () => go('home') }, '← Report'),
    h(
      'div',
      { class: 'card' },
      h('h1', { tabindex: '-1' }, 'Post to GitHub'),
      h('p', { class: 'muted' }, `Posts as @${result.viewer?.login ?? '?'}: one review with inline comments, plus one summary comment that is updated on later runs. Approving is never possible.`),
      h('label', { class: 'field', for: 'event' }, 'Review type', h('select', { id: 'event' }, h('option', { value: 'COMMENT' }, 'Comment'))),
      h('button', { class: 'btn', type: 'button', onclick: () => void doPreview() }, shown ? 'Refresh preview' : 'Preview post'),
      shown ? h('button', { class: 'btn primary full', type: 'button', id: 'post-btn', onclick: () => void doPost() }, `Post ${shown.preview.inline.length} inline comment(s) and the summary`) : '',
      h('p', { class: 'muted' }, `${sel.size} of ${result.report.findings.length} findings included`),
      state.postResult ? h('div', { class: `result ${state.postResult.tone}`, id: 'post-result', tabindex: '-1' }, state.postResult.text, state.postResult.links ?? '') : '',
    ),
    shown
      ? h(
          'div',
          { class: 'card' },
          h('h2', {}, `New inline comments (${shown.preview.inline.length})`),
          shown.preview.inline.length ? h('ul', { class: 'plain' }, shown.preview.inline.map((c) => h('li', {}, h('details', {}, h('summary', { class: 'mono' }, `${c.path}:${c.line}`), h('pre', { class: 'mono' }, strip(c.body)))))) : h('p', { class: 'muted' }, 'None.'),
          shown.preview.stillOpen.length ? [h('h2', {}, `Still open from earlier reviews (${shown.preview.stillOpen.length})`), h('ul', { class: 'plain' }, shown.preview.stillOpen.map((x) => h('li', {}, x.finding.title)))] : '',
          shown.preview.resolved.length ? [h('h2', {}, `Resolved since the last review (${shown.preview.resolved.length})`), h('ul', { class: 'plain' }, shown.preview.resolved.map((x) => h('li', {}, x.title)))] : '',
          h('h2', {}, 'Summary comment'),
          h('pre', { class: 'mono summary' }, strip(shown.preview.summaryBody)),
        )
      : '',
  )
}

// ── Boot: follow the tab ───────────────────────────────────────────────────

async function activePr(): Promise<string | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const pr = prFromUrl(tab?.url, state.settings?.host ?? 'github.com')
  return pr ? `${pr.owner}/${pr.repo}#${pr.number}` : undefined
}

async function follow(initial = false): Promise<void> {
  const pr = await activePr()
  if (pr === state.pr && !initial) return
  state.pr = pr
  state.shown = undefined
  state.postResult = undefined
  state.notice = initial ? state.notice : undefined
  state.error = undefined
  if (state.surface === 'post') state.surface = 'home'
  if (pr && state.settings && state.stored[pr] && !state.results.has(pr) && state.online) {
    state.head.set(pr, await currentHead(state.settings, pr, net).catch(() => undefined))
  }
  render(initial)
  if (pr && !initial) announce(`Showing ${pr}`)
}

async function boot(): Promise<void> {
  const local = await chrome.storage.local.get([CONSENT, REVIEWS])
  state.consent = local[CONSENT] === true
  state.stored = (local[REVIEWS] as Record<string, Stored> | undefined) ?? {}
  state.settings = await secure.get<StandaloneSettings>(SETTINGS)
  const interrupted = (await chrome.storage.session.get(RUNNING))[RUNNING]
  if (typeof interrupted === 'string') {
    state.notice = 'The last review was stopped when the panel closed.'
    await chrome.storage.session.remove(RUNNING)
    await savePrState(interrupted, undefined)
  }
  state.surface = !state.consent ? 'welcome' : state.settings ? 'home' : 'setup-github'
  // Opened from the Review button on the page with "start" (Story 7.5).
  const auto = (await chrome.storage.session.get('auto-review'))['auto-review']
  await chrome.storage.session.remove('auto-review')
  if (typeof auto === 'string' && !state.settings) state.pendingPr = auto
  await follow(true)
  if (state.settings) testGitHubToken(state.settings.githubToken, net, state.settings.host).then((r) => ((state.login = r.ok ? r.login : ''), render())).catch(() => undefined)
  if (typeof auto === 'string' && state.settings && state.pr?.toLowerCase() === auto.toLowerCase() && !state.stored[state.pr]) void review()
  chrome.tabs.onActivated.addListener(() => void follow())
  chrome.tabs.onUpdated.addListener((_id, change) => change.url && void follow())
  addEventListener('online', () => ((state.online = true), render(), announce('Back online.')))
  addEventListener('offline', () => ((state.online = false), render(), announce('You are offline.', true)))
}

void boot()
