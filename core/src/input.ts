import { ABOUT_MAX, AFTER, HISTORY_DEFAULT, HISTORY_MAX, LETTER } from './layout'
import { isOneOf, quote } from './markdown'
import type { ShiftInput } from './types'

// A string argument, trimmed; '' when it is missing or not a string.
function text(raw: Record<string, unknown>, key: string): string {
  const value = raw[key]

  return typeof value === 'string' ? value.trim() : ''
}

// A string argument that may be left out: null when it is missing or empty.
function optional(raw: Record<string, unknown>, key: string): string | null {
  return text(raw, key) === '' ? null : text(raw, key)
}

export function parseShiftInput(raw: Record<string, unknown>): ShiftInput | string {
  const letter = text(raw, 'letter')
  const after = raw.after
  if (letter === '') return `letter is empty: write the letter to yourself (${LETTER}) and pass its path.`
  if (!isOneOf(AFTER, after)) return `after must be ${quote(AFTER, ' or ')}.`

  if (raw.about === undefined) return { letter, after }
  const about = text(raw, 'about')
  if (!about) return 'about is empty: describe what the stretch did and where you stand.'
  if (about.includes('\n')) return 'about is one line, without line breaks.'
  if (about.length > ABOUT_MAX) return `about is ${about.length} characters, the limit is ${ABOUT_MAX}. Shorten it.`
  return { letter, after, about }
}

export function parseHistoryCount(raw: Record<string, unknown>): number | string {
  const count = raw.count ?? HISTORY_DEFAULT
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > HISTORY_MAX) {
    return `count is an integer from 1 to ${HISTORY_MAX}.`
  }

  return count
}

// The one path argument of a docs tool; null when it is missing or empty.
export function parsePath(raw: Record<string, unknown>, key: 'path' | 'file'): string | null {
  return optional(raw, key)
}
