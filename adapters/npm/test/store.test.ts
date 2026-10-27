import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, readlink, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeStore } from '../store'

test('writes of one file at once never mix; a link is written through, even to a file not there yet, a cycle refused', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shift-store-'))
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
  await symlink('y.md', join(root, 'x.md'))
  await symlink('x.md', join(root, 'y.md'))
  await expect(nodeStore.write(join(root, 'x.md'), 'X')).rejects.toThrow('cycle')
  expect(await readlink(join(root, 'x.md'))).toBe('y.md')
})

test('a link counts as what it points to', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shift-store-'))
  await mkdir(join(root, 'pages'))
  await writeFile(join(root, 'pages/real.md'), '# R')
  await symlink('real.md', join(root, 'pages/guide.md'))
  await symlink('.', join(root, 'pages/loop'))
  expect(await nodeStore.list(join(root, 'pages'), 'file')).toEqual(['guide.md', 'real.md'])
  expect(await nodeStore.list(join(root, 'pages'), 'dir')).toEqual(['loop'])
  expect(Object.keys(await nodeStore.stamps(join(root, 'pages'))).sort()).toEqual(['guide.md', 'real.md'])
})
