// A stock client can submit directly to the app server as soon as replacement
// history is installed. Its prompt hook and the MCP process share this receipt.
import { Database } from 'bun:sqlite'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { isSaved, WAKE } from '../../core/src'
import { shiftContext } from './protocol'

export type Handover = { root: string; dir: string; offset: number | null; phase: 'prepared' | 'ready' | 'offered' | 'delivered' }

export function withSessionDb<T>(file: string, run: (db: Database) => T): T {
  const db = new Database(`${file}.sqlite`)
  try {
    db.exec('PRAGMA busy_timeout = 10000')
    return run(db)
  } finally {
    db.close()
  }
}

export function readHandover(db: Database, root: string): Handover | null {
  if (!db.query("SELECT 1 FROM sqlite_master WHERE name = 'handover'").get()) return null
  const row = db.query<Handover, [string]>('SELECT * FROM handover WHERE root = ?').get(root)
  return row && isSaved(row.dir) ? row : null
}

export function prepareHandover(file: string, root: string, dir: string, offset?: number) {
  withSessionDb(file, db => {
    db.exec('CREATE TABLE IF NOT EXISTS handover (root TEXT PRIMARY KEY, dir TEXT NOT NULL, offset INTEGER, phase TEXT NOT NULL)')
    db.query("INSERT OR REPLACE INTO handover VALUES (?, ?, ?, 'prepared')").run(root, dir, offset ?? null)
  })
}

export function readyHandover(db: Database, row: Pick<Handover, 'root' | 'dir'>) {
  db.query("UPDATE handover SET phase = 'ready' WHERE root = ? AND dir = ? AND phase = 'prepared'").run(row.root, row.dir)
}

export const wakeInput = (dir: string) => shiftContext(`${WAKE}\n${dir}`)

// A client may restart after replacing history but before the MCP process
// records success. A resume alone does not prove that replacement happened.
export async function replacedSince(path: string, offset: number) {
  const stream = createReadStream(path, { start: offset, encoding: 'utf8' })
  try {
    for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
      if (!line.includes('"compacted"')) continue
      try {
        if (JSON.parse(line).type === 'compacted') return true
      } catch {
        // The checkpoint can fall between writes to the rollout.
      }
    }
    return false
  } catch {
    return false
  } finally {
    stream.destroy()
  }
}
