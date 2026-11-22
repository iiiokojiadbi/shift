import { afterAll, expect, test } from 'bun:test'
import { mkdir, readFile, readlink, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { docPaths, docStamps } from '../core/index'
import { nodeStore, projectAt } from '../store'
import { cleanup, scratch } from './scratch'

afterAll(cleanup)

test('writes of one file at once never mix; a link is written through, even to a file not there yet, a cycle refused', async () => {
  const root = await scratch('store')
  const file = join(root, 'track.md')
  const texts = ['a'.repeat(16_384), 'b'.repeat(8_192), 'c'.repeat(12_000)]
  await Promise.all(texts.map(text => nodeStore.write(file, text)))
  expect(texts).toContain(await readFile(file, 'utf8'))

  await symlink('target.md', join(root, 'map.md'))
  await nodeStore.write(join(root, 'map.md'), 'MAP')
  expect(await readlink(join(root, 'map.md'))).toBe('target.md')
  expect(await readFile(join(root, 'target.md'), 'utf8')).toBe('MAP')
  await symlink('b.md', join(root, 'a.md'))
  await symlink('end.md', join(root, 'b.md'))
  await nodeStore.write(join(root, 'a.md'), 'END')
  expect(await readlink(join(root, 'b.md'))).toBe('end.md')
  expect(await readFile(join(root, 'end.md'), 'utf8')).toBe('END')
  for (let link = 0; link < 40; link++) await symlink(link === 39 ? 'last.md' : `l${link + 1}.md`, join(root, `l${link}.md`))
  await nodeStore.write(join(root, 'l0.md'), 'LAST')
  expect(await readFile(join(root, 'last.md'), 'utf8')).toBe('LAST')
  await symlink('y.md', join(root, 'x.md'))
  await symlink('x.md', join(root, 'y.md'))
  await expect(nodeStore.write(join(root, 'x.md'), 'X')).rejects.toThrow('cycle')
  expect(await readlink(join(root, 'x.md'))).toBe('y.md')
})

test('a link counts as what it points to', async () => {
  const root = await scratch('store')
  await mkdir(join(root, 'pages'))
  await writeFile(join(root, 'pages/real.md'), '# R')
  await symlink('real.md', join(root, 'pages/guide.md'))
  await symlink('.', join(root, 'pages/loop'))
  expect(await nodeStore.list(join(root, 'pages'), 'file')).toEqual(['guide.md', 'real.md'])
  expect(await nodeStore.list(join(root, 'pages'), 'dir')).toEqual(['loop'])
  expect(Object.keys(await nodeStore.stamps(join(root, 'pages'))).sort()).toEqual(['guide.md', 'real.md'])
})

test('settings initialization preserves a file another writer has created or edited', async () => {
  const file = join(await scratch('settings'), '.shift/settings.toml')
  const writes = await Promise.allSettled(['first', 'second'].map(text => nodeStore.write(file, text, null)))
  expect(writes.filter(write => write.status === 'fulfilled')).toHaveLength(1)
  const saved = await readFile(file, 'utf8')
  await expect(nodeStore.write(file, 'migration', 'stale')).rejects.toThrow('changed')
  expect(await readFile(file, 'utf8')).toBe(saved)
  await nodeStore.write(file, 'migration', saved)
  expect(await readFile(file, 'utf8')).toBe('migration')
})

test('map and edit observation skip ancestor links and preserve an independent directory alias', async () => {
  const root = await scratch('document-links')
  await mkdir(join(root, 'docs/guide'), { recursive: true })
  await writeFile(join(root, 'docs/guide/guide.md'), '# Guide')
  await symlink('guide', join(root, 'docs/alias'))
  await symlink('..', join(root, 'docs/guide/back'))
  await symlink('.', join(root, 'docs/again'))
  const expected = ['docs/alias/guide.md', 'docs/guide/guide.md']
  expect(await docPaths(nodeStore, root, ['docs'], 50)).toEqual(expected)
  expect(Object.keys(await docStamps(await projectAt(root))).sort()).toEqual(expected)
})
