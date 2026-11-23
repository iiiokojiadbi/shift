import { execFile } from 'node:child_process'
import type { Stats } from 'node:fs'
import { access, chmod, link, mkdir, readdir, readFile, readlink, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, resolve } from 'node:path'
import { promisify } from 'node:util'
import { beadsExecutable, loadProject, type Project, type Store } from './core/index'

declare const SHIFT_MARKETPLACE: boolean

let writes = 0

// The core's store over node's files and processes: pi runs an extension in its own node process, opencode a plugin
// in its server under Bun.
export const nodeStore: Store = {
  nativeRecords: true,
  beads: async (root, args, stdin) => {
    const executable = beadsExecutable(process.platform, process.arch)
    if (!executable) throw new Error(`No embedded Beads build for ${process.platform}/${process.arch}.`)
    let path: string
    if (typeof SHIFT_MARKETPLACE !== 'undefined' && SHIFT_MARKETPLACE) {
      path = resolve(import.meta.dirname, 'vendor', executable)
    } else {
      const require = createRequire(import.meta.url)
      const own = require('./package.json')
      const platform = `${process.platform}-${process.arch}`
      const alias = `${own.name}-runtime-${platform}`
      const native = require.resolve(`${alias}/package.json`)
      const installed = JSON.parse(await readFile(native, 'utf8'))
      if (installed.name !== own.name || installed.version !== `${own.version}-${platform}`)
        throw new Error(`Bundled runtime for ${platform} does not match the installed Shift version.`)
      path = resolve(dirname(native), executable)
    }
    const child = promisify(execFile)(path, [root, ...args], { timeout: 30_000, maxBuffer: 64 * 1024 * 1024 })
    if (stdin !== undefined) {
      child.child.stdin?.on('error', () => undefined)
      child.child.stdin?.end(stdin)
    }
    return (await child).stdout
  },
  read: path => readFile(path, 'utf8').catch(() => null),
  directoryIdentity: path => realpath(path).catch(() => null),
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
  write: async (path, text, expected) => {
    await mkdir(dirname(path), { recursive: true })
    const target = await through(path)
    const mode = await stat(target).then(
      found => found.mode,
      () => null,
    )
    // Its own temporary file for each write: two writes of one file at once never mix.
    const temporary = `${dirname(target)}/.${basename(target)}.${process.pid}.${++writes}.tmp`
    try {
      await writeFile(temporary, text)
      if (mode !== null) await chmod(temporary, mode)
      if (expected === null) {
        // Publish the complete file only if no editor created it meanwhile.
        await link(temporary, target)
        await unlink(temporary)
      } else {
        if (expected !== undefined && (await readFile(target, 'utf8')) !== expected)
          throw new Error('Settings changed during initialization.')
        await rename(temporary, target)
      }
    } catch (error) {
      await unlink(temporary).catch(() => undefined)
      throw error
    }
  },
  exists: async (path, mode) => {
    try {
      await access(path)
      return true
    } catch (error) {
      if (mode === 'checked' && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return false
    }
  },
  git: (root, args) =>
    new Promise(done => {
      execFile('git', ['-C', root, ...args], { env: { ...process.env, LC_ALL: 'C' } }, (error, stdout, stderr) => {
        // A number is git's exit code; a string (ENOENT) means there is no git to run.
        const code = error === null ? 0 : error.code
        done(typeof code === 'number' ? { code, stdout, stderr } : null)
      })
    }),
}

// The project at `root`, loaded once for the event or tool call at hand.
export function projectAt(root: string, actor?: string, letterSession?: string, lifecycle?: 'start'): Promise<Project> {
  return loadProject(nodeStore, root, actor, letterSession, lifecycle)
}

// The file a write goes to: a link's target, through a chain of links, even one not there yet; a cycle of links is
// refused, never written over. As many links as the system follows: 40, and the file they end at.
const MAX_LINKS = 40

async function through(path: string): Promise<string> {
  const real = await realpath(path).catch(() => null)
  if (real !== null) return real
  let at = path
  for (let hop = 0; hop <= MAX_LINKS; hop++) {
    const link = await readlink(at).catch(() => null)
    if (link === null) return at
    at = resolve(dirname(at), link)
  }

  throw new Error(`${path}: too many links, or a cycle of them`)
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
