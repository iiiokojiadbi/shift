// Generated from core/src by scripts/sync-core.ts — edit the source, not this copy.
import { GLOSSARY_MAX_LINES } from './layout'
import { blocks, dated, overLimit } from './markdown'

// GLOSSARY.md: the project's own words, one article each, loaded whole into every session.
//
// ## Shift
// Variants: shifts, shifted
// Means: the boundary between stretches of work: records updated, a letter written, the history let go.
// Avoid: compaction, handoff
// Where: everywhere the agent reads; the owner says «сдвиг».
// Unconfirmed: is a stretch the same as a session?

export const GLOSSARY_LABELS = ['Variants', 'Means', 'Avoid', 'Where', 'Unconfirmed'] as const
export type GlossaryLabel = (typeof GLOSSARY_LABELS)[number]
export type Article = { term: string; fields: Partial<Record<GlossaryLabel, string>> }

// The articles, or what is wrong with a line; text before the first article is the file's own heading and intro.
export function parseGlossary(text: string, where: string): Article[] | string {
  const articles: Article[] = []
  for (const block of blocks(text, 2)) {
    const article: Article = { term: block.title, fields: {} }
    articles.push(article)
    for (const line of block.body.split('\n').map(each => each.trim())) {
      if (line === '') continue
      const signed = /^([A-Za-z]+): *(.*)$/.exec(line)
      const label = signed?.[1] as GlossaryLabel | undefined
      if (signed === null || label === undefined || !(GLOSSARY_LABELS as readonly string[]).includes(label)) {
        return `${where}, "${article.term}": "${line}" is not a signed line; the labels are ${GLOSSARY_LABELS.join(', ')}.`
      }
      if (article.fields[label] !== undefined) return `${where}, "${article.term}": "${label}:" twice; one line each.`
      article.fields[label] = (signed[2] ?? '').trim()
    }
  }

  return articles
}

export function checkGlossary(text: string | null, where: string): string | null {
  if (text === null) return null
  const size =
    overLimit(where, text, GLOSSARY_MAX_LINES, 'it comes into every session. Drop general words and terms no longer in use.') ??
    dated(where, text, 'A term means what it means now.')
  if (size !== null) return size
  const articles = parseGlossary(text, where)
  if (typeof articles === 'string') return articles

  const seen = new Map<string, string>()
  for (const article of articles) {
    if (!article.fields.Means) return `${where}, "${article.term}" has no "Means:" — what it is, in one or two sentences.`
    for (const name of [article.term, ...words(article.fields.Variants)]) {
      const key = name.toLowerCase()
      const earlier = seen.get(key)
      if (earlier !== undefined) return `${where}: "${name}" is in both "${earlier}" and "${article.term}". One word, one article.`
      seen.set(key, article.term)
    }
  }
  for (const article of articles) {
    for (const avoided of words(article.fields.Avoid)) {
      const owner = seen.get(avoided.toLowerCase())
      if (owner !== undefined) {
        return `${where}: "${article.term}" says to avoid "${avoided}", but "${owner}" uses that word. Keep one of them.`
      }
    }
  }

  return null
}

function words(list: string | undefined): string[] {
  return (list ?? '')
    .split(',')
    .map(word => word.trim())
    .filter(word => word !== '')
}
