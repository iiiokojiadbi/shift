import type { EngineInterface } from 'claude-code'
import { atom, read, update } from 'claude-code'
import type { GaugeKeeper } from './core/index'
import { contentChars, countGrowth as countChars, FRESH_GAUGE, gaugeStatus, growthOf, shiftBase } from './core/index'
import { projectOf } from './disk'

// The engine lists a module's state from atoms declared in the same file, so each file declares the ones it touches.
const gauge = atom({ plugin: 'shift', key: 'gauge' } as const, FRESH_GAUGE)
const threshold = atom({ plugin: 'shift', key: 'threshold' } as const, null)

// The harness's own threshold, read once per process at the first reading: the breakdown that names it is an estimate
// over everything, so not every time. Read only sometimes — once the window was half full, or when asked — it left a
// restarted process stepping by the window where the hint before it had stepped by the threshold, and the hint came twice.
async function compactLimit($: EngineInterface, window: number): Promise<number> {
  const known: number | null = await read($, threshold)
  if (known !== null) return known
  const { breakdown } = (await $.session.usage({ breakdown: 'summary' })).context
  const limit = breakdown?.autoCompactThreshold ?? window
  await update($, threshold, () => limit)

  return limit
}

// What a row added to the stretch's history, by where it came from.
export async function countGrowth($: EngineInterface, source: string, content: unknown): Promise<void> {
  await countChars(keeperOf($), source, contentChars(content))
}

export function statusText($: EngineInterface): Promise<string> {
  return gaugeStatus(keeperOf($))
}

// The gauge in the plugin's state; the history and the base read from the session.
export function keeperOf($: EngineInterface): GaugeKeeper {
  return {
    read: () => read($, gauge),
    update: async change => {
      await update($, gauge, change)
    },
    history: async () => growthOf(await $.session.messages({ as: 'api' })),
    base: async () => shiftBase(await projectOf($), await $.session.id()),
    reading: async () => {
      const { tokens, window } = (await $.session.usage()).context

      return { tokens, window, threshold: tokens === undefined ? undefined : await compactLimit($, window) }
    },
  }
}
