import { expect, test } from 'bun:test'
import { checkGlossary } from '../src/glossary'
import { findDate, frontmatter, itemsOf } from '../src/markdown'
import { checkKnowledge, checkTask } from '../src/records'
import { shiftNames } from '../src/store'
import { archiveInList, checkTaskList } from '../src/tasks'
import { numberItems } from '../src/track'
import { R, ROOT, taskMd } from './fixtures'
import { memoryProject } from './memory'

// Cases the review of the records' checks found: each was a false refusal or a check that let a broken record pass.

test('a date is a real day of a real month, never part of a version', () => {
  expect(findDate('released 2026-10-26')).toBe('released 2026-10-26')
  expect(findDate('on 26.10.2026')).toBe('on 26.10.2026')
  expect(findDate('Use version 0.32.2026')).toBeNull()
  expect(findDate('build 2026-13-40')).toBeNull()
  expect(findDate('version 0.32.0')).toBeNull()
})

test('a frontmatter with CRLF line ends is read', () => {
  expect(frontmatter('---\r\nkind: traps\r\nabout: x\r\n---\r\n').get('kind')).toBe('traps')
})

test('an id past the safe integers is numbered anew, never shared', () => {
  expect(itemsOf('- [open] #9007199254740993 big')[0]?.id).toBeNull()
  expect(numberItems('- [open] #9007199254740993 big\n- [open] #2 small')).toBe('- [open] #3 big\n- [open] #2 small')
})

test('a fenced example in a task, a fragment link to a note, a tilde-fenced runbook command', () => {
  const task = taskMd('T', ['', '```yaml', 'continues: no', '```'])
  expect(checkTask({ name: 't', task, track: '- [open] #1 x', notes: [] })).toBeNull()
  expect(checkTask({ name: 't', task: taskMd('T'), track: '- [open] #1 x — [proof](notes/missing.md#evidence)', notes: [] })).toContain(
    'notes/missing.md',
  )
  const runbook = [
    '---',
    'kind: runbook',
    'about: commands',
    '---',
    '',
    '## Build',
    '',
    '### Build it',
    '',
    '~~~sh',
    'bun run build',
    '~~~',
    '',
    '**Shows.** green',
  ].join('\n')
  expect(checkKnowledge({ name: 'runbook.md', text: runbook })).toBeNull()
})

test('a glossary article may spell its own term in another case', () => {
  expect(checkGlossary('# Glossary\n\n## OAuth\nVariants: oauth\nMeans: the login.\n', 'GLOSSARY.md')).toBeNull()
  expect(checkGlossary('# Glossary\n\n## OAuth\nMeans: a.\n\n## Login\nVariants: oauth\nMeans: b.\n', 'GLOSSARY.md')).toContain('in both')
})

test('TASKS.md: a task listed twice is refused; archiving keeps blank-separated links out and splits a shared needs', () => {
  const twice =
    '# Tasks\n\n- [in progress] [a](tasks/a/) — a\n  - needs: [b](tasks/b/)\n- [in progress] [b](tasks/b/) — b\n  - needs: [a](tasks/a/)\n- [in progress] [a](tasks/a/) — again\n'
  expect(checkTaskList(twice, ['a', 'b'], [])).toContain('lists a task twice')

  const blank = '# Tasks\n\n- [in progress] [a](tasks/a/) — a\n\n  - needs: [b](tasks/b/)\n- [in progress] [b](tasks/b/) — b\n'
  expect(archiveInList(blank, 'a')).not.toContain('needs: [b]')

  const shared =
    '# Tasks\n\n- [in progress] [a](tasks/a/) — a\n  - needs: [b](tasks/b/), [c](tasks/c/) — both feed it\n- [in progress] [b](tasks/b/) — b\n- [in progress] [c](tasks/c/) — c\n'
  const left = archiveInList(shared, 'b')
  expect(left).toContain('  - needs: [c](tasks/c/) — both feed it\n  - after: [b](archive/b/)')
  expect(checkTaskList(left, ['a', 'c'], ['b'])).toBeNull()
})

test('shift folders sort by time, a second taken twice by its number', async () => {
  const project = await memoryProject(
    Object.fromEntries(
      ['20260102-030405', '20260102-030405-10', '20260102-030405-9', '20260102-030406'].map(name => [`${R}/shifts/${name}/about.md`, 'x']),
    ),
    ROOT,
  )
  expect(await shiftNames(project)).toEqual(['20260102-030405', '20260102-030405-9', '20260102-030405-10', '20260102-030406'])
})
