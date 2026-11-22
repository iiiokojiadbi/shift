import { DIR, SHIFT_FILE } from './layout'
import { pendingMap } from './map-import'
import { sectionRange } from './markdown'
import type { Project } from './project'
import { recordProblem } from './records'
import { archiveCall } from './saved'

function field(raw: Record<string, unknown>, name: string): string {
  const value = raw[name]
  if (typeof value !== 'string') throw new Error(`Expected a string for ${name}.`)
  return value
}

export function replacePassage(text: string, find: string, replacement: string, section?: string) {
  let start = 0,
    end = text.length
  if (section !== undefined) {
    const { first, after } = sectionRange(text, section)
    const lines = text.split('\n')
    const offset = (index: number) => lines.slice(0, index).reduce((sum, line) => sum + line.length + 1, 0)
    start = Math.min(text.length, offset(first + 1))
    if (after !== undefined) end = offset(after)
  }
  const body = text.slice(start, end)
  const at = body.indexOf(find)
  if (!find || at < 0 || body.indexOf(find, at + 1) >= 0)
    throw new Error('Expected one exact match. Read the record and include more context.')
  return text.slice(0, start + at) + replacement + text.slice(start + at + find.length)
}

export async function editRecord(p: Project, raw: Record<string, unknown>) {
  const w = p.working
  if (!w) throw new Error('This project uses file-backed records. Edit its Markdown files directly.')
  const action = field(raw, 'action')
  if (action === 'import') {
    const names = await w.importFiles()
    return names.length ? `Imported ${names.join(', ')}. Originals remain on disk.` : 'No new internal files to import.'
  }
  const all = await w.all()
  if (action === 'list')
    return (
      Object.entries(all)
        .filter(([n]) => w.key(`${DIR}/${n}`))
        .map(([n, r]) => `${n} ${r.revision}`)
        .join('\n') || 'No current records. Use checkout to create one, or import existing internal files.'
    )
  const name = field(raw, 'name')
  if (w.key(`${DIR}/${name}`) !== name)
    throw new Error(
      'Unknown or file-backed record. Use a logical name such as board.md or knowledge/traps.md. Edit configured files at their paths.',
    )
  const r = all[name] ?? { revision: '', text: '' }
  if (`${DIR}/${name}` === SHIFT_FILE && pendingMap(r.text)) throw new Error('Map import is pending. Retry at the next session start.')
  if (!r.revision && (await w.disk.exists(`${p.root}/${DIR}/${name}`)))
    throw new Error('Existing Markdown record. Use import to adopt the internal files, or edit the original file.')
  if (action === 'read') return r.revision ? `${r.revision}\n${r.text}` : 'Record missing. Use checkout to create it.'
  const session = w.session
  if (!session) throw new Error('A session identity is required to edit records.')
  const draft = <T>(op: string, revision: string, text = '') =>
    archiveCall<T>(p, { action: `draft-${op}`, session, file: name, revision, text })
  if (action === 'drafts') return JSON.stringify(await draft('list', ''))
  if (action === 'checkout') {
    const path = await draft<string>('open', r.revision, r.text)
    return JSON.stringify({ path, revision: r.revision || 'new' })
  }
  const version = field(raw, 'revision')
  const revision = version === 'new' ? '' : version
  if (action === 'delete') {
    if (!name.startsWith('knowledge/')) throw new Error('Only current knowledge records can be deleted.')
    if (await w.disk.exists(`${p.root}/${DIR}/${name}`))
      throw new Error('A loose source still exists. Move or retire that file before deleting the imported record.')
    await w.remove(name, revision)
    return `Deleted ${name}.`
  }
  if (action === 'discard') {
    const body = await draft<string>('read', revision)
    await draft('remove', revision, body)
    return 'Discarded draft.'
  }
  if (action !== 'apply' && action !== 'replace') throw new Error('Unknown record action.')
  let next: string
  let diff = ''
  if (action === 'apply') {
    next = await draft<string>('read', revision)
  } else {
    const find = field(raw, 'find'),
      replacement = field(raw, 'replacement')
    if (revision !== r.revision) throw new Error('Record changed. Read its current revision and retry.')
    next = replacePassage(r.text, find, replacement, raw.section === undefined ? undefined : field(raw, 'section'))
    diff =
      '\n' +
      find
        .split('\n')
        .map(s => `- ${s}`)
        .concat(replacement.split('\n').map(s => `+ ${s}`))
        .join('\n')
  }
  const bad = recordProblem(name, next)
  if (bad) throw new Error(bad)
  // A crash after committing an apply can leave its draft. Identical text is
  // already saved, so the same request can finish cleaning up without a write.
  const expected = action === 'apply' && r.text === next && r.revision ? r.revision : revision
  const written = await w.put({ [name]: { text: next, revision: expected } })
  const saved = written[name]
  if (!saved) throw new Error('Missing record after write.')
  const result = `${name} ${saved.revision}${diff}`
  if (action === 'apply') {
    try {
      await draft('remove', revision, next)
    } catch (error) {
      return `${result}\nThe record was saved. Check remaining drafts before editing again. ${String(error)}`
    }
  }
  return result
}
