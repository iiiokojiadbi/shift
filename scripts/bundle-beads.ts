// Creates offline marketplace payloads and the shared npm runtime in a disposable release checkout.
import { execFileSync } from 'node:child_process'
import { copyFile, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { embeddedTargets, executableFor, nativePackageDir } from './native-packages'
import { checksums, sha256, stage, version } from './stage-beads'

const root = resolve(import.meta.dirname, '..')
const [assets, only, ...extra] = process.argv.slice(2)
if (!assets || extra.length) throw new Error('Usage: bun run beads:bundle <upstream-assets> [target]')
const targets = embeddedTargets
if (only && !targets.includes(only)) throw new Error(`No embedded runtime for ${only}.`)
const manifest = JSON.parse(await readFile(join(root, 'adapters/npm/package.json'), 'utf8'))
const name = `${manifest.name}-beads`
if (manifest.dependencies?.[name] !== manifest.version) throw new Error(`Expected ${name}@${manifest.version} in dependencies`)
const runtime = join(root, nativePackageDir)
const packages = join(root, 'beads-packages')
await mkdir(runtime, { recursive: true })
const temp = await mkdtemp(join(packages, '.build-'))
try {
  await cp(join(root, 'runtime/beads'), temp, { recursive: true })
  for (const target of only ? [only] : targets) {
    const [os, arch] = target.split('_')
    const windows = os === 'windows'
    const filename = `beads_${version}_${target}.${windows ? 'zip' : 'tar.gz'}`
    const payload = join(temp, 'payload')
    await copyFile(resolve(assets, filename), payload)
    const digest = await sha256(payload)
    if (digest !== checksums.get(target)) throw new Error(`Checksum mismatch for ${filename}.`)

    const unpacked = await stage(resolve(assets, filename), temp)
    const binaryDigest = await sha256(unpacked)
    const command = executableFor(target)
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
    await rename(native, join(runtime, command))
    await copyFile(join(unpacked, '..', 'LICENSE'), join(runtime, 'LICENSE'))
    console.log(`${target}: ${command} in the npm runtime and both marketplace payloads`)
  }
  const pkg = {
    name,
    version: manifest.version,
    license: 'MIT',
    files: ['LICENSE', ...targets.map(executableFor)],
    description: 'Native runtime for Shift records and project tasks.',
    repository: manifest.repository,
  }
  await writeFile(join(runtime, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)
} finally {
  await rm(temp, { recursive: true, force: true })
}
