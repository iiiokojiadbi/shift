import { DIR, KNOWLEDGE, NAMES } from './layout'
import type { Project } from './project'
import { savedEntries } from './saved'
import { historyWindow } from './settings'
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
  // Settings initialization supplies the text it read, or null to create a missing file.
  write(path: string, text: string, expected?: string | null): Promise<void>
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
export async function lastShifts(
  project: Project,
  count: number,
  current?: string,
  session?: string,
  preview = true,
  letters = 0,
): Promise<Recent> {
  const saved = await savedEntries(project, { current, session, preview, letters })
  return {
    total: saved.length,
    entries: saved.slice(Math.max(0, saved.length - count)).map(e => ({
      name: e.id,
      about: e.about,
      ...(e.files?.[NAMES.letter] === undefined ? {} : { letter: e.files[NAMES.letter] }),
    })),
  }
}

// The current letter occupies the last full slot and is delivered separately.
export function recentShifts(project: Project, current?: string, session?: string, preview = true): Promise<Recent> {
  return lastShifts(project, historyWindow(project.settings) - 1, current, session, preview, project.settings.history.full - 1)
}
