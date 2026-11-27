// Live terminal spinner, stage/RAG procedure visibility, and interactive post-review actions (TTY only).
import type { EventSink, LayerResult, RunEvent } from '@pr-reviewer/core'
import type { CliIo } from './deps.js'

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

const STAGE_LABEL: Record<string, string> = {
  fetchContext: '[1/7] Fetching PR metadata, diffs, and CI results',
  detect: '[2/7] Detecting project languages, frameworks, and rules',
  validate: '[3/7] Running sandbox & local validators (syntax, standards, security, CVEs)',
  execute: '[4/7] Scanning secrets & loading RAG context (callers, tests, standards)',
  review: '[5/7] Running AI review',
  dedupe: '[6/7] Grounding, deduplicating, and applying feedback',
  gate: '[7/7] Evaluating gate & building report',
}

export interface TerminalProgress {
  start: () => void
  onEvent: EventSink
  onLayer: (layer: LayerResult) => void
  pause: () => void
  resume: () => void
  stop: () => void
}

export function createTerminalProgress(io: CliIo, opts: { isTTY: boolean; silent: boolean }): TerminalProgress {
  if (!opts.isTTY || opts.silent) {
    return {
      start: () => undefined,
      onEvent: () => undefined,
      onLayer: opts.silent ? () => undefined : (l) => io.stderr(`  ${l.status.padEnd(14)} ${l.layer} (${l.validator})${l.reason ? ` ${l.reason}` : ''}\n`),
      pause: () => undefined,
      resume: () => undefined,
      stop: () => undefined,
    }
  }

  let frame = 0
  let paused = false
  let stopped = false
  let started = false
  let stage = 'init'
  let aiContextLabel = ''
  let detail = 'Preparing review…'
  let stageStart = Date.now()
  let timer: ReturnType<typeof setInterval> | undefined

  const clearLine = () => io.stderr('\r\x1b[2K')
  const draw = () => {
    if (!started || paused || stopped) return
    const sec = Math.max(0, Math.floor((Date.now() - stageStart) / 1000))
    const spin = FRAMES[frame++ % FRAMES.length]!
    const timeTag = sec >= 2 ? ` (${sec}s)` : ''
    io.stderr(`\r\x1b[2K${spin} ${detail}${timeTag}`)
  }

  const startTimer = () => {
    if (stopped) return
    started = true
    if (timer) return
    timer = setInterval(draw, 80)
    timer.unref?.()
    draw()
  }

  const stopTimer = () => {
    if (timer) {
      clearInterval(timer)
      timer = undefined
    }
    clearLine()
  }

  const statusColor = (status: LayerResult['status']): string => {
    if (status === 'PASSED') return `\x1b[32m${status.padEnd(14)}\x1b[0m`
    if (status === 'WARNING') return `\x1b[33m${status.padEnd(14)}\x1b[0m`
    if (status === 'FAILED' || status === 'ERROR' || status === 'TIMEOUT') return `\x1b[31m${status.padEnd(14)}\x1b[0m`
    return `\x1b[2m${status.padEnd(14)}\x1b[0m`
  }

  return {
    start: startTimer,
    onEvent(event: RunEvent) {
      if (stopped) return
      if (!started) startTimer()
      if (event.type === 'STAGE_STARTED') {
        stage = String(event.payload.stage ?? stage)
        stageStart = Date.now()
        if (stage === 'review') {
          const provider = String(event.payload.provider ?? 'ai')
          const model = event.payload.model ? ` · ${String(event.payload.model)}` : ''
          const effort = event.payload.effort ? ` · ${String(event.payload.effort)}` : ''
          aiContextLabel = `${provider}${model}${effort}`
          detail = `${STAGE_LABEL.review} (${aiContextLabel})`
          const rag = event.payload.rag as { stacks?: string[]; relatedFiles?: number; guidanceFiles?: string[]; learnings?: number; deterministicFindings?: number } | undefined
          if (rag) {
            clearLine()
            const parts = [
              rag.stacks?.length ? `standards [${rag.stacks.join(', ')}]` : '',
              rag.relatedFiles ? `${rag.relatedFiles} caller/test file(s)` : '',
              rag.guidanceFiles?.length ? `guidance (${rag.guidanceFiles.join(', ')})` : '',
              rag.learnings ? `${rag.learnings} learning(s)` : '',
              rag.deterministicFindings ? `${rag.deterministicFindings} tool finding(s)` : '',
            ].filter(Boolean)
            if (parts.length) io.stderr(`  → AI RAG context: ${parts.join(' · ')}\n`)
          }
        } else {
          detail = STAGE_LABEL[stage] ?? stage
        }
        draw()
      } else if (event.type === 'STAGE_PROGRESS' && event.payload.stage === 'review') {
        const part = event.payload.part
        const parts = event.payload.parts
        if (part && parts) {
          detail = `${STAGE_LABEL.review} (${aiContextLabel ? `${aiContextLabel} · ` : ''}part ${String(part)}/${String(parts)})`
        }
        draw()
      } else if (event.type === 'STAGE_FINISHED') {
        const st = String(event.payload.stage ?? '')
        clearLine()
        if (st === 'detect' && Array.isArray(event.payload.projects)) {
          const projs = (event.payload.projects as Array<{ path: string; language: string; frameworks?: string[] }>).map((p) => {
            const fw = p.frameworks?.length ? ` (${p.frameworks.join(', ')})` : ''
            return `${p.path}: ${p.language}${fw}`
          })
          if (projs.length) io.stderr(`  ✓ Detected: ${projs.join(' · ')}\n`)
        } else if (st === 'validate') {
          const mode = event.payload.hostFallback ? 'local host tools (user approved) + local checks' : event.payload.sandbox ? 'Docker/sandbox + local checks' : 'local checks'
          io.stderr(`  ✓ Validation (${mode}): ${String(event.payload.findings ?? 0)} finding(s)\n`)
        } else if (st === 'execute') {
          const stacks = Array.isArray(event.payload.stacks) ? (event.payload.stacks as string[]) : []
          const rel = Number(event.payload.relatedFiles ?? 0)
          io.stderr(`  ✓ Secrets scanned · RAG prepared (${rel} related file(s)${stacks.length ? `, stacks: ${stacks.join(', ')}` : ''})\n`)
        } else if (st === 'review') {
          const p = event.payload.provider ? `${String(event.payload.provider)}${event.payload.model ? ` ${String(event.payload.model)}` : ''}` : 'AI'
          io.stderr(`  ✓ AI review finished (${p}: ${String(event.payload.status ?? 'done')})\n`)
        }
        draw()
      } else if (event.type === 'DONE') {
        stopTimer()
      }
    },
    onLayer(l: LayerResult) {
      clearLine()
      io.stderr(`  ${statusColor(l.status)} ${l.layer} (${l.validator})${l.reason ? ` ${l.reason}` : ''}\n`)
      draw()
    },
    pause() {
      paused = true
      clearLine()
    },
    resume() {
      paused = false
      draw()
    },
    stop() {
      stopped = true
      stopTimer()
    },
  }
}

export function renderPostRunBanner(
  io: CliIo,
  opts: { actionableFixCount: number; codeFixCount: number; canPost: boolean; canOpenBrowser: boolean },
): void {
  io.stderr('\n──── What next? ────\n')
  if (opts.actionableFixCount > 0) {
    io.stderr(`  Recommended Fix Bundle: ${opts.actionableFixCount} actionable finding(s) (${opts.codeFixCount} with direct code suggestions)\n`)
  }
  if (opts.canPost) {
    io.stderr('  [p] Post review to GitHub (shows preview first)\n')
    io.stderr('  [v] Step through findings & pick which to post\n')
  }
  io.stderr('  [f] View / save Recommended Fix Bundle\n')
  if (opts.canOpenBrowser) io.stderr('  [o] Open interactive review page in browser\n')
  io.stderr('  [q] Done (exit)\n')
}
