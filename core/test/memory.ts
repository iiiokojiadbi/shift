import type { Store } from '../src/store'

// A store over a map of absolute paths to texts, for testing the core's flows without a harness.
export function memoryStore(seed: Record<string, string> = {}, ignored = true): Store & { files: Map<string, string> } {
  const files = new Map(Object.entries(seed))
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
    write: async (path, text) => {
      files.set(path, text)
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
    isIgnored: async () => ignored,
  }
}
