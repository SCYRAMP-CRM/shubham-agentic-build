import { appendFileSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { writeAtomic } from './config.ts'

// Shubham's order ob12b, Agent 14's B-1 (22 Nov 2026): a person's REFUSED Update presses are kept in their own small file, build-update-refusals.jsonl in the agent folder, and not in access-log.jsonl, which also holds the Access
// history and the owners file's changes and rotates at 4 MB (so a loop of refused presses could push the owner's real history out of it). Two bounds: the file is size-capped (past REFUSALS_MAX_BYTES it moves to
// build-update-refusals.old.jsonl and starts again: never more than about twice the cap on disk), and ONE line is kept per person per reason per REFUSAL_WINDOW_MS (a loop of the same refused press is one line, not thousands).

export const REFUSALS_FILE = 'build-update-refusals.jsonl'
export const REFUSALS_MAX_BYTES = 256 * 1024
export const REFUSAL_WINDOW_MS = 10 * 60_000
/** The remembered (person, reason) pairs are bounded too: past this many the memory starts again (a flood of different ids costs at most one line each, in a file that is capped). */
const REMEMBERED_MAX = 500

export interface RefusalNote {
  by: { id: string; name: string }
  update: { from: string | null; to: string | null; outcome: 'refused'; why: string }
}

export interface RefusalAudit {
  /** One line, unless this person was already refused for this reason within the last 10 minutes. Never throws: a refusal's line is a courtesy; the refusal stands. */
  note(entry: RefusalNote): void
}

export function createRefusalAudit(o: { dir: string; now: () => number; warn?: (message: string) => void }): RefusalAudit {
  const file = path.join(o.dir, REFUSALS_FILE)
  const lastNoted = new Map<string, number>()
  return {
    note(entry) {
      const at = o.now()
      const key = `${entry.by.id}\n${entry.update.why}`
      const before = lastNoted.get(key)
      if (before !== undefined && before <= at && at - before < REFUSAL_WINDOW_MS) return
      if (lastNoted.size >= REMEMBERED_MAX) lastNoted.clear()
      lastNoted.set(key, at)
      try {
        mkdirSync(o.dir, { recursive: true })
        try {
          if (statSync(file).size > REFUSALS_MAX_BYTES) {
            writeAtomic(path.join(o.dir, 'build-update-refusals.old.jsonl'), readFileSync(file, 'utf8'))
            writeAtomic(file, '')
          }
        } catch {
          // No file yet.
        }
        appendFileSync(file, `${JSON.stringify({ at: new Date(at).toISOString(), by: { id: entry.by.id, name: entry.by.name }, update: entry.update })}\n`, { mode: 0o600 })
      } catch (e) {
        o.warn?.(`a refused Update press could not be noted: ${e instanceof Error ? e.message : String(e)}`)
      }
    },
  }
}
