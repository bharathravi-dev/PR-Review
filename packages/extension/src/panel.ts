// Side panel (Epic 7). Stories 7.1–7.4: Welcome and consent, Standalone setup (token or device sign-in, AI key
// test, encrypted storage), review in this page, findings to include, links into the diff, preview and post,
// following the tab, recent reviews, background runs, offline. Stories 7.7–7.8: Connected mode, where a team's
// Web App or pr-reviewer on this computer runs the review. Contract: ux-designs/ux-pr-reviewer-2026-11-26.
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
  DEFAULT_OLLAMA_BASE_URL,
  listOllamaModels,
  ollamaOrigin,
  ollamaProblem,
  type Edits,
  type StandaloneResult,
  type StandaloneSettings,
} from './compose.js'
import { connectionProblem, createClient, LOCAL_PORT, modeLabel, pairWithComputer, randomState, remoteShown, ServiceError, tokenFromRedirect, UnreachableError, webAppAuthUrl, webAppOrigin, type Connection, type RemotePreview, type SessionInfo, type ShownPreview } from './connected.js'
import { h } from './dom.js'
import { allowOllama, ollamaPermission } from './ollama-access.js'
import { browserSecureStore } from './secure-store.js'
import { MAX_STORED, prKey, type PrState } from './state.js'

const secure = browserSecureStore()
const SETTINGS = 'standalone-settings'
/** GitHub sign-in kept as soon as it succeeds, so closing the panel before the AI step doesn't lose it. */
const GITHUB_SIGNIN = 'github-signin'
const CONNECTION = 'connection'
const CONSENT = 'consent-given'
const REVIEWS = 'stored-reviews'
const PR_STATE = 'pr-state'
const RUNNING = 'running-review'
const $ = (id: string) => document.getElementById(id)!
const net: typeof fetch = (...a) => fetch(...a)

type Surface = 'welcome' | 'setup-github' | 'setup-ai' | 'setup-web' | 'setup-local' | 'home' | 'post' | 'settings'
type Choice = 'standalone' | 'web' | 'local'
interface Run {
  pr: string
  events: RunEvent[]
  cancelled: boolean
  /** Connected mode: the backend's run, which keeps going if this panel closes. */
  runId?: string
  abort?: AbortController
}
/** A review that can still be posted from this panel. */
interface Live {
  report: Report
  standalone?: StandaloneResult
  runId?: string
}
interface Shown {
  view: ShownPreview
  standalone?: { plan: PublishPlan; preview: PublishPreview; report: Report }
  digest?: string
}
interface Stored {
  report: Report
  at: number
}
const state = {
  surface: 'welcome' as Surface,
  consent: false,
  settings: undefined as StandaloneSettings | undefined,
  conn: undefined as Connection | undefined,
  session: undefined as SessionInfo | undefined,
  choice: 'standalone' as Choice,
  login: undefined as string | undefined,
  draft: {} as Partial<StandaloneSettings>,
  pr: undefined as string | undefined,
  runs: new Map<string, Run>(),
  results: new Map<string, Live>(),
  stored: {} as Record<string, Stored>,
  head: new Map<string, string | undefined>(),
  selected: new Map<string, Set<string>>(),
  edits: new Map<string, Edits>(),
  filter: new Set<string>(),
  shown: undefined as Shown | undefined,
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
  const text = !state.online ? 'Offline' : state.conn ? modeLabel(state.conn) : !state.settings ? 'Not set up' : state.login === '' ? 'Standalone · signed out' : 'Standalone'
  $('mode-text').textContent = text
  chip.className = `chip ${!state.online || state.login === '' ? 'bad' : ready() ? 'ok' : 'neutral'}`
  const target = (focusId && document.getElementById(focusId)) || (userNav ? ($('main').querySelector('h1') as HTMLElement | null) : active ? document.getElementById(active) : null)
  target?.focus()
}

/** Whether reviews can run: a connection (preferred) or Standalone settings. */
const ready = () => !!(state.conn || state.settings)
const reviewer = () => (state.conn ? state.session?.github.login : state.login)

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
  if (state.surface === 'setup-web') return setupWeb()
  if (state.surface === 'setup-local') return setupLocal()
  if (state.surface === 'settings') return settingsView()
  if (!ready()) return welcome()
  if (state.surface === 'post') return postView()
  return homeView()
}

const CHOICE_TEXT: Record<Choice, string> = { standalone: 'Standalone', web: 'my team’s Web App', local: 'This computer' }

function welcome(): HTMLElement {
  const choice = (value: Choice, title: string, desc: string, tag?: string) =>
    h(
      'label',
      { class: 'choice' },
      h('input', { type: 'radio', name: 'mode', value, checked: state.choice === value, onchange: () => {
        state.choice = value
        ;(document.getElementById('continue') as HTMLElement).textContent = `Continue with ${CHOICE_TEXT[value]}`
      } }),
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
        h('li', {}, 'Web App or This computer: only the PR link goes there; that pr-reviewer talks to GitHub and the AI with its own credentials.'),
        h('li', {}, 'Nothing goes anywhere else. No analytics.'),
        h('li', {}, 'Your recent reviews, including short code excerpts, stay in this browser until you clear them.'),
      ),
      h('a', { href: chrome.runtime.getURL('privacy.html'), target: '_blank' }, 'Privacy policy'),
      h('p', { class: 'muted' }, 'Tip: press F6 to move between the page and this panel.'),
    ),
    choice('standalone', 'Standalone', 'Your GitHub sign-in and an AI key, or a local model in Ollama. Compile and lint do not run.'),
    choice('web', 'My team’s Web App', 'Reviews run on your team’s self-hosted pr-reviewer. You sign in there; your keys stay on that server.', 'full checks'),
    choice('local', 'This computer', 'Pair with pr-reviewer serve on this computer: your CLI’s settings, subscription and checks. No key in the browser.', 'full checks'),
    h('button', { class: 'btn primary full', type: 'button', id: 'continue', onclick: async () => {
      state.consent = true
      await chrome.storage.local.set({ [CONSENT]: true })
      if (state.choice === 'web') return go('setup-web')
      if (state.choice === 'local') return go('setup-local')
      go(state.settings ? 'home' : 'setup-github')
    } }, `Continue with ${CHOICE_TEXT[state.choice]}`),
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
    await secure.set(GITHUB_SIGNIN, { githubToken: t, ...(state.draft.host ? { host: state.draft.host } : {}) })
    announce(`Signed in to GitHub as @${r.login}`)
    go('setup-ai')
  }
  const device = __GITHUB_CLIENT_ID__ && !state.draft.host ? deviceBlock() : ''
  const hostInput = h('input', { id: 'ghe', type: 'text', placeholder: 'github.example.com', value: state.draft.host ?? '' }) as HTMLInputElement
  const hostMsg = h('p', { class: 'muted', id: 'ghe-msg', role: 'status' })
  const addHost = async () => {
    const host = hostInput.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase()
    if (!host || host === 'github.com') {
      delete state.draft.host
      return go('setup-github', 'gh')
    }
    if (!/^[a-z0-9.-]+\.[a-z]{2,}(:\d+)?$/.test(host)) {
      hostMsg.className = 'field-error'
      hostMsg.textContent = 'Enterprise host: enter a host name such as github.example.com.'
      return hostInput.focus()
    }
    // Chrome is asked for this host only, at the moment it is added (Story 7.6).
    const granted = await chrome.permissions.request({ origins: [`https://${host}/*`] }).catch(() => false)
    if (!granted) {
      hostMsg.className = 'field-error'
      hostMsg.textContent = `Chrome did not allow access to ${host}, so PRs there can't be reviewed. Try again to allow it.`
      return hostInput.focus()
    }
    state.draft.host = host
    announce(`Using ${host}. Paste a token for it.`)
    go('setup-github', 'gh')
  }
  const enterprise = h('details', { class: 'enterprise', open: !!state.draft.host }, h('summary', {}, state.draft.host ? `GitHub Enterprise: ${state.draft.host}` : 'Use GitHub Enterprise'), h('label', { class: 'field', for: 'ghe' }, 'Enterprise host', hostInput), hostMsg, h('button', { class: 'btn', type: 'button', onclick: () => void addHost() }, 'Use this host'))
  return h(
    'section',
    { class: 'stack' },
    steps(1),
    (() => {
      const tokenParts = [h('p', { class: 'muted', id: 'gh-help' }, 'A fine-grained token with Pull requests: read and Contents: read (add Pull requests: write to post). Classic tokens need repo or public_repo.'), h('label', { class: 'field', for: 'gh' }, 'GitHub token', token), err, h('button', { class: `btn${device ? '' : ' primary'} full`, type: 'button', onclick: () => void useToken() }, 'Test and continue')]
      // With an OAuth app, signing in on GitHub is the way in; a pasted token stays available as the fallback.
      return device
        ? h('div', { class: 'card' }, h('h1', { tabindex: '-1' }, 'Connect GitHub'), h('p', { class: 'muted' }, 'Sign in on GitHub and approve PR Reviewer. Nothing to copy except a short code.'), device, h('details', { class: 'alt' }, h('summary', {}, 'Use a token instead'), ...tokenParts), enterprise)
        : h('div', { class: 'card' }, h('h1', { tabindex: '-1' }, state.draft.host ? `Connect ${state.draft.host}` : 'Connect GitHub'), h('h2', {}, 'Use a token'), ...tokenParts, enterprise, h('p', { class: 'muted' }, 'No token? Choose ', h('a', { href: '#', onclick: (e: Event) => (e.preventDefault(), (state.choice = 'local'), go('welcome')) }, 'This computer'), ' on the first screen to use the GitHub login of pr-reviewer on your computer.'))
    })(),
  )
}

function deviceBlock(): HTMLElement {
  const box = h('div', { class: 'device' }, h('button', { class: 'btn primary full', type: 'button', onclick: () => void run() }, 'Sign in with GitHub'))
  const run = async () => {
    try {
      const s = await startDeviceFlow(__GITHUB_CLIENT_ID__, net)
      const expires = new Date(s.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      // The code is copied so it can be pasted on GitHub's page; if the browser refuses, the Copy button remains.
      const copied = await navigator.clipboard.writeText(s.userCode).then(() => true, () => false)
      box.replaceChildren(
        h('p', {}, copied ? 'The code is copied. Paste it on the GitHub page that opened, then approve.' : 'Enter this code on the GitHub page that opened, then approve.'),
        h('div', { class: 'code', 'aria-label': `Code: ${s.userCode.split('').join(' ')}` }, s.userCode),
        h('button', { class: 'btn', type: 'button', onclick: async () => (await navigator.clipboard.writeText(s.userCode).catch(() => undefined), announce('Code copied.')) }, 'Copy code'),
        h('p', { class: 'muted' }, `Waiting for approval · expires at ${expires}`),
      )
      announce(copied ? `Code ${s.userCode} copied. Paste it on the GitHub page.` : `Your code is ${s.userCode}.`)
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
          await secure.set(GITHUB_SIGNIN, { githubToken: p.token })
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
  const type = h('select', { id: 'ptype' }, h('option', { value: 'anthropic' }, 'Anthropic'), h('option', { value: 'openai-compatible' }, 'OpenAI or compatible'), h('option', { value: 'ollama' }, 'Ollama: a local model, no key')) as HTMLSelectElement
  type.value = state.draft.provider?.type ?? 'anthropic'
  const key = h('input', { id: 'key', type: 'password', autocomplete: 'off', 'aria-describedby': 'ai-msg' }) as HTMLInputElement
  const model = h('input', { id: 'model', type: 'text', placeholder: 'Optional for Anthropic', value: state.draft.provider?.type !== 'ollama' ? (state.draft.provider?.model ?? '') : '' }) as HTMLInputElement
  const base = h('input', { id: 'base', type: 'text', placeholder: 'https://api.openai.com/v1', value: state.draft.provider?.type === 'openai-compatible' ? (state.draft.provider.baseUrl ?? '') : '' }) as HTMLInputElement
  const keyRow = h('label', { class: 'field', for: 'key' }, 'API key', key)
  const modelRow = h('label', { class: 'field', for: 'model' }, 'Model', model)
  const baseRow = h('label', { class: 'field', for: 'base' }, 'Endpoint', base)
  // Ollama: models come from the local Ollama itself; the address is changed only for a non-default setup.
  const omodel = h('select', { id: 'omodel', 'aria-describedby': 'ai-msg' }, h('option', { value: '' }, 'Finding models…')) as HTMLSelectElement
  const ourl = h('input', { id: 'ourl', type: 'text', placeholder: DEFAULT_OLLAMA_BASE_URL, value: state.draft.provider?.type === 'ollama' ? (state.draft.provider.baseUrl ?? '') : '' }) as HTMLInputElement
  const ollamaRows = h(
    'div',
    { class: 'stack' },
    h('label', { class: 'field', for: 'omodel' }, 'Model', omodel),
    h('button', { class: 'btn small', type: 'button', onclick: () => void findModels(true) }, 'Find models again'),
    h('details', {}, h('summary', {}, `Ollama address: ${DEFAULT_OLLAMA_BASE_URL} unless changed`), h('label', { class: 'field', for: 'ourl' }, 'Ollama address', ourl)),
  )
  const defaultNote = 'Stored in this browser only, where web pages cannot read it, encrypted at rest. Used only for calls to your provider.'
  const msg = h('p', { id: 'ai-msg', class: 'muted', role: 'status' }, defaultNote)
  const say = (tone: 'muted' | 'field-error' | 'ok-line', text: string) => ((msg.className = tone), (msg.textContent = text))

  /** Asks Chrome for the Ollama address (on a click), lets requests through, and lists the installed models. */
  const findModels = async (ask: boolean): Promise<string | undefined> => {
    const origin = ollamaOrigin(ourl.value)
    if (!origin) return void say('field-error', 'Ollama address: use http:// on this computer (127.0.0.1 or localhost) or an https:// address.')
    const pattern = ollamaPermission(origin)
    const granted = (await chrome.permissions.contains({ origins: [pattern] }).catch(() => false)) || (ask && (await chrome.permissions.request({ origins: [pattern] }).catch(() => false)))
    if (!granted) return void say('muted', 'Click “Find models again” to let the extension talk to Ollama on this computer.')
    await allowOllama(origin)
    say('muted', 'Looking for models in Ollama…')
    try {
      const models = await listOllamaModels(origin, net)
      const want = state.draft.provider?.type === 'ollama' ? state.draft.provider.model : omodel.value
      omodel.replaceChildren(...(models.length ? models.map((m) => h('option', { value: m.name }, `${m.name}${m.parameterSize ? ` · ${m.parameterSize}` : ''}`)) : [h('option', { value: '' }, 'No models installed')]))
      if (want && models.some((m) => m.name === want)) omodel.value = want
      if (!models.length) say('field-error', 'Ollama has no models yet. Install one in a terminal, for example: ollama pull qwen3:8b')
      else say('muted', `${models.length} model${models.length === 1 ? '' : 's'} in Ollama. Reviews with a local model stay on this computer; a large model is slower but finds more.`)
      return origin
    } catch (e) {
      omodel.replaceChildren(h('option', { value: '' }, 'Ollama not reachable'))
      say('field-error', ollamaProblem((e as Error).message))
      return undefined
    }
  }
  const sync = () => {
    const t = type.value
    keyRow.hidden = t === 'ollama'
    modelRow.hidden = t === 'ollama'
    baseRow.hidden = t !== 'openai-compatible'
    ollamaRows.hidden = t !== 'ollama'
    if (t === 'ollama') void findModels(true)
    else say('muted', defaultNote)
  }
  type.addEventListener('change', sync)
  const save = async () => {
    let provider: StandaloneSettings['provider']
    if (type.value === 'ollama') {
      const origin = await findModels(true)
      if (!origin) return omodel.focus()
      if (!omodel.value) {
        say('field-error', 'Model: choose one of the models installed in Ollama.')
        return omodel.focus()
      }
      provider = { type: 'ollama', apiKey: '', model: omodel.value, ...(origin !== DEFAULT_OLLAMA_BASE_URL ? { baseUrl: origin } : {}) }
    } else {
      provider = { type: type.value as 'anthropic' | 'openai-compatible', apiKey: key.value.trim(), ...(model.value.trim() ? { model: model.value.trim() } : {}), ...(type.value === 'openai-compatible' && base.value.trim() ? { baseUrl: base.value.trim() } : {}) }
      if (!provider.apiKey) {
        say('field-error', 'AI key: paste your key first.')
        return key.focus()
      }
      if (provider.type === 'openai-compatible' && !provider.model) {
        say('field-error', 'Model: an OpenAI-compatible provider needs a model name.')
        model.setAttribute('aria-invalid', 'true')
        return model.focus()
      }
      if (provider.baseUrl && !/^https:\/\//.test(provider.baseUrl)) {
        say('field-error', 'Endpoint: only https:// endpoints are allowed.')
        return base.focus()
      }
    }
    say('muted', 'Testing…')
    const r = await testAiKey(provider, net)
    if (!r.ok) {
      say('field-error', r.message)
      const field = provider.type === 'ollama' ? omodel : key
      field.setAttribute('aria-invalid', 'true')
      return field.focus()
    }
    say('ok-line', r.message)
    state.settings = { githubToken: state.draft.githubToken!, ...(state.draft.host ? { host: state.draft.host } : {}), provider }
    await secure.set(SETTINGS, state.settings)
    await secure.remove(GITHUB_SIGNIN)
    state.draft = {}
    announce('Saved.')
    const pr = state.pendingPr
    state.pendingPr = undefined
    go('home')
    if (pr && pr === state.pr) void review()
  }
  const view = h(
    'section',
    { class: 'stack' },
    steps(2),
    state.login
      ? h('p', { class: 'ok-line' }, `Signed in to GitHub as @${state.login} `, h('button', { class: 'btn small', type: 'button', onclick: async () => {
          await secure.remove(GITHUB_SIGNIN)
          state.draft = {}
          state.login = undefined
          go('setup-github')
        } }, 'Use another account'))
      : '',
    h('div', { class: 'card' }, h('h1', { tabindex: '-1' }, 'Your AI provider'), h('label', { class: 'field', for: 'ptype' }, 'Provider', type), keyRow, modelRow, baseRow, ollamaRows, msg, h('button', { class: 'btn primary full', type: 'button', onclick: () => void save() }, state.pendingPr ? `Test, save and review ${state.pendingPr}` : 'Test and save')),
  )
  queueMicrotask(sync)
  return view
}

async function connect(conn: Connection): Promise<SessionInfo> {
  const session = await createClient(conn, net).session()
  state.conn = conn
  state.session = session
  state.login = session.github.login ?? ''
  state.error = undefined
  await secure.set(CONNECTION, conn)
  return session
}

function afterConnect(text: string): void {
  announce(text)
  const pr = state.pendingPr
  state.pendingPr = undefined
  go('home')
  if (pr && pr === state.pr) void review()
}

function fieldError(el: HTMLElement, input: HTMLInputElement, text: string): void {
  el.className = 'field-error'
  el.textContent = text
  input.setAttribute('aria-invalid', 'true')
  input.focus()
}

function setupWeb(): HTMLElement {
  const url = h('input', { id: 'web-url', type: 'url', inputmode: 'url', autocomplete: 'url', placeholder: 'https://reviews.example.com', 'aria-describedby': 'web-help web-err' }) as HTMLInputElement
  const err = h('p', { class: 'muted', id: 'web-err', role: 'status' })
  const run = async () => {
    const origin = webAppOrigin(url.value)
    if (!origin) return fieldError(err, url, 'Web App address: enter an https:// address, such as https://reviews.example.com.')
    // Chrome asks for this one site now, while the click still counts as the user's.
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] }).catch(() => false)
    if (!granted) return fieldError(err, url, `Chrome did not allow access to ${new URL(origin).host}, so the extension can't use that Web App. Try again to allow it.`)
    err.className = 'muted'
    err.textContent = 'Checking…'
    const probe = await net(`${origin}/v1/session`, { headers: { 'accept-schema': '1' } }).then(async (r) => ({ status: r.status, body: (await r.json().catch(() => undefined)) as { error?: { code?: string } } | undefined })).catch(() => undefined)
    if (!probe) return fieldError(err, url, `Can't reach ${new URL(origin).host}. Check the address or your network.`)
    if (probe.status !== 401 || !probe.body?.error?.code) return fieldError(err, url, `${new URL(origin).host} doesn't look like a pr-reviewer Web App.`)
    err.textContent = 'Sign in and allow the extension in the window that opened…'
    const st = randomState()
    let redirect: string | undefined
    try {
      redirect = await chrome.identity.launchWebAuthFlow({ url: webAppAuthUrl(origin, chrome.runtime.id, st), interactive: true })
    } catch {
      return fieldError(err, url, 'The Web App window closed before you allowed the extension. If it said this extension is not allowed, send your admin the ID below.')
    }
    const token = tokenFromRedirect(redirect, chrome.runtime.id, st)
    if (!token) return fieldError(err, url, 'The Web App did not hand back access. Try again.')
    try {
      const s = await connect({ kind: 'web', baseUrl: origin, token })
      afterConnect(`Connected to ${new URL(origin).host} as @${s.user?.login ?? s.github.login ?? '?'}`)
    } catch (e) {
      fieldError(err, url, e instanceof ServiceError && e.code === 'schema_unsupported' ? e.message : `Connecting failed: ${(e as Error).message}`)
    }
  }
  return h(
    'section',
    { class: 'stack' },
    h(
      'div',
      { class: 'card' },
      h('h1', { tabindex: '-1' }, 'Connect to your team’s Web App'),
      h('p', { class: 'muted', id: 'web-help' }, 'Reviews run there with your settings and full checks. You sign in to the Web App with GitHub and allow this extension; it gets a token that you can revoke on the Web App.'),
      h('label', { class: 'field', for: 'web-url' }, 'Web App address', url),
      err,
      h('button', { class: 'btn primary full', type: 'button', onclick: () => void run() }, 'Connect'),
      h('details', {}, h('summary', {}, 'For your Web App’s admin'), h('p', {}, 'The Web App accepts this extension once its ID is in PR_REVIEWER_EXTENSION_IDS:'), h('p', { class: 'mono' }, chrome.runtime.id), h('button', { class: 'btn small', type: 'button', onclick: async () => (await navigator.clipboard.writeText(chrome.runtime.id).catch(() => undefined), announce('Extension ID copied.')) }, 'Copy ID')),
    ),
    h('button', { class: 'btn', type: 'button', onclick: () => go('welcome') }, '← Choose another mode'),
  )
}

function setupLocal(): HTMLElement {
  const code = h('input', { id: 'pair-code', type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: '9', placeholder: 'ABCD-EFGH', 'aria-describedby': 'pair-help pair-err' }) as HTMLInputElement
  const port = h('input', { id: 'pair-port', type: 'number', min: '1', max: '65535', value: String(LOCAL_PORT) }) as HTMLInputElement
  const err = h('p', { class: 'muted', id: 'pair-err', role: 'status' })
  const run = async () => {
    const n = Number(port.value)
    if (!Number.isInteger(n) || n < 1 || n > 65535) return fieldError(err, port, 'Port: a whole number from 1 to 65535.')
    const typed = code.value.trim()
    if (!/^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/.test(typed)) return fieldError(err, code, 'Pairing code: 8 letters and digits, like ABCD-EFGH.')
    const granted = await chrome.permissions.request({ origins: ['http://127.0.0.1/*'] }).catch(() => false)
    if (!granted) return fieldError(err, code, 'Chrome did not allow the extension to reach pr-reviewer on this computer. Try again to allow it.')
    err.className = 'muted'
    err.textContent = 'Pairing…'
    try {
      const paired = await pairWithComputer(n, typed, net)
      await connect({ kind: 'local', baseUrl: `http://127.0.0.1:${paired.port}`, token: paired.token, computer: paired.computer })
      afterConnect(`Paired with pr-reviewer on ${paired.computer}`)
    } catch (e) {
      if (e instanceof UnreachableError) return fieldError(err, code, `pr-reviewer on this computer isn't running on port ${n}. Start it with: pr-reviewer serve --pair.`)
      if (e instanceof ServiceError && e.code === 'pair_code_wrong') return fieldError(err, code, "That code didn't match.")
      if (e instanceof ServiceError && e.code === 'pair_code_expired') return fieldError(err, code, 'That code expired. Run pr-reviewer serve --pair again.')
      fieldError(err, code, (e as Error).message)
    }
  }
  code.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && void run())
  return h(
    'section',
    { class: 'stack' },
    h(
      'div',
      { class: 'card' },
      h('h1', { tabindex: '-1' }, 'Pair with this computer'),
      h('p', { id: 'pair-help' }, 'In a terminal, run ', h('code', { class: 'mono' }, 'pr-reviewer serve --pair'), '. Type the 8-character code it prints (letters and digits, like ABCD-EFGH). It works once, for 10 minutes.'),
      h('label', { class: 'field', for: 'pair-code' }, 'Pairing code', code),
      h('details', {}, h('summary', {}, `Port: ${LOCAL_PORT} unless you passed --port`), h('label', { class: 'field', for: 'pair-port' }, 'Port', port)),
      err,
      h('button', { class: 'btn primary full', type: 'button', onclick: () => void run() }, 'Pair'),
      h('p', { class: 'muted' }, 'Reviews then use the CLI’s settings and credentials, including your subscription. The extension never sees them.'),
    ),
    h('button', { class: 'btn', type: 'button', onclick: () => go('welcome') }, '← Choose another mode'),
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
    state.conn
      ? h(
          'div',
          { class: 'card' },
          h('h2', {}, 'Mode and connection'),
          h('p', {}, modeLabel(state.conn), state.session?.github.login ? ` · GitHub @${state.session.github.login}` : ''),
          state.conn.kind === 'local' ? h('p', { class: 'muted' }, `pr-reviewer on ${state.conn.computer ?? 'this computer'} · port ${new URL(state.conn.baseUrl).port}. If that isn’t your computer, disconnect and run pr-reviewer serve --unpair.`) : h('p', { class: 'muted' }, `Revoke the extension’s access any time at ${state.conn.baseUrl}/auth/extension/tokens.`),
          state.session ? h('p', { class: 'muted' }, `AI: ${state.session.ai.provider}${state.session.ai.model ? ` · ${state.session.ai.model}` : ''}${state.session.ai.ready ? '' : ` · not ready: ${state.session.ai.reason ?? ''}`}`) : '',
          h('button', { class: 'btn', type: 'button', onclick: async () => {
            state.conn = undefined
            state.session = undefined
            state.login = undefined
            state.results.clear()
            await secure.remove(CONNECTION)
            announce(state.settings ? 'Disconnected. Reviews now run in Standalone.' : 'Disconnected.')
            if (state.settings) void testGitHubToken(state.settings.githubToken, net, state.settings.host).then((r) => ((state.login = r.ok ? r.login : ''), render())).catch(() => undefined)
            go(state.settings ? 'settings' : 'welcome')
          } }, 'Disconnect'),
        )
      : h('div', { class: 'card' }, h('h2', {}, 'Mode and connection'), h('p', {}, 'Standalone', state.login ? ` · GitHub @${state.login}` : ''), h('p', { class: 'muted' }, s ? `AI: ${s.provider.type === 'anthropic' ? 'Anthropic' : s.provider.type === 'ollama' ? `Ollama on ${s.provider.baseUrl ? new URL(s.provider.baseUrl).host : 'this computer'}` : (s.provider.baseUrl ?? 'OpenAI')}${s.provider.model ? ` · ${s.provider.model}` : ''}` : 'Not set up'), h('button', { class: 'btn', type: 'button', onclick: () => go('welcome') }, 'Connect a Web App or this computer')),
    s
      ? h(
      'div',
      { class: 'card' },
      h('h2', {}, 'Credentials'),
      h('button', { class: 'btn', type: 'button', onclick: async () => {
        if (!state.settings) return
        state.settings = undefined
        await secure.remove(SETTINGS)
        await secure.remove(GITHUB_SIGNIN)
        state.login = undefined
        announce('GitHub token and AI key removed.')
        go('setup-github')
      } }, 'Remove GitHub token and AI key'),
      h('button', { class: 'btn', type: 'button', onclick: () => {
        state.draft = state.settings ? { githubToken: state.settings.githubToken } : {}
        go('setup-ai')
      } }, 'Change AI provider or key'),
    )
      : '',
    h('div', { class: 'card' }, h('h2', {}, 'Stored reviews'), h('p', { class: 'muted' }, `${Object.keys(state.stored).length} of at most ${MAX_STORED} kept in this browser.`), h('button', { class: 'btn', type: 'button', onclick: confirmClear, disabled: !Object.keys(state.stored).length }, 'Clear stored reviews')),
    h('div', { class: 'card' }, h('a', { href: chrome.runtime.getURL('privacy.html'), target: '_blank' }, 'Privacy policy'), h('a', { class: 'credit', href: 'https://bharathravi.dev/', target: '_blank' }, 'Built by ', h('span', { class: 'br' }, 'BR'), h('span', { class: 'dev' }, '.dev'))),
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
      state.error ? h('div', { class: 'note bad' }, state.error, ' ', h('button', { class: 'btn small', type: 'button', onclick: () => void review() }, 'Retry'), state.conn && state.settings ? [' ', h('button', { class: 'btn small', type: 'button', onclick: () => void review(true) }, 'Review with Standalone instead')] : '') : '',
      h('button', { class: 'btn primary full', type: 'button', disabled: !state.online, onclick: () => void review() }, 'Review this PR'),
      !state.online ? h('p', { class: 'field-error' }, state.conn ? 'You are offline; reviewing needs your pr-reviewer connection.' : 'You are offline; reviewing needs GitHub and your AI provider.') : '',
      h('p', { class: 'muted' }, 'Nothing is posted until you press Post.'),
    ),
  ].filter(Boolean) as HTMLElement[]
}

const onRunEvent = (run: Run) => (e: RunEvent) => {
  if (run.cancelled) return
  run.events.push(e)
  if (e.type === 'LAYER_STATUS' && e.payload.status !== 'NOT_APPLICABLE') announce(`${words(e.payload.layer)}: ${words(e.payload.status)}`)
  if (state.pr === run.pr) render()
}

async function finished(pr: string, live: Live): Promise<void> {
  state.results.set(pr, live)
  state.head.set(pr, live.report.run.headSha)
  state.selected.set(pr, defaultSelection(live.report.findings))
  await storeReport(pr, live.report)
  const fresh = live.report.findings.filter((f) => f.scope !== 'PRE_EXISTING').length
  announce(`Review finished: ${STATUS_TEXT[live.report.overallStatus] ?? live.report.overallStatus}, ${fresh} new findings.`)
}

/** Follows a backend run to its end: events, then the report (Connected mode). */
async function watchRemote(conn: Connection, run: Run, id: string): Promise<void> {
  const client = createClient(conn, net)
  await client.events(id, onRunEvent(run), { signal: run.abort!.signal })
  if (run.cancelled) return
  for (let i = 0; ; i++) {
    const r = (await client.report(id)) as Report | { status: 'running' }
    if (!('status' in r && r.status === 'running')) return finished(run.pr, { report: r as Report, runId: id })
    if (i > 30) throw new Error('The review did not finish.')
    await new Promise((res) => setTimeout(res, 1000))
  }
}

async function review(standalone = false): Promise<void> {
  const conn = standalone ? undefined : state.conn
  if ((!conn && !state.settings) || !state.pr || state.runs.has(state.pr)) return
  const pr = state.pr
  const run: Run = { pr, events: [], cancelled: false, ...(conn ? { abort: new AbortController() } : {}) }
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
    if (conn) {
      const { id } = await createClient(conn, net).startRun(pr)
      run.runId = id
      // Kept so a reopened panel follows the same backend run (it keeps going when the panel closes).
      await chrome.storage.session.set({ [RUNNING]: { pr, runId: id, baseUrl: conn.baseUrl } })
      await watchRemote(conn, run, id)
    } else {
      const result = await runStandalone({ pr, settings: state.settings!, fetch: net, onEvent: onRunEvent(run) })
      if (run.cancelled) return
      await finished(pr, { report: result.report, standalone: result })
    }
  } catch (e) {
    if (!run.cancelled) {
      const msg = conn ? connectionProblem(conn, e) : (e as Error).message
      state.error = conn && (e instanceof UnreachableError || e instanceof ServiceError) ? msg : `The review failed: ${msg}`
      if (!conn && /401|unauthori|bad credentials/i.test(msg)) state.login = ''
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
  run.abort?.abort()
  state.runs.delete(run.pr)
  state.notice = run.runId ? 'Stopped following this review; it may still finish on the server.' : 'Review cancelled.'
  void chrome.storage.session.remove(RUNNING)
  void savePrState(run.pr, undefined)
  render(true)
}

const STAGES: Record<string, string> = { fetchContext: 'Reading the PR', detect: 'Detecting projects', validate: 'Running checks', execute: 'Scanning for secrets', review: 'AI review', dedupe: 'Merging findings', gate: 'Deciding the result' }

function runningView(run: Run): HTMLElement {
  const started = run.events.filter((e) => e.type === 'STAGE_STARTED').map((e) => String(e.payload.stage))
  const finished = new Set(run.events.filter((e) => e.type === 'STAGE_FINISHED').map((e) => String(e.payload.stage)))
  // A large PR on a local model is reviewed in parts; show which one, since each can take a minute or more.
  const part = run.events.findLast((e) => e.type === 'STAGE_PROGRESS' && e.payload.stage === 'review')?.payload as { part?: number; parts?: number } | undefined
  const rows = Object.keys(STAGES).map((s) => {
    const running = part && s === 'review' && !finished.has(s) ? `Part ${part.part} of ${part.parts}` : 'Running'
    const st = finished.has(s) ? ['Done', 'ok'] : started.includes(s) ? [running, 'running'] : ['Waiting', 'waiting']
    return h('li', { class: `step ${st[1]}` }, h('span', { class: 'node', 'aria-hidden': 'true' }), h('span', {}, STAGES[s], ' ', h('span', { class: 'state' }, st[0])))
  })
  const noSandbox = run.events.some((e) => e.type === 'LAYER_STATUS' && e.payload.status === 'SKIPPED' && e.payload.reason === 'NO_SANDBOX')
  const skipped = run.events.filter((e) => e.type === 'LAYER_STATUS' && e.payload.status === 'SKIPPED' && e.payload.reason !== 'NO_SANDBOX').map((e) => `${words(e.payload.layer)}: SKIPPED (${words(e.payload.reason)})`)
  return h('section', { class: 'card' }, h('h1', { tabindex: '-1' }, `Reviewing ${run.pr}`), h('ol', { class: 'steps' }, rows), part ? h('p', { class: 'muted' }, `This PR is larger than the model's context window, so it is reviewed in ${part.parts} parts and the findings are merged.`) : '', noSandbox ? sandboxNote() : '', skipped.length ? h('p', { class: 'muted' }, skipped.join(' · ')) : '', run.abort && state.conn ? h('p', { class: 'muted' }, `Running on ${state.conn.kind === 'local' ? `pr-reviewer on ${state.conn.computer ?? 'this computer'}` : new URL(state.conn.baseUrl).host}; closing this panel doesn’t stop it.`) : h('p', { class: 'note warn' }, 'Closing this panel stops the review.'), h('button', { class: 'btn', type: 'button', onclick: () => cancel(run) }, run.abort ? 'Stop following' : 'Cancel'))
}

/** Compile and lint run the repository's own tools in a container; a browser can't, so say where they do run. */
function sandboxNote(): HTMLElement {
  return h(
    'p',
    { class: 'muted' },
    'Compile and lint run the repository’s own tools inside Docker, which a browser can’t start. To include them, use ',
    h('a', { href: '#', onclick: (e: Event) => (e.preventDefault(), (state.choice = 'local'), go('welcome')) }, 'This computer'),
    ' (pr-reviewer serve --pair) with Docker running.',
  )
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
      r.effort ? h('p', { class: 'muted' }, `Review depth: ${r.effort.level} (${r.effort.reasons.join('; ')})${r.incremental ? ` · re-checked only what changed since ${r.incremental.since.slice(0, 7)}` : ''}`) : '',
      notRun.length ? h('ul', { class: 'plain muted' }, notRun.map((l) => h('li', {}, `${words(l.validator)}: ${l.status} (${words(l.reason)})`))) : '',
      notRun.some((l) => l.reason === 'NO_SANDBOX') && !state.conn ? sandboxNote() : '',
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
  const live = state.results.get(pr)
  const conn = live?.runId ? state.conn : undefined
  if (!live || (live.standalone ? !state.settings : !conn)) return h('section', { class: 'card' }, h('h1', { tabindex: '-1' }, 'Post to GitHub'), h('p', {}, 'Review again to post.'), h('button', { class: 'btn', type: 'button', onclick: () => go('home') }, '← Report'))
  const login = live.standalone ? live.standalone.viewer?.login : state.session?.github.login
  const sel = state.selected.get(pr) ?? new Set<string>()
  const all = live.report.findings.filter((f) => f.fingerprint).map((f) => f.fingerprint!)
  const include = all.every((fp) => sel.has(fp)) ? undefined : [...sel]
  const edits = state.edits.get(pr) ?? {}
  const shown = state.shown
  const strip = (t: string) => t.replace(/\n*<!-- pr-reviewer [^>]* -->\s*$/, '')
  const doPreview = async () => {
    state.postResult = undefined
    try {
      if (conn) {
        const r = await createClient(conn, net).preview(live.runId!, { include, edits })
        state.shown = { view: remoteShown(r.preview), digest: r.digest }
      } else {
        const p = await previewPost(live.standalone!, state.settings!, net, { event: 'COMMENT', include, edits })
        state.shown = { standalone: p, view: { inline: p.preview.inline, stillOpen: p.preview.stillOpen.map((x) => ({ title: x.finding.title })), resolved: p.preview.resolved, summaryBody: p.preview.summaryBody } }
      }
      announce(`Preview ready: ${state.shown.view.inline.length} inline comments and the summary.`)
    } catch (e) {
      state.postResult = { tone: 'bad', text: conn ? connectionProblem(conn, e) : (e as Error).message }
    }
    render(false, 'post-btn')
  }
  /** This computer posts as the CLI's GitHub identity, so every post is confirmed first (FR37). */
  const confirmLocal = (n: number) =>
    new Promise<boolean>((resolve) => {
      const dlg = document.getElementById('post-confirm') as HTMLDialogElement
      const done = (ok: boolean) => (dlg.close(), resolve(ok))
      dlg.replaceChildren(
        h('h2', { id: 'post-confirm-h' }, `Post ${n} inline comment${n === 1 ? '' : 's'} as @${login ?? '?'} from pr-reviewer on ${conn?.computer ?? 'this computer'}?`),
        h('p', {}, 'Plus one summary comment. Nothing else is posted.'),
        h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', id: 'post-confirm-cancel', onclick: () => done(false) }, 'Cancel'), h('button', { class: 'btn primary', type: 'button', onclick: () => done(true) }, 'Post')),
      )
      dlg.addEventListener('cancel', () => resolve(false), { once: true })
      dlg.showModal()
      ;(document.getElementById('post-confirm-cancel') as HTMLElement).focus()
    })
  const doPost = async () => {
    if (!state.shown) return
    if (conn?.kind === 'local' && !(await confirmLocal(state.shown.view.inline.length))) return document.getElementById('post-btn')?.focus()
    const btn = document.getElementById('post-btn') as HTMLButtonElement
    btn.disabled = true
    btn.textContent = 'Posting…'
    let rec: PublishRecord
    try {
      rec = conn ? await createClient(conn, net).publish(live.runId!, { include, edits }, state.shown.digest!) : await postReview(live.standalone!, state.settings!, net, state.shown.standalone!)
    } catch (e) {
      if (e instanceof ServiceError && e.code === 'preview_changed' && e.body?.preview) {
        state.shown = { view: remoteShown(e.body.preview as RemotePreview), digest: String(e.body.digest) }
        state.postResult = { tone: 'bad', text: 'What would be posted changed since your preview (for example, someone commented on the PR). Check the new preview, then post.' }
      } else state.postResult = { tone: 'bad', text: conn ? connectionProblem(conn, e) : `GitHub refused: ${(e as Error).message}` }
      return render(false, 'post-result')
    }
    const links = h('span', {}, rec.reviewUrl ? [' ', h('a', { href: rec.reviewUrl, target: '_blank' }, 'Open the review')] : '', rec.summaryUrl ? [' · ', h('a', { href: rec.summaryUrl, target: '_blank' }, 'Open the summary')] : '')
    if (rec.status === 'PUBLISHED') state.postResult = { tone: 'ok', text: `Posted ${rec.commentCount ?? 0} inline comment(s) and the summary as @${login ?? ''}.`, links }
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
      h('p', { class: 'muted' }, `Posts as @${login ?? '?'}${conn ? ` through ${conn.kind === 'local' ? `pr-reviewer on ${conn.computer ?? 'this computer'}` : new URL(conn.baseUrl).host}` : ''}: one review with inline comments, plus one summary comment that is updated on later runs. Approving is never possible.`),
      h('label', { class: 'field', for: 'event' }, 'Review type', h('select', { id: 'event' }, h('option', { value: 'COMMENT' }, 'Comment'))),
      h('button', { class: 'btn', type: 'button', onclick: () => void doPreview() }, shown ? 'Refresh preview' : 'Preview post'),
      shown ? h('button', { class: 'btn primary full', type: 'button', id: 'post-btn', onclick: () => void doPost() }, `Post ${shown.view.inline.length} inline comment(s) and the summary`) : '',
      h('p', { class: 'muted' }, `${sel.size} of ${live.report.findings.length} findings included`),
      state.postResult ? h('div', { class: `result ${state.postResult.tone}`, id: 'post-result', tabindex: '-1' }, state.postResult.text, state.postResult.links ?? '') : '',
    ),
    shown
      ? h(
          'div',
          { class: 'card' },
          h('h2', {}, `New inline comments (${shown.view.inline.length})`),
          shown.view.inline.length ? h('ul', { class: 'plain' }, shown.view.inline.map((c) => h('li', {}, h('details', {}, h('summary', { class: 'mono' }, `${c.path}:${c.line}`), h('pre', { class: 'mono' }, strip(c.body)))))) : h('p', { class: 'muted' }, 'None.'),
          shown.view.stillOpen.length ? [h('h2', {}, `Still open from earlier reviews (${shown.view.stillOpen.length})`), h('ul', { class: 'plain' }, shown.view.stillOpen.map((x) => h('li', {}, x.title)))] : '',
          shown.view.resolved.length ? [h('h2', {}, `Resolved since the last review (${shown.view.resolved.length})`), h('ul', { class: 'plain' }, shown.view.resolved.map((x) => h('li', {}, x.title)))] : '',
          h('h2', {}, 'Summary comment'),
          h('pre', { class: 'mono summary' }, strip(shown.view.summaryBody)),
        )
      : '',
    h('dialog', { id: 'post-confirm', 'aria-labelledby': 'post-confirm-h' }),
  )
}

// ── Boot: follow the tab ───────────────────────────────────────────────────

async function activePr(): Promise<string | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const pr = prFromUrl(tab?.url, (state.conn ? state.session?.github.host : state.settings?.host) ?? 'github.com')
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
  if (pr && !state.conn && state.settings && state.stored[pr] && !state.results.has(pr) && state.online) {
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
  state.conn = await secure.get<Connection>(CONNECTION)
  const signin = state.settings ? undefined : await secure.get<{ githubToken: string; host?: string }>(GITHUB_SIGNIN)
  if (signin) state.draft = { ...signin }
  if (state.settings?.provider.type === 'ollama') await allowOllama(ollamaOrigin(state.settings.provider.baseUrl) ?? DEFAULT_OLLAMA_BASE_URL)
  if (state.conn) state.choice = state.conn.kind
  const interrupted = (await chrome.storage.session.get(RUNNING))[RUNNING] as string | { pr: string; runId: string; baseUrl: string } | undefined
  const reattach = typeof interrupted === 'object' && interrupted && state.conn?.baseUrl === interrupted.baseUrl ? interrupted : undefined
  if (interrupted && !reattach) {
    state.notice = 'The last review was stopped when the panel closed.'
    await chrome.storage.session.remove(RUNNING)
    await savePrState(typeof interrupted === 'string' ? interrupted : interrupted.pr, undefined)
  }
  state.surface = !state.consent ? 'welcome' : ready() ? 'home' : signin ? 'setup-ai' : 'setup-github'
  // Opened from the Review button on the page with "start" (Story 7.5).
  const auto = (await chrome.storage.session.get('auto-review'))['auto-review']
  await chrome.storage.session.remove('auto-review')
  if (typeof auto === 'string' && !ready()) state.pendingPr = auto
  if (state.conn) {
    // The session says who posts and which GitHub host PR links belong to.
    const conn = state.conn
    state.session = await createClient(conn, net).session().catch((e: unknown) => ((state.error = connectionProblem(conn, e)), undefined))
    if (state.session) state.login = state.session.github.login ?? ''
  }
  await follow(true)
  if (signin) testGitHubToken(signin.githubToken, net, signin.host).then((r) => ((state.login = r.ok ? r.login : undefined), r.ok ? render() : (secure.remove(GITHUB_SIGNIN), (state.draft = {}), go('setup-github')))).catch(() => undefined)
  if (state.settings && !state.conn) testGitHubToken(state.settings.githubToken, net, state.settings.host).then((r) => ((state.login = r.ok ? r.login : ''), render())).catch(() => undefined)
  if (reattach && state.conn) {
    const run: Run = { pr: reattach.pr, events: [], cancelled: false, runId: reattach.runId, abort: new AbortController() }
    state.runs.set(run.pr, run)
    render()
    const conn = state.conn
    watchRemote(conn, run, reattach.runId)
      .catch((e: unknown) => ((state.error = connectionProblem(conn, e)), savePrState(run.pr, undefined)))
      .finally(async () => {
        state.runs.delete(run.pr)
        if (!state.runs.size) await chrome.storage.session.remove(RUNNING)
        render()
      })
  }
  if (typeof auto === 'string' && ready() && state.pr?.toLowerCase() === auto.toLowerCase() && !state.stored[state.pr]) void review()
  chrome.tabs.onActivated.addListener(() => void follow())
  chrome.tabs.onUpdated.addListener((_id, change) => change.url && void follow())
  addEventListener('online', () => ((state.online = true), render(), announce('Back online.')))
  addEventListener('offline', () => ((state.online = false), render(), announce('You are offline.', true)))
}

void boot()
