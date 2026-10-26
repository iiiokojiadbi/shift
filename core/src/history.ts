import { readAbout } from './about'
import { CLOSED, SHIFTS } from './layout'
import { itemsOf } from './markdown'
import { listedTasks } from './records'
import type { HistoryEntry, Item, Segment, Snapshot } from './types'

export function stamp(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')

  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
}

export function shiftDir(root: string, ms: number): string {
  return `${root}/${SHIFTS}/${stamp(ms)}`
}

// What the stretch closed and archived, against the previous shift's snapshot. An item is the same item by its id, a
// line of the index the same task by its folder: a closed item renamed, or an archived task's line reworded, is no
// new work.
export function segment(now: Snapshot, previous: Snapshot | null): Segment {
  const closedBefore = new Map<string, Set<string>>()
  for (const task of previous?.work.tasks ?? []) {
    closedBefore.set(
      task.name,
      new Set(
        itemsOf(task.track ?? '')
          .filter(i => CLOSED.has(i.status))
          .flatMap(itemKeys),
      ),
    )
  }
  const fresh = now.work.tasks.flatMap(task =>
    itemsOf(task.track ?? '')
      .filter(item => CLOSED.has(item.status) && !itemKeys(item).some(key => closedBefore.get(task.name)?.has(key) ?? false))
      .map(item => ({ status: item.status, text: `${task.name}: ${item.rest}` })),
  )
  const indexed = new Set(itemsOf(previous?.index ?? '').map(archivedKey))

  return {
    done: fresh.filter(f => f.status === 'done').map(f => f.text),
    dropped: fresh.filter(f => f.status === 'dropped').map(f => f.text),
    archived: itemsOf(now.index ?? '')
      .filter(i => !indexed.has(archivedKey(i)))
      .map(i => i.line.slice(2)),
    open: listedTasks(now.work).map(t => t.line.slice(2)),
  }
}

// An item is known by its id, and by its name for a track numbered only since.
function itemKeys(item: Item): string[] {
  return item.id === null ? [`name ${item.name}`] : [`#${item.id}`, `name ${item.name}`]
}

// An index line by its task's folder, `[title](name/)`; the whole line when it links none.
function archivedKey(item: Item): string {
  return /\]\(([^)]+?)\/?\)/.exec(item.line)?.[1] ?? item.line
}

export function renderSummary(messages: readonly { role: string; text: string }[]): string {
  return `${messages.map(m => `## ${m.role}\n\n${m.text}`).join('\n\n')}\n`
}

export function renderHistory(entries: HistoryEntry[], total: number): string {
  if (entries.length === 0) return `No shifts in this project yet: ${SHIFTS}/ is empty.`

  const blocks = entries.map((entry, index) => {
    if (entry.about === null) return `### ${entry.name}\n\nNo about.md.`
    const about = readAbout(entry.about)
    const lines = [`### ${entry.name} · ${about.after ?? '?'} · ${about.result ?? '?'}`, '', about.description ?? '']
    for (const [heading, listed] of [
      ['Done', about.done],
      ['Dropped', about.dropped],
      ['Archived', about.archived],
    ] as const) {
      if (listed.length > 0) lines.push('', `${heading}: ${listed.join('; ')}`)
    }
    if (index === entries.length - 1) lines.push('', `Open: ${about.open.length === 0 ? 'none' : about.open.join('; ')}`)

    return lines.join('\n')
  })
  const head = `Shifts, oldest first: ${entries.length} of ${total}. Folders — ${SHIFTS}/<name>/.`

  return [head, ...blocks].join('\n\n')
}
