import { expect, test } from 'bun:test'
import { basename, dirname, fromRoot, isInside, join, normalize, resolvePath } from '../src/paths'

test('a path with no folder is in `.`, and `.` joins to the name alone', () => {
  expect(dirname('OWNER.md')).toBe('.')
  expect(dirname('.shift/OWNER.md')).toBe('.shift')
  expect(dirname('/OWNER.md')).toBe('/')
  expect(join(dirname('OWNER.md'), 'OWNER.md')).toBe('OWNER.md')
  expect(join('/p', '.')).toBe('/p')
  expect(join('.shift', 'board.md')).toBe('.shift/board.md')
  expect(basename('.shift/shifts/20260102-030405')).toBe('20260102-030405')
  expect(basename('docs/')).toBe('docs')
  expect(basename('')).toBe('')
})

test('a link is folded from its folder, and one climbing out of the project is null', () => {
  expect(normalize(`${dirname('docs/a.md')}/../AGENTS.md`)).toBe('AGENTS.md')
  expect(normalize(`${dirname('AGENTS.md')}/docs/./a.md`)).toBe('docs/a.md')
  expect(normalize('docs/../../x.md')).toBeNull()
})

test('paths from the root and back, and what counts as inside the project', () => {
  expect(resolvePath('/p', './.shift/letter.md')).toBe('/p/.shift/letter.md')
  expect(resolvePath('/p', '/q/letter.md')).toBe('/q/letter.md')
  expect(fromRoot('/p', '/p/docs/a.md')).toBe('docs/a.md')
  expect(fromRoot('/p', './docs/a.md')).toBe('docs/a.md')
  expect(isInside('docs')).toBe(true)
  expect(['', '/etc', 'docs/../..'].some(isInside)).toBe(false)
})
