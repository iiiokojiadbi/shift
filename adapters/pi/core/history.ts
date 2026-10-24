// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { CLOSED, DIR } from './layout'
import { bullets, formatK, frontmatter, itemsOf, sections } from './markdown'
import { boardTasks } from './records'
import type { AboutMeta, HistoryEntry, Segment, Snapshot } from './types'

export function stamp(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')

  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
}

export function shiftDir(root: string, ms: number): string {
  return `${root}/${DIR}/shifts/${stamp(ms)}`
}

export function segment(now: Snapshot, previous: Snapshot | null): Segment {
  const closedBefore = new Map<string, Set<string>>()
  for (const task of previous?.work.tasks ?? []) {
    closedBefore.set(
      task.name,
      new Set(
        itemsOf(task.track ?? '')
          .filter(i => CLOSED.has(i.status))
          .map(i => i.rest),
      ),
    )
  }
  const fresh = now.work.tasks.flatMap(task =>
    itemsOf(task.track ?? '')
      .filter(item => CLOSED.has(item.status) && !(closedBefore.get(task.name)?.has(item.rest) ?? false))
      .map(item => ({ status: item.status, text: `${task.name}: ${item.rest}` })),
  )
  const indexed = new Set(itemsOf(previous?.index ?? '').map(i => i.line))

  return {
    done: fresh.filter(f => f.status === 'done').map(f => f.text),
    dropped: fresh.filter(f => f.status === 'dropped').map(f => f.text),
    archived: itemsOf(now.index ?? '')
      .filter(i => !indexed.has(i.line))
      .map(i => i.line.slice(2)),
    open: boardTasks(now.work.board).map(t => t.line.slice(2)),
  }
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

export function renderSummary(messages: readonly { role: string; text: string }[]): string {
  return `${messages.map(m => `## ${m.role}\n\n${m.text}`).join('\n\n')}\n`
}

export function renderHistory(entries: HistoryEntry[], total: number): string {
  if (entries.length === 0) return `No shifts in this project yet: ${DIR}/shifts/ is empty.`

  const blocks = entries.map((entry, index) => {
    if (entry.about === null) return `### ${entry.name}\n\nNo about.md.`
    const fields = frontmatter(entry.about)
    const found = sections(entry.about)
    const lines = [
      `### ${entry.name} · ${fields.get('after') ?? fields.get('then') ?? '?'} · ${fields.get('result') ?? '?'}`,
      '',
      fields.get('description') ?? '',
    ]
    for (const heading of ['Done', 'Dropped', 'Archived']) {
      const listed = bullets(found.get(heading))
      if (listed.length > 0) lines.push('', `${heading}: ${listed.join('; ')}`)
    }
    if (index === entries.length - 1) {
      const open = bullets(found.get('Open'))
      lines.push('', `Open: ${open.length === 0 ? 'none' : open.join('; ')}`)
    }

    return lines.join('\n')
  })
  const head = `Shifts, oldest first: ${entries.length} of ${total}. Folders — ${DIR}/shifts/<name>/.`

  return [head, ...blocks].join('\n\n')
}
