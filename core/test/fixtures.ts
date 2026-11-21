import { checkWork } from '../src/records'
import { DEFAULT_SETTINGS } from '../src/settings'
import type { Work } from '../src/types'
import { BOARD, OWNER, TRAPS } from './data'

export * from './data'

export const WORK: Work = {
  board: BOARD,
  owner: OWNER,
  knowledge: [{ name: 'traps.md', text: TRAPS }],
  glossary: null,
  shift: null,
}
// The records checked against a project whose settings are the defaults.
export const check = (work: Work) => checkWork(work, { settings: DEFAULT_SETTINGS, problem: null })
