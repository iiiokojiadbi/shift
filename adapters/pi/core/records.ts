// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import {
  ARCHIVE_TOOL,
  BOARD,
  BOARD_MAX_LINES,
  BOARD_SECTIONS,
  FOCUS,
  KINDS,
  KNOWLEDGE,
  KNOWLEDGE_MAX_LINES,
  LETTER_SECTIONS,
  NAME,
  OWNER,
  OWNER_MAX_LINES,
  OWNER_SECTION,
  STATUSES,
  TASK_SECTIONS,
  TASKS,
} from './layout'
import { findDate, frontmatter, itemsOf, missingSections, quote, sections } from './markdown'
import type { FocusTask, Kind, KnowledgeFile, TaskFiles, Work } from './types'

export function checkLetter(text: string): string | null {
  const missing = missingSections(text, LETTER_SECTIONS, 'The letter')
  if (missing !== null) return missing
  const found = sections(text)
  const empty = LETTER_SECTIONS.filter(name => found.get(name) === '')
  if (empty.length > 0) return `The letter has empty sections: ${quote(empty)}. Nothing to say — write "none".`

  return null
}

export function boardTasks(board: string): FocusTask[] {
  return itemsOf(sections(board).get('Tasks') ?? '').map(item => ({
    status: item.status,
    name: item.rest.split(/\s+/)[0] ?? '',
    line: item.line,
  }))
}

export function taskTitle(task: string): string | null {
  return /^# +(.+?)\s*$/m.exec(task)?.[1] ?? null
}

export function continues(task: string): string[] {
  return [...task.matchAll(/^continues: *(?:\S*\/)?archive\/([a-z0-9-]+)\/?\s*$/gm)].map(match => match[1] ?? '')
}

// The whole state of the work as one text, to tell whether anything moved since the last shift.
export function workText(work: Work): string {
  const tasks = [...work.tasks].sort((a, b) => a.name.localeCompare(b.name))

  return [
    work.board.trim(),
    (work.owner ?? '').trim(),
    ...tasks.map(t => `${t.name}\n${(t.task ?? '').trim()}\n${(t.track ?? '').trim()}`),
    ...work.knowledge.map(k => `${k.name}\n${k.text.trim()}`),
  ].join('\n\n')
}

const lineCount = (text: string) => text.trimEnd().split('\n').length

export function checkWork(work: Work, previous: Work | null): string | null {
  const { board } = work
  if (sections(board).has(OWNER_SECTION)) {
    return `The board has an "## ${OWNER_SECTION}" section: owner decisions now live in ${OWNER}. Move its lines there as they are, remove the section from the board, and call again.`
  }
  const boardMissing = missingSections(board, BOARD_SECTIONS, 'The board')
  if (boardMissing !== null) return boardMissing

  const lines = lineCount(board)
  if (lines > BOARD_MAX_LINES) {
    return `The board is ${lines} lines, the limit is ${BOARD_MAX_LINES}: it has become a diary. Move what belongs to one task into that task, keep only decisions in force.`
  }

  const date = findDate(board)
  if (date !== null) return `A date on the board: "${date}". The board has no dates — each shift's time is recorded by itself. Remove it.`

  const focus = boardTasks(board)
  const badStatus = focus.filter(t => !(FOCUS as readonly string[]).includes(t.status))
  if (badStatus.length > 0) {
    return `Board tasks without a status (${FOCUS.join(', ')}): ${badStatus.map(t => `"${t.line}"`).join('; ')}. A finished task is archived with ${ARCHIVE_TOOL}, not marked on the board.`
  }
  const badName = focus.filter(t => !NAME.test(t.name))
  if (badName.length > 0) {
    return `Board tasks must start with the task's folder name: ${badName.map(t => `"${t.line}"`).join('; ')}.`
  }

  const onBoard = new Set(focus.map(t => t.name))
  const folders = new Set(work.tasks.map(t => t.name))
  const unlisted = [...folders].filter(name => !onBoard.has(name))
  if (unlisted.length > 0)
    return `Task folders missing from the board: ${unlisted.join(', ')}. Put each on the board with its status, or archive it.`
  const homeless = [...onBoard].filter(name => !folders.has(name))
  if (homeless.length > 0)
    return `Board tasks without a folder in ${TASKS}/: ${homeless.join(', ')}. Create the folder, or remove the line if the task is archived.`

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
  const bad = itemsOf(track).filter(item => !(STATUSES as readonly string[]).includes(item.status))
  if (bad.length > 0)
    return `Track items without a status (${STATUSES.join(', ')}) in ${where}track.md: ${bad.map(i => `"${i.line}"`).join('; ')}.`

  return null
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
