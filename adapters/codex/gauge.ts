import { open, readFile, rename, writeFile } from 'node:fs/promises'
import { FRESH_GAUGE, type Gauge, letGoGauge, type Reading, renderStatus, shiftHint } from '../../core/src'
import { fields } from './protocol'

type Sample = { gauge: Gauge; reading: Reading; offset: number }

async function saved(file: string): Promise<Sample> {
  return readFile(file, 'utf8').then(
    text => JSON.parse(text),
    () => ({
      gauge: FRESH_GAUGE,
      reading: { tokens: undefined, window: 0, threshold: undefined },
      offset: 0,
    }),
  )
}

export async function status(file: string) {
  const { gauge, reading } = await saved(file)
  return renderStatus(gauge, reading)
}

// Hook processes share only the latest reading and its byte offset. Long tool results are skipped by
// seeking to the tail. An incomplete last record is picked up on the next call.
export async function sample(file: string, transcript: string, reset: boolean) {
  const state = await saved(file)
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
          state.reading = { tokens, window: info.model_context_window, threshold: undefined }
          const next = shiftHint(state.gauge, state.reading)
          state.gauge = next.gauge
          hint = next.text ?? hint
        } catch {
          /* The first line of a bounded tail can be partial. */
        }
      }
      state.offset = start + newline + 1
    } else if (!reset) return null
    const temporary = `${file}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 })
    await rename(temporary, file)
  } finally {
    await handle.close()
  }
  return hint
}
