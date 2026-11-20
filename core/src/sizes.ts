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
    continueRows.push(row(BOARD, count(back.work.board)))
    for (const task of inProgress(back.work)) {
      const folder = `${TASKS}/${task.name}`
      continueRows.push(row(`${folder}/${NAMES.task}`, count(task.task ?? 'missing')))
      continueRows.push(row(`${folder}/${NAMES.track}`, count(trackPreview(task.track ?? 'missing'))))
      if (task.notes.length) continueRows.push(row(`${folder}/notes (descriptions)`, count(notesList(task.name, task.notes))))
    }
    continueRows.push(row('Knowledge index', count(knowledgeMap(back.work.knowledge))))
  }
  continueRows.push(row('Recent shifts', count(renderRecent(back.recent))))
  if (back.stuck.length) continueRows.push(row('Unchanged tasks', count(renderStuck(back.stuck))))
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
    'Totals include message framing.',
    '',
    ...(saved.length
      ? [`Saved letters in ${SHIFTS}/ (outside total)`, ...saved.map(entry => row(entry.name, count(entry.letter)))]
      : ['No saved letters.']),
  ].join('\n')
}
