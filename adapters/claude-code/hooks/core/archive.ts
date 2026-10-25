// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { ARCHIVE, CLOSED, TASKS } from './layout'
import { itemsOf, title } from './markdown'
import type { ArchiveInput, TaskFiles } from './types'

// What `task_archive` refuses: a task that is not there, or one marked done with open items.
export function checkArchive(input: ArchiveInput, task: TaskFiles, archived: boolean): string | null {
  const where = `${TASKS}/${input.name}/`
  if (archived) return `${ARCHIVE}/${input.name}/ already exists: pick another name for the task before archiving it.`
  if (task.task === null) return `${where}task.md is missing: is "${input.name}" the task's folder name?`
  if (title(task.task) === null) return `${where}task.md has no "# <title>" line.`
  if (input.outcome === 'done') {
    const open = itemsOf(task.track ?? '').filter(item => !CLOSED.has(item.status))
    if (open.length > 0) {
      return `Not every item is closed: ${open.map(i => `"${i.line}"`).join('; ')}. Close them as done or dropped, or archive the task as dropped.`
    }
  }

  return null
}

// `continues` lists the archived tasks this one picked up, from its links in TASKS.md.
export function indexLine(input: ArchiveInput, task: string, continues: readonly string[]): string {
  const linked = continues
  const tail = linked.length === 0 ? '' : `; continues ${linked.join(', ')}`

  return `- [${input.outcome}] [${title(task) ?? input.name}](${input.name}/) — ${input.about}${tail}`
}

export function addToIndex(index: string | null, line: string): string {
  const head =
    index === null || index.trim() === ''
      ? '# Archive\n\nOne line per archived task: outcome, title, what it was and how it ended.\n'
      : `${index.trimEnd()}\n`

  return `${head}${index === null || index.trim() === '' ? '\n' : ''}${line}\n`
}
