// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { docStamps, mapParts, refreshDocs, TOC_END, TOC_START } from './docs'
import { type ConfirmedEdit, recordFingerprint, staleLayout, textFingerprint } from './flows'
import { frontmatter, headings, lineOutside, pinned } from './markdown'
import type { Project } from './project'
import type { SessionFile } from './types'

// Store fingerprints of private text; names identify the parts removed since the last delivery.
type Part = { name: string; hash: string }
type DocumentPrint = {
  stamp: string
  archived: boolean
  header: string
  content: string
  intro: string
  sections: Part[]
  pins: Part[]
}
export type MapPrints = { text: string; map: Record<string, string>; notices: string; documents?: Record<string, DocumentPrint> }
type Hash = (text: string) => string

export function sameDocumentStamps(documents: Record<string, DocumentPrint>, stamps: Record<string, string>) {
  return (
    Object.keys(stamps).length === Object.keys(documents).length &&
    Object.entries(stamps).every(([path, stamp]) => documents[path]?.stamp === stamp)
  )
}

function documentParts(project: Project, path: string, text: string, stamp: string, entry: string, fingerprint: Hash) {
  const lines = text.split('\n')
  const start = lineOutside(lines, line => line.trim() === TOC_START)
  const end = start < 0 ? -1 : lineOutside(lines, line => line.trim() === TOC_END, start + 1)
  if (end >= 0) {
    // withToc inserts a blank line before a new block. Exclude that separator as well.
    const from = start > 0 && !lines[start - 1]?.trim() ? start - 1 : start
    lines.splice(from, end - from + 1)
  }
  const source = lines.join('\n')
  const marks = headings(source).filter(h => h.level === 2)
  const archived = frontmatter(source).get('archived') === 'true'
  const front = lines[0]?.trimEnd() === '---' ? lines.findIndex((line, i) => i > 0 && line.trimEnd() === '---') : -1
  const intro = lines.slice(front + 1, archived ? undefined : (marks[0]?.line ?? lines.length + 1) - 1)
  const sections = archived
    ? []
    : marks.map((mark, i) => ({
        name: mark.title,
        hash: fingerprint(
          lines
            .slice(mark.line, (marks[i + 1]?.line ?? lines.length + 1) - 1)
            .join('\n')
            .trim(),
        ),
      }))
  const pins = pinned(source).map(pin => ({ name: pin.section ?? '', hash: fingerprint(pin.text), text: pin.text }))
  const print: DocumentPrint = {
    stamp,
    archived,
    header: fingerprint(entry.split('\n', 1)[0] ?? ''),
    content: recordFingerprint(project, path, text),
    intro: fingerprint(intro.join('\n').trim()),
    sections,
    pins: pins.map(({ name, hash }) => ({ name, hash })),
  }
  return { print, pins }
}

// Match unchanged occurrences first: removing the first of two pins under the same heading
// must not reprint the second as a replacement. Then pair the remaining occurrences by name.
function compareParts(before: Part[], after: Part[]) {
  const used = new Set<number>()
  const matches = after.map(part => {
    const index = before.findIndex((p, i) => p.name === part.name && p.hash === part.hash && !used.has(i))
    if (index >= 0) used.add(index)
    return index
  })
  let last = -1
  const changes: { name: string; status: string; index: number }[] = []
  for (const [index, part] of after.entries()) {
    const match = matches[index] ?? -1
    const old = match >= 0 ? match : before.findIndex((p, i) => p.name === part.name && !used.has(i))
    const status = old < 0 ? 'new' : before[old]?.hash !== part.hash || old < last ? 'changed' : ''
    if (old >= 0) {
      used.add(old)
      last = Math.max(old, last)
    }
    if (status) changes.push({ name: part.name, status, index })
  }
  for (const [i, part] of before.entries()) if (!used.has(i)) changes.push({ name: part.name, status: 'deleted', index: -1 })
  return changes
}

function documentDelta(label: string, entry: string, old: DocumentPrint, current: ReturnType<typeof documentParts>) {
  const detail: string[] = []
  const first = entry.split('\n', 1)[0] ?? label
  if (old.header !== current.print.header) detail.push(`description (changed): ${first.slice(label.length + ' — '.length)}`)
  const sections = current.print.archived ? [] : compareParts(old.sections, current.print.sections)
  if (sections.length) detail.push(`sections: ${sections.map(s => `${s.name} (${s.status})`).join(' · ')}`)
  if (old.archived === current.print.archived && old.intro !== current.print.intro)
    detail.push(current.print.sections.length ? 'Introduction (changed)' : 'Text (changed)')
  for (const pin of compareParts(old.pins, current.print.pins)) {
    const value = current.pins[pin.index]?.text
    detail.push(`pinned${pin.name ? ` (${pin.name})` : ''} (${pin.status})${value ? `:\n    ${value.replaceAll('\n', '\n    ')}` : ''}`)
  }
  return detail.length ? `${label} (changed)\n  ${detail.join('\n  ')}` : ''
}

export async function observeMap(
  project: Project,
  previous: MapPrints | undefined,
  files: SessionFile[],
  stamps: Record<string, string>,
  confirmed?: ConfirmedEdit,
  legacyStamps?: Record<string, string>,
  fingerprint: Hash = text => String(textFingerprint(text)),
) {
  const path = project.settings.files.shift
  const mapFile = files.find(file => file.path === path)
  const text = fingerprint(mapFile?.text ?? '')
  if (previous?.text === text && previous.documents && sameDocumentStamps(previous.documents, stamps)) return { prints: previous, note: '' }
  const { other, entries } = mapParts(mapFile?.text ?? '')
  const documents: Record<string, DocumentPrint> = Object.create(null)
  const changes: string[] = []
  const notices = other
    .split('\n')
    .filter(line => /^(Pinned:|off:)/.test(line))
    .join('\n')
  const prints: MapPrints = { text, map: Object.create(null), notices: fingerprint(notices), documents }
  if (previous && prints.notices !== previous.notices && (previous.documents || fingerprint(other) !== previous.notices)) {
    if (notices) changes.push(notices)
    else if (previous.documents) changes.push('Documentation map notices cleared.')
  }
  for (const [key, entry] of entries) {
    const hash = fingerprint(entry)
    prints.map[key] = hash
    const was = previous?.map[key]
    const old = previous?.documents?.[key]
    const stamp = stamps[key]
    if (old && old.stamp === stamp && was === hash) {
      documents[key] = old
      continue
    }
    const body = stamp === undefined ? null : await project.store.read(`${project.root}/${key}`)
    if (stamp !== undefined && body === null) {
      if (old) documents[key] = old
      if (was !== undefined) prints.map[key] = was
      else delete prints.map[key]
      continue
    }
    const current = body === null || stamp === undefined ? undefined : documentParts(project, key, body, stamp, entry, fingerprint)
    if (current) documents[key] = current.print
    if (!previous || confirmed?.(key, body, old?.content)) continue
    const label = `- \`${key}\``
    if (!current && old) {
      changes.push(`${label} (deleted)`)
      continue
    }
    if (!was || (current && !old && previous.documents)) {
      // Removing the last document already accounts for its newly empty folder.
      if (current) changes.push(entry.replace(label, () => `${label} (new)`))
      else if (!entry.endsWith(' — no documents') || !Object.keys(previous.documents ?? {}).some(path => path.startsWith(key)))
        changes.push(entry)
      continue
    }
    if (!old || !current) {
      // An older checkpoint only knows the whole rendered entry and the file stamp.
      if (was !== hash) changes.push(entry.replace(label, () => `${label} (changed)`))
      else if (!previous.documents && legacyStamps?.[key] && legacyStamps[key] !== stamp) changes.push(`${label} (changed)`)
      continue
    }
    const delta = documentDelta(label, entry, old, current)
    if (delta) changes.push(delta)
  }
  for (const key of Object.keys(previous?.map ?? {})) {
    if (
      (!previous?.documents || previous.documents[key]) &&
      !Object.hasOwn(prints.map, key) &&
      !confirmed?.(key, null, previous?.documents?.[key]?.content)
    )
      changes.push(`- \`${key}\` (deleted)`)
  }
  return { prints, note: changes.join('\n') }
}

export async function initialMap(project: Project, files: SessionFile[]) {
  return (await observeMap(project, undefined, files, await docStamps(project))).prints
}

export async function currentMap(project: Project, previous: MapPrints, confirmed?: ConfirmedEdit) {
  const stamps = await docStamps(project)
  if ((previous.documents && sameDocumentStamps(previous.documents, stamps)) || (await staleLayout(project)))
    return { prints: previous, note: '' }
  await refreshDocs(project, { tocs: false })
  const path = project.settings.files.shift
  const text = await project.store.read(`${project.root}/${path}`)
  return observeMap(project, previous, text === null ? [] : [{ path, text }], stamps, confirmed)
}
