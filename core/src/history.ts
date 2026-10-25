import { readAbout } from './about'
import { CLOSED, SHIFTS } from './layout'
import { itemsOf } from './markdown'
import { listedTasks } from './records'
import type { HistoryEntry, Segment, Snapshot } from './types'

export function stamp(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')

  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
}

export function shiftDir(root: string, ms: number): string {
  return `${root}/${SHIFTS}/${stamp(ms)}`
}

export function segment(now: Snapshot, previous: Snapshot | null): Segment {
  const closedBefore = new Map<string, Set<string>>()
  for (const task of previous?.work.tasks ?? []) {
    closedBefore.set(
      task.name,
      new Set(
        itemsOf(task.track ?? '')
          .filter(i => CLOSED.has(i.status))
          .map(i => i.name),
      ),
    )
  }
  const fresh = now.work.tasks.flatMap(task =>
    itemsOf(task.track ?? '')
      .filter(item => CLOSED.has(item.status) && !(closedBefore.get(task.name)?.has(item.name) ?? false))
      .map(item => ({ status: item.status, text: `${task.name}: ${item.rest}` })),
  )
  const indexed = new Set(itemsOf(previous?.index ?? '').map(i => i.line))

  return {
    done: fresh.filter(f => f.status === 'done').map(f => f.text),
    dropped: fresh.filter(f => f.status === 'dropped').map(f => f.text),
    archived: itemsOf(now.index ?? '')
      .filter(i => !indexed.has(i.line))
      .map(i => i.line.slice(2)),
    open: listedTasks(now.work).map(t => t.line.slice(2)),
  }
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
