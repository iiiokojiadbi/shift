import { expect, test } from 'bun:test'
import { readAbout, renderAbout } from '../src/about'
import { checkGlossary } from '../src/glossary'
import { findDate, frontmatter } from '../src/markdown'
import { checkKnowledge } from '../src/records'
import { parseSettings } from '../src/settings'

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

test('a tilde-fenced runbook command', () => {
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

test('about.md keeps a known fill without the one before, and a reason over lines', () => {
  const about = renderAbout({
    about: 'x',
    sessionId: 's',
    at: 0,
    after: 'wait',
    result: 'not shifted: failed\n  denied',
    tokensAfter: 20_000,
  })
  expect(readAbout(about)).toMatchObject({ tokensAfter: 20_000, result: 'not shifted: failed denied' })
})

test('a settings table is opened once', () => {
  expect(parseSettings('[docs]\ntoc = true\n[docs]\nmax_lines = 9')).toContain('opened twice')
})
