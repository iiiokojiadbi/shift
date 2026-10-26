import { expect, test } from 'bun:test'
import { countGrowth, FRESH_GAUGE, type GaugeKeeper, gaugeStatus, lastStep, letGoGauge, takeHint } from '../src/hint'
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
  expect(await gaugeStatus(port)).toContain('Since the last shift: +110K.')
  expect(kept.restores).toBe(1)
})

test('a restart does not repeat a hint already given; the next step still hints', async () => {
  const limits = { window: 1_000_000, threshold: 1_000_000 }
  const soft = keeper({ tokens: 640_000, ...limits }, {}, 20_000)
  soft.kept.gauge = FRESH_GAUGE
  expect(await takeHint(soft.port)).toBeNull()
  expect(soft.kept.gauge?.hinted).toBe(420_000)
  const later = keeper({ tokens: 830_000, ...limits }, {}, 20_000)
  later.kept.gauge = await soft.port.read()
  expect(await takeHint(later.port)).toContain('830K of 1000K used')

  const final = keeper({ tokens: 830_000, ...limits }, {}, 20_000)
  final.kept.gauge = FRESH_GAUGE
  expect(await takeHint(final.port)).toBeNull()
  expect(final.kept.gauge?.hinted).toBe(830_000)
})

test('a restart before the first step leaves no hint behind it', () => {
  const reading = { tokens: 90_000, window: 200_000, threshold: undefined }
  expect(lastStep(20_000, reading)).toBeNull()
  expect(lastStep(null, reading)).toBeNull()
  expect(lastStep(20_000, { ...reading, tokens: undefined })).toBeNull()
})

test('after a let-go the count is whole from its start; one the agent did not ask for is told at its next look', async () => {
  const { port, kept } = keeper({ tokens: 20_000, window: 200_000, threshold: undefined })
  kept.gauge = letGoGauge(true)
  expect(await takeHint(port)).toContain('let the history go by itself')
  expect(kept.gauge).toMatchObject({ base: 20_000, unassisted: false })
  expect(await takeHint(port)).toBeNull()
  expect(kept.restores).toBe(0)
})

test('a fresh process restores only once a reading is there; the hint given before is not repeated then', async () => {
  const blind = keeper({ tokens: undefined, window: 1_000_000, threshold: undefined }, {}, 20_000)
  blind.kept.gauge = FRESH_GAUGE
  await countGrowth(blind.port, 'Bash', 50)
  expect(blind.kept.gauge?.whole).toBe(false)
  const seen = keeper({ tokens: 820_000, window: 1_000_000, threshold: undefined }, {}, 20_000)
  seen.kept.gauge = blind.kept.gauge
  expect(await takeHint(seen.port)).toBeNull()
  expect(seen.kept.gauge).toMatchObject({ base: 20_000, hinted: 820_000, whole: true })
})

test('the status names no soft hint the rule would hold back', async () => {
  const { port, kept } = keeper({ tokens: 700_000, window: 1_000_000, threshold: undefined })
  kept.gauge = { ...FRESH_GAUGE, base: 20_000, whole: true }
  expect(await gaugeStatus(port)).toContain('Hints: no soft hint before the final; final at 800K.')
})
