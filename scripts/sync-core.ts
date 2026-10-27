// Copies core/src into every adapter, and the tests' fixture data into the Claude Code plugin's tests: a harness may
// load only files inside its own plugin folder. `--check` changes nothing and fails when a copy is stale; with
// `--staged` it checks the files as git's index holds them — what a commit takes —, not as they are on disk.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const SOURCE = 'core/src'
const TARGETS = ['adapters/claude-code/hooks/core', 'adapters/npm/core']
const DATA = 'core/test/data.ts'
const DATA_COPIES = ['adapters/claude-code/tests/data.ts']
const header = (from: string) => `// Generated from ${from} by scripts/sync-core.ts — edit the source, not this copy.\n`

const staged = process.argv.includes('--staged')
const check = staged || process.argv.includes('--check')
// Files and their text, from paths relative to the root: on disk, or in git's index.
const files = staged ? indexFiles() : diskFiles()
const sources = files.list(SOURCE)
if (sources.length === 0) throw new Error(`no .ts files in ${SOURCE}: nothing to copy, and nothing is removed`)
const stale: string[] = []

for (const target of TARGETS) {
  const wanted = new Map(sources.map(name => [name, header(SOURCE) + files.read(join(SOURCE, name))]))
  const present = files.list(target)

  for (const [name, text] of wanted) {
    const path = join(target, name)
    if (present.includes(name) && files.read(path) === text) continue
    stale.push(path)
    if (!check) {
      mkdirSync(dirname(join(ROOT, path)), { recursive: true })
      writeFileSync(join(ROOT, path), text)
    }
  }
  for (const name of present.filter(name => !wanted.has(name))) {
    stale.push(join(target, name))
    if (!check) rmSync(join(ROOT, target, name))
  }
}

const data = header(DATA) + files.read(DATA)
for (const target of DATA_COPIES) {
  if (files.read(target) === data) continue
  stale.push(target)
  if (!check) writeFileSync(join(ROOT, target), data)
}

if (check && stale.length > 0) {
  const fix = staged ? 'run `bun run sync-core` and stage the copies' : 'run `bun run sync-core`'
  console.error(`Core copies are stale${staged ? ' in what is staged' : ''}, ${fix}:\n${stale.map(path => `  ${path}`).join('\n')}`)
  process.exit(1)
}
if (!check) console.log(stale.length > 0 ? `Synced:\n${stale.map(path => `  ${path}`).join('\n')}` : 'Core copies are up to date.')

type Files = { list(dir: string): string[]; read(path: string): string | null }

// The .ts files under a folder on disk, relative to it; none when it is missing, and a folder that cannot be read
// stops the sync rather than look empty.
function diskFiles(): Files {
  return {
    list: dir => {
      try {
        return readdirSync(join(ROOT, dir), { recursive: true, encoding: 'utf8' }).filter(name => name.endsWith('.ts'))
      } catch (error) {
        if ((error as { code?: string }).code === 'ENOENT') return []
        throw error
      }
    },
    read: path => {
      try {
        return readFileSync(join(ROOT, path), 'utf8')
      } catch (error) {
        if ((error as { code?: string }).code === 'ENOENT') return null
        throw error
      }
    },
  }
}

function indexFiles(): Files {
  const git = (args: string[]) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return {
    list: dir =>
      git(['ls-files', '--cached', '--', dir])
        .split('\n')
        .filter(path => path.endsWith('.ts'))
        .map(path => path.slice(dir.length + 1)),
    read: path => {
      try {
        return git(['show', `:${path}`])
      } catch {
        return null
      }
    },
  }
}
