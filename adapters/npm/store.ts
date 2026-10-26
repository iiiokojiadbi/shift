import { execFile } from 'node:child_process'
import type { Stats } from 'node:fs'
import { access, chmod, mkdir, readdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { loadProject, type Project, type Store } from './core/index'

// The core's store over node's files and processes: pi runs an extension in its own node process, opencode a plugin
// in its server under Bun.
export const nodeStore: Store = {
  read: path => readFile(path, 'utf8').catch(() => null),
  list: async (path, kind) => {
    const entries = await kinds(path)

    return entries
      .filter(entry => entry.kind === kind)
      .map(entry => entry.name)
      .sort()
  },
  stamps: async path => {
    const files = (await kinds(path)).filter(entry => entry.kind === 'file')

    return Object.fromEntries(files.map(entry => [entry.name, `${entry.stats.mtimeMs}:${entry.stats.size}`]))
  },
  // Written whole or not at all: a write that fails half way leaves the record as it was. A link is written through,
  // as an editor would, and the file keeps its mode.
  write: async (path, text) => {
    await mkdir(dirname(path), { recursive: true })
    const target = await realpath(path).catch(() => path)
    const mode = await stat(target).then(
      found => found.mode,
      () => null,
    )
    const temporary = `${dirname(target)}/.${basename(target)}.${process.pid}.tmp`
    try {
      await writeFile(temporary, text)
      if (mode !== null) await chmod(temporary, mode)
      await rename(temporary, target)
    } catch (error) {
      await unlink(temporary).catch(() => undefined)
      throw error
    }
  },
  exists: path =>
    access(path).then(
      () => true,
      () => false,
    ),
  move: async (from, to) => {
    try {
      await mkdir(dirname(to), { recursive: true })
      await rename(from, to)

      return null
    } catch (error) {
      return String(error)
    }
  },
  git: (root, args) =>
    new Promise(done => {
      execFile('git', ['-C', root, ...args], (error, stdout) => {
        // A number is git's exit code; a string (ENOENT) means there is no git to run.
        const code = error === null ? 0 : error.code
        done(typeof code === 'number' ? { code, stdout } : null)
      })
    }),
}

// The project at `root`, loaded once for the event or tool call at hand.
export function projectAt(root: string): Promise<Project> {
  return loadProject(nodeStore, root)
}

// A folder's files and folders, a link counted as what it points to; an entry that cannot be read is left out.
async function kinds(path: string): Promise<{ name: string; kind: 'file' | 'dir'; stats: Stats }[]> {
  const entries = await readdir(path).catch(() => [] as string[])
  const found = await Promise.all(
    entries.map(async entry => {
      const stats = await stat(`${path}/${entry}`).catch(() => null)
      if (stats === null) return []
      const kind = stats.isDirectory() ? ('dir' as const) : stats.isFile() ? ('file' as const) : null

      return kind === null ? [] : [{ name: entry, kind, stats }]
    }),
  )

  return found.flat()
}
