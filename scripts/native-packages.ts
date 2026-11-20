// Release packages are assembled in the checkout that will be tagged.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sha256 } from './stage-beads'

export const embeddedTargets = ['linux_amd64', 'linux_arm64', 'darwin_amd64', 'darwin_arm64', 'windows_amd64']

export async function nativePackages(root: string, main: { name: string; version: string; optionalDependencies: Record<string, string> }) {
  const packages = []
  for (const target of embeddedTargets) {
    const [os, arch] = target.split('_')
    const platform = os === 'windows' ? 'win32' : os
    const cpu = arch === 'amd64' ? 'x64' : arch
    const name = `${main.name}-beads-${platform}-${cpu}`
    const binary = `shift-bd-${target}${os === 'windows' ? '.exe' : ''}`
    const dir = join(root, 'beads-packages', target)
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    assert.equal(main.optionalDependencies[name], main.version)
    assert.equal(manifest.name, name)
    assert.equal(manifest.version, main.version)
    assert.deepEqual(manifest.os, [platform])
    assert.deepEqual(manifest.cpu, [cpu])
    const hash = await sha256(join(dir, binary))
    for (const path of ['adapters/codex/plugin', 'adapters/claude-code'])
      assert.equal(await sha256(join(root, path, 'vendor', binary)), hash, `Different marketplace binary for ${target}`)
    const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: dir, encoding: 'utf8' }))
    assert.deepEqual(pack.files.map((entry: { path: string }) => entry.path).sort(), ['LICENSE', 'package.json', binary])
    packages.push({ dir, reference: `${name}@${main.version}`, integrity: pack.integrity as string })
  }
  return packages
}
