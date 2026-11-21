// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
// Names in the release bundle. Only these upstream builds include the embedded engine.
export function beadsExecutable(platform: string, arch: string): string | null {
  const system = platform.toLowerCase()
  const os = system === 'windows_nt' || system === 'win32' ? 'windows' : system
  const machine = arch.toLowerCase()
  const cpu = ['amd64', 'x64', 'x86_64'].includes(machine) ? 'amd64' : ['aarch64', 'arm64'].includes(machine) ? 'arm64' : null
  if (!cpu || (os !== 'linux' && os !== 'darwin' && !(os === 'windows' && cpu === 'amd64'))) return null
  return `shift-bd-${os}_${cpu}${os === 'windows' ? '.exe' : ''}`
}

export type SbdCommand = './.shift/bin/sbd' | './.shift/bin/sbd.exe'

export async function installSbd(project: import('./project').Project): Promise<SbdCommand> {
  if (!project.store.beads) throw new Error('The bundled runtime is unavailable.')
  const path = (await project.store.beads(project.root, ['shift-install-sbd'])).trim()
  if (path !== './.shift/bin/sbd' && path !== './.shift/bin/sbd.exe')
    throw new Error('The bundled runtime did not confirm the sbd command.')
  return path
}

export function taskInstructions(command?: SbdCommand | null): string {
  return command
    ? `For tasks, run \`${command} prime\` from the project root. Use \`${command}\` wherever Beads shows \`bd\`.`
    : 'For tasks, call shift_setup(section="sbd") to prepare the project command. Run prime with the path it confirms. If setup fails, leave the conflicting path alone.'
}
