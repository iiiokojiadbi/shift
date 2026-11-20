import { open } from 'node:fs/promises'
import { resolve } from 'node:path'
import { applyPatch, parsePatch, reversePatch } from 'diff'
import { type ConfirmedEdit, type Project, recordFingerprint } from '../../core/src'
import { type Fields, fields } from './protocol'

export function readOnlyActions(actions: unknown) {
  return (
    Array.isArray(actions) &&
    actions.length > 0 &&
    actions.every(action => ['read', 'list_files', 'listFiles', 'search'].includes(String(fields(action).type)))
  )
}

export type EditEvidence = {
  offset?: number
  confirmed?: ConfirmedEdit
  hasPatch?: (path: string) => boolean
  readOnlyShell?: boolean
}

// Replay only completed file changes since the previous observation. Reversing the recorded
// edits must recover the previous fingerprint, including any text outside the diff hunks.
export async function recentEdits(project: Project, input: Fields, offset?: number): Promise<EditEvidence> {
  if (typeof input.transcript_path !== 'string') return {}
  const handle = await open(input.transcript_path, 'r').catch(() => null)
  if (!handle) return {}
  try {
    const { size } = await handle.stat()
    if (offset === undefined || offset > size || size - offset > 2 * 1024 * 1024) return { offset: size }
    const bytes = Buffer.alloc(size - offset)
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, offset)
    const end = bytes.subarray(0, bytesRead).lastIndexOf(10) + 1
    const edits = new Map<string, Fields[]>()
    let readOnlyShell = false
    const shell = input.hook_event_name === 'PostToolUse' && input.tool_name === 'Bash'
    for (const line of bytes.toString('utf8', 0, end).split('\n')) {
      if (!line.includes('"FileChange"') && !(shell && line.includes('"CommandExecution"'))) continue
      try {
        const row = JSON.parse(line)
        const event = fields(row.payload)
        const item = fields(event.item)
        if (row.type !== 'event_msg' || event.thread_id !== input.session_id || event.type !== 'item_completed') continue
        if (shell && item.type === 'CommandExecution' && item.id === input.tool_use_id) readOnlyShell = readOnlyActions(item.parsed_cmd)
        if (item.type !== 'FileChange' || item.status !== 'completed') continue
        for (const [file, change] of Object.entries(fields(item.changes))) {
          const path = resolve(project.root, file)
          const changes = edits.get(path) ?? []
          changes.push(fields(change))
          edits.set(path, changes)
        }
      } catch {
        /* A malformed event cannot establish authorship. */
      }
    }
    const confirmed: ConfirmedEdit = (path, current, previous) => {
      const changes = edits.get(resolve(project.root, path))
      if (!changes) return false
      let text = current
      for (const change of changes.toReversed()) {
        if (change.type === 'add' && text === change.content) text = null
        else if (change.type === 'delete' && text === null && typeof change.content === 'string') text = change.content
        else if (change.type === 'update' && !change.move_path && text !== null && typeof change.unified_diff === 'string') {
          try {
            const [patch] = parsePatch(change.unified_diff)
            if (!patch?.hunks.length) return false
            const prior = applyPatch(text, reversePatch(patch))
            if (prior === false) return false
            text = prior
          } catch {
            return false
          }
        } else return false
      }
      return text === null ? previous === undefined : previous === recordFingerprint(project, path, text)
    }
    return {
      offset: offset + end,
      readOnlyShell,
      confirmed: edits.size ? confirmed : undefined,
      hasPatch: path => edits.has(resolve(project.root, path)),
    }
  } finally {
    await handle.close()
  }
}
