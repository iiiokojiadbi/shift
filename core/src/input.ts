import {
  ABOUT_MAX,
  AFTER,
  FOCUS,
  HISTORY_DEFAULT,
  HISTORY_MAX,
  LETTER,
  NAME,
  NAME_RULE,
  OUTCOMES,
  STATUSES,
  TASK_LIST,
  TASKS,
} from './layout'
import { dated, isOneOf, quote } from './markdown'
import type { ArchiveInput, ShiftInput, TrackInput } from './types'

// A string argument, trimmed; '' when it is missing or not a string.
function text(raw: Record<string, unknown>, key: string): string {
  const value = raw[key]

  return typeof value === 'string' ? value.trim() : ''
}

// A string argument that may be left out: null when it is missing or empty.
function optional(raw: Record<string, unknown>, key: string): string | null {
  return text(raw, key) === '' ? null : text(raw, key)
}

// What is wrong with a one-line argument — a line break, past `max` characters, a date where records have none;
// null when it is fine.
function lineProblem(key: string, value: string, rules: { max?: number; noDates?: boolean }): string | null {
  if (value.includes('\n')) return `${key} is one line, without line breaks.`
  if (rules.max !== undefined && value.length > rules.max)
    return `${key} is ${value.length} characters, the limit is ${rules.max}. Shorten it.`

  return rules.noDates ? dated(key, value, 'Records have no dates.') : null
}

// The `about` of a shift or an archived task: required, one line, within the limit.
function about(raw: Record<string, unknown>, what: string): string | null {
  const value = text(raw, 'about')

  return value === '' ? `about is empty: one line — ${what}.` : lineProblem('about', value, { max: ABOUT_MAX })
}

// A task folder name argument, or what is wrong with it.
function taskName(raw: Record<string, unknown>, key: string): string | { problem: string } {
  const name = text(raw, key)

  return NAME.test(name) ? name : { problem: `${key} is a task folder name in ${TASKS}/: ${NAME_RULE}.` }
}

export function parseShiftInput(raw: Record<string, unknown>): ShiftInput | string {
  const letter = text(raw, 'letter')
  const after = raw.after
  if (letter === '') return `letter is empty: write the letter to yourself (${LETTER}) and pass its path.`
  if (!isOneOf(AFTER, after)) return `after must be ${quote(AFTER, ' or ')}.`

  return about(raw, 'what the stretch did and where you stand') ?? { letter, after, about: text(raw, 'about') }
}

export function parseArchiveInput(raw: Record<string, unknown>): ArchiveInput | string {
  const name = taskName(raw, 'name')
  if (typeof name !== 'string') return name.problem
  const outcome = raw.outcome
  if (!isOneOf(OUTCOMES, outcome)) return `outcome must be ${quote(OUTCOMES, ' or ')}.`

  return about(raw, 'what the task was and how it ended') ?? { name, outcome, about: text(raw, 'about') }
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

// The one path argument of a docs tool; null when it is missing or empty.
export function parsePath(raw: Record<string, unknown>, key: 'path' | 'file'): string | null {
  return optional(raw, key)
}

export function parseTrackInput(raw: Record<string, unknown>): TrackInput | string {
  const task = taskName(raw, 'task')
  if (typeof task !== 'string') return task.problem
  const item = optional(raw, 'item')
  const note = optional(raw, 'note')
  const add = raw.add === true
  const status = text(raw, 'status')
  const allowed: readonly string[] = item === null ? FOCUS : STATUSES
  if (!allowed.includes(status))
    return `status for ${item === null ? `a task in ${TASK_LIST}` : 'a track item'} is one of ${quote(allowed)}.`
  if (add && item === null) return "add needs item: the new item's name."
  for (const [key, value] of [
    ['item', item],
    ['note', note],
  ] as const) {
    const problem = value === null ? null : lineProblem(key, value, { noDates: true })
    if (problem !== null) return problem
  }
  if (item === null && status !== 'in progress' && note === null) return `A ${status} task carries its reason in its line: pass note.`

  return { task, item, status, note, add }
}
