// Creates offline marketplace payloads and platform-specific npm packages in a disposable release checkout.
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { embeddedTargets } from './native-packages'
import { checksums, sha256, stage, version } from './stage-beads'

const root = resolve(import.meta.dirname, '..')
const [assets, only, ...extra] = process.argv.slice(2)
if (!assets || extra.length) throw new Error('Usage: bun run beads:bundle <upstream-assets> [target]')
const targets = embeddedTargets
if (only && !targets.includes(only)) throw new Error(`No embedded runtime for ${only}.`)
const release = root
const manifest = JSON.parse(await readFile(join(release, 'adapters/npm/package.json'), 'utf8'))
const packages = join(release, 'beads-packages')
await mkdir(packages, { recursive: true })
const temp = await mkdtemp(join(packages, '.build-'))
try {
  await copyFile(join(root, 'runtime/beads/main.go'), join(temp, 'main.go'))
  for (const os of ['unix', 'windows']) await copyFile(join(root, `runtime/beads/run_${os}.go`), join(temp, `run_${os}.go`))
  for (const target of only ? [only] : targets) {
    const [os, arch] = target.split('_')
    const windows = os === 'windows'
    const suffix = windows ? '.exe' : ''
    const filename = `beads_${version}_${target}.${windows ? 'zip' : 'tar.gz'}`
    const payload = join(temp, 'payload')
    await copyFile(resolve(assets, filename), payload)
    const digest = await sha256(payload)
    if (digest !== checksums.get(target)) throw new Error(`Checksum mismatch for ${filename}.`)

    const unpacked = await stage(resolve(assets, filename), temp)
    const binaryDigest = await sha256(unpacked)
    const command = `shift-bd-${target}${suffix}`
    const native = join(temp, command)
    execFileSync(
      'go',
      [
        'build',
        '-trimpath',
        '-ldflags',
        `-s -w -X main.digest=${digest} -X main.binaryDigest=${binaryDigest}`,
        '-o',
        native,
        'main.go',
        windows ? 'run_windows.go' : 'run_unix.go',
      ],
      {
        cwd: temp,
        env: { ...process.env, GOOS: os, GOARCH: arch, CGO_ENABLED: '0' },
        stdio: 'inherit',
      },
    )
    for (const adapter of ['adapters/claude-code', 'adapters/codex/plugin']) {
      const vendor = join(release, adapter, 'vendor')
      await mkdir(vendor, { recursive: true })
      await copyFile(native, join(vendor, command))
    }
    const platform = windows ? 'win32' : os
    const cpu = arch === 'amd64' ? 'x64' : arch
    const name = `${manifest.name}-beads-${platform}-${cpu}`
    if (manifest.optionalDependencies?.[name] !== manifest.version)
      throw new Error(`Expected ${name}@${manifest.version} in optionalDependencies`)
    const pkg = join(packages, target)
    await mkdir(pkg, { recursive: true })
    await rename(native, join(pkg, command))
    await copyFile(join(unpacked, '..', 'LICENSE'), join(pkg, 'LICENSE'))
    await writeFile(
      join(pkg, 'package.json'),
      JSON.stringify(
        {
          name,
          version: manifest.version,
          license: 'MIT',
          os: [platform],
          cpu: [cpu],
          files: [command, 'LICENSE'],
          description: 'Private task runtime for Shift.',
          repository: manifest.repository,
        },
        null,
        2,
      ),
    )
    console.log(`${target}: ${name}@${manifest.version} and both marketplace payloads`)
  }
} finally {
  await rm(temp, { recursive: true, force: true })
}
