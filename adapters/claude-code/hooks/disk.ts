import type { EngineInterface } from 'claude-code'
import { beadsExecutable, dirname, loadProject, type Project, type Store } from './core/index'

// The core's store over Claude Code's files and processes.
export function claudeStore($: EngineInterface): Store {
  return {
    beads: async (root, args, stdin) => {
      const windows = (await $.env.get('OS')) === 'Windows_NT'
      const [os, arch] = windows
        ? ['Windows_NT', (await $.env.get('PROCESSOR_ARCHITECTURE')) ?? '']
        : (await $.process.run(['uname', '-sm'])).stdout.trim().split(/\s+/)
      const name = beadsExecutable(os ?? '', arch ?? '')
      if (!name) throw new Error(`No embedded Beads build for ${os}/${arch}.`)
      const argv = [`${$.plugin.root}/vendor/${name}`, root, ...args]
      if (args[0] === 'shift-history' || args[0] === 'shift-task') {
        const child = $.process.spawn({ argv, ...(stdin === undefined ? {} : { input: stdin }) })
        const stdout: string[] = [],
          stderr: string[] = []
        for (;;) {
          const piece = await child.next()
          if (piece.done) {
            if (piece.value.code !== 0) throw new Error(stderr.join('').trim() || 'Storage process failed.')
            return stdout.join('')
          }
          ;(piece.value.stream === 'stdout' ? stdout : stderr).push(piece.value.text)
        }
      }
      const run = await $.process.run(argv, stdin === undefined ? {} : { stdin })
      if (run.exitCode !== 0) throw new Error(run.stderr.trim() || `Beads exited with ${run.exitCode}.`)
      if (run.isStdoutTruncated) throw new Error('Task output exceeded the host process limit. Narrow the query.')
      return run.stdout
    },
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
    stamps: async path => {
      const entries = await $.fs.list(path).catch(() => [])

      return Object.fromEntries(entries.filter(entry => entry.kind === 'file').map(entry => [entry.name, `${entry.mtimeMs}:${entry.size}`]))
    },
    write: async (path, text) => {
      await $.fs.write(path, text)
    },
    exists: path => $.fs.exists(path),
    move: async (from, to) => {
      await $.process.run(['mkdir', '-p', dirname(to)])
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
  return loadProject(claudeStore($), await $.session.root(), await $.session.id())
}
