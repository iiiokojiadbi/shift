import type { EngineInterface } from 'claude-code'
import type { Store } from './core/index'

// The core's store over Claude Code's files and processes.
export function claudeStore($: EngineInterface): Store {
  return {
    read: path =>
      $.fs.read(path).then(
        text => (typeof text === 'string' ? text : null),
        () => null,
      ),
    list: async (path, kind) => {
      const entries = await $.fs.list(path).catch(() => [])

      return entries
        .filter(entry => entry.kind === kind)
        .map(entry => entry.name)
        .sort()
    },
    write: async (path, text) => {
      await $.fs.write(path, text)
    },
    exists: path => $.fs.exists(path),
    move: async (from, to) => {
      await $.process.run(['mkdir', '-p', to.slice(0, to.lastIndexOf('/'))])
      const moved = await $.process.run(['mv', from, to])

      return moved.exitCode === 0 ? null : moved.stderr.trim()
    },
    // 1 — not ignored; 128 — not a git repository, nothing to keep out.
    isIgnored: async (root, path) => (await $.process.run(['git', '-C', root, 'check-ignore', '-q', path])).exitCode !== 1,
    // git names it relative to the root, or absolute in a linked worktree.
    excludeFile: async root => {
      const found = await $.process.run(['git', '-C', root, 'rev-parse', '--git-path', 'info/exclude'])
      const path = found.stdout.trim()
      if (found.exitCode !== 0 || path === '') return null

      return path.startsWith('/') ? path : `${root}/${path}`
    },
  }
}
