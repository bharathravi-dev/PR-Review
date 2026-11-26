import { describe, expect, it } from 'vitest'

type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (f: string): Promise<Any> => import(new URL(`../static/v2/${f}`, import.meta.url).href)
const keys = await load('keys.js')
const model = await load('model.js')

const ev = (key: string, o: Record<string, unknown> = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, isComposing: false, timeStamp: 1000, target: { tagName: 'DIV', getAttribute: () => null }, ...o })

describe('v2 keyboard model', () => {
  it('runs page-wide keys anywhere, finding keys only in the list or detail, chords within a moment', () => {
    const km = keys.createKeymap()
    expect(km.handle(ev('k', { metaKey: true }))).toBe('palette')
    expect(km.handle(ev('k', { ctrlKey: true }))).toBe('palette')
    expect(km.handle(ev('?', { shiftKey: true }))).toBe('help')
    expect(km.handle(ev('j'))).toBeNull()
    expect(km.handle(ev('j'), { inFindings: true })).toBe('next')
    expect(km.handle(ev('p'))).toBe('post')
    expect(km.handle(ev('g', { timeStamp: 10 }))).toBeNull()
    expect(km.handle(ev('a', { timeStamp: 500 }))).toBe('goAttention')
    expect(km.handle(ev('g', { timeStamp: 10 }))).toBeNull()
    expect(km.handle(ev('a', { timeStamp: 5000 }))).toBeNull()
  })

  it('never fires while typing, composing, with other modifiers, or with a dialog open', () => {
    const km = keys.createKeymap()
    for (const target of [{ tagName: 'INPUT' }, { tagName: 'SELECT' }, { tagName: 'TEXTAREA' }, { tagName: 'DIV', isContentEditable: true }, { tagName: 'DIV', getAttribute: (n: string) => (n === 'role' ? 'combobox' : null) }]) {
      expect(km.handle(ev('p', { target }))).toBeNull()
    }
    expect(km.handle(ev('p', { isComposing: true }))).toBeNull()
    expect(km.handle(ev('p', { altKey: true }))).toBeNull()
    expect(km.handle(ev('P', { shiftKey: true }))).toBeNull()
    expect(km.handle(ev('p'), { dialogOpen: true })).toBeNull()
    expect(km.handle(ev('k', { metaKey: true }), { dialogOpen: true })).toBeNull()
  })

  it('honours the Off and focus-only modes and validates remapping', () => {
    expect(keys.createKeymap(keys.DEFAULT_BINDINGS, 'off').handle(ev('p'))).toBeNull()
    expect(keys.createKeymap(keys.DEFAULT_BINDINGS, 'off').handle(ev('k', { metaKey: true }))).toBe('palette')
    const focus = keys.createKeymap(keys.DEFAULT_BINDINGS, 'focus')
    expect(focus.handle(ev('p'))).toBeNull()
    expect(focus.handle(ev('p'), { inFindings: true })).toBe('post')
    expect(keys.bindingProblems(keys.DEFAULT_BINDINGS)).toEqual([])
    expect(keys.bindingProblems({ ...keys.DEFAULT_BINDINGS, edit: 'x' })).toEqual(['edit and toggle both use "x"'])
    expect(keys.bindingProblems({ ...keys.DEFAULT_BINDINGS, edit: 'g' })[0]).toContain('starts a two-key shortcut')
  })
})

const finding = (o: Record<string, unknown>) => ({ fingerprint: 'f', severity: 'MINOR', confidence: 'HIGH', scope: 'NEW', title: 'T', description: 'D', location: { anchorKind: 'LINE', path: 'src/a.ts', startLine: 2, endLine: 3 }, ...o })
const report = (o: Record<string, unknown> = {}) => ({
  run: { repo: { fullName: 'octo/app' }, pr: 9 },
  overallStatus: 'PASSED_WITH_WARNINGS',
  gate: { failedRules: [] },
  layers: [
    { layer: 'CONTEXT', validator: 'github.context', status: 'PASSED', durationMs: 1200 },
    { layer: 'LINT', validator: 'lint.tslint', status: 'WARNING', detail: '20 problems', durationMs: 38000 },
    { layer: 'COMPILE', validator: 'ts.tsc', status: 'NOT_APPLICABLE' },
    { layer: 'AI_REVIEW', validator: 'ai.review', status: 'ERROR', reason: 'PROVIDER_RATE_LIMITED' },
  ],
  findings: [finding({ fingerprint: 'a' }), finding({ fingerprint: 'b', severity: 'MAJOR', confidence: 'LOW' }), finding({ fingerprint: 'p', scope: 'PRE_EXISTING' })],
  ai: { attempts: [{ outcome: 'SUCCEEDED', model: 'claude-opus-5-5', usage: { input: 8508, output: 1685 } }] },
  ...o,
})

describe('v2 view models', () => {
  it('builds the verdict, tiles and timeline from a Report', () => {
    const r = report()
    expect(model.verdictSentence(r)).toBe('2 new findings to look at; nothing blocks merging.')
    expect(model.verdictSentence(report({ walkthrough: { summary: 'Adds retries.' } }))).toBe('Adds retries.')
    expect(model.tiles(r).map((t: Any) => [t.id, t.value])).toEqual([['attention', '2'], ['pre', '1'], ['checks', '1 / 3'], ['walkthrough', '10.2k']])
    expect(model.timeline(r.layers).map((t: Any) => [t.name, t.word])).toEqual([['context', 'Done'], ['lint', 'Done with warnings'], ['ai review', 'Failed']])
    expect(model.timeline(r.layers)[2].detail).toBe('provider rate limited')
  })

  it('leaves low-confidence and pre-existing findings out of the default post, and filters', () => {
    expect([...model.defaultSelectionV2(report().findings)]).toEqual(['a'])
    const fs = report().findings
    expect(model.filterFindings(fs, { severity: new Set(['MAJOR']) }).map((f: Any) => f.fingerprint)).toEqual(['b'])
    expect(model.filterFindings(fs, { confidence: new Set(['HIGH']), file: 'src/a.ts' }).map((f: Any) => f.fingerprint)).toEqual(['a', 'p'])
  })

  it('shows "since last review" only after an earlier review, and builds agent prompts', () => {
    expect(model.sinceStrip({ resolved: [], stillOpen: [] }, report())).toBeUndefined()
    expect(model.sinceStrip({ resolved: [{}], stillOpen: [{}] }, report())).toEqual({ resolved: 1, stillOpen: 1, fresh: 1 })
    expect(model.agentPrompt(finding({}))).toBe('In src/a.ts at line 2-3: T. D. Make the smallest change that fixes this, and keep the existing behaviour otherwise.')
    expect(model.agentPrompt(finding({}), { title: 'Better' })).toContain('In src/a.ts at line 2-3: Better. D.')
    expect(model.combinedPrompt('octo/app#9', [finding({})])).toContain('1. In src/a.ts')
    expect(model.fixCommand(report())).toBe('pr-reviewer fix octo/app#9')
    expect(model.liveTimeline([{ type: 'STAGE_STARTED', payload: { stage: 'review', provider: 'anthropic' } }]).at(-1)).toMatchObject({ word: 'Running', name: 'AI review' })
  })
})
