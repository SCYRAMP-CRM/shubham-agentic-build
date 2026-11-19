import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readSync, statSync } from 'node:fs'
import path from 'node:path'

// The one place an append-only audit file is written and read (Agent 3, 18 Nov 2026): floor-events.ts and chat-presence.ts both use it, so a torn row, a tail
// read and a file that cannot be written behave the same in both. It was written for floor-events.ts first (the shape and care of the approvals log, approvals.ts)
// and moved here, unchanged, when a second record needed the same thing: a consolidation, not a second copy.
//
// One JSON line per row, appended and never rewritten; a read looks at the end of the file, newest first. `build` is the ALLOWLIST of the record that uses it: it
// is given what a caller passed and returns only the row that record is defined to hold, so a caller can never put anything else into the file.

/** How much of the end of the file a read looks at. */
const TAIL = 512 * 1024

export interface AuditFile<In, Row> {
  /** Throws when the file cannot be written: the caller decides how loud that is (a record is written AFTER the thing it records, and never undoes it). */
  add(e: In): Row
  /** Newest first. */
  list(limit?: number): Row[]
}

export function createAuditFile<In, Row>(file: string, build: (e: In, at: string) => Row, now = () => new Date()): AuditFile<In, Row> {
  mkdirSync(path.dirname(file), { recursive: true })
  /** A write cut short (a crash, a full disk) leaves a partial line with no newline: the next line must not be glued onto it, or one torn row costs two. */
  function endsMidLine(): boolean {
    try {
      const size = statSync(file).size
      if (size === 0) return false
      const fd = openSync(file, 'r')
      try {
        const last = Buffer.alloc(1)
        readSync(fd, last, 0, 1, size - 1)
        return last[0] !== 0x0a
      } finally {
        closeSync(fd)
      }
    } catch {
      return false
    }
  }
  return {
    add(e) {
      const entry = build(e, now().toISOString())
      appendFileSync(file, `${endsMidLine() ? '\n' : ''}${JSON.stringify(entry)}\n`, { mode: 0o600 })
      return entry
    },
    list(limit = 100) {
      if (!existsSync(file)) return []
      const size = statSync(file).size
      const from = Math.max(0, size - TAIL)
      const buf = Buffer.alloc(size - from)
      const fd = openSync(file, 'r')
      try {
        readSync(fd, buf, 0, buf.length, from)
      } finally {
        closeSync(fd)
      }
      const rows = buf.toString('utf8').split('\n')
      // A read that starts in the middle of a row drops that row.
      if (from > 0) rows.shift()
      const out: Row[] = []
      for (let i = rows.length - 1; i >= 0 && out.length < limit; i--) {
        if (!rows[i]) continue
        try {
          out.push(JSON.parse(rows[i]) as Row)
        } catch {
          // A torn row.
        }
      }
      return out
    },
  }
}
