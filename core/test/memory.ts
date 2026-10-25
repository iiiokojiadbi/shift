import { loadProject, type Project } from '../src/project'
import type { Store } from '../src/store'

// A store over a map of absolute paths to texts, for testing the core's flows without a harness.
export function memoryStore(seed: Record<string, string> = {}, ignored = true): Store & { files: Map<string, string> } {
  const files = new Map(Object.entries(seed))
  // Every write stamps its file anew, as a file's time does, whatever the text.
  const stamps = new Map<string, number>()
  let clock = 0
  const under = (path: string) => [...files.keys()].filter(key => key.startsWith(`${path}/`)).map(key => key.slice(path.length + 1))

  return {
    files,
    read: async path => files.get(path) ?? null,
    list: async (path, kind) => {
      const names = under(path)
        .filter(rest => rest.includes('/') === (kind === 'dir'))
        .map(rest => rest.split('/')[0] ?? rest)

      return [...new Set(names)].sort()
    },
    stamps: async path =>
      Object.fromEntries(
        under(path)
          .filter(rest => !rest.includes('/'))
          .map(name => [name, String(stamps.get(`${path}/${name}`) ?? 0)]),
      ),
    write: async (path, text) => {
      files.set(path, text)
      stamps.set(path, ++clock)
    },
    exists: async path => files.has(path) || under(path).length > 0,
    move: async (from, to) => {
      const moved = under(from)
      if (moved.length === 0) return `no such folder: ${from}`
      for (const rest of moved) {
        files.set(`${to}/${rest}`, files.get(`${from}/${rest}`) ?? '')
        files.delete(`${from}/${rest}`)
      }

      return null
    },
    // check-ignore answers 0 when ignored and 1 when not; rev-parse names the exclude file from the root.
    git: async (_root, args) =>
      args[0] === 'check-ignore' ? { code: ignored ? 0 : 1, stdout: '' } : { code: 0, stdout: '.git/info/exclude\n' },
  }
}

// The project at `root` over a memory store, loaded as an operation of the mod loads it.
export async function memoryProject(
  seed: Record<string, string> = {},
  root = '/p',
  ignored = true,
): Promise<Project & { files: Map<string, string> }> {
  const store = memoryStore(seed, ignored)

  return { ...(await loadProject(store, root)), files: store.files }
}
