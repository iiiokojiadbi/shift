import { expect, test } from 'bun:test'
import { blocks, dated, headings, lineCount, overLimit, sections, title } from '../src/markdown'

const FENCED = ['# Letter', '## Hold', 'keep this:', '```md', '## not a heading', '### nor this', '```', 'and this', '## Next', 'go'].join(
  '\n',
)

test('a heading inside a code fence is text: the Hold keeps it, the next real heading ends it', () => {
  expect([...sections(FENCED).keys()]).toEqual(['Hold', 'Next'])
  expect(sections(FENCED).get('Hold')).toBe('keep this:\n```md\n## not a heading\n### nor this\n```\nand this')
  expect(headings(FENCED).map(h => [h.level, h.title, h.line])).toEqual([
    [1, 'Letter', 1],
    [2, 'Hold', 2],
    [2, 'Next', 9],
  ])
  expect(title(FENCED)).toBe('Letter')
  expect(title('```\n# not a title\n```')).toBeNull()
})

test('blocks of a level end at the next heading of that level or above', () => {
  const runbook = ['## Build', '### Check', '```', '### inside', '```', '**Shows.** green.', '## Release', 'text', '### Tag', 'x'].join(
    '\n',
  )
  expect(blocks(runbook, 3).map(b => [b.title, b.body])).toEqual([
    ['Check', '```\n### inside\n```\n**Shows.** green.'],
    ['Tag', 'x'],
  ])
})

test('one line count, one limit refusal, one date refusal', () => {
  expect(lineCount('a\n\n\n')).toBe(1)
  expect(lineCount('a\nb\n')).toBe(2)
  expect(overLimit('The board', 'a\nb\nc', 2, 'trim it.')).toBe('The board is 3 lines, the limit is 2: trim it.')
  expect(overLimit('The board', 'a\nb', 2, 'trim it.')).toBeNull()
  expect(dated('X', 'one\nsince 2026-10-24\n', 'No dates.')).toBe('A date in X: "since 2026-10-24". No dates. Remove it.')
  expect(dated('X', 'none', 'No dates.')).toBeNull()
})

test('fences as CommonMark has them: closed by the same mark at least as long, an unclosed one hides nothing', () => {
  const keys = (text: string) => [...sections(text).keys()]
  expect(keys('## A\n```\nx\n## B\n## C\n')).toEqual(['A', 'B', 'C'])
  expect(keys('## A\n````\n```\n## no\n````\n## B\nb\n')).toEqual(['A', 'B'])
  expect(keys('## A\n```inline```\nfoo\n## B\nb\n')).toEqual(['A', 'B'])
  expect(keys('## A\n~~~\n## no\n~~~\n## B\nb\n')).toEqual(['A', 'B'])
  expect(keys('## A\nMeans: x\n   ## B\nMeans: y\n')).toEqual(['A', 'B'])
})
