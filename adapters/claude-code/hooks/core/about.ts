// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { bullets, formatK, frontmatter, sections } from './markdown'
import type { AboutMeta, ShiftAfter } from './types'

// about.md, a shift in brief with a strict structure: written once when the shift is accepted and again with its
// outcome, read by the history, by the message after a shift and by a fresh process for its base. One module writes
// and reads it, so the keys, the sections and the outcomes cannot drift between them.

// What became of a shift, as its `result:` line says it.
export const OUTCOME = {
  pending: 'pending',
  continuing: (shrank: string) => `shifted (${shrank}), continuing`,
  waiting: (shrank: string, why: string) => `shifted (${shrank}), ${why}`,
  notShifted: (why: string) => `not shifted: ${why}`,
  unsettled: (why: string) => `let go, not settled: ${why}`,
}

export type About = {
  description: string | null
  after: ShiftAfter | null
  result: string | null
  session: string | null
  // Whether the history was let go and settled.
  shifted: boolean
  // The fill right after the let-go; null when unknown.
  tokensAfter: number | null
  done: string[]
  dropped: string[]
  archived: string[]
  open: string[]
}

export function renderAbout(meta: AboutMeta): string {
  const list = (items: string[]) => (items.length === 0 ? ['none'] : items.map(item => `- ${item}`))
  const tokens =
    meta.tokensBefore === undefined
      ? 'unknown'
      : `${formatK(meta.tokensBefore)} → ${meta.tokensAfter === undefined ? '?' : formatK(meta.tokensAfter)}`

  return [
    '---',
    `description: ${meta.about}`,
    `at: ${new Date(meta.at).toISOString()}`,
    `after: ${meta.after}`,
    `result: ${meta.result}`,
    `tokens: ${tokens}`,
    `summary_chars: ${meta.summaryChars ?? 'unknown'}`,
    `session: ${meta.sessionId}`,
    '---',
    '',
    '## Done',
    '',
    ...list(meta.segment.done),
    '',
    '## Dropped',
    '',
    ...list(meta.segment.dropped),
    '',
    '## Archived',
    '',
    ...list(meta.segment.archived),
    '',
    '## Open',
    '',
    ...list(meta.segment.open),
    '',
  ].join('\n')
}

export function readAbout(text: string): About {
  const meta = frontmatter(text)
  const found = sections(text)
  const after = meta.get('after') ?? meta.get('then') ?? null
  const result = meta.get('result') ?? null
  // `tokens: 300K → 20K`, a fill under 1000 printed as it is.
  const fill = /→ (\d+)(K?)$/.exec(meta.get('tokens') ?? '')

  return {
    description: meta.get('description') ?? null,
    after: after === 'continue' || after === 'wait' ? after : null,
    result,
    session: meta.get('session') ?? null,
    shifted: result?.startsWith('shifted') ?? false,
    tokensAfter: fill === null ? null : Number(fill[1]) * (fill[2] === 'K' ? 1000 : 1),
    done: bullets(found.get('Done')),
    dropped: bullets(found.get('Dropped')),
    archived: bullets(found.get('Archived')),
    open: bullets(found.get('Open')),
  }
}

// The fill the stretch started from, if the shift was this session's and let the history go.
export function shiftFill(text: string, sessionId: string): number | null {
  const about = readAbout(text)

  return about.session === sessionId && about.shifted ? about.tokensAfter : null
}
