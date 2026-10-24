// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { BOARD, MOD, TASK_LIST, TASKS, TOOL } from './layout'
import { formatK, frontmatter } from './markdown'
import type { Gauge, Reading } from './types'

// Every step is a share of the limit — the harness's own threshold, or the window when it is unknown — so the rhythm is the same on any window.
// Soft hints come every max(100K, 25%) of growth: a shorter stretch does not pay for its own letter and records.
export function softStep(limit: number): number {
  return Math.max(100_000, Math.round(limit / 4))
}

// The final hint comes at 80% of the limit, with room left to finish a stage, and again every 5% after it.
export function finalAt(limit: number): number {
  return Math.round(limit * 0.8)
}

export function finalStep(limit: number): number {
  return Math.round(limit / 20)
}

export const FRESH_GAUGE: Gauge = { base: null, hinted: null, unassisted: false, growth: {}, whole: false }

// Where a row of the history came from, as hints name it.
export const SOURCES = {
  responses: 'your responses',
  owner: "the owner's messages",
  attachments: 'attachments and reminders',
  tools: 'tool results',
} as const

// One hint at most per new growth; an ignored one is not repeated until the history grows again.
export function shiftHint(gauge: Gauge, { tokens, window, threshold }: Reading): { gauge: Gauge; text: string | null } {
  if (tokens === undefined) return { gauge, text: null }
  if (gauge.base === null) return { gauge: { ...gauge, base: tokens, unassisted: false }, text: gauge.unassisted ? UNASSISTED_HINT : null }

  const limit = threshold ?? window
  const final = finalAt(limit)
  const grown = tokens - gauge.base
  const since = tokens - (gauge.hinted ?? gauge.base)
  const hinted = { ...gauge, hinted: tokens }
  if (grown < finalStep(limit)) return { gauge, text: null }

  if (tokens >= final) {
    const isFirst = gauge.hinted === null || gauge.hinted < final
    return isFirst || since >= finalStep(limit) ? { gauge: hinted, text: finalHint(tokens, limit, gauge.growth) } : { gauge, text: null }
  }
  // No soft hint right before the final one: it would come twice in a row.
  const step = softStep(limit)
  if (since >= step && tokens + step / 2 <= final) return { gauge: hinted, text: softHint(grown, gauge.growth) }

  return { gauge, text: null }
}

function softHint(grown: number, growth: Record<string, number>): string {
  return `Shift hint: the history has grown by ${formatK(grown)} since the last shift.${sources(growth)} This is not an alarm — running out of room gets a hint of its own. If you are at a stage boundary and the stretch's history is not needed whole any more, shift; if not, go on — the next hint comes after new growth.`
}

function finalHint(tokens: number, limit: number, growth: Record<string, number>): string {
  return `Shift hint: ${formatK(tokens)} of ${formatK(limit)} used — close to the point where the harness lets the history go by itself, without your letter.${sources(growth)} Shift at the nearest stage boundary: board, tasks, letter, \`${TOOL}\`.`
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

// The fill right after the last shift, if that shift let this session's history go; about.md keeps it as "95K → 6K".
export function shiftFill(about: string, sessionId: string): number | null {
  const meta = frontmatter(about)
  if (meta.get('session') !== sessionId || !meta.get('result')?.startsWith('shifted')) return null
  const after = /→ (\d+)K$/.exec(meta.get('tokens') ?? '')?.[1]

  return after === undefined ? null : Number(after) * 1000
}

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
export function renderStatus(gauge: Gauge, { tokens, window, threshold }: Reading): string {
  if (tokens === undefined) return 'No reading yet: the first response since the last let-go has not come back.'
  const limit = threshold ?? window
  const final = finalAt(limit)
  const lines = [
    `Used: ${formatK(tokens)} of ${formatK(window)} window; ${threshold === undefined ? 'the harness threshold is not read yet, the window stands for it' : `the harness lets the history go by itself at ${formatK(threshold)}`}.`,
  ]
  if (gauge.base !== null) lines.push(`Since the last shift: +${formatK(Math.max(0, tokens - gauge.base))}.`)
  if (tokens >= final) lines.push(`Past the final hint at ${formatK(final)}: shift at the nearest stage boundary.`)
  else {
    const soft = (gauge.hinted ?? gauge.base ?? tokens) + softStep(limit)
    const next = soft + softStep(limit) / 2 <= final ? `next soft hint at ${formatK(soft)}` : 'no soft hint before the final'
    lines.push(`Hints: ${next}; final at ${formatK(final)}.`)
  }
  const shares = growthShares(gauge.growth)
  if (shares.length > 0) lines.push(`Grown mostly from: ${shares.map(each => `${each.source} ${each.share}%`).join(', ')}.`)

  return lines.join('\n')
}

// A hint as a text block of its own inside a tool result, for a harness whose results are lists of blocks.
export function hintBlock(hint: string): string {
  return `<${MOD} note="a hint from the mod, not part of this result">\n${hint}\n</${MOD}>`
}

// A hint goes inside the last tool result, framed as a system note: a block of its own would show as the owner's words.
export function withHint<Block extends { type: string }>(content: readonly Block[], hint: string): Block[] {
  const note = `<system-reminder>\n${hint}\n</system-reminder>`
  const at = content.map(block => block.type).lastIndexOf('tool_result')
  if (at === -1) return [...content]
  const block = content[at] as Block & { content?: unknown }
  const inner = block.content
  const merged =
    typeof inner === 'string' || inner === undefined
      ? `${inner ?? ''}\n\n${note}`.trimStart()
      : [...(inner as readonly unknown[]), { type: 'text', text: note }]

  return content.map((each, index) => (index === at ? ({ ...block, content: merged } as Block) : each))
}

export const UNASSISTED_HINT = `The harness let the history go by itself, without your shift: there is no letter, only its digest is in memory. Before going on, read the board \`${BOARD}\`, \`${TASK_LIST}\` and the tasks in progress in \`${TASKS}/\`, and check where you stand against them.`
