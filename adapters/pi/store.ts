import { execFile } from 'node:child_process'
import { access, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { loadProject, type Project, type Store } from './core/index'

// The core's store over node's files and processes: an extension runs inside pi's own node process.
export const nodeStore: Store = {
  read: path => readFile(path, 'utf8').catch(() => null),
  list: async (path, kind) => {
    const entries = await readdir(path, { withFileTypes: true }).catch(() => [])

    return entries
      .filter(entry => (kind === 'dir' ? entry.isDirectory() : entry.isFile()))
      .map(entry => entry.name)
      .sort()
  },
  stamps: async path => {
    const entries = await readdir(path, { withFileTypes: true }).catch(() => [])
    const files = entries.filter(entry => entry.isFile())
    const stats = await Promise.all(files.map(entry => stat(`${path}/${entry.name}`).catch(() => null)))

    return Object.fromEntries(files.flatMap((entry, i) => (stats[i] ? [[entry.name, `${stats[i].mtimeMs}:${stats[i].size}`]] : [])))
  },
  write: async (path, text) => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text)
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
