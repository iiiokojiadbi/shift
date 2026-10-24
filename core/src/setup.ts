import { docsReport } from './docs'
import { sessionFiles } from './flows'
import { MOD, SETTINGS } from './layout'
import type { Project } from './project'
import { SETTING_KEYS, settingValue } from './settings'
import { SETUP_LAYOUT, SETUP_MIGRATION } from './texts/doctrine'
import { fileBlock } from './texts/prompts'

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
    const where = project.set.has(key) ? 'set here' : 'default'

    return `- \`${tomlKey(key)}\` = ${value ?? 'unset'} — ${where}, since ${since}: ${about}`
  })

  const files = await sessionFiles(project)
  const stale = loaded === null ? [] : files.filter(file => !loaded.includes(fileBlock(file.path, file.text))).map(file => file.path)
  const block =
    files.length === 0
      ? 'None: the mod is off here, or the records are in an older layout.'
      : [
          ...files.map(file => `- \`${file.path}\``),
          '',
          stale.length === 0
            ? "This session's block matches them."
            : `Changed since this session's block was read: ${stale.map(path => `\`${path}\``).join(', ')}. The block is read at a session's start and after each shift, so the changes reach it after the next shift or in a new session; read the files themselves meanwhile.`,
        ].join('\n')

  return [
    `# The ${MOD} mod in this project`,
    '',
    `## Settings — \`${SETTINGS}\``,
    '',
    `The owner's file: change it only on their word. ${state} A change takes effect for the session's block at the next shift or in a new session, for everything else at once. Every key, its value here, the mod's version it came in, what it does:`,
    '',
    ...keys,
    '',
    '## The session block',
    '',
    'Loaded whole into every session:',
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
    '',
    SETUP_MIGRATION,
  ].join('\n')
}

function tomlKey(key: string): string {
  const dot = key.indexOf('.')

  return dot === -1 ? key : `[${key.slice(0, dot)}] ${key.slice(dot + 1)}`
}
