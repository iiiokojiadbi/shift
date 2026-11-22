import { checkGlossary } from './glossary'
import {
  atPlaces,
  BOARD,
  BOARD_MAX_LINES,
  BOARD_SECTIONS,
  DIR,
  GLOSSARY,
  GUIDE_TOOL,
  KINDS,
  KNOWLEDGE,
  KNOWLEDGE_MAX_LINES,
  LETTER_SECTIONS,
  NAMES,
  OWNER,
  OWNER_MAX_LINES,
  OWNER_SECTION,
  SETTINGS,
} from './layout'
import { blocks, dated, frontmatter, missingSections, overLimit, quote, sections } from './markdown'
import type { Project } from './project'
import type { Kind, KnowledgeFile, Work } from './types'

export function checkLetter(text: string): string | null {
  const missing = missingSections(text, LETTER_SECTIONS, 'The letter')
  if (missing !== null) return missing
  const found = sections(text)
  const empty = LETTER_SECTIONS.filter(name => found.get(name) === '')
  if (empty.length > 0) return `The letter has empty sections: ${quote(empty)}. Nothing to say — write "none".`

  return null
}

// The records against the previous shift's snapshot; a refusal names the files at the places the settings give.
export function checkWork(work: Work, project: Pick<Project, 'settings' | 'problem'>): string | null {
  const problem = checkRecords(work, project)

  return problem === null ? null : atPlaces(problem, project.settings.files)
}

function checkRecords(work: Work, project: Pick<Project, 'settings' | 'problem'>): string | null {
  const settingsProblem = checkSettings(project)
  if (settingsProblem !== null) return settingsProblem
  const boardProblem = checkBoard(work.board)
  if (boardProblem !== null) return boardProblem

  const ownerProblem = checkOwner(work.owner)
  if (ownerProblem !== null) return ownerProblem

  for (const file of work.knowledge) {
    const problem = checkKnowledge(file)
    if (problem !== null) return problem
  }

  const glossaryProblem = checkGlossary(work.glossary, GLOSSARY)
  if (glossaryProblem !== null) return glossaryProblem

  return null
}

// After the agent wrote one record: only the checks of that file, so a broken record is seen as it is written, not
// hundreds of K later at the shift. `path` is from the project's root; null for a file that is not a record.
export function checkWritten(path: string, work: Work, project: Pick<Project, 'settings' | 'problem'>): string | null {
  const { files } = project.settings
  const [dir, name = '', rest] = path.split('/').slice(1)
  const inShift = path.startsWith(`${DIR}/`)
  let problem: string | null = null
  if (path === SETTINGS) problem = checkSettings(project)
  else if (path === BOARD) problem = checkBoard(work.board)
  else if (path === files.owner) problem = checkOwner(work.owner)
  else if (path === files.glossary) problem = checkGlossary(work.glossary, GLOSSARY)
  else if (inShift && dir === NAMES.knowledge && rest === undefined && name.endsWith('.md')) {
    const file = work.knowledge.find(each => each.name === name)
    problem = file === undefined ? null : checkKnowledge(file)
  }

  return problem === null ? null : atPlaces(problem, files)
}

function checkSettings(project: Pick<Project, 'problem'>): string | null {
  return project.problem === null ? null : `${project.problem} The file is the owner's: tell them, and do not shift until it is fixed.`
}

export function checkBoard(board: string): string | null {
  const headings = sections(board)
  if (headings.has(OWNER_SECTION)) {
    return `The board has an "## ${OWNER_SECTION}" section: owner decisions live in ${OWNER}. Move its lines there as they are, remove the section from the board, and call again.`
  }
  // Existing boards stay usable until their next editorial revision.
  const legacy = headings.has('Decisions') && headings.has('Dead ends')
  const boardMissing = missingSections(board, legacy ? ['Goal'] : BOARD_SECTIONS, 'The board')
  if (boardMissing !== null) return boardMissing

  return (
    overLimit(
      'The board',
      board,
      BOARD_MAX_LINES,
      'it has become a diary. Keep the stage goals and shared focus. Put the next step in the letter.',
    ) ?? dated('the board', board, "The board has no dates — each shift's time is recorded by itself.")
  )
}

export function checkOwner(owner: string | null): string | null {
  if (owner === null) return `No ${OWNER}: create it with the owner's decisions in force for the whole project, or "none".`
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

export const isKind = (kind: string): kind is Kind => Object.hasOwn(KINDS, kind)

// An entry's command: a fenced block or an indented one.
const hasCommand = (body: string) => /^ {0,3}(```|~~~)/m.test(body) || /^ {4}\S/m.test(body)

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
