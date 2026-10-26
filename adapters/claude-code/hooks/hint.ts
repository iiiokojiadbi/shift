import type { EngineInterface } from 'claude-code'
import { atom, read, update } from 'claude-code'
import type { GaugeKeeper } from './core/index'
import { contentChars, countGrowth as countChars, FRESH_GAUGE, gaugeStatus, growthOf, shiftBase } from './core/index'
import { projectOf } from './disk'

// The engine lists a module's state from atoms declared in the same file, so each file declares the ones it touches.
const gauge = atom({ plugin: 'shift', key: 'gauge' } as const, FRESH_GAUGE)
const limit = atom({ plugin: 'shift', key: 'limit' } as const, null)

// The harness's own threshold, read once per window at the first reading: the breakdown that names it is an estimate
// over everything, so not every time. Read only sometimes — once the window was half full, or when asked — it left a
// restarted process stepping by the window where the hint before it had stepped by the threshold, and the hint came twice.
// A model of another window is read anew; with the harness's own let-go off there is none, and the window stands for it.
async function compactLimit($: EngineInterface, window: number): Promise<number | undefined> {
  const known: { window: number; limit: number | null } | null = await read($, limit)
  if (known !== null && known.window === window) return known.limit ?? undefined
  const { breakdown } = (await $.session.usage({ breakdown: 'summary' })).context
  const found = breakdown === undefined ? window : breakdown.isAutoCompactEnabled ? (breakdown.autoCompactThreshold ?? window) : null
  await update($, limit, () => ({ window, limit: found }))

  return found ?? undefined
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
