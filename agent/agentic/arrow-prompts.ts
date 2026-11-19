import { readFileSync } from 'node:fs'
import { apiError } from '../api.ts'
import { writeAtomic } from '../config.ts'

// Order o5d4e: "Buttons for arrow-select prompts". On by default (his words: "give ability to select on phone"); switched off, claude's unnumbered
// selects are read as before, with no menu and no buttons ("answer it in the chat itself"): the old way, kept (his rule). One file on this PC
// (arrow-prompts.json: {"on": false}); a missing file is the default (on), an unreadable one is the SAFE state (off) and says so until he
// chooses again, as the other settings do: a setting that cannot be read never makes the app press more than it did.

export interface ArrowPrompts {
  /** Whether unnumbered selects get buttons now. */
  on(): boolean
  /** The file exists but could not be read: off until he chooses. */
  unreadable(): boolean
  set(on: unknown): void
}

export function createArrowPrompts(file: string): ArrowPrompts {
  let on = true
  let bad = false
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw) && typeof (raw as { on?: unknown }).on === 'boolean') on = (raw as { on: boolean }).on
    else {
      on = false
      bad = true
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      on = false
      bad = true
    }
  }
  return {
    on: () => on,
    unreadable: () => bad,
    set(v) {
      if (typeof v !== 'boolean') throw apiError(400, 'Expected {on: true | false}')
      writeAtomic(file, `${JSON.stringify({ on: v })}\n`)
      on = v
      bad = false
    },
  }
}
