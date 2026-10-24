import { docsReport } from './doccare'
import { sessionFiles } from './flows'
import { MOD, SETTINGS } from './layout'
import { DEFAULT_SETTINGS, parseSettings, SETTING_KEYS, settingValue } from './settings'
import type { Store } from './store'
import { SETUP_LAYOUT, SETUP_MIGRATION } from './texts/doctrine'
import { fileBlock } from './texts/prompts'

// How the mod is set up in this project: every setting with its value here and the version it came in, the files of
// the session's block and whether the block the session holds is older than them, the layout and the migrations.
// `loaded` is the block as this session read it; null when the harness does not keep one.
export async function setupReport(store: Store, root: string, loaded: string | null): Promise<string> {
  const text = await store.read(`${root}/${SETTINGS}`)
  const parsed = text === null ? null : parseSettings(text)
  const settings = parsed === null || typeof parsed === 'string' ? DEFAULT_SETTINGS : parsed
  const state =
    text === null
      ? 'No settings file: every key is at its default.'
      : typeof parsed === 'string'
        ? `It does not parse — ${parsed} The mod stays on with the defaults, and a shift is refused until it is fixed.`
        : 'It parses.'
  const keys = SETTING_KEYS.map(({ key, since, about }) => {
    const value = settingValue(settings, key)
    const where = text !== null && typeof parsed !== 'string' && setIn(text, key) ? 'set here' : 'default'

    return `- \`${tomlKey(key)}\` = ${value ?? 'unset'} — ${where}, since ${since}: ${about}`
  })

  const files = await sessionFiles(store, root)
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
      : ((await docsReport(store, root)) ?? 'No remarks.'),
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

// Whether the file sets the key itself: a `key =` line under its table.
function setIn(text: string, key: string): boolean {
  const dot = key.indexOf('.')
  const table = dot === -1 ? '' : key.slice(0, dot)
  const name = dot === -1 ? key : key.slice(dot + 1)
  let current = ''
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const header = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line)
    if (header !== null) current = header[1] ?? ''
    else if (current === table && new RegExp(`^${name}\\s*=`).test(line)) return true
  }

  return false
}
