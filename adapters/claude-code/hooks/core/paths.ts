// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
// Paths as the mod writes them: `/`-separated, from the project's root unless absolute. One place, so a path with no
// folder means the same everywhere: its folder is `.`.

export function dirname(path: string): string {
  const at = path.lastIndexOf('/')

  return at === -1 ? '.' : at === 0 ? '/' : path.slice(0, at)
}

// The last part, a trailing `/` ignored.
export function basename(path: string): string {
  return (
    path
      .split('/')
      .filter(part => part !== '')
      .at(-1) ?? ''
  )
}

// `name` inside `dir`, where `.` is the folder itself.
export function join(dir: string, name: string): string {
  return dir === '.' || dir === '' ? name : name === '.' ? dir : `${dir}/${name}`
}

// `.`, `..` and empty parts folded away; null when it climbs out of where it started.
export function normalize(path: string): string | null {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part !== '..') parts.push(part)
    else if (parts.pop() === undefined) return null
  }

  return parts.join('/')
}

// An absolute path for one the agent gave: absolute as is, else from the root.
export function resolvePath(root: string, path: string): string {
  return path.startsWith('/') ? path : `${root}/${path.replace(/^\.\//, '')}`
}

// A path from the root for one that may be absolute.
export function fromRoot(root: string, file: string): string {
  return file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file.replace(/^\.\//, '')
}

// Relative, without a way out of the project.
export function isInside(path: string): boolean {
  return path !== '' && !path.startsWith('/') && !path.split('/').includes('..')
}
