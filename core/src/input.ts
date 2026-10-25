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
import type { ArchiveInput, ItemChange, OpenInput, ShiftInput, TrackInput } from './types'

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

// The lines of a list argument, each `words — what matters` split at its first " — "; what is wrong with one otherwise.
function splitLines(raw: Record<string, unknown>, key: string): { name: string; note: string | null }[] | string {
  const value = raw[key] ?? []
  if (!Array.isArray(value) || value.some(each => typeof each !== 'string')) return `${key} is a list of lines.`
  const lines: { name: string; note: string | null }[] = []
  for (const each of value as string[]) {
    const line = each.trim()
    const problem = line === '' ? `${key} has an empty line.` : lineProblem(key, line, { noDates: true })
    if (problem !== null) return problem
    const at = line.indexOf(' — ')
    lines.push(at === -1 ? { name: line, note: null } : { name: line.slice(0, at).trim(), note: line.slice(at + 3).trim() || null })
  }

  return lines
}

export function parseOpenInput(raw: Record<string, unknown>): OpenInput | string {
  const name = taskName(raw, 'name')
  if (typeof name !== 'string') return name.problem
  const status = text(raw, 'status') || 'in progress'
  if (!(FOCUS as readonly string[]).includes(status)) return `status is one of ${quote(FOCUS)}.`
  const fields = { title: text(raw, 'title'), goal: text(raw, 'goal'), doneWhen: text(raw, 'done_when') }
  for (const [key, value] of [
    ['title', fields.title],
    ['goal', fields.goal],
    ['done_when', fields.doneWhen],
  ] as const) {
    if (value === '') return `${key} is empty.`
    const problem = key === 'title' ? lineProblem(key, value, { noDates: true }) : dated(key, value, 'Tasks have no dates.')
    if (problem !== null) return problem
  }
  const what = status === 'in progress' ? 'what the task is' : `what the task is and why it is ${status}`
  const line = about(raw, what)
  if (line !== null) return line
  const items = splitLines(raw, 'items')
  if (typeof items === 'string') return items
  const links: OpenInput['links'] = []
  for (const kind of ['needs', 'after', 'continues'] as const) {
    const listed = splitLines(raw, kind)
    if (typeof listed === 'string') return listed
    for (const each of listed) {
      if (!NAME.test(each.name)) return `${kind}: "${each.name}" is not a task name — ${NAME_RULE}, then " — why" if it needs one.`
      links.push({ kind, name: each.name, why: each.note })
    }
  }

  return { name, status, ...fields, about: text(raw, 'about'), items, links }
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
  const status = optional(raw, 'status')
  const note = optional(raw, 'note')
  if (Array.isArray(raw.items) && raw.items.length > 0) {
    if (optional(raw, 'item') !== null) return 'Pass item inside items, or leave items out.'
    const items: ItemChange[] = []
    for (const [n, each] of raw.items.entries()) {
      const change = itemChange(typeof each === 'object' && each !== null ? (each as Record<string, unknown>) : {})
      if (typeof change === 'string') return `items[${n}]: ${change}`
      items.push(change)
    }
    if (status === null) return { task, items, own: null }
    const own = ownStatus(status, note)

    return typeof own === 'string' ? own : { task, items, own }
  }
  if (optional(raw, 'item') === null) {
    const own = ownStatus(status ?? '', note)

    return typeof own === 'string' ? own : { task, items: [], own }
  }
  const change = itemChange(raw)

  return typeof change === 'string' ? change : { task, items: [change], own: null }
}

// One item's change: its words, a status of a track item, a one-line note.
function itemChange(raw: Record<string, unknown>): ItemChange | string {
  const item = text(raw, 'item')
  const status = text(raw, 'status')
  const note = optional(raw, 'note')
  if (item === '') return "item is empty: words of the item's name."
  if (!isOneOf(STATUSES, status)) return `status for a track item is one of ${quote(STATUSES)}.`
  for (const [key, value] of [
    ['item', item],
    ['note', note],
  ] as const) {
    const problem = value === null ? null : lineProblem(key, value, { noDates: true })
    if (problem !== null) return problem
  }

  return { item, status, note, add: raw.add === true }
}

// The task's own status in TASKS.md: a waiting or deferred one carries its reason.
function ownStatus(status: string, note: string | null): { status: string; note: string | null } | string {
  if (!isOneOf(FOCUS, status)) return `status for a task in ${TASK_LIST} is one of ${quote(FOCUS)}.`
  const problem = note === null ? null : lineProblem('note', note, { noDates: true })
  if (problem !== null) return problem
  if (status !== 'in progress' && note === null) return `A ${status} task carries its reason in its line: pass note.`

  return { status, note }
}
