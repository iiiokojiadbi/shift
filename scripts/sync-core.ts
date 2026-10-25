// Copies core/src into every adapter, and the tests' fixture data into the Claude Code plugin's tests: a harness may
// load only files inside its own plugin folder. `--check` changes nothing and fails when a copy is stale.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const SOURCE = join(ROOT, 'core/src')
const TARGETS = ['adapters/claude-code/hooks/core', 'adapters/pi/core']
const DATA = 'core/test/data.ts'
const DATA_COPIES = ['adapters/claude-code/tests/data.ts']
const header = (from: string) => `// Generated from ${from} by scripts/sync-core.ts — edit the source, not this copy.\n`

const check = process.argv.includes('--check')
const files = tsFiles(SOURCE)
const stale: string[] = []

for (const target of TARGETS) {
  const dir = join(ROOT, target)
  const wanted = new Map(files.map(name => [name, header('core/src') + readFileSync(join(SOURCE, name), 'utf8')]))
  const present = tsFiles(dir)

  for (const [name, text] of wanted) {
    const path = join(dir, name)
    if (present.includes(name) && readFileSync(path, 'utf8') === text) continue
    stale.push(join(target, name))
    if (!check) {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, text)
    }
  }
  for (const name of present.filter(name => !wanted.has(name))) {
    stale.push(join(target, name))
    if (!check) rmSync(join(dir, name))
  }
}

const data = header(DATA) + readFileSync(join(ROOT, DATA), 'utf8')
for (const target of DATA_COPIES) {
  const path = join(ROOT, target)
  if (readIfThere(path) === data) continue
  stale.push(target)
  if (!check) writeFileSync(path, data)
}

if (check && stale.length > 0) {
  console.error(`Core copies are stale, run \`bun run sync-core\`:\n${stale.map(path => `  ${path}`).join('\n')}`)
  process.exit(1)
}
if (!check) console.log(stale.length > 0 ? `Synced:\n${stale.map(path => `  ${path}`).join('\n')}` : 'Core copies are up to date.')

// Paths of the .ts files under a folder, relative to it; none when it is missing.
function tsFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter(name => name.endsWith('.ts'))
  } catch {
    return []
  }
}

function readIfThere(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}
