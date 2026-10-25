// The records a shift accepts, as the tests use them: one copy, so a fixture never drifts between files. Data only,
// no imports: scripts/sync-core.ts copies it into the Claude Code plugin's tests, which load only the plugin's files.

export const ROOT = '/p'
export const R = `${ROOT}/.shift`

export const LETTER = [
  '## Where I am',
  'fixing tests',
  '## Next',
  'claude plugin test',
  '## Unverified',
  'none',
  '## Hold',
  'HOLD-THIS',
].join('\n')

export function boardWith(decisions: string[] = ['none']): string {
  return ['## Goal', 'the mod', '## Decisions', ...decisions, '## Dead ends', 'none'].join('\n')
}

export function listWith(taskLines: string[]): string {
  return ['# Tasks', '', ...taskLines].join('\n')
}

export function taskMd(title: string, extra: string[] = []): string {
  return [
    `# ${title}`,
    ...extra,
    '',
    '## Goal',
    'g',
    '## Done when',
    'd',
    '## Owner decisions',
    'none',
    '## Decisions',
    'none',
    '## Dead ends',
    'none',
  ].join('\n')
}

export const BOARD = boardWith()
export const LIST = listWith(['- [in progress] [tests](tasks/tests/) — red'])
export const TRACK = '- [in progress] fix the parser\n- [open] cover the archive'
export const TESTS = { name: 'tests', task: taskMd('Green tests'), track: TRACK, notes: [] }
export const OWNER = '# Owner decisions\n\n## How to work\n\n- «тесты зеленые перед коммитом»'
export const TRAPS = [
  '---',
  'kind: traps',
  'about: traps of edits and tests; lessons — lessons.md',
  '---',
  '',
  '## Edits',
  '',
  '### The script stopped on the third replacement',
  '',
  '**Cause.** the pattern matched twice.',
  '',
  '**Do.** check the count before writing.',
].join('\n')
