// Release packages are assembled in the checkout that will be tagged.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sha256 } from './stage-beads'

export const embeddedTargets = ['linux_amd64', 'linux_arm64', 'darwin_amd64', 'darwin_arm64', 'windows_amd64']

export const nativePackageDir = 'beads-packages/runtime'

export function executableFor(target: string) {
  return `shift-bd-${target}${target.startsWith('windows_') ? '.exe' : ''}`
}

export async function nativePackage(root: string, main: { name: string; version: string; dependencies: Record<string, string> }) {
  const name = `${main.name}-beads`
  const binaries = embeddedTargets.map(executableFor)
  const dir = join(root, nativePackageDir)
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  assert.equal(main.dependencies[name], main.version)
  assert.equal(manifest.name, name)
  assert.equal(manifest.version, main.version)
  for (const binary of binaries) {
    const hash = await sha256(join(dir, binary))
    for (const path of ['adapters/codex/plugin', 'adapters/claude-code'])
      assert.equal(await sha256(join(root, path, 'vendor', binary)), hash, `Different marketplace binary for ${binary}`)
  }
  const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: dir, encoding: 'utf8' }))
  assert.deepEqual(pack.files.map((entry: { path: string }) => entry.path).sort(), ['LICENSE', 'package.json', ...binaries.sort()])
  console.log(`Native tarball: ${pack.files.length} files, ${(pack.size / 1_000_000).toFixed(1)} MB`)
  return { dir, reference: `${name}@${main.version}`, integrity: pack.integrity as string }
}
