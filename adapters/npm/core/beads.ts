// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { keepRecordsOut } from './privacy'

// Names in the release bundle. Only these upstream builds include the embedded engine.
export function beadsExecutable(platform: string, arch: string): string | null {
  const system = platform.toLowerCase()
  const os = system === 'windows_nt' || system === 'win32' ? 'windows' : system
  const machine = arch.toLowerCase()
  const cpu = ['amd64', 'x64', 'x86_64'].includes(machine) ? 'amd64' : ['aarch64', 'arm64'].includes(machine) ? 'arm64' : null
  if (!cpu || (os !== 'linux' && os !== 'darwin' && !(os === 'windows' && cpu === 'amd64'))) return null
  return `shift-bd-${os}_${cpu}${os === 'windows' ? '.exe' : ''}`
}

export type TaskCommandPath = './.shift/bin/shift-task' | './.shift/bin/shift-task.exe'

export async function installTaskCommand(project: import('./project').Project): Promise<TaskCommandPath> {
  if (!project.store.beads) throw new Error('The bundled runtime is unavailable.')
  const kept = await keepRecordsOut(project)
  if ('deny' in kept) throw new Error(kept.deny)
  const path = (await project.store.beads(project.root, ['shift-install-task'])).trim()
  if (path !== './.shift/bin/shift-task' && path !== './.shift/bin/shift-task.exe')
    throw new Error('The bundled runtime did not confirm the shift-task command.')
  return path
}

export function taskInstructions(command?: TaskCommandPath | null): string {
  return command
    ? `Use \`${command}\` from the project root for all tracker commands. Start with \`show <id>\` for a named issue or \`ready --parent <epic>\` for available work in an epic. Claim with \`update <id> --claim\`. A prerequisite is \`dep add <dependent> <prerequisite>\`. Close with \`close <id> --reason <result>\`. For the Beads reference run \`${command} prime\`; use this executable wherever it shows \`bd\`.`
    : 'To use the built-in shift-task tracker, call shift_setup(section="tasks") to prepare the project command. Run prime with the path it confirms. If setup fails, leave the conflicting path alone.'
}
