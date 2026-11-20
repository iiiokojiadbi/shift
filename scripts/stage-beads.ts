// Build-time staging only. Each target gets the complete, checksum-pinned upstream release.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

export const version = '1.3.4'
export const checksums = new Map([
  ['android_arm64', '8787357172f90a240ee42f3704a0776ceccfa773f1b16b8e47c0c1933e9949cf'],
  ['darwin_amd64', '05e713a2da8eeaba40b924184735d9a34d2da8669e4d3ac50cc716605ba10640'],
  ['darwin_arm64', 'b08a9c15bff80c42235f32946f94a6566a7d90944fe8afe45f3fd2f350596cdb'],
  ['freebsd_amd64', 'fb5166f90bc6f5e6abc4496624f93a8466214cc7f8dbfef4077d4de8f0d3d874'],
  ['linux_amd64', '175c26904bde3ff9168d2282ff6b56f17b17f60c22fa5acb3dacc9fb3465303a'],
  ['linux_arm64', 'f4ee6eb3ec79bb2d7eb9d717c73efbcb6fa763cc70f726b4d055b72afdd68ad5'],
  ['windows_amd64', 'e66e7b66c0d1ac6a878951462edddb4a177532aff3fc22989daac115feaaef11'],
  ['windows_arm64', '51de3ebe5b60e7dc6d4fe2817c7085cd593a33ad78d8dae9ce0f054457d80547'],
])

export async function sha256(path: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

// A concurrent build may have installed this target while this one was extracting.
async function matchesPayload(payload: string, destination: string) {
  if (!(await lstat(destination)).isDirectory()) return false
  const names = await readdir(payload)
  if ((await readdir(destination)).length !== names.length) return false
  for (const name of names) {
    const expected = join(payload, name)
    const actual = join(destination, name)
    const a = await stat(expected)
    const b = await lstat(actual)
    if (!b.isFile() || a.size !== b.size || (a.mode & 0o111) !== (b.mode & 0o111)) return false
    if ((await sha256(expected)) !== (await sha256(actual))) return false
  }
  return true
}

export async function stage(archive: string, output: string) {
  const file = basename(archive)
  const target = [...checksums.keys()].find(key => file === `beads_${version}_${key}.${key.startsWith('windows_') ? 'zip' : 'tar.gz'}`)
  if (!target) throw new Error(`Expected an official Beads ${version} platform archive, got ${file}.`)
  const parent = resolve(output, version)
  await mkdir(parent, { recursive: true })
  const temp = await mkdtemp(join(parent, '.stage-'))
  try {
    const copy = join(temp, file)
    await copyFile(archive, copy)
    if ((await sha256(copy)) !== checksums.get(target)) throw new Error(`Checksum mismatch for ${file}.`)

    const payload = join(temp, 'payload')
    await mkdir(payload)
    const windows = target.startsWith('windows_')
    if (windows) execFileSync('unzip', ['-q', copy, '-d', payload])
    else execFileSync('tar', ['-xzf', copy, '-C', payload])
    const binary = windows ? 'bd.exe' : 'bd'
    for (const name of [binary, 'LICENSE', 'README.md', 'CHANGELOG.md']) {
      if (!(await stat(join(payload, name))).isFile()) throw new Error(`Missing ${name} in ${file}.`)
    }
    const destination = join(parent, target)
    try {
      await rename(payload, destination)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOTEMPTY' && code !== 'EEXIST' && code !== 'EPERM') throw error
      if (!(await matchesPayload(payload, destination))) throw new Error(`Existing payload differs from ${file} at ${destination}`)
    }
    return join(destination, binary)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  const [archive, output, ...extra] = process.argv.slice(2)
  if (!archive || !output || extra.length > 0) throw new Error('Usage: bun run beads:stage <release-archive> <output-root>')
  console.log(await stage(archive, output))
}
