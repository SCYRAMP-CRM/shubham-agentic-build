import { appendFileSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { writeAtomic } from '../config.ts'

// Settings › Access and the owners file share ONE audit file, access-log.jsonl in the auth folder, one JSON object per line, never rewritten except
// when it outgrows its size (the old part is kept beside it as access-log.old.jsonl). This is the one place that appends to it.

export const ACCESS_LOG_MAX_BYTES = 4 * 1024 * 1024

/**
 * One line into access-log.jsonl. A log grown past its size starts again beside the old one. A failure to write is said to `warn` and never thrown:
 * the change the line records already stands.
 */
export function appendAccessLog(dir: string, entry: unknown, warn?: (message: string) => void): void {
  const logFile = path.join(dir, 'access-log.jsonl')
  try {
    mkdirSync(dir, { recursive: true })
    try {
      if (statSync(logFile).size > ACCESS_LOG_MAX_BYTES) {
        writeAtomic(path.join(dir, 'access-log.old.jsonl'), readFileSync(logFile, 'utf8'))
        writeAtomic(logFile, '')
      }
    } catch {
      // No log yet.
    }
    appendFileSync(logFile, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
  } catch (e) {
    warn?.(`the access change could not be logged: ${e instanceof Error ? e.message : String(e)}`)
  }
}
