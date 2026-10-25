// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { ARCHIVE_TOOL, FOCUS, NAME, NAME_RULE, TASK_LIST, TASKS, TASKS_MAX_LINES } from './layout'
import { dated, overLimit, quote } from './markdown'

// TASKS.md: every open task, one line each, and under it the links to other tasks and archived ones.
//
// - [in progress] [adapters](tasks/adapters/) — the shift in pi and opencode on the shared core
//   - needs: [core-port](tasks/core-port/) — the port comes first
//   - after: [settings](archive/settings/)
//   - continues: [old-adapters](archive/old-adapters/)

export const LINKS = ['needs', 'after', 'continues'] as const
export type LinkKind = (typeof LINKS)[number]
export type Link = { kind: LinkKind; place: 'tasks' | 'archive'; name: string; line: string }
export type ListedTask = { status: string; name: string; about: string; line: string; links: Link[] }

const TASK_LINE = /^- \[([^\]]+)\] \[([^\]]+)\]\(tasks\/([^)/]+)\/?\) — (.+)$/

export function formatTaskLine(status: string, label: string, name: string, about: string): string {
  return `- [${status}] [${label}](tasks/${name}/) — ${about}`
}

// One line of TASKS.md as `- [status] [label](tasks/name/) — about`; null when it is not a task line.
export function taskLine(line: string): { status: string; label: string; name: string; about: string } | null {
  const [, status = '', label = '', name = '', about = ''] = TASK_LINE.exec(line.trimEnd()) ?? []

  return name === '' ? null : { status, label, name, about }
}
const LINK_LINE = /^\s+- ([a-z]+): (.+)$/
const TARGET = /\[([^\]]+)\]\((tasks|archive)\/([^)/]+)\/?\)/g

// The tasks as listed, or what is wrong with a line; "none" stands for an empty list.
export function parseTaskList(text: string): ListedTask[] | string {
  const tasks: ListedTask[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    if (line.trim() === '' || line.startsWith('#') || line.trim() === 'none') continue
    const task = taskLine(line)
    if (task !== null) {
      const { status, label, name, about } = task
      if (label !== name) return `${TASK_LIST}: the link text and the folder differ in "${line}": write [${name}](tasks/${name}/).`
      tasks.push({ status, name, about, line, links: [] })
      continue
    }
    const link = LINK_LINE.exec(line)
    const owner = tasks.at(-1)
    if (link === null || owner === undefined) {
      return `${TASK_LIST}: "${line.trim()}" is neither a task line \`- [status] [name](tasks/name/) — what it is\` nor a link under one.`
    }
    const kind = link[1] as LinkKind
    if (!(LINKS as readonly string[]).includes(kind))
      return `${TASK_LIST}: unknown link "${kind}:" in "${line.trim()}"; links are ${LINKS.join(', ')}.`
    const targets = [...((link[2] ?? '').split(' — ')[0]?.matchAll(TARGET) ?? [])]
    if (targets.length === 0) return `${TASK_LIST}: "${line.trim()}" links nothing; write [name](tasks/name/) or [name](archive/name/).`
    for (const [, , place = 'tasks', name = ''] of targets)
      owner.links.push({ kind, place: place as Link['place'], name, line: line.trim() })
  }

  return tasks
}

// TASKS.md against the task folders and the archive.
export function checkTaskList(text: string | null, folders: readonly string[], archived: readonly string[]): string | null {
  if (text === null) return `No ${TASK_LIST}: list every task folder there, one line each, or write "none".`
  const size =
    overLimit(TASK_LIST, text, TASKS_MAX_LINES, 'archive finished tasks, keep one short line each.') ??
    dated(TASK_LIST, text, 'Tasks have no dates.')
  if (size !== null) return size
  const tasks = parseTaskList(text)
  if (typeof tasks === 'string') return tasks

  const badStatus = tasks.filter(t => !(FOCUS as readonly string[]).includes(t.status))
  if (badStatus.length > 0) {
    return `Tasks without a status (${FOCUS.join(', ')}) in ${TASK_LIST}: ${quote(
      badStatus.map(t => t.line),
      '; ',
    )}. A finished task is archived with ${ARCHIVE_TOOL}, not marked.`
  }
  const badName = tasks.filter(t => !NAME.test(t.name))
  if (badName.length > 0) return `Task names are ${NAME_RULE}: ${quote(badName.map(t => t.name))}.`

  const listed = new Set(tasks.map(t => t.name))
  const unlisted = folders.filter(name => !listed.has(name))
  if (unlisted.length > 0)
    return `Task folders missing from ${TASK_LIST}: ${unlisted.join(', ')}. List each with its status, or archive it.`
  const homeless = [...listed].filter(name => !folders.includes(name))
  if (homeless.length > 0)
    return `Tasks in ${TASK_LIST} without a folder in ${TASKS}/: ${homeless.join(', ')}. Create the folder, or remove the line.`

  for (const task of tasks) {
    for (const link of task.links) {
      const exists = link.place === 'tasks' ? listed.has(link.name) : archived.includes(link.name)
      if (!exists) return `${TASK_LIST}: "${link.line}" under ${task.name} points at ${link.place}/${link.name}/, which is not there.`
      if (link.kind === 'needs' && link.place !== 'tasks') {
        return `${TASK_LIST}: ${task.name} needs ${link.name}, which is archived: what it gave is done — write "after:".`
      }
      if (link.kind === 'continues' && link.place !== 'archive')
        return `${TASK_LIST}: ${task.name} continues ${link.name}, which is not archived: only an archived task is continued.`
      if (link.place === 'tasks' && link.name === task.name) return `${TASK_LIST}: ${task.name} links itself.`
    }
  }
  const cycle = needsCycle(tasks)
  if (cycle !== null)
    return `${TASK_LIST}: tasks need each other in a circle: ${cycle.join(' → ')}. One of them does not really need the next.`

  return null
}

function needsCycle(tasks: readonly ListedTask[]): string[] | null {
  const needs = new Map(tasks.map(t => [t.name, t.links.filter(l => l.kind === 'needs').map(l => l.name)]))
  const done = new Set<string>()
  const walk = (name: string, path: string[]): string[] | null => {
    if (path.includes(name)) return [...path.slice(path.indexOf(name)), name]
    if (done.has(name)) return null
    for (const next of needs.get(name) ?? []) {
      const found = walk(next, [...path, name])
      if (found !== null) return found
    }
    done.add(name)

    return null
  }
  for (const task of tasks) {
    const found = walk(task.name, [])
    if (found !== null) return found
  }

  return null
}

// After archiving `name`: its line and links leave, and the links of others point into the archive; what was needed is
// now behind them.
export function archiveInList(text: string, name: string): string {
  const out: string[] = []
  let skipping = false
  for (const line of text.split('\n')) {
    const task = taskLine(line)
    if (task !== null) skipping = task.name === name
    else if (!LINK_LINE.test(line)) skipping = false
    if (skipping) continue
    const moved = line.replaceAll(`](tasks/${name}/)`, `](archive/${name}/)`).replaceAll(`](tasks/${name})`, `](archive/${name}/)`)
    out.push(moved !== line && /^\s+- needs: /.test(moved) ? moved.replace('- needs: ', '- after: ') : moved)
  }
  const kept = out.join('\n')
  const left = parseTaskList(kept)
  const isEmpty = Array.isArray(left) && left.length === 0 && !/^none$/m.test(kept)

  if (!isEmpty) return kept

  return kept.trim() === '' ? 'none\n' : `${kept.trimEnd()}\n\nnone\n`
}
