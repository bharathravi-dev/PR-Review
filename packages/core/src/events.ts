import * as z from 'zod'

/** Progress event types (AD-16). Every progress UI renders from these, never from engine internals. */
export const RunEventType = z.enum(['STAGE_STARTED', 'STAGE_FINISHED', 'LAYER_STATUS', 'FINDING_COUNT', 'DONE'])
export type RunEventType = z.infer<typeof RunEventType>

/** Pipeline stages reported through STAGE_STARTED / STAGE_FINISHED (AD-3). */
export type RunStage = 'fetchContext' | 'execute' | 'review' | 'dedupe' | 'gate'

/** One progress event of a Review Run; `seq` is monotonic per run (AD-16), `schemaVersion` per AD-22. */
export const RunEvent = z.looseObject({
  schemaVersion: z.literal(1),
  runId: z.string(),
  seq: z.number().int(),
  at: z.string(),
  type: RunEventType,
  payload: z.record(z.string(), z.unknown()),
})
export type RunEvent = z.infer<typeof RunEvent>

/** Receives a run's events in order (the `EventSink` port of AD-25). */
export type EventSink = (event: RunEvent) => void

/** Creates an emitter that numbers events for one run. */
export function runEventEmitter(runId: string, now: () => number, sink: EventSink | undefined): (type: RunEventType, payload?: Record<string, unknown>) => void {
  let seq = 0
  return (type, payload = {}) => {
    if (!sink) return
    seq += 1
    sink({ schemaVersion: 1, runId, seq, at: new Date(now()).toISOString(), type, payload })
  }
}
