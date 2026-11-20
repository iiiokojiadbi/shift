import { BOARD, TASK_LIST, TASKS, TOOL } from './layout'
import { formatK } from './markdown'
import type { Gauge, HintTargets, Reading } from './types'

// A stretch needs enough new work to justify the cost of a voluntary shift.
function nextSoft(base: number, tokens: number, limit: number, targets: HintTargets): number | null {
  if (targets.soft === null) return null
  const at = Math.max(tokens, targets.soft, base + 200_000)
  return at + Math.round(limit * 0.1) <= targets.final ? at : null
}

export function finalAt(limit: number): number {
  return Math.round(limit * 0.84)
}

function hintTargets(limit: number, overrides?: HintTargets): HintTargets {
  return overrides ?? { soft: Math.round(limit * 0.6), final: finalAt(limit) }
}

// Give a new stretch some room even when the previous shift left a full history.
function firstFinal(base: number, limit: number, final: number): number {
  if (base < final) return final
  const growth = Math.min(limit * 0.05, (limit - base) / 2)
  return base + Math.max(1, Math.round(growth))
}

export const FRESH_GAUGE: Gauge = { base: null, hinted: null, unassisted: false, growth: {}, whole: false }

// Where a row of the history came from, as hints name it.
export const SOURCES = {
  responses: 'your responses',
  owner: "the owner's messages",
  attachments: 'attachments and reminders',
  tools: 'tool results',
} as const

// A history smaller than the base or the last hint was let go by a way the mod did not see (a cleared session, a
// compaction it was not told of): counting from the old base would put the next hint far off, so it starts again here.
function rebased(gauge: Gauge, tokens: number): Gauge {
  return gauge.base !== null && tokens < (gauge.hinted ?? gauge.base) ? { ...gauge, base: tokens, hinted: null, growth: {} } : gauge
}

// A reading that crosses both milestones gives only the final hint.
export function shiftHint(
  current: Gauge,
  { tokens, window, threshold, hintTargets: overrides }: Reading,
): { gauge: Gauge; text: string | null } {
  if (tokens === undefined) return { gauge: current, text: null }
  const gauge = rebased(current, tokens)
  if (gauge.base === null) return { gauge: { ...gauge, base: tokens, unassisted: false }, text: gauge.unassisted ? UNASSISTED_HINT : null }

  const limit = threshold ?? window
  const targets = hintTargets(limit, overrides)
  const hinted = { ...gauge, hinted: tokens }
  if (tokens >= firstFinal(gauge.base, limit, targets.final) && (gauge.hinted === null || gauge.hinted < targets.final))
    return { gauge: hinted, text: finalHint(tokens, limit, gauge.growth) }

  if (gauge.hinted === null && nextSoft(gauge.base, tokens, limit, targets) === tokens)
    return { gauge: hinted, text: softHint(tokens - gauge.base, gauge.growth) }

  return { gauge, text: null }
}

function softHint(grown: number, growth: Record<string, number>): string {
  return `Shift hint: the history has grown by ${formatK(grown)} since the last shift.${sources(growth)} This is not an alarm — running out of room gets a hint of its own. If you are at a stage boundary and the stretch's history is not needed whole any more, shift; otherwise keep working.`
}

function finalHint(tokens: number, limit: number, growth: Record<string, number>): string {
  return `Shift hint: ${formatK(tokens)} of ${formatK(limit)} used — close to the point where the harness lets the history go by itself, without your letter.${sources(growth)} Shift now. Check the records, write your letter and call \`${TOOL}\`.`
}

// Token counts per row are not known, so the growth is counted in characters and named by shares.
export function addGrowth(gauge: Gauge, source: string, chars: number): Gauge {
  if (chars <= 0) return gauge
  return { ...gauge, growth: { ...gauge.growth, [source]: (gauge.growth[source] ?? 0) + chars } }
}

// The sources of at least 5% of the growth, largest first, three at most.
export function growthShares(growth: Record<string, number>): { source: string; share: number }[] {
  const total = Object.values(growth).reduce((sum, chars) => sum + chars, 0)
  if (total === 0) return []
  return Object.entries(growth)
    .map(([source, chars]) => ({ source, share: Math.round((chars / total) * 100) }))
    .filter(each => each.share >= 5)
    .sort((a, b) => b.share - a.share)
    .slice(0, 3)
}

function sources(growth: Record<string, number>): string {
  const shares = growthShares(growth)
  return shares.length === 0 ? '' : ` Mostly from: ${shares.map(each => `${each.source} ${each.share}%`).join(', ')}.`
}

// Characters of a row's content, whatever its blocks: text, tool calls and their results, thinking; an image counts as a fixed size.
export function contentChars(content: unknown): number {
  if (typeof content === 'string') return content.length
  if (Array.isArray(content)) return content.reduce((sum: number, block) => sum + contentChars(block), 0)
  if (typeof content !== 'object' || content === null) return 0
  const block = content as Record<string, unknown>
  if (block.type === 'image') return IMAGE_CHARS
  if (typeof block.text === 'string') return block.text.length
  if (typeof block.thinking === 'string') return block.thinking.length
  if (block.type === 'tool_use') return JSON.stringify(block.input ?? {}).length
  if (block.type === 'toolCall') return JSON.stringify(block.arguments ?? {}).length
  if (block.type === 'tool_result') return contentChars(block.content)
  return 0
}

const IMAGE_CHARS = 6000

// The growth of a history already there, counted the way rows are counted as they come: a tool result by the tool's name.
export function growthOf(messages: readonly { role: string; content: unknown }[]): Record<string, number> {
  const tools = new Map<string, string>()
  let gauge: Gauge = FRESH_GAUGE
  for (const message of messages) {
    const blocks = Array.isArray(message.content)
      ? (message.content as Record<string, unknown>[])
      : [{ type: 'text', text: message.content }]
    if (message.role === 'assistant') {
      for (const block of blocks) if (block.type === 'tool_use') tools.set(String(block.id), String(block.name))
      gauge = addGrowth(gauge, SOURCES.responses, contentChars(blocks))
      continue
    }
    for (const block of blocks) {
      const source =
        block.type === 'tool_result'
          ? (tools.get(String(block.tool_use_id)) ?? SOURCES.tools)
          : typeof block.text === 'string' && block.text.trimStart().startsWith('<system-reminder>')
            ? SOURCES.attachments
            : SOURCES.owner
      gauge = addGrowth(gauge, source, contentChars(block))
    }
  }

  return gauge.growth
}

// What the status tool answers: the fill, the limit, the growth since the last shift, when the next hints come, and what grew.
export function renderStatus(current: Gauge, { tokens, window, threshold, hintTargets: overrides }: Reading): string {
  if (tokens === undefined) return 'No reading yet: the first response since the last let-go has not come back.'
  const gauge = rebased(current, tokens)
  const limit = threshold ?? window
  const targets = hintTargets(limit, overrides)
  const base = gauge.base ?? tokens
  const final = firstFinal(base, limit, targets.final)
  const lines = [
    `Used: ${formatK(tokens)} of ${formatK(window)} window; ${threshold === undefined ? 'the automatic threshold is unknown' : `the harness lets the history go by itself at ${formatK(threshold)}`}.`,
  ]
  if (gauge.base !== null) lines.push(`Since the last shift: +${formatK(Math.max(0, tokens - gauge.base))}.`)
  if (tokens >= final) lines.push(`Past the final hint at ${formatK(final)}: shift now.`)
  else {
    const soft = gauge.hinted === null ? nextSoft(base, tokens, limit, targets) : null
    const next = soft === null ? 'no soft hint before the final' : `next soft hint at ${formatK(soft)}`
    lines.push(`Hints: ${next}; final at ${formatK(final)}.`)
  }
  const shares = growthShares(gauge.growth)
  if (shares.length > 0) lines.push(`Grown mostly from: ${shares.map(each => `${each.source} ${each.share}%`).join(', ')}.`)

  return lines.join('\n')
}

export const UNASSISTED_HINT = `The harness let the history go by itself, without your shift: there is no letter, only its digest is in memory. Before going on, read the board \`${BOARD}\`, \`${TASK_LIST}\` and the tasks in progress in \`${TASKS}/\`, and check where you stand against them.`

// The gauge as an adapter keeps it, and what only the harness knows; how it is kept is the core's. A fresh process
// (a restart, a reload, a resumed session) starts with none of the stretch counted and restores it once.
export type GaugeKeeper = {
  // The gauge as kept; null or a gauge of an older version of the mod is completed with the fields added since.
  read(): Promise<Gauge | null>
  // A change applied to the gauge as it is then: a harness that serializes state changes applies it atomically.
  update(change: (current: Gauge) => Gauge): Promise<void>
  // The growth of the history as it is now, per source: what a fresh process counts from.
  history(): Promise<Record<string, number>>
  // The fill the stretch started from, if the last shift was this session's.
  base(): Promise<number | null>
  // How full the history is.
  reading(): Promise<Reading>
}

// A gauge after any let-go of the main history: a new stretch, whole from its start; one the agent did not ask for
// is told to it at its next look.
export function letGoGauge(unassisted: boolean): Gauge {
  return { ...FRESH_GAUGE, unassisted, whole: true }
}

// A hint for the agent if the fill since the last shift calls for one, given in the same change that finds it: tools
// ending together never both carry it.
export async function takeHint(keeper: GaugeKeeper): Promise<string | null> {
  await restore(keeper)
  const reading = await keeper.reading()
  let text: string | null = null
  await keeper.update(current => {
    const hint = shiftHint(complete(current), reading)
    text = hint.text

    return hint.gauge
  })

  return text
}

// A hint offered with the next prompt, which may not go: the gauge keeps everything else at once and marks the hint
// given only at `take`, so a hint whose prompt failed comes again with the next one. One prompt at a time asks.
export async function offerHint(keeper: GaugeKeeper): Promise<{ text: string; take(): Promise<void> } | null> {
  await restore(keeper)
  const reading = await keeper.reading()
  const offered: { gauge?: Gauge; text?: string; seen?: Gauge } = {}
  await keeper.update(current => {
    // A harness may run the change again on a newer gauge: only the last run's hint is offered.
    delete offered.gauge
    delete offered.text
    delete offered.seen
    const now = complete(current)
    const hint = shiftHint(now, reading)
    if (hint.text === null) return hint.gauge
    offered.gauge = hint.gauge
    offered.text = hint.text
    offered.seen = now

    return now
  })
  const { gauge: given, text, seen } = offered
  if (given === undefined || text === undefined || seen === undefined) return null

  return {
    text,
    // Never over a newer count: a tool's hint given meanwhile, or a stretch begun since, stands.
    take: () =>
      keeper.update(current =>
        !sameStretch(seen, current)
          ? current
          : {
              ...current,
              base: current.base ?? given.base,
              hinted: current.hinted !== null && current.hinted >= (given.hinted ?? 0) ? current.hinted : given.hinted,
              unassisted: current.unassisted && given.unassisted,
            },
      ),
  }
}

// What a row added to the stretch's history, by where it came from.
export async function countGrowth(keeper: GaugeKeeper, source: string, chars: number): Promise<void> {
  await restore(keeper)
  await keeper.update(current => addGrowth(complete(current), source, chars))
}

// What shift_status answers.
export async function gaugeStatus(keeper: GaugeKeeper): Promise<string> {
  await restore(keeper)
  const reading = await keeper.reading()

  return renderStatus(complete(await keeper.read()), reading)
}

// Whether `later` is still the stretch `earlier` was: a let-go since starts the count anew — its own base, no hint
// given, the agent told if the harness let go by itself.
function sameStretch(earlier: Gauge, later: Gauge): boolean {
  return (
    later.base === earlier.base &&
    (later.hinted ?? 0) >= (earlier.hinted ?? 0) &&
    (later.unassisted === earlier.unassisted || !later.unassisted)
  )
}

function complete(current: Gauge | null): Gauge {
  return { ...FRESH_GAUGE, ...current }
}

// The base from the last shift of this session, the growth from the history plus whatever this process counted before
// the restore finished, and the last hint as given before. Once; a let-go marks the count whole itself.
// Not before the first reading: the last hint is placed by the fill, and one placed at none would come again.
async function restore(keeper: GaugeKeeper): Promise<void> {
  if (complete(await keeper.read()).whole) return
  const reading = await keeper.reading()
  if (reading.tokens === undefined) return
  const base = await keeper.base()
  const growth = await keeper.history()
  await keeper.update(current => {
    const now = complete(current)
    if (now.whole) return now
    const merged = Object.entries(now.growth).reduce((sum, [source, chars]) => addGrowth(sum, source, chars), { ...now, growth })
    const from = now.base ?? base

    return { ...merged, base: from, hinted: now.hinted ?? lastStep(from, reading), whole: true }
  })
}

// On restore, infer the milestones already passed in this stretch.
export function lastStep(base: number | null, { tokens, window, threshold, hintTargets: overrides }: Reading): number | null {
  if (base === null || tokens === undefined || tokens < base) return null
  const limit = threshold ?? window
  const targets = hintTargets(limit, overrides)
  if (tokens >= firstFinal(base, limit, targets.final)) return tokens
  const soft = nextSoft(base, base, limit, targets)
  return soft !== null && tokens >= soft ? soft : null
}
