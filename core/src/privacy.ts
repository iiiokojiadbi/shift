import { DIR } from './layout'
import type { Project } from './project'
import { NOT_IGNORED } from './texts/prompts'

// Unless the owner lets the project commit them, the records stay out of its git: when they are not ignored, the mod
// adds them to the repository's own exclude file. The exclude file's path when it did; null when nothing was needed.
export async function keepRecordsOut(project: Project): Promise<{ excluded: string | null } | { deny: string }> {
  const { store, root } = project
  if (project.settings.commit) return { excluded: null }
  const check = () => store.git(root, ['check-ignore', '-q', `${DIR}/`])
  const ignored = await check()
  if (ignored === null || ignored.code === 0) return { excluded: null }
  if (ignored.code !== 1) {
    const repo = await store.git(root, ['rev-parse', '--is-inside-work-tree'])
    // A broken repository and a directory outside Git can both exit 128. Adapters request C diagnostics.
    if (repo?.code === 0 && repo.stdout.trim() === 'false') return { excluded: null }
    if (repo?.stderr?.startsWith('fatal: not a git repository (or any ')) return { excluded: null }
    return { deny: NOT_IGNORED }
  }
  // git names it relative to the root, or absolute in a linked worktree.
  const found = await store.git(root, ['rev-parse', '--git-path', 'info/exclude'])
  const path = found === null || found.code !== 0 ? '' : found.stdout.trim()
  if (path === '') return { deny: NOT_IGNORED }
  const file = path.startsWith('/') ? path : `${root}/${path}`
  const existing = await store.read(file)
  if (existing === null && (await store.exists(file, 'checked').catch(() => true))) return { deny: NOT_IGNORED }
  const text = existing ?? ''
  if (text.split(/\r?\n/).includes(`${DIR}/`)) return { deny: NOT_IGNORED }
  try {
    await store.write(file, `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${DIR}/\n`, existing)
  } catch (error) {
    if ((await check())?.code === 0) return { excluded: null }
    return { deny: `${NOT_IGNORED} ${String(error)}` }
  }
  return (await check())?.code === 0 ? { excluded: file } : { deny: NOT_IGNORED }
}
