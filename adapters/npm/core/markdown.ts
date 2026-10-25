// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import type { Item } from './types'

// Every record and document is read by these: a heading is a `#` line outside code fences, so a `## ` inside a
// fenced command or example — in the letter's Hold, a runbook entry, a document — never cuts what it is in.

export type Heading = { level: number; title: string; line: number; note: string }

const HEADING = /^ {0,3}(#{1,6}) +(.+?)\s*$/
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/

// The lines inside code fences, the fences included: an opener of three or more backticks or tildes, closed by a line
// of the same character at least as long with nothing else on it. A backtick opener with a backtick after it is
// inline code, and an opener never closed is no fence, so a stray one never hides the rest of a record.
function fenced(lines: readonly string[]): Set<number> {
  const inside = new Set<number>()
  for (let at = 0; at < lines.length; at++) {
    const [, mark = '', info = ''] = FENCE.exec(lines[at] ?? '') ?? []
    if (mark === '' || (mark.startsWith('`') && info.includes('`'))) continue
    const closer = new RegExp(`^ {0,3}${mark.startsWith('`') ? '`' : '~'}{${mark.length},}\\s*$`)
    const close = lines.findIndex((line, index) => index > at && closer.test(line))
    if (close === -1) continue
    for (let index = at; index <= close; index++) inside.add(index)
    at = close
  }

  return inside
}

// Every heading outside code fences: its level, its title, its line from 1, and the `> ` line right under it.
export function headings(text: string): Heading[] {
  const lines = text.split('\n')
  const inside = fenced(lines)
  const found: Heading[] = []
  for (const [index, line] of lines.entries()) {
    const match = inside.has(index) ? null : HEADING.exec(line)
    if (match === null) continue
    const under = lines[index + 1] ?? ''
    found.push({
      level: match[1]?.length ?? 1,
      title: match[2] ?? '',
      line: index + 1,
      note: under.startsWith('> ') ? under.slice(2).trim() : '',
    })
  }

  return found
}

const PIN = /^ {0,3}> ?\[!IMPORTANT\]\s*$/
const QUOTED = /^ {0,3}> ?/

// A pinned block: a `> [!IMPORTANT]` quote, as GitHub draws it, outside code fences.
export type Pin = { section: string | null; text: string }

// The pinned blocks of a text: each one's lines without their `> `, and the `##` or `###` section it is in.
export function pinned(text: string): Pin[] {
  const lines = text.split('\n')
  const inside = fenced(lines)
  const marks = headings(text).filter(heading => heading.level >= 2)
  const found: Pin[] = []
  for (let at = 0; at < lines.length; at++) {
    if (inside.has(at) || !PIN.test(lines[at] ?? '')) continue
    let end = at + 1
    while (end < lines.length && !inside.has(end) && QUOTED.test(lines[end] ?? '')) end++
    const body = lines
      .slice(at + 1, end)
      .map(line => line.replace(QUOTED, ''))
      .join('\n')
      .trim()
    if (body !== '') found.push({ section: marks.filter(heading => heading.line <= at).at(-1)?.title ?? null, text: body })
    at = end - 1
  }

  return found
}

// The blocks under the headings of `level`: each title with the text up to the next heading of that level or above.
export function blocks(text: string, level: number): { title: string; body: string }[] {
  const lines = text.split('\n')
  const marks = headings(text).filter(heading => heading.level <= level)

  return marks.flatMap((heading, at) =>
    heading.level === level
      ? [{ title: heading.title, body: lines.slice(heading.line, (marks[at + 1]?.line ?? lines.length + 1) - 1).join('\n') }]
      : [],
  )
}

// `## heading` blocks of a markdown file, trimmed; text before the first heading is dropped.
export function sections(text: string): Map<string, string> {
  return new Map(blocks(text, 2).map(block => [block.title, block.body.trim()]))
}

// The `# ` title; null without one.
export function title(text: string): string | null {
  return headings(text).find(heading => heading.level === 1)?.title ?? null
}

export function lineCount(text: string): number {
  return text.trimEnd().split('\n').length
}

// The refusal for a record over its line limit, with what to do about it; null within it.
export function overLimit(where: string, text: string, max: number, advice: string): string | null {
  const lines = lineCount(text)

  return lines > max ? `${where} is ${lines} lines, the limit is ${max}: ${advice}` : null
}

// The refusal for a date in a record, with why it has none; null without one.
export function dated(where: string, text: string, why: string): string | null {
  const date = findDate(text)

  return date === null ? null : `A date in ${where}: "${date}". ${why} Remove it.`
}

export const quote = (names: readonly string[], separator = ', ') => names.map(name => `"${name}"`).join(separator)

// Whether a value is one of a list of literals, narrowed to it.
export function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return (list as readonly unknown[]).includes(value)
}

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

// Every `- ` line of a text as an item; a line without a `[status]` has an empty one, a track item without `#<id>`
// a null id.
export function itemsOf(text: string): Item[] {
  return text.split('\n').flatMap((raw, index) => {
    if (!raw.startsWith('- ')) return []
    const line = raw.trim()
    const match = /^- \[([^\]]+)\] *(.*)$/.exec(line)
    const rest = match?.[2] ?? line.slice(2).trim()
    const id = /^#(\d+) +/.exec(rest)
    const named = id === null ? rest : rest.slice(id[0].length)
    const cut = named.indexOf(' — ')

    return [
      {
        status: match?.[1] ?? '',
        id: id === null ? null : Number(id[1]),
        name: cut === -1 ? named : named.slice(0, cut),
        note: cut === -1 ? null : named.slice(cut + 3),
        rest,
        line,
        index,
      },
    ]
  })
}

export function formatItem(status: string, id: number, name: string, note: string | null): string {
  return `- [${status}] #${id} ${name}${note === null ? '' : ` — ${note}`}`
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
