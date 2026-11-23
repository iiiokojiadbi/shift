// Build the real history process from the checkout. The task payload is never executed by shift tests.
import { execFileSync } from 'node:child_process'
import { cp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { beadsExecutable } from '../../../core/src/beads'
import { scratch } from './scratch'

type Entry = { id: string; about: string; state: string; files: Record<string, string> }

export async function historyRuntime() {
  const repo = resolve(import.meta.dirname, '../../..')
  const dir = await scratch('history-runtime')
  const executable = beadsExecutable(process.platform, process.arch)
  if (!executable) throw new Error('Unsupported test platform')
  await cp(join(repo, 'runtime/beads'), dir, { recursive: true })
  await writeFile(join(dir, 'payload'), '')
  const binary = join(dir, executable)
  execFileSync('go', ['build', '-o', binary, '.'], { cwd: dir })
  const marketplace = join(dir, 'marketplace')
  const plugin = join(marketplace, 'adapters/codex/plugin')
  await cp(join(repo, '.agents/plugins'), join(marketplace, '.agents/plugins'), { recursive: true })
  await cp(join(repo, 'adapters/codex/plugin'), plugin, { recursive: true, filter: path => basename(path) !== 'vendor' })
  await mkdir(join(plugin, 'vendor'), { recursive: true })
  await cp(binary, join(plugin, 'vendor', executable))
  function run(root: string, args: readonly string[], stdin?: string) {
    return execFileSync(binary, [root, ...args], { input: stdin, encoding: 'utf8' })
  }
  function query<T>(root: string, request: object): T {
    return JSON.parse(run(root, ['shift-history'], JSON.stringify(request))) as T
  }
  function seed(root: string, letter: string, board: string) {
    const about = '---\ndescription: Saved fixture\nresult: shifted\nafter: wait\n---'
    const id = query<string>(root, { action: 'begin', key: 'fixture', about, files: { 'letter.md': letter, 'board.md': board } })
    query(root, { action: 'finish', id, state: 'complete', about, limit: 30 })
    return id
  }
  function latest(root: string) {
    const rows = query<Entry[]>(root, { action: 'list' })
    const id = rows.at(-1)?.id
    return id ? query<Entry>(root, { action: 'read', id }) : undefined
  }
  async function sourceLauncher() {
    const adapters = join(dir, 'source/adapters')
    const npm = join(adapters, 'npm')
    await cp(join(repo, 'adapters/codex'), join(adapters, 'codex'), {
      recursive: true,
      filter: path => !['plugin', 'test', 'node_modules'].includes(basename(path)),
    })
    await mkdir(npm, { recursive: true })
    await cp(join(repo, 'adapters/npm/store.ts'), join(npm, 'store.ts'))
    await cp(join(repo, 'adapters/npm/package.json'), join(npm, 'package.json'))
    await symlink(join(repo, 'adapters/npm/core'), join(npm, 'core'), 'dir')
    await symlink(join(repo, 'core'), join(dir, 'source/core'), 'dir')
    await symlink(join(repo, 'node_modules'), join(dir, 'source/node_modules'), 'dir')
    const name = '@iiiokojiadbi/shift-beads'
    const dependency = join(npm, 'node_modules', name)
    await mkdir(dependency, { recursive: true })
    const version = JSON.parse(await readFile(join(npm, 'package.json'), 'utf8')).dependencies[name]
    await writeFile(join(dependency, 'package.json'), JSON.stringify({ name, version }))
    await cp(binary, join(dependency, basename(binary)))
    return join(adapters, 'codex/index.ts')
  }
  return { marketplace, plugin, run, seed, latest, query, sourceLauncher }
}
