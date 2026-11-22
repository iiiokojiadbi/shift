// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { DIR, KNOWLEDGE, NAMES } from './layout'
import type { Project } from './project'
import { NEXT_SAVED, savedEntries } from './saved'
import type { KnowledgeFile, Recent, Work } from './types'

// The files the mod works on, as a harness gives them; paths are absolute.
export type Store = {
  nativeRecords?: boolean
  // The installed adapter owns the executable and the child process environment.
  beads?(root: string, args: readonly string[], stdin?: string): Promise<string>
  // The file's text; null when it is missing or unreadable.
  read(path: string): Promise<string | null>
  // Names of the folders or files right under `path`, sorted; none when it is missing.
  list(path: string, kind: 'dir' | 'file'): Promise<string[]>
  // The files right under `path`, each with a stamp that changes when the file does (its time and size), from one
  // listing and no reads: what the records' look after every tool can afford.
  stamps(path: string): Promise<Record<string, string>>
  // Writes the file whole, making its folders.
  write(path: string, text: string): Promise<void>
  exists(path: string): Promise<boolean>
  // Runs git with `args` in `root`: its exit code and what it printed; null when there is no git to run.
  git(root: string, args: readonly string[]): Promise<{ code: number; stdout: string } | null>
}

export async function readKnowledge({ store, root }: Project): Promise<KnowledgeFile[]> {
  return Promise.all(
    (await store.list(`${root}/${KNOWLEDGE}`, 'file'))
      .filter(name => name.endsWith('.md'))
      .map(async name => ({ name, text: (await store.read(`${root}/${KNOWLEDGE}/${name}`)) ?? '' })),
  )
}

// Read only the current records selected by this project's settings.
export async function readRecords(project: Project): Promise<Work | null> {
  const {
    root,
    store,
    settings: { files },
  } = project
  const base = `${root}/${DIR}`
  const board = await store.read(`${base}/${NAMES.board}`)
  if (board === null) return null
  return {
    board,
    knowledge: await readKnowledge(project),
    owner: await store.read(`${root}/${files.owner}`),
    glossary: await store.read(`${root}/${files.glossary}`),
    shift: await store.read(`${root}/${files.shift}`),
  }
}

// The last `count` shifts' about.md, oldest first, and how many shifts the project has in all.
export async function lastShifts(project: Project, count: number, exclude?: string, session?: string, preview = true): Promise<Recent> {
  const saved = await savedEntries(project, preview ? exclude : undefined, session)
  const entries = saved.filter(entry => !exclude || exclude === NEXT_SAVED || entry.id < exclude)
  return { total: entries.length, entries: entries.slice(Math.max(0, entries.length - count)).map(e => ({ name: e.id, about: e.about })) }
}

// The shifts the message after a shift recalls.
export function recentShifts(project: Project, current?: string, session?: string, preview = true): Promise<Recent> {
  return lastShifts(project, project.settings.historyLimit - 1, current, session, preview)
}
