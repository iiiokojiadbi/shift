// Release variants are assembled in the checkout that will be tagged.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sha256 } from './stage-beads'

export const embeddedTargets = ['linux_amd64', 'linux_arm64', 'darwin_amd64', 'darwin_arm64', 'windows_amd64']

export function platformBuild(target: string, main: { name: string; version: string }) {
  const [goos, goarch] = target.split('_')
  const os = goos === 'windows' ? 'win32' : goos
  const cpu = goarch === 'amd64' ? 'x64' : goarch
  const tag = `${os}-${cpu}`
  const version = `${main.version}-${tag}`
  return {
    os,
    cpu,
    tag,
    version,
    alias: `${main.name}-runtime-${tag}`,
    reference: `${main.name}@${version}`,
    executable: `shift-bd-${target}${goos === 'windows' ? '.exe' : ''}`,
  }
}

export async function nativePackages(root: string, main: { name: string; version: string; optionalDependencies: Record<string, string> }) {
  const packages = []
  const expected = Object.fromEntries(
    embeddedTargets.map(target => {
      const variant = platformBuild(target, main)
      return [variant.alias, `npm:${variant.reference}`]
    }),
  )
  assert.deepEqual(main.optionalDependencies, expected)
  for (const target of embeddedTargets) {
    const variant = platformBuild(target, main)
    const dir = join(root, 'beads-packages', target)
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    assert.equal(manifest.name, main.name)
    assert.equal(manifest.version, variant.version)
    assert.deepEqual(manifest.os, [variant.os])
    assert.deepEqual(manifest.cpu, [variant.cpu])
    const hash = await sha256(join(dir, variant.executable))
    for (const path of ['adapters/codex/plugin', 'adapters/claude-code'])
      assert.equal(await sha256(join(root, path, 'vendor', variant.executable)), hash, `Different marketplace binary for ${target}`)
    const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: dir, encoding: 'utf8' }))
    assert.deepEqual(pack.files.map((entry: { path: string }) => entry.path).sort(), ['LICENSE', 'package.json', variant.executable])
    console.log(`${variant.reference}: ${(pack.size / 1_000_000).toFixed(1)} MB`)
    packages.push({ ...variant, dir, integrity: pack.integrity as string })
  }
  return packages
}
