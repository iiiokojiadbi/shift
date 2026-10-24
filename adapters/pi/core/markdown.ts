// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import type { Item } from './types'

// `## heading` blocks of a markdown file; text before the first heading is dropped.
export function sections(text: string): Map<string, string> {
  const found = new Map<string, string>()
  let heading: string | null = null
  let body: string[] = []
  const flush = () => {
    if (heading !== null) found.set(heading, body.join('\n').trim())
  }
  for (const line of text.split('\n')) {
    const match = /^## +(.+?)\s*$/.exec(line)
    if (match === null) {
      body.push(line)
      continue
    }
    flush()
    heading = match[1] ?? null
    body = []
  }
  flush()

  return found
}

export const quote = (names: readonly string[]) => names.map(name => `"${name}"`).join(', ')

export function missingSections(text: string, required: readonly string[], where: string): string | null {
  const found = sections(text)
  const missing = required.filter(name => !found.has(name))
  if (missing.length > 0) return `${where} lacks sections: ${missing.map(m => `"## ${m}"`).join(', ')}.`

  return null
}

const DATES = [/\b(19|20)\d{2}-\d{2}-\d{2}\b/, /\b\d{1,2}\.\d{1,2}\.(19|20)\d{2}\b/]

export function findDate(text: string): string | null {
  for (const line of text.split('\n')) {
    if (DATES.some(re => re.test(line))) return line.trim()
  }

  return null
}

export function itemsOf(text: string): Item[] {
  return text
    .split('\n')
    .filter(line => line.startsWith('- '))
    .map(line => {
      const match = /^- \[([^\]]+)\] *(.*)$/.exec(line.trim())

      return { status: match?.[1] ?? '', rest: match?.[2] ?? line.slice(2).trim(), line: line.trim() }
    })
}

export function formatK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(0)}K` : String(n)
}

// `key: value` lines between the leading `---` fences.
export function frontmatter(text: string): Map<string, string> {
  const found = new Map<string, string>()
  const match = /^---\n([\s\S]*?)\n---/.exec(text)
  for (const line of (match?.[1] ?? '').split('\n')) {
    const colon = line.indexOf(':')
    if (colon > 0) found.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim())
  }

  return found
}

export function bullets(body: string | undefined): string[] {
  return (body ?? '')
    .split('\n')
    .filter(line => line.startsWith('- '))
    .map(line => line.slice(2))
}
