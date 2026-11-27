import { describe, expect, it } from 'vitest'
import { createTerminalProgress, renderPostRunBanner } from './terminal-ui.js'

describe('terminal UI progress and post-run menu', () => {
  it('renders plain layer lines in non-TTY mode and stays quiet in silent mode', () => {
    let err = ''
    const p = createTerminalProgress({ stdout: () => undefined, stderr: (t) => (err += t) }, { isTTY: false, silent: false })
    p.onLayer({ layer: 'SYNTAX', validator: 'syntax.local', status: 'PASSED', durationMs: 1 })
    p.stop()
    expect(err).toContain('PASSED')
    expect(err).toContain('SYNTAX (syntax.local)')

    let silentErr = ''
    const quiet = createTerminalProgress({ stdout: () => undefined, stderr: (t) => (silentErr += t) }, { isTTY: false, silent: true })
    quiet.onLayer({ layer: 'SYNTAX', validator: 'syntax.local', status: 'PASSED', durationMs: 1 })
    quiet.stop()
    expect(silentErr).toBe('')
  })

  it('renders animated TTY stage updates, RAG context, and stops cleanly', () => {
    let err = ''
    const p = createTerminalProgress({ stdout: () => undefined, stderr: (t) => (err += t) }, { isTTY: true, silent: false })
    p.start()
    p.onEvent({
      schemaVersion: 1,
      runId: 'r1',
      seq: 1,
      at: '2026-01-01T00:00:00Z',
      type: 'STAGE_STARTED',
      payload: {
        stage: 'review',
        provider: 'claude-code',
        model: 'opus',
        effort: 'standard',
        rag: { stacks: ['Java'], relatedFiles: 3, guidanceFiles: ['CLAUDE.md'], deterministicFindings: 2 },
      },
    })
    p.onEvent({ schemaVersion: 1, runId: 'r1', seq: 2, at: '2026-01-01T00:00:01Z', type: 'STAGE_PROGRESS', payload: { stage: 'review', part: 1, parts: 2 } })
    p.onEvent({ schemaVersion: 1, runId: 'r1', seq: 3, at: '2026-01-01T00:00:02Z', type: 'STAGE_FINISHED', payload: { stage: 'review', provider: 'claude-code', model: 'opus', status: 'PASSED' } })
    p.stop()
    expect(err).toContain('AI RAG context: standards [Java] · 3 caller/test file(s) · guidance (CLAUDE.md) · 2 tool finding(s)')
    expect(err).toContain('[5/7] Running AI review (claude-code · opus · standard · part 1/2)')
    expect(err).toContain('AI review finished')
  })

  it('prints interactive action choices including Recommended Fix Bundle', () => {
    let err = ''
    renderPostRunBanner({ stdout: () => undefined, stderr: (t) => (err += t) }, { actionableFixCount: 4, codeFixCount: 2, canPost: true, canOpenBrowser: true })
    expect(err).toContain('Recommended Fix Bundle: 4 actionable finding(s) (2 with direct code suggestions)')
    expect(err).toContain('[p] Post review to GitHub')
    expect(err).toContain('[v] Step through findings')
    expect(err).toContain('[f] View / save Recommended Fix Bundle')
    expect(err).toContain('[o] Open interactive review page')
  })
})
