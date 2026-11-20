// Names in the release bundle. Only these upstream builds include the embedded engine.
export function beadsExecutable(platform: string, arch: string): string | null {
  const system = platform.toLowerCase()
  const os = system === 'windows_nt' || system === 'win32' ? 'windows' : system
  const machine = arch.toLowerCase()
  const cpu = ['amd64', 'x64', 'x86_64'].includes(machine) ? 'amd64' : ['aarch64', 'arm64'].includes(machine) ? 'arm64' : null
  if (!cpu || (os !== 'linux' && os !== 'darwin' && !(os === 'windows' && cpu === 'amd64'))) return null
  return `shift-bd-${os}_${cpu}${os === 'windows' ? '.exe' : ''}`
}
