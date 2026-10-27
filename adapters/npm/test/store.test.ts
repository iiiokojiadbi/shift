import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, readlink, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeStore } from '../store'

test('writes of one file at once never mix; a link is written through, even to a file not there yet', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shift-store-'))
  const file = join(root, 'track.md')
  const texts = ['a'.repeat(16_384), 'b'.repeat(8_192), 'c'.repeat(12_000)]
  await Promise.all(texts.map(text => nodeStore.write(file, text)))
  expect(texts).toContain(await readFile(file, 'utf8'))

  await symlink('target.md', join(root, 'map.md'))
  await nodeStore.write(join(root, 'map.md'), 'MAP')
  expect(await readlink(join(root, 'map.md'))).toBe('target.md')
  expect(await readFile(join(root, 'target.md'), 'utf8')).toBe('MAP')
})

test('a link to a file is a file; a link to a folder is not followed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shift-store-'))
  await mkdir(join(root, 'docs'))
  await writeFile(join(root, 'docs/real.md'), '# R')
  await symlink('real.md', join(root, 'docs/guide.md'))
  await symlink('.', join(root, 'docs/loop'))
  expect(await nodeStore.list(join(root, 'docs'), 'file')).toEqual(['guide.md', 'real.md'])
  expect(await nodeStore.list(join(root, 'docs'), 'dir')).toEqual([])
  expect(Object.keys(await nodeStore.stamps(join(root, 'docs'))).sort()).toEqual(['guide.md', 'real.md'])
})
