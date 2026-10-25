// The pi package's release gate. A published version cannot be reused and a tarball stays in every mirror, so by
// default it does everything but upload: the checks, the tarball file by file, whether the version is free.
//
//   bun run release:pi                     check, show the tarball
//   bun run release:pi --publish           the same from a pushed, clean tree, then upload, verify and tag
//   bun run release:pi --publish --otp 123456
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const PACKAGE = join(ROOT, 'adapters/pi')
// The tarball's shape: the entry, the store, the core copy, the README and the license; anything else got in by mistake.
const REQUIRED = ['LICENSE', 'README.md', 'core/index.ts', 'index.ts', 'package.json', 'store.ts']
const ALLOWED = /^(LICENSE|README\.md|package\.json|index\.ts|store\.ts|core\/[a-z/]+\.ts)$/
const MAX_TARBALL_KB = 150

const args = process.argv.slice(2)
const publish = args.includes('--publish')
// A code valid for seconds, passed per run, never stored.
const otp = args.includes('--otp') ? args[args.indexOf('--otp') + 1] : undefined

const run = (command: string, commandArgs: string[], cwd = ROOT) =>
  execFileSync(command, commandArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const show = (command: string, commandArgs: string[], cwd = ROOT) => execFileSync(command, commandArgs, { cwd, stdio: 'inherit' })

const manifest = JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf8'))
const reference = `${manifest.name}@${manifest.version}`
const tag = `shift-pi--v${manifest.version}`
console.log(`preparing ${reference}`)

// One version for both harnesses: a pi release carries the core of the Claude Code release with the same number.
const plugin = JSON.parse(readFileSync(join(ROOT, 'adapters/claude-code/.claude-plugin/plugin.json'), 'utf8'))
if (manifest.version !== plugin.version)
  throw new Error(
    `adapters/pi/package.json is ${manifest.version}, the Claude Code plugin ${plugin.version}: release pi with the plugin's version`,
  )

if (publish) {
  // What goes up is a commit anyone can find: nothing uncommitted, and the commit on origin/main.
  if (run('git', ['status', '--porcelain']).trim() !== '') throw new Error('the tree has uncommitted changes: commit them first')
  run('git', ['fetch', '--quiet', 'origin', 'main'])
  try {
    run('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/main'])
  } catch {
    throw new Error('HEAD is not on origin/main: push it first')
  }
}

for (const script of ['check', 'types:core', 'types:pi', 'test:core', 'test:pi']) show('bun', ['run', script])

const packed = JSON.parse(run('npm', ['pack', '--dry-run', '--json'], PACKAGE))[0] ?? {}
const shipped: string[] = (packed.files ?? []).map((file: { path: string }) => file.path).sort()
console.log('\nwhat would be uploaded:')
for (const path of shipped) console.log(`  ${path}`)
const kb = (packed.size ?? 0) / 1024
console.log(`files: ${shipped.length}, tarball: ${kb.toFixed(0)} KB`)
const unexpected = shipped.filter(path => !ALLOWED.test(path))
if (unexpected.length > 0) throw new Error(`the package would ship files nobody declared: ${unexpected.join(', ')}`)
const missing = REQUIRED.filter(path => !shipped.includes(path))
if (missing.length > 0) throw new Error(`missing from the package: ${missing.join(', ')}`)
if (kb > MAX_TARBALL_KB) throw new Error(`the tarball is ${kb.toFixed(0)} KB, over ${MAX_TARBALL_KB} KB`)

// `npm view` fails both for a version that is not there and for a registry it cannot reach: only npm's own E404
// means the version is free.
let taken = false
try {
  taken = run('npm', ['view', reference, 'version']).trim() !== ''
} catch (cause) {
  const text = String((cause as { stderr?: string }).stderr ?? cause)
  if (/npm (?:error|ERR!) code (E\d+|[A-Z_]+)/i.exec(text)?.[1] !== 'E404')
    throw new Error(`could not ask the registry whether ${reference} exists:\n${text.trim()}`)
}
if (taken) throw new Error(`${reference} is already in the registry: bump the version in adapters/pi/package.json`)
console.log(`\n${reference} is not in the registry yet`)

if (!publish) {
  console.log('dry run: nothing was published. Pass --publish to upload exactly this.')
  process.exit(0)
}

console.log(`\npublishing ${reference}...`)
show('npm', ['publish', '--access', 'public', ...(otp === undefined ? [] : ['--otp', otp])], PACKAGE)

// The registry takes minutes to show a new version: asked again before it counts as a failure, never published twice.
let latest = ''
for (let attempt = 0; attempt < 30 && latest !== manifest.version; attempt++) {
  if (attempt > 0) await Bun.sleep(10_000)
  try {
    latest = run('npm', ['view', manifest.name, 'dist-tags.latest']).trim()
  } catch {}
}
if (latest !== manifest.version) throw new Error(`published, but latest is still "${latest}": check \`npm view ${manifest.name}\``)
console.log(`published ${reference}, latest is ${latest}`)

run('git', ['tag', tag])
run('git', ['push', '--quiet', 'origin', tag])
console.log(`tagged ${tag}`)
