import type { EngineInterface } from 'claude-code'
import { loadProject, type Project, type Store } from './core/index'

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
    git: async (root, args) => {
      const ran = await $.process.run(['git', '-C', root, ...args]).catch(() => null)

      return ran === null ? null : { code: ran.exitCode, stdout: ran.stdout }
    },
  }
}

// The session's project, loaded once for the hook or tool call at hand.
export async function projectOf($: EngineInterface): Promise<Project> {
  return loadProject(claudeStore($), await $.session.root())
}
