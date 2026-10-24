// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { checkGlossary } from './glossary'
import {
  BOARD,
  BOARD_MAX_LINES,
  BOARD_SECTIONS,
  GUIDE_TOOL,
  KINDS,
  KNOWLEDGE,
  KNOWLEDGE_MAX_LINES,
  LETTER_SECTIONS,
  OLD_OWNER,
  OWNER,
  OWNER_MAX_LINES,
  OWNER_SECTION,
  STATUSES,
  TASK_LIST,
  TASK_SECTIONS,
  TASKS,
} from './layout'
import { findDate, frontmatter, itemsOf, missingSections, quote, sections } from './markdown'
import { DEFAULT_SETTINGS, parseSettings } from './settings'
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

export function taskTitle(task: string): string | null {
  return /^# +(.+?)\s*$/m.exec(task)?.[1] ?? null
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
    ...tasks.map(t => `${t.name}\n${(t.task ?? '').trim()}\n${(t.track ?? '').trim()}`),
    ...work.knowledge.map(k => `${k.name}\n${k.text.trim()}`),
  ].join('\n\n')
}

const lineCount = (text: string) => text.trimEnd().split('\n').length

export function checkWork(work: Work, previous: Work | null): string | null {
  const { board } = work
  const parsed = work.settings === null ? DEFAULT_SETTINGS : parseSettings(work.settings)
  if (typeof parsed === 'string') return `${parsed} The file is the owner's: tell them, and do not shift until it is fixed.`
  if (work.oldOwner) return `${OLD_OWNER} is the old name: owner decisions live in ${parsed.files.owner} now. Rename it and call again.`
  if (sections(board).has(OWNER_SECTION)) {
    return `The board has an "## ${OWNER_SECTION}" section: owner decisions live in ${parsed.files.owner}. Move its lines there as they are, remove the section from the board, and call again.`
  }
  if (sections(board).has('Tasks')) {
    return `The board has a "## Tasks" section: the open tasks live in ${TASK_LIST} now, one line each with links under it — see ${GUIDE_TOOL}. Move them there and remove the section.`
  }
  const boardMissing = missingSections(board, BOARD_SECTIONS, 'The board')
  if (boardMissing !== null) return boardMissing

  const lines = lineCount(board)
  if (lines > BOARD_MAX_LINES) {
    return `The board is ${lines} lines, the limit is ${BOARD_MAX_LINES}: it has become a diary. Move what belongs to one task into that task, keep only decisions in force.`
  }

  const date = findDate(board)
  if (date !== null) return `A date on the board: "${date}". The board has no dates — each shift's time is recorded by itself. Remove it.`
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

  const glossaryProblem = checkGlossary(work.glossary, parsed.files.glossary)
  if (glossaryProblem !== null) return glossaryProblem

  if (previous !== null && workText(previous) === workText(work)) {
    return 'Nothing changed in the records since the last shift. Update the tracks, statuses and decisions, then shift.'
  }

  return null
}

function checkTask({ name, task, track }: TaskFiles): string | null {
  const where = `${TASKS}/${name}/`
  if (task === null) return `${where} has no task.md.`
  if (track === null) return `${where} has no track.md.`
  if (taskTitle(task) === null) return `${where}task.md has no "# <title>" line.`
  const missing = missingSections(task, TASK_SECTIONS, `${where}task.md`)
  if (missing !== null) return missing
  const date = findDate(task) ?? findDate(track)
  if (date !== null) return `A date in ${where}: "${date}". Tasks have no dates. Remove it.`
  if (/^continues:/m.test(task))
    return `${where}task.md has a "continues:" line: links live in ${TASK_LIST} now, under the task's line. Move it there.`
  const rejected = badRejected(task, `${where}task.md`)
  if (rejected !== null) return rejected
  const bad = itemsOf(track).filter(item => !(STATUSES as readonly string[]).includes(item.status))
  if (bad.length > 0)
    return `Track items without a status (${STATUSES.join(', ')}) in ${where}track.md: ${bad.map(i => `"${i.line}"`).join('; ')}.`

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
  const lines = lineCount(owner)
  if (lines > OWNER_MAX_LINES) {
    return `${OWNER} is ${lines} lines, the limit is ${OWNER_MAX_LINES}: it has become a log. Merge rules that say the same, drop revoked ones, move what binds one task into that task.`
  }
  const date = findDate(owner)
  if (date !== null)
    return `A date in ${OWNER}: "${date}". The owner's decisions have no dates: a newer word rewrites the older line. Remove it.`

  return null
}

export const isKind = (kind: string): kind is Kind => Object.hasOwn(KINDS, kind)

// `### heading` blocks of a markdown file with their bodies.
function entries(text: string): { heading: string; body: string }[] {
  return text
    .split(/^### +/m)
    .slice(1)
    .map(block => {
      const end = block.indexOf('\n')

      return { heading: (end === -1 ? block : block.slice(0, end)).trim(), body: end === -1 ? '' : block.slice(end + 1) }
    })
}

// An entry's command: a fenced block or an indented one.
const hasCommand = (body: string) => /^```/m.test(body) || /^ {4}\S/m.test(body)

export function checkKnowledge({ name, text }: KnowledgeFile): string | null {
  const where = `${KNOWLEDGE}/${name}`
  const meta = frontmatter(text)
  const kind = meta.get('kind') ?? ''
  if (kind === 'glossary')
    return `${where} is a glossary: terms live in GLOSSARY.md now, one article each — see ${GUIDE_TOOL}. Move them there and remove the file.`
  if (!isKind(kind)) return `${where} needs a frontmatter "kind": one of ${Object.keys(KINDS).join(', ')}.`
  if (name !== `${kind}.md` && !name.startsWith(`${kind}-`)) {
    return `${where} is of kind "${kind}": name it ${kind}.md or ${kind}-<topic>.md.`
  }
  if ((meta.get('about') ?? '') === '') return `${where} needs a frontmatter "about": what is in it and where the neighbouring files are.`
  const lines = lineCount(text)
  if (lines > KNOWLEDGE_MAX_LINES) {
    return `${where} is ${lines} lines, the limit is ${KNOWLEDGE_MAX_LINES}: drop what is dead, then split the rest by topic into ${kind}-<topic>.md files.`
  }
  const date = findDate(text)
  if (date !== null)
    return `A date in ${where}: "${date}". Knowledge has no dates: an entry that lied is fixed or removed when it is used. Remove it.`

  const fields: readonly string[] = KINDS[kind]
  const lacking = entries(text).filter(e => fields.some(f => !e.body.includes(f)) || (kind === 'runbook' && !hasCommand(e.body)))
  if (lacking.length > 0) {
    const need = kind === 'runbook' ? `a command block and ${quote(fields)}` : quote(fields)
    return `Entries in ${where} lack ${need}: ${lacking.map(e => `"### ${e.heading}"`).join(', ')}.`
  }

  return null
}

// What each knowledge file holds, one line per file: it is read on demand, not handed over.
export function knowledgeMap(files: readonly KnowledgeFile[]): string {
  if (files.length === 0) return `${KNOWLEDGE}/ is empty.`

  return files
    .map(({ name, text }) => {
      const kind = frontmatter(text).get('kind') ?? ''
      const count = kind === 'glossary' ? text.split('\n').filter(line => line.startsWith('- **')).length : entries(text).length

      return `- ${KNOWLEDGE}/${name} — ${frontmatter(text).get('about') ?? ''} (${count} ${kind === 'glossary' ? 'terms' : 'entries'})`
    })
    .join('\n')
}
