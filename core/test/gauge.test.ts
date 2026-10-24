import { expect, test } from 'bun:test'
import { countGrowth, type GaugeKeeper, gaugeStatus, letGoGauge, takeHint } from '../src/hint'
import type { Gauge, Reading } from '../src/types'

// A keeper over a variable, with a history and a base as a fresh process would find them.
function keeper(reading: Reading, history: Record<string, number> = {}, base: number | null = null) {
  const kept: { gauge: Gauge | null; restores: number } = { gauge: null, restores: 0 }
  const port: GaugeKeeper = {
    read: async () => kept.gauge,
    update: async change => {
      kept.gauge = change(kept.gauge ?? letGoGauge(false))
    },
    history: async () => {
      kept.restores++
      return history
    },
    base: async () => base,
    reading: async () => reading,
  }

  return { port, kept }
}

test('a fresh process restores once: the base of this session, the history plus what it counted meanwhile', async () => {
  const { port, kept } = keeper({ tokens: 150_000, window: 200_000, threshold: 180_000 }, { 'your responses': 400 }, 40_000)
  kept.gauge = { base: null, hinted: null, unassisted: false, growth: { Bash: 100 }, whole: false }
  await countGrowth(port, 'Bash', 50)
  expect(kept.gauge).toMatchObject({ base: 40_000, whole: true, growth: { 'your responses': 400, Bash: 150 } })
  expect(await takeHint(port)).toContain('Shift hint')
  expect(await gaugeStatus(port)).toContain('Since the last shift: +110K.')
  expect(kept.restores).toBe(1)
})

test('after a let-go the count is whole from its start; one the agent did not ask for is told at its next look', async () => {
  const { port, kept } = keeper({ tokens: 20_000, window: 200_000, threshold: undefined })
  kept.gauge = letGoGauge(true)
  expect(await takeHint(port)).toContain('let the history go by itself')
  expect(kept.gauge).toMatchObject({ base: 20_000, unassisted: false })
  expect(await takeHint(port)).toBeNull()
  expect(kept.restores).toBe(0)
})
