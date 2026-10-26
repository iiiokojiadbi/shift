// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { docsReport } from './docs'
import { sessionFiles, staleLayout } from './flows'
import { atPlaces, BOARD, GUIDE_TOOL, MOD, SETTINGS, TASK_LIST } from './layout'
import { formatK } from './markdown'
import type { Project } from './project'
import { checkWork } from './records'
import { DEFAULT_SETTINGS, SETTING_KEYS, settingValue } from './settings'
import { readRecords } from './store'
import { doctrine, SETUP_LAYOUT, SETUP_MIGRATION } from './texts/doctrine'
import { fileBlock } from './texts/prompts'
import { shownTools } from './tools'

// How the mod is set up in this project: every setting with its value here and the version it came in, the files of
// the session's block and whether the block the session holds is older than them, the layout and the migrations.
// `loaded` is the block as this session read it; null when the harness does not keep one.
export async function setupReport(project: Project, loaded: string | null): Promise<string> {
  const { settings } = project
  const state =
    project.settingsText === null
      ? 'No settings file: every key is at its default.'
      : project.problem !== null
        ? `It does not parse — ${project.problem} The mod stays on with the defaults, and a shift is refused until it is fixed.`
        : 'It parses.'
  const keys = SETTING_KEYS.map(({ key, since, about }) => {
    const value = settingValue(settings, key)
    const where = project.set.has(key) ? `set here, default ${settingValue(DEFAULT_SETTINGS, key) ?? 'unset'}` : 'default'

    return `- \`${tomlKey(key)}\` = ${value ?? 'unset'} — ${where}, since ${since}: ${about}`
  })

  // Read as they are: a report writes nothing, not even the docs' tocs and map.
  const files = await sessionFiles(project, { refresh: false })
  const doctrineChars = atPlaces(doctrine(shownTools(settings).map(tool => tool.name)), settings.files).length
  // Only the files a block can hold: a record's own example of a file tag is no file.
  const loadable = [settings.files.shift, settings.files.owner, settings.files.glossary, TASK_LIST, ...settings.files.always]
  const gone = loadable.filter(path => loaded?.includes(`<file path="${path}">\n`) && !files.some(file => file.path === path))
  const stale = [
    ...(loaded === null ? [] : files.filter(file => !loaded.includes(fileBlock(file.path, file.text))).map(file => file.path)),
    ...gone,
  ]
  const none = !settings.enabled
    ? 'None: the mod is off here, `enabled = false`.'
    : (await staleLayout(project)) !== null
      ? 'None: the records are in an older layout; the Records section says what to move.'
      : `None yet: none of ${[settings.files.shift, settings.files.owner, settings.files.glossary, TASK_LIST].map(path => `\`${path}\``).join(', ')} is here.`
  const shown = settings.enabled ? doctrineChars : 0
  const block = [
    ...(files.length === 0 ? [none] : files.map(file => `- \`${file.path}\` — ${weight(fileBlock(file.path, file.text).length)}`)),
    ...(settings.enabled ? [`- the doctrine, the system prompt's "Shift" section — ${weight(doctrineChars)}`] : []),
    `- in all — ${weight(shown + files.reduce((sum, file) => sum + fileBlock(file.path, file.text).length, 0))}; tokens are estimated at ${CHARS_PER_TOKEN} characters each, more for text that is not English`,
    '',
    stale.length === 0
      ? "This session's block matches them."
      : `Changed or removed since this session's block was read: ${stale.map(path => `\`${path}\``).join(', ')}. The block is read at a session's start and after each shift, so the changes reach it after the next shift or in a new session; read the files themselves meanwhile.`,
  ].join('\n')
  // The tree shows the records where they are by default; the settings may keep some elsewhere.
  const moved = (['owner', 'glossary', 'shift'] as const)
    .filter(key => settings.files[key] !== DEFAULT_SETTINGS.files[key])
    .map(key => `\`${DEFAULT_SETTINGS.files[key]}\` is at \`${settings.files[key]}\` here`)

  return [
    `# The ${MOD} mod in this project`,
    '',
    `## Settings — \`${SETTINGS}\``,
    '',
    `The owner's file: change it only on their word. ${state} A change takes effect for the session's block at the next shift or in a new session, for everything else at once. Every key, its value here, the mod's version it came in, what it does:`,
    '',
    ...keys,
    '',
    '## Records',
    '',
    await recordsState(project),
    '',
    '## The session block',
    '',
    'Loaded whole into every session, with what each costs:',
    '',
    block,
    '',
    '## Documents',
    '',
    settings.docs.dirs.length === 0
      ? 'Off: `[docs] dirs = []`, the mod leaves the documents alone.'
      : ((await docsReport(project)) ?? 'No remarks.'),
    '',
    `## Files`,
    '',
    SETUP_LAYOUT,
    ...(moved.length === 0 ? [] : ['', `Moved by the settings: ${moved.join('; ')}.`]),
    '',
    atPlaces(SETUP_MIGRATION, settings.files),
  ].join('\n')
}

// The records as they are, by every check a shift makes but "nothing changed": a rule added in a newer version, or a
// record broken by a hand outside the agent's tools before the mod looked, shows here and not only at the shift.
async function recordsState(project: Project): Promise<string> {
  if (!project.settings.enabled) return 'Off: `enabled = false`, the mod keeps no records here.'
  const stale = await staleLayout(project)
  if (stale !== null) return stale
  const work = await readRecords(project)
  if (work === null) return `No board yet: create ${BOARD} by the sections in ${GUIDE_TOOL} before the first shift.`
  const problem = checkWork(work, null, project)

  return problem === null
    ? 'They pass every check a shift makes of the records, but whether anything changed since the last shift; the letter is checked by the shift itself.'
    : `A shift would refuse them now: ${problem}`
}

// What a text costs in the context: its characters and the tokens they come to, roughly.
const CHARS_PER_TOKEN = 4

function weight(chars: number): string {
  return `${formatK(chars)} characters, ~${formatK(Math.round(chars / CHARS_PER_TOKEN))} tokens`
}

function tomlKey(key: string): string {
  const dot = key.indexOf('.')

  return dot === -1 ? key : `[${key.slice(0, dot)}] ${key.slice(dot + 1)}`
}
