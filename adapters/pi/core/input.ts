// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { ABOUT_MAX, HISTORY_DEFAULT, HISTORY_MAX, LETTER, NAME, TASKS } from './layout'
import type { ArchiveInput, ShiftInput } from './types'

function oneLine(raw: unknown, what: string): string {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (text === '') return `about is empty: one line — ${what}.`
  if (text.includes('\n')) return 'about is one line, without line breaks.'
  if (text.length > ABOUT_MAX) return `about is ${text.length} characters, the limit is ${ABOUT_MAX}. Shorten it.`

  return ''
}

export function parseShiftInput(raw: Record<string, unknown>): ShiftInput | string {
  const letter = typeof raw.letter === 'string' ? raw.letter.trim() : ''
  const after = raw.after
  if (letter === '') return `letter is empty: write the letter to yourself (${LETTER}) and pass its path.`
  if (after !== 'continue' && after !== 'wait') return 'after must be "continue" or "wait".'
  const problem = oneLine(raw.about, 'what the stretch did and where you stand')
  if (problem !== '') return problem

  return { letter, after, about: String(raw.about).trim() }
}

export function parseArchiveInput(raw: Record<string, unknown>): ArchiveInput | string {
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!NAME.test(name)) return `name must be a task folder name in ${TASKS}/: lowercase latin, digits and dashes.`
  const outcome = raw.outcome
  if (outcome !== 'done' && outcome !== 'dropped') return 'outcome must be "done" or "dropped".'
  const problem = oneLine(raw.about, 'what the task was and how it ended')
  if (problem !== '') return problem

  return { name, outcome, about: String(raw.about).trim() }
}

export function resolvePath(root: string, path: string): string {
  return path.startsWith('/') ? path : `${root}/${path.replace(/^\.\//, '')}`
}

export function parseHistoryCount(raw: Record<string, unknown>): number | string {
  const count = raw.count ?? HISTORY_DEFAULT
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > HISTORY_MAX) {
    return `count is an integer from 1 to ${HISTORY_MAX}.`
  }

  return count
}
