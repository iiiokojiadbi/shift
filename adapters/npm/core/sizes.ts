// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { mapBounds } from './docs'
import { handBack, sessionFiles } from './flows'
import { BOARD, LETTER, NAMES } from './layout'
import type { Project } from './project'
import { knowledgeMap } from './records'
import { NEXT_SAVED, readSaved, savedEntries } from './saved'
import { continuePrompt, fileBlock, renderRecent, renderSessionFiles } from './texts/prompts'
import { sessionDoctrine } from './tools'

// Count complete rendered messages for totals: token boundaries need not align at row edges.
export async function sizeReport(project: Project, counter?: (text: string) => number): Promise<string> {
  if (!project.settings.enabled) return 'Shift is disabled in this project.'
  const count = counter ?? ((text: string) => Math.ceil(text.length / 4))
  const sessionRows: string[] = []
  const continueRows: string[] = []
  const row = (label: string, tokens: number) => `${String(tokens).padStart(7)}  ${label.replace(/[\r\n]/g, ' ')}`
  const files = await sessionFiles(project, { refresh: false })
  const doctrine = sessionDoctrine(project.settings).doctrine
  sessionRows.push(row('Doctrine', count(doctrine)))
  for (const file of files) {
    sessionRows.push(row(file.path, count(fileBlock(file.path, file.text))))
    if (file.path === project.settings.files.shift) {
      const parts = file.text.split('\n')
      const { start, end } = mapBounds(parts)
      if (end >= 0) sessionRows.push(row('  of which: documentation map', count(parts.slice(start, end + 1).join('\n'))))
    }
  }
  const session = count([doctrine, renderSessionFiles(files)].filter(Boolean).join('\n\n'))
  const retained = (await savedEntries(project)).reverse()
  const saved: { name: string; letter: string }[] = []
  for (const e of retained.slice(0, 3)) {
    const letter = (await readSaved(project, e.id, NAMES.letter)).files[NAMES.letter]
    if (letter !== undefined) saved.push({ name: e.id, letter })
  }
  const dir = NEXT_SAVED
  const back = await handBack(project, dir, project.actor)
  if (back.work) {
    continueRows.push(row(BOARD, count(back.work.board)))
    continueRows.push(row('Knowledge index', count(knowledgeMap(back.work.knowledge))))
  }
  continueRows.push(row('Recent shifts', count(renderRecent(back.recent))))
  if (back.remarks) continueRows.push(row('Document remarks', count(back.remarks)))
  const draft = await project.store.read(`${project.root}/${LETTER}`)
  const letter = draft ?? saved[0]?.letter ?? ''
  continueRows.push(row(draft !== null ? 'Working letter' : saved.length ? 'Latest saved letter' : 'Letter (missing)', count(letter)))
  const continuation = count(continuePrompt(letter, back))
  return [
    counter ? 'Text tokens (o200k_base).' : 'Estimated text tokens (4 characters per token).',
    row('Session + continue', session + continuation),
    '',
    row('Session', session),
    ...sessionRows,
    '',
    row('Continue message', continuation),
    ...continueRows,
    '',
    'Totals include message framing and the fallback task-command instructions. The next continuation uses estimated identifiers.',
    '',
    ...(saved.length
      ? ['Saved letters in the shift archive (outside total)', ...saved.map(entry => row(entry.name, count(entry.letter)))]
      : ['No saved letters.']),
  ].join('\n')
}
