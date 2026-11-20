import { mapBounds } from './docs'
import { handBack, sessionFiles } from './flows'
import { BOARD, LETTER, NAMES, SHIFTS, TASKS } from './layout'
import type { Project } from './project'
import { knowledgeMap } from './records'
import { shiftNames } from './store'
import {
  continuePrompt,
  fileBlock,
  inProgress,
  notesList,
  renderRecent,
  renderSessionFiles,
  renderStuck,
  trackPreview,
} from './texts/prompts'
import { sessionDoctrine } from './tools'

// Count complete rendered messages for totals: token boundaries need not align at row edges.
export async function sizeReport(project: Project, counter?: (text: string) => number): Promise<string> {
  if (!project.settings.enabled) return 'Shift is disabled in this project.'
  const count = counter ?? ((text: string) => Math.ceil(text.length / 4))
  const lines = [
    counter ? 'Text tokens (o200k_base).' : 'Estimated text tokens (4 characters per token).',
    'Totals include message framing written by Shift. Detail and saved-letter rows are not additive.',
    '',
    '| Delivery | Entity | Tokens |',
    '|---|---|---:|',
  ]
  const row = (group: string, label: string, tokens: number) =>
    lines.push(`| ${group} | ${label.replaceAll('|', '\\|').replace(/[\r\n]/g, ' ')} | ${tokens} |`)
  const files = await sessionFiles(project, { refresh: false })
  const doctrine = sessionDoctrine(project.settings).doctrine
  row('Session', 'Doctrine', count(doctrine))
  for (const file of files) {
    row('Session', file.path, count(fileBlock(file.path, file.text)))
    if (file.path === project.settings.files.shift) {
      const parts = file.text.split('\n')
      const { start, end } = mapBounds(parts)
      if (end >= 0) row('Included above', 'Documentation map', count(parts.slice(start, end + 1).join('\n')))
    }
  }
  const session = count([doctrine, renderSessionFiles(files)].filter(Boolean).join('\n\n'))
  row('Total', 'Session', session)
  const folders = (await shiftNames(project)).reverse()
  const saved: { name: string; letter: string }[] = []
  for (const name of folders) {
    const letter = await project.store.read(`${project.root}/${SHIFTS}/${name}/${NAMES.letter}`)
    if (letter !== null) saved.push({ name, letter })
    if (saved.length === 3) break
  }
  const dir = `${project.root}/${SHIFTS}/${saved[0]?.name ?? '<next-shift>'}`
  const back = await handBack(project, dir)
  if (back.work) {
    row('Continue', BOARD, count(back.work.board))
    for (const task of inProgress(back.work)) {
      const folder = `${TASKS}/${task.name}`
      row('Continue', `${folder}/${NAMES.task}`, count(task.task ?? 'missing'))
      row('Continue', `${folder}/${NAMES.track}`, count(trackPreview(task.track ?? 'missing')))
      if (task.notes.length) row('Continue', `${folder}/notes (descriptions)`, count(notesList(task.name, task.notes)))
    }
    row('Continue', 'Knowledge index', count(knowledgeMap(back.work.knowledge)))
  }
  row('Continue', 'Recent shifts', count(renderRecent(back.recent)))
  if (back.stuck.length) row('Continue', 'Unchanged tasks', count(renderStuck(back.stuck)))
  if (back.remarks) row('Continue', 'Document remarks', count(back.remarks))
  const draft = await project.store.read(`${project.root}/${LETTER}`)
  const letter = draft ?? saved[0]?.letter ?? ''
  row('Continue', draft !== null ? 'Working letter' : saved.length ? 'Latest saved letter' : 'Letter (missing)', count(letter))
  const continuation = count(continuePrompt(letter, back))
  row('Total', 'Continue message', continuation)
  row('Total', 'Session + continue', session + continuation)
  for (const entry of saved) row('Saved letter', `${SHIFTS}/${entry.name}/${NAMES.letter}`, count(entry.letter))
  if (!saved.length) lines.push('', 'No saved letters.')
  return lines.join('\n')
}
