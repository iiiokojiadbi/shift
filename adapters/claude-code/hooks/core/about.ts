// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { AFTER } from './layout'
import { formatK, frontmatter, isOneOf } from './markdown'
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
}

export function renderAbout(meta: AboutMeta): string {
  const fill = (tokens: number | undefined) => (tokens === undefined ? '?' : formatK(tokens))
  const tokens =
    meta.tokensBefore === undefined && meta.tokensAfter === undefined ? 'unknown' : `${fill(meta.tokensBefore)} → ${fill(meta.tokensAfter)}`

  return [
    '---',
    `description: ${meta.about}`,
    `at: ${new Date(meta.at).toISOString()}`,
    `after: ${meta.after}`,
    // A harness's reason may run over lines; the line keeps all of it.
    `result: ${meta.result.replace(/\s*\r?\n\s*/g, ' ')}`,
    `tokens: ${tokens}`,
    `summary_chars: ${meta.summaryChars ?? 'unknown'}`,
    `session: ${meta.sessionId}`,
    '---',
    '',
  ].join('\n')
}

export function readAbout(text: string): About {
  const meta = frontmatter(text)
  const after = meta.get('after') ?? meta.get('then') ?? null
  const result = meta.get('result') ?? null
  // `tokens: 300K → 20K`, a fill under 1000 printed as it is.
  const fill = /→ (\d+)(K?)$/.exec(meta.get('tokens') ?? '')

  return {
    description: meta.get('description') ?? null,
    after: isOneOf(AFTER, after) ? after : null,
    result,
    session: meta.get('session') ?? null,
    shifted: result?.startsWith('shifted') ?? false,
    tokensAfter: fill === null ? null : Number(fill[1]) * (fill[2] === 'K' ? 1000 : 1),
  }
}

// The fill the stretch started from, if the shift was this session's and let the history go.
export function shiftFill(text: string, sessionId: string): number | null {
  const about = readAbout(text)

  return about.session === sessionId && about.shifted ? about.tokensAfter : null
}
