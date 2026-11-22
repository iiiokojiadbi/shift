// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { BOARD, DIR, GLOSSARY, KNOWLEDGE, LETTER, OWNER, SHIFT_FILE } from './layout'
import { basename, dirname, fromRoot } from './paths'
import type { Project } from './project'
import { ownerRevisionProblem, recordProblem } from './records'
import { ARCHIVE_DB, archiveCall } from './saved'
import type { Store } from './store'

export type CurrentRecord = { revision: string; text: string }
type Current = Record<string, CurrentRecord>
const names: string[] = [BOARD, LETTER, OWNER, GLOSSARY, SHIFT_FILE]
const fileKeys: Record<string, 'owner' | 'glossary'> = {
  [OWNER]: 'owner',
  [GLOSSARY]: 'glossary',
} as const

// A project object lives for one operation. Its first record read takes a
// consistent view; revisions fence both later edits and snapshot acceptance.
export class WorkingRecords {
  private loaded: Promise<Current> | undefined
  constructor(
    private project: Project,
    readonly disk: Store,
    readonly session: string,
  ) {}

  all(): Promise<Current> {
    this.loaded ??= this.disk
      .exists(`${this.project.root}/${ARCHIVE_DB}`)
      .then(exists => (exists ? archiveCall<Current>(this.project, { action: 'working-list', session: this.session }) : {}))
    return this.loaded
  }

  async revisions() {
    return Object.fromEntries(Object.entries(await this.all()).map(([name, r]) => [name, r.revision]))
  }

  key(path: string) {
    const p = fromRoot(this.project.root, path)
    if (this.project.settings.commit || this.project.settings.files.always.includes(p)) return null
    for (const key of ['owner', 'glossary'] as const) {
      if (this.project.set.has(`files.${key}`) && this.project.settings.files[key] === p) return null
    }
    const key = fileKeys[p]
    if (key && (this.project.set.has(`files.${key}`) || this.project.settings.files[key] !== p)) return null
    if (
      !names.includes(p) &&
      !(dirname(p) === KNOWLEDGE && !basename(p).includes('\\') && basename(p).endsWith('.md') && basename(p).length > 3)
    )
      return null
    return p.slice(DIR.length + 1)
  }

  async put(changes: Current, session = this.session) {
    const before = await this.all()
    const updated = await archiveCall<Current>(this.project, { action: 'working-write', session, changes })
    this.loaded =
      session === this.session
        ? Promise.resolve({ ...before, ...Object.fromEntries(Object.entries(updated).filter(([n]) => Object.hasOwn(changes, n))) })
        : undefined
    return updated
  }

  async remove(file: string, revision: string) {
    await archiveCall(this.project, { action: 'working-delete', file, revision })
    this.loaded = undefined
  }

  async importFiles() {
    const { root } = this.project
    const paths = [...names, ...(await this.disk.list(`${root}/${KNOWLEDGE}`, 'file')).map(n => `${KNOWLEDGE}/${n}`)]
    const current = await archiveCall<Current>(this.project, { action: 'working-list', session: '' })
    const changes: Current = {}
    for (const path of paths) {
      const name = this.key(path)
      if (!name || current[name] || !(await this.disk.exists(`${root}/${path}`))) continue
      const text = await this.disk.read(`${root}/${path}`)
      if (text === null) throw new Error(`Cannot import ${path}; existing file is unreadable.`)
      const problem = recordProblem(name, text, true) ?? (path === OWNER ? await ownerRevisionProblem(this.project, text) : null)
      if (problem) throw new Error(`Cannot import ${path}: ${problem}`)
      changes[name] = { text, revision: '' }
    }
    if (Object.keys(changes).length) await this.put(changes, '')
    return Object.keys(changes)
  }

  store(): Store {
    const disk = this.disk
    const entries = async (path: string): Promise<[string, CurrentRecord][]> => {
      const dir = fromRoot(this.project.root, path)
      if (dir !== DIR && dir !== KNOWLEDGE) return []
      return Object.entries(await this.all()).filter(([n]) => dirname(`${DIR}/${n}`) === dir && this.key(`${DIR}/${n}`))
    }
    return {
      ...disk,
      read: async path => {
        const key = this.key(path)
        return (key && (await this.all())[key]?.text) ?? disk.read(path)
      },
      exists: async path => {
        const key = this.key(path)
        return !!(key && (await this.all())[key]) || (await disk.exists(path))
      },
      write: async (path, text, expected) => {
        const key = this.key(path)
        if (!key) return disk.write(path, text, expected)
        const old = (await this.all())[key]
        // Existing loose files remain editable until an explicit import.
        if (!old && (await disk.exists(path))) return disk.write(path, text, expected)
        if (expected !== undefined && (old?.text ?? null) !== expected) throw new Error('Record changed during initialization.')
        await this.put({ [key]: { text, revision: old?.revision ?? '' } })
      },
      list: async (path, kind) => {
        const physical = await disk.list(path, kind)
        if (kind !== 'file') return physical
        return [...new Set([...physical, ...(await entries(path)).map(([name]) => basename(name))])].sort()
      },
      stamps: async path => {
        const result = await disk.stamps(path)
        for (const [name, entry] of await entries(path)) result[basename(name)] = entry.revision
        return result
      },
    }
  }
}
