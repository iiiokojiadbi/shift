// A small stand-in for the native process protocol. The Go archive tests exercise
// transactions, retention, retries and the on-disk format.
type Entry = { id: string; about: string; state: string; files: Record<string, string> }
export type ArchiveFixture = {
  working?: Record<string, { revision: string; text: string }>
  entries: Entry[]
  waiting: Record<string, string>
}
export const emptyArchive = (): ArchiveFixture => ({ entries: [], waiting: {} })

export function archiveFixture(state: ArchiveFixture, stdin: string): string {
  const query = JSON.parse(stdin)
  const entry = state.entries.find(item => item.id === query.id)
  switch (query.action) {
    case 'working-list':
      return JSON.stringify(state.working ?? {})
    case 'working-write': {
      state.working ??= {}
      for (const [key, change] of Object.entries(query.changes as Record<string, { revision: string; text: string }>)) {
        if ((state.working[key]?.revision ?? '') !== change.revision) throw new Error('Working record changed.')
        state.working[key] = { revision: String(Number(change.revision) + 1), text: change.text }
      }
      return JSON.stringify(state.working)
    }
    case 'begin': {
      const prior = state.entries.find(item => item.id === query.compare)
      if (
        prior &&
        Object.keys(prior.files).filter(name => name !== 'summary.md').length === Object.keys(query.files).length &&
        Object.entries(query.files).every(([name, value]) => prior.files[name] === value)
      )
        return '""'
      const id = `s-${(state.entries.length + 1).toString(16).padStart(16, '0')}`
      state.entries.push({ id, about: query.about, state: 'pending', files: query.files })
      return JSON.stringify(id)
    }
    case 'finish':
      if (!entry) throw new Error('Unknown saved shift')
      entry.state = query.state
      entry.about = query.about
      Object.assign(entry.files, query.files)
      if (query.session && query.state === 'complete') {
        if (query.wait) state.waiting[query.session] = entry.id
        else delete state.waiting[query.session]
      }
      return JSON.stringify(entry.id)
    case 'list':
      return JSON.stringify(state.entries.map(({ id, about, state }) => ({ id, about, state })))
    case 'read':
      if (!entry) throw new Error('Unknown saved shift')
      return JSON.stringify({ ...entry, files: query.file ? { [query.file]: entry.files[query.file] } : entry.files })
    case 'waiting':
      return JSON.stringify(state.waiting[query.session] ?? '')
    case 'received': {
      const id = state.waiting[query.session] ?? ''
      if (id === query.id) delete state.waiting[query.session]
      return JSON.stringify(id)
    }
    default:
      throw new Error(`Unexpected archive operation: ${query.action}`)
  }
}
