import { createHash } from 'node:crypto'
import {
  type ConfirmedEdit,
  observeMap as compareMap,
  docStamps,
  type MapPrints,
  type Project,
  refreshDocs,
  type SessionFile,
  sameDocumentStamps,
  staleLayout,
  wrap,
} from '../../core/src'
import type { EditEvidence } from './edits'

export type { MapPrints } from '../../core/src'

// Keep the hash used by previously installed hook checkpoints.
export async function observeMap(
  project: Project,
  previous: MapPrints | undefined,
  files: SessionFile[],
  stamps: Record<string, string>,
  confirmed?: ConfirmedEdit,
  legacyStamps?: Record<string, string>,
) {
  const update = await compareMap(project, previous, files, stamps, confirmed, legacyStamps, text =>
    createHash('sha256').update(text).digest('hex'),
  )
  return { prints: update.prints, note: update.note && wrap({ kind: 'map', body: update.note }) }
}

// Take the document baseline at tool boundaries. Settling tocs and diagnostics still belongs to the next prompt.
export async function mapAtTool(project: Project, previous: MapPrints, edits: () => Promise<EditEvidence>, shellWrite: boolean) {
  const stamps = await docStamps(project)
  if (!previous.documents || sameDocumentStamps(previous.documents, stamps) || (await staleLayout(project)))
    return { prints: previous, note: '' }
  await refreshDocs(project, { tocs: false })
  const path = project.settings.files.shift
  const text = await project.store.read(`${project.root}/${path}`)
  const evidence = await edits()
  // Shells give the harness command boundaries but no file receipts. A matched write interval
  // advances the baseline silently. A patch receipt still distinguishes mixed file changes.
  const known: ConfirmedEdit = (file, body, prior) =>
    (shellWrite && !evidence.hasPatch?.(file)) || !!evidence.confirmed?.(file, body, prior)
  const update = await observeMap(project, previous, text === null ? [] : [{ path, text }], stamps, known)
  return shellWrite && !evidence.confirmed ? { prints: update.prints, note: '' } : update
}
