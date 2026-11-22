import { open } from 'node:fs/promises'
import { FRESH_GAUGE, type Gauge, letGoGauge, type Reading, renderStatus, shiftHint } from '../../core/src'
import { fields } from './protocol'

export type Sample = { gauge: Gauge; reading: Reading; offset: number }

// Token events give usable capacity. Keep reminder targets separate from the unknown automatic threshold.
function windowTargets(window: number) {
  switch (window) {
    case 258_400:
      return { soft: null, final: 205_632 }
    case 475_000:
      return { soft: 300_000, final: 410_000 }
    default:
      return undefined
  }
}

export function usageReading(previous: Reading, gauge: Gauge, tokens: number, window: number) {
  const reading: Reading = { tokens, window, threshold: undefined, hintTargets: windowTargets(window) }
  // A soft hint in a larger window must not count as the final hint in a smaller one.
  const changed = previous.window > 0 && previous.window !== window
  if (changed) return { reading, gauge: { ...gauge, hinted: null } }
  // A saved stretch with a single final hint may have claimed it at the previous release's lower target.
  const targets = reading.hintTargets
  if (targets?.soft === null && gauge.hinted !== null && gauge.hinted < targets.final && tokens >= targets.final)
    return { reading, gauge: { ...gauge, hinted: targets.final } }
  return { reading, gauge }
}

export function freshSample(): Sample {
  return { gauge: FRESH_GAUGE, reading: { tokens: undefined, window: 0, threshold: undefined }, offset: 0 }
}

export function status({ gauge, reading }: Sample, softHints = true) {
  return renderStatus(gauge, { ...reading, hintTargets: windowTargets(reading.window), softHints })
}

// Hook processes share only the latest reading and its byte offset. Long tool results are skipped by
// seeking to the tail. An incomplete last record is picked up on the next call.
export async function sample(state: Sample, transcript: string, reset: boolean, softHints = true) {
  const handle = await open(transcript, 'r').catch(() => null)
  if (!handle) return null
  let hint: string | null = null
  try {
    const { size } = await handle.stat()
    if (reset) {
      state.gauge = letGoGauge(false)
      state.offset = size
      state.reading.tokens = undefined
    }
    const start = Math.max(size < state.offset ? 0 : state.offset, size - 256 * 1024)
    const bytes = Buffer.alloc(size - start)
    if (bytes.length) {
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, start)
      const newline = bytes.subarray(0, bytesRead).lastIndexOf(10)
      if (newline < 0) return null
      for (const line of bytes.toString('utf8', 0, newline).split('\n')) {
        if (!line.includes('"token_count"')) continue
        try {
          const payload = fields(JSON.parse(line).payload)
          if (payload.type !== 'token_count') continue
          const info = fields(payload.info)
          const tokens = fields(info.last_token_usage).total_tokens
          if (typeof tokens !== 'number' || typeof info.model_context_window !== 'number' || info.model_context_window <= 0) continue
          Object.assign(state, usageReading(state.reading, state.gauge, tokens, info.model_context_window))
          const next = shiftHint(state.gauge, { ...state.reading, softHints })
          state.gauge = next.gauge
          hint = next.text ?? hint
        } catch {
          /* The first line of a bounded tail can be partial. */
        }
      }
      state.offset = start + newline + 1
    }
  } finally {
    await handle.close()
  }
  return hint
}
