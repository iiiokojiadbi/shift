import { createHash } from 'node:crypto'
import { mapParts, type Project, type SessionFile, wrap } from '../../core/src'

// Checkpoints contain fingerprints. The configured files may be large or private.
export type MapPrints = { text: string; map: Record<string, string>; notices: string }
const fingerprint = (text: string) => createHash('sha256').update(text).digest('hex')

export function observeMap(project: Project, previous: MapPrints | undefined, files: SessionFile[]) {
  const path = project.settings.files.shift
  const mapFile = files.find(file => file.path === path)
  const text = fingerprint(mapFile?.text ?? '')
  if (previous?.text === text) return { prints: previous, note: '' }
  const { other, entries } = mapParts(mapFile?.text ?? '')
  const prints: MapPrints = { text, map: Object.create(null), notices: fingerprint(other) }
  const changes: string[] = []
  if (mapFile && previous && previous.notices !== prints.notices) changes.push(`Map notices changed in ${path}. Read the current file.`)
  for (const [key, entry] of entries) {
    prints.map[key] = fingerprint(entry)
    if (previous && previous.map[key] !== prints.map[key]) changes.push(entry)
  }
  for (const key of Object.keys(previous?.map ?? {}))
    if (!Object.hasOwn(prints.map, key)) changes.push(`Removed from the documentation map: ${key}`)
  return { prints, note: changes.length ? wrap({ kind: 'docs', body: changes.join('\n') }) : '' }
}
