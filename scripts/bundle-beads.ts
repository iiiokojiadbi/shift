// Creates offline marketplace payloads and Shift's platform versions for npm.
import { execFileSync } from 'node:child_process'
import { copyFile, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { embeddedTargets, platformBuild } from './native-packages'
import { checksums, sha256, stage, version } from './stage-beads'

const root = resolve(import.meta.dirname, '..')
const [assets, only, ...extra] = process.argv.slice(2)
if (!assets || extra.length) throw new Error('Usage: bun run beads:bundle <upstream-assets> [target]')
const targets = embeddedTargets
if (only && !targets.includes(only)) throw new Error(`No embedded runtime for ${only}.`)
const manifest = JSON.parse(await readFile(join(root, 'adapters/npm/package.json'), 'utf8'))
const packages = join(root, 'beads-packages')
await mkdir(packages, { recursive: true })
const temp = await mkdtemp(join(packages, '.build-'))
try {
  await cp(join(root, 'runtime/beads'), temp, { recursive: true })
  for (const target of only ? [only] : targets) {
    const [os, arch] = target.split('_')
    const variant = platformBuild(target, manifest)
    if (manifest.optionalDependencies?.[variant.alias] !== `npm:${variant.reference}`)
      throw new Error(`Expected ${variant.alias} to select ${variant.reference}`)
    const windows = os === 'windows'
    const filename = `beads_${version}_${target}.${windows ? 'zip' : 'tar.gz'}`
    const payload = join(temp, 'payload')
    await copyFile(resolve(assets, filename), payload)
    const digest = await sha256(payload)
    if (digest !== checksums.get(target)) throw new Error(`Checksum mismatch for ${filename}.`)

    const unpacked = await stage(resolve(assets, filename), temp)
    const binaryDigest = await sha256(unpacked)
    const command = variant.executable
    const native = join(temp, command)
    execFileSync(
      'go',
      [
        'build',
        '-trimpath',
        '-buildvcs=false',
        '-ldflags',
        `-s -w -X main.digest=${digest} -X main.binaryDigest=${binaryDigest}`,
        '-o',
        native,
        '.',
      ],
      {
        cwd: temp,
        env: { ...process.env, GOOS: os, GOARCH: arch, CGO_ENABLED: '0' },
        stdio: 'inherit',
      },
    )
    for (const adapter of ['adapters/claude-code', 'adapters/codex/plugin']) {
      const vendor = join(root, adapter, 'vendor')
      await mkdir(vendor, { recursive: true })
      await copyFile(native, join(vendor, command))
    }
    const runtime = join(packages, target)
    await mkdir(runtime, { recursive: true })
    await rename(native, join(runtime, command))
    await copyFile(join(unpacked, '..', 'LICENSE'), join(runtime, 'LICENSE'))
    const pkg = {
      name: manifest.name,
      version: variant.version,
      license: 'MIT',
      os: [variant.os],
      cpu: [variant.cpu],
      files: ['LICENSE', command],
      description: `Native runtime for Shift on ${variant.tag}.`,
      repository: manifest.repository,
    }
    await writeFile(join(runtime, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)
    console.log(`${variant.reference}: ${command} and both marketplace payloads`)
  }
} finally {
  await rm(temp, { recursive: true, force: true })
}
