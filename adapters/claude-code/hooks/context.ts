import type { EngineInterface } from 'claude-code'
import { atom, read, update } from 'claude-code'
import {
  FRESH_LOOKS,
  initialMap,
  mapCheckpoint,
  type Project,
  refreshDocs,
  renderSessionFiles,
  sessionFiles,
  staleLayout,
} from './core/index'

const files = atom({ plugin: 'shift', key: 'files' } as const, null)
const filesSession = atom({ plugin: 'shift', key: 'filesSession' } as const, null)
const looks = atom({ plugin: 'shift', key: 'looks' } as const, FRESH_LOOKS)

type Saved = { files: string | null; checkpoint: ReturnType<typeof mapCheckpoint> }

export async function sessionKey($: EngineInterface): Promise<string> {
  return `${await $.session.id()} ${await $.session.root()}`
}

// A resume reuses the system section the model already had. A new history or a completed shift reads it anew.
export async function loadFiles($: EngineInterface, project: Project, resume = true): Promise<void> {
  const session = await sessionKey($)
  const saved =
    resume && project.settings.enabled ? ((await $.store.get(`context:${session}`).catch(() => undefined)) as Saved | undefined) : undefined
  await update($, filesSession, () => session)
  if (saved?.checkpoint.map && (await $.session.messages()).length) {
    await update($, files, () => saved.files)
    await update($, looks, () => ({ ...FRESH_LOOKS, ...saved.checkpoint, refreshClaims: true }))
    return
  }
  if (!resume && project.settings.enabled && !(await staleLayout(project))) await refreshDocs(project, { tocs: false })
  const loaded = await sessionFiles(project, { refresh: resume })
  const map = await initialMap(project, loaded)
  await update($, files, () => renderSessionFiles(loaded))
  await update($, looks, current => ({ ...(resume ? FRESH_LOOKS : current), map, mapNotes: [], migrationChecked: false }))
  await persistMap($)
}

export async function persistMap($: EngineInterface): Promise<void> {
  const session = await read($, filesSession)
  if (!session) return
  const checkpoint = mapCheckpoint(await read($, looks))
  const key = `context:${session}`
  // A full native store must not leave an older checkpoint eligible for the next resume.
  await $.store.set(key, { files: await read($, files), checkpoint }).catch(() => $.store.delete(key).catch(() => undefined))
}
