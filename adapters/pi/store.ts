import { execFile } from 'node:child_process'
import { access, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { Store } from './core/index'

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
  // 1 — not ignored; 128 — not a git repository, nothing to keep out.
  // git names it relative to the root, or absolute in a linked worktree.
  excludeFile: root =>
    new Promise(done => {
      execFile('git', ['-C', root, 'rev-parse', '--git-path', 'info/exclude'], (error, stdout) => {
        const path = stdout.trim()
        done(error !== null || path === '' ? null : resolve(root, path))
      })
    }),
  isIgnored: (root, path) =>
    new Promise(done => {
      execFile('git', ['-C', root, 'check-ignore', '-q', path], error => done(error?.code !== 1))
    }),
}
