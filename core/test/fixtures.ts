import { checkWork } from '../src/records'
import { DEFAULT_SETTINGS } from '../src/settings'
import type { Work } from '../src/types'
import { BOARD, LIST, OWNER, TESTS, TRAPS } from './data'

export * from './data'

export const WORK: Work = {
  board: BOARD,
  owner: OWNER,
  tasks: [TESTS],
  knowledge: [{ name: 'traps.md', text: TRAPS }],
  taskList: LIST,
  glossary: null,
  shift: null,
  archived: [],
  oldOwner: false,
}
// The records checked against a project whose settings are the defaults.
export const check = (work: Work, previous: Work | null) => checkWork(work, previous, { settings: DEFAULT_SETTINGS, problem: null })
