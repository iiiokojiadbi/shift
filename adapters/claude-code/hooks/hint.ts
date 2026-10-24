import type { EngineInterface } from 'claude-code'
import { atom, read, update } from 'claude-code'
import type { Gauge, Reading } from './core/index'
import { addGrowth, contentChars, FRESH_GAUGE, growthOf, HINTED, renderStatus, shiftBase, shiftHint } from './core/index'
import { claudeStore } from './disk'

// The engine lists a module's state from atoms declared in the same file, so each file declares the ones it touches.
const gauge = atom({ plugin: 'infinity-shift', key: 'gauge' } as const, FRESH_GAUGE)
const pending = atom({ plugin: 'infinity-shift', key: 'pending' } as const, null)
const threshold = atom({ plugin: 'infinity-shift', key: 'threshold' } as const, null)

// The harness's own threshold, read once the window is half full or when asked: the breakdown that names it is an estimate over everything.
async function compactLimit($: EngineInterface, tokens: number, window: number, now = false): Promise<number | undefined> {
  const known: number | null = await read($, threshold)
  if (known !== null || (tokens < window / 2 && !now)) return known ?? undefined
  const { breakdown } = (await $.session.usage({ breakdown: 'summary' })).context
  const limit = breakdown?.autoCompactThreshold ?? window
  await update($, threshold, () => limit)

  return limit
}

// A hint for the agent if the fill since the last shift calls for one; none while a shift is pending.
export async function takeHint($: EngineInterface): Promise<string | null> {
  if ((await read($, pending)) !== null) return null
  await restore($)
  const reading = await takeReading($)
  let text: string | null = null
  await update($, gauge, (current: Gauge) => {
    const hint = shiftHint(complete(current), reading)
    text = hint.text

    return hint.gauge
  })
  if (text !== null) $.ui.log(HINTED(text))

  return text
}

async function takeReading($: EngineInterface, now = false): Promise<Reading> {
  const { tokens, window } = (await $.session.usage()).context

  return { tokens, window, threshold: tokens === undefined ? undefined : await compactLimit($, tokens, window, now) }
}

// What a row added to the stretch's history, by where it came from.
export async function countGrowth($: EngineInterface, source: string, content: unknown): Promise<void> {
  await restore($)
  await update($, gauge, (current: Gauge) => addGrowth(complete(current), source, contentChars(content)))
}

export async function statusText($: EngineInterface): Promise<string> {
  await restore($)
  const reading = await takeReading($, true)

  return renderStatus(complete(await read($, gauge)), reading)
}

// A gauge kept by an older version of the mod lacks the fields added since.
function complete(current: Gauge): Gauge {
  return { ...FRESH_GAUGE, ...current }
}

// A fresh process (a restart, a resumed session) starts with none of the stretch counted: the base comes back from
// the last shift of this session, the growth from the history as it is. Once; a let-go marks the count whole itself.
async function restore($: EngineInterface): Promise<void> {
  if (complete(await read($, gauge)).whole) return
  const base = await shiftBase(claudeStore($), await $.session.root(), await $.session.id())
  const growth = growthOf(await $.session.messages({ as: 'api' }))
  await update($, gauge, (current: Gauge) => {
    const now = complete(current)
    if (now.whole) return now
    const merged = Object.entries(now.growth).reduce((sum, [source, chars]) => addGrowth(sum, source, chars), { ...now, growth })

    return { ...merged, base: now.base ?? base, whole: true }
  })
}
