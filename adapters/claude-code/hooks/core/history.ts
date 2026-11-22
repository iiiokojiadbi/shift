// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { readAbout } from './about'
import type { HistoryEntry } from './types'

export function renderSummary(messages: readonly { role: string; text: string }[]): string {
  return `${messages.map(m => `## ${m.role}\n\n${m.text}`).join('\n\n')}\n`
}

export function renderHistory(entries: HistoryEntry[], total: number): string {
  if (entries.length === 0) return 'No shifts in this project yet.'

  const blocks = entries.map(entry => {
    if (entry.about === null) return `### ${entry.name}\n\nNo about.md.`
    const about = readAbout(entry.about)
    return `### ${entry.name} · ${about.after ?? '?'} · ${about.result ?? '?'}\n\n${about.description ?? ''}`
  })
  const head = `Saved shifts, oldest first: ${entries.length} of ${total}.`
  const older = entries.length < total ? [`For earlier shifts, call shift_history with before="${entries[0]?.name}".`] : []
  return [head, ...blocks, ...older].join('\n\n')
}
