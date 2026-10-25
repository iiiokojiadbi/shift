// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { checkGlossary } from './glossary'
import {
  atPlaces,
  BOARD,
  BOARD_MAX_LINES,
  BOARD_SECTIONS,
  GLOSSARY,
  GUIDE_TOOL,
  KINDS,
  KNOWLEDGE,
  KNOWLEDGE_MAX_LINES,
  LETTER_SECTIONS,
  NAMES,
  OLD_OWNER,
  OLD_TASKS_SECTION,
  OWNER,
  OWNER_MAX_LINES,
  OWNER_SECTION,
  STATUSES,
  TASK_LIST,
  TASK_SECTIONS,
  TASKS,
} from './layout'
import { blocks, dated, frontmatter, itemsOf, missingSections, overLimit, quote, sections, title } from './markdown'
import type { Project } from './project'
import { checkTaskList, type ListedTask, parseTaskList } from './tasks'
import type { Kind, KnowledgeFile, TaskFiles, Work } from './types'

export function checkLetter(text: string): string | null {
  const missing = missingSections(text, LETTER_SECTIONS, 'The letter')
  if (missing !== null) return missing
  const found = sections(text)
  const empty = LETTER_SECTIONS.filter(name => found.get(name) === '')
  if (empty.length > 0) return `The letter has empty sections: ${quote(empty)}. Nothing to say — write "none".`

  return null
}

// The open tasks as TASKS.md lists them; none when it is missing or does not parse.
export function listedTasks(work: Work): ListedTask[] {
  const listed = work.taskList === null ? [] : parseTaskList(work.taskList)

  return typeof listed === 'string' ? [] : listed
}

// The whole state of the work as one text, to tell whether anything moved since the last shift.
export function workText(work: Work): string {
  const tasks = [...work.tasks].sort((a, b) => a.name.localeCompare(b.name))

  return [
    work.board.trim(),
    (work.owner ?? '').trim(),
    (work.taskList ?? '').trim(),
    (work.glossary ?? '').trim(),
    (work.shift ?? '').trim(),
    ...tasks.map(
      t => `${t.name}\n${(t.task ?? '').trim()}\n${(t.track ?? '').trim()}\n${t.notes.map(n => `${n.name}\n${n.text.trim()}`).join('\n')}`,
    ),
    ...work.knowledge.map(k => `${k.name}\n${k.text.trim()}`),
  ].join('\n\n')
}

// The records against the previous shift's snapshot; a refusal names the files at the places the settings give.
export function checkWork(work: Work, previous: Work | null, project: Pick<Project, 'settings' | 'problem'>): string | null {
  const problem = checkRecords(work, previous, project)

  return problem === null ? null : atPlaces(problem, project.settings.files)
}

function checkRecords(work: Work, previous: Work | null, project: Pick<Project, 'settings' | 'problem'>): string | null {
  const { board } = work
  if (project.problem !== null) return `${project.problem} The file is the owner's: tell them, and do not shift until it is fixed.`
  if (work.oldOwner) return `${OLD_OWNER} is the old name: owner decisions live in ${OWNER} now. Rename it and call again.`
  if (sections(board).has(OWNER_SECTION)) {
    return `The board has an "## ${OWNER_SECTION}" section: owner decisions live in ${OWNER}. Move its lines there as they are, remove the section from the board, and call again.`
  }
  if (sections(board).has(OLD_TASKS_SECTION)) {
    return `The board has a "## ${OLD_TASKS_SECTION}" section: the open tasks live in ${TASK_LIST} now, one line each with links under it — see ${GUIDE_TOOL}. Move them there and remove the section.`
  }
  const boardMissing = missingSections(board, BOARD_SECTIONS, 'The board')
  if (boardMissing !== null) return boardMissing

  const boardProblem =
    overLimit(
      'The board',
      board,
      BOARD_MAX_LINES,
      'it has become a diary. Move what belongs to one task into that task, keep only decisions in force.',
    ) ?? dated('the board', board, "The board has no dates — each shift's time is recorded by itself.")
  if (boardProblem !== null) return boardProblem
  const rejected = badRejected(board, 'The board')
  if (rejected !== null) return rejected

  const listProblem = checkTaskList(
    work.taskList,
    work.tasks.map(t => t.name),
    work.archived,
  )
  if (listProblem !== null) return listProblem

  const ownerProblem = checkOwner(work.owner)
  if (ownerProblem !== null) return ownerProblem

  for (const task of work.tasks) {
    const problem = checkTask(task)
    if (problem !== null) return problem
  }

  for (const file of work.knowledge) {
    const problem = checkKnowledge(file)
    if (problem !== null) return problem
  }

  const glossaryProblem = checkGlossary(work.glossary, GLOSSARY)
  if (glossaryProblem !== null) return glossaryProblem

  if (previous !== null && workText(previous) === workText(work)) {
    return 'Nothing changed in the records since the last shift. Update the tracks, statuses and decisions, then shift.'
  }

  return null
}

function checkTask({ name, task, track, notes: notes_ }: TaskFiles): string | null {
  const where = `${TASKS}/${name}/`
  if (task === null) return `${where} has no task.md.`
  if (track === null) return `${where} has no track.md.`
  if (title(task) === null) return `${where}task.md has no "# <title>" line.`
  const missing = missingSections(task, TASK_SECTIONS, `${where}task.md`)
  if (missing !== null) return missing
  const date = dated(where, task, 'Tasks have no dates.') ?? dated(where, track, 'Tasks have no dates.')
  if (date !== null) return date
  if (/^continues:/m.test(task))
    return `${where}task.md has a "continues:" line: links live in ${TASK_LIST} now, under the task's line. Move it there.`
  const rejected = badRejected(task, `${where}task.md`)
  if (rejected !== null) return rejected
  const notes = checkNotes(where, task, track, notes_)
  if (notes !== null) return notes
  const bad = itemsOf(track).filter(item => !(STATUSES as readonly string[]).includes(item.status))
  if (bad.length > 0)
    return `Track items without a status (${STATUSES.join(', ')}) in ${where}track.md: ${quote(
      bad.map(i => i.line),
      '; ',
    )}.`

  return null
}

// A decision may name what it turned down: "rejected: <option> — <why>".
function badRejected(text: string, where: string): string | null {
  const bad = (sections(text).get('Decisions') ?? '').split('\n').find(line => /rejected:/.test(line) && !/rejected: .+ — .+/.test(line))

  return bad === undefined ? null : `${where}: "${bad.trim()}" — a rejected option needs its reason: "rejected: <option> — <why>".`
}

function checkOwner(owner: string | null): string | null {
  if (owner === null) return `No ${OWNER}: create it beside ${BOARD} with the owner's decisions in force for the whole project, or "none".`
  if (owner.trim() === '') return `${OWNER} is empty. No decisions yet — write "none".`
  return (
    overLimit(
      OWNER,
      owner,
      OWNER_MAX_LINES,
      'it has become a log. Merge rules that say the same, drop revoked ones, move what binds one task into that task.',
    ) ?? dated(OWNER, owner, "The owner's decisions have no dates: a newer word rewrites the older line.")
  )
}

// A task's notes: each with its description, each linked from track.md or task.md, every link reaching a note. Beside
// the description a note is free: research, a decision worked out, evidence.
function checkNotes(where: string, task: string, track: string, notes: TaskFiles['notes']): string | null {
  for (const note of notes) {
    if ((frontmatter(note.text).get('description') ?? '') === '') {
      return `${where}${NAMES.notes}/${note.name} needs a frontmatter "description": what is in it, as the list after a shift shows it.`
    }
    if (!`${task}\n${track}`.includes(`${NAMES.notes}/${note.name}`)) {
      return `${where}${NAMES.notes}/${note.name} is linked from nowhere: link it from its item in track.md, or from task.md, as [what it holds](${NAMES.notes}/${note.name}).`
    }
  }
  const names = new Set(notes.map(note => note.name))
  const linked = [...`${task}\n${track}`.matchAll(new RegExp(`\\]\\(${NAMES.notes}/([^)#\\s]+)\\)`, 'g'))].map(found => found[1] ?? '')
  const missing = linked.filter(name => !names.has(name))

  return missing.length === 0
    ? null
    : `${where} links to notes that are not there: ${quote(missing.map(name => `${NAMES.notes}/${name}`))}.`
}

export const isKind = (kind: string): kind is Kind => Object.hasOwn(KINDS, kind)

// An entry's command: a fenced block or an indented one.
const hasCommand = (body: string) => /^```/m.test(body) || /^ {4}\S/m.test(body)

export function checkKnowledge({ name, text }: KnowledgeFile): string | null {
  const where = `${KNOWLEDGE}/${name}`
  const meta = frontmatter(text)
  const kind = meta.get('kind') ?? ''
  if (kind === 'glossary')
    return `${where} is a glossary: terms live in ${GLOSSARY} now, one article each — see ${GUIDE_TOOL}. Move them there and remove the file.`
  if (!isKind(kind)) return `${where} needs a frontmatter "kind": one of ${Object.keys(KINDS).join(', ')}.`
  if (name !== `${kind}.md` && !name.startsWith(`${kind}-`)) {
    return `${where} is of kind "${kind}": name it ${kind}.md or ${kind}-<topic>.md.`
  }
  if ((meta.get('about') ?? '') === '') return `${where} needs a frontmatter "about": what is in it and where the neighbouring files are.`
  const size =
    overLimit(where, text, KNOWLEDGE_MAX_LINES, `drop what is dead, then split the rest by topic into ${kind}-<topic>.md files.`) ??
    dated(where, text, 'Knowledge has no dates: an entry that lied is fixed or removed when it is used.')
  if (size !== null) return size

  const fields: readonly string[] = KINDS[kind]
  const lacking = blocks(text, 3).filter(e => fields.some(f => !e.body.includes(f)) || (kind === 'runbook' && !hasCommand(e.body)))
  if (lacking.length > 0) {
    const need = kind === 'runbook' ? `a command block and ${quote(fields)}` : quote(fields)
    return `Entries in ${where} lack ${need}: ${lacking.map(e => `"### ${e.title}"`).join(', ')}.`
  }

  return null
}

// What each knowledge file holds, one line per file: it is read on demand, not handed over.
export function knowledgeMap(files: readonly KnowledgeFile[]): string {
  if (files.length === 0) return `${KNOWLEDGE}/ is empty.`

  return files
    .map(({ name, text }) => {
      const kind = frontmatter(text).get('kind') ?? ''
      const count = kind === 'glossary' ? text.split('\n').filter(line => line.startsWith('- **')).length : blocks(text, 3).length

      return `- ${KNOWLEDGE}/${name} — ${frontmatter(text).get('about') ?? ''} (${count} ${kind === 'glossary' ? 'terms' : 'entries'})`
    })
    .join('\n')
}
