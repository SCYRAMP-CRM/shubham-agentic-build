import { readFileSync } from 'node:fs'
import { writeAtomic } from './config.ts'
import type { Logger } from './log.ts'

// Shubham's order ob12b (22 Nov 2026): "the Build page open to everyone with an Update button". Two small facts must outlive the app, which Update restarts: the first owner's SWITCH ("people may press Update",
// default ON: he asked) and the time of the last accepted press by a person (the 30-minute cooldown is meaningless if the restart it limits forgets it). They live in one tiny file, update-people.json, in the agent folder,
// beside auth.json. Read FRESH every time (it is a few bytes, and two readers never disagree); written atomically. A missing file is the default (ON, no press yet); a file that cannot be read or is not this shape is
// OFF (fail closed: nobody but the first owner updates until he flips the switch, which writes a clean file).

export interface UpdatePolicyState {
  /** Whether people other than the first owner may press Update. */
  peopleMayUpdate: boolean
  /** When a person's press was last accepted (ms since 1970), or null. */
  lastPersonPressAt: number | null
  /** The file was there and could not be trusted: the switch reads OFF. */
  odd: boolean
}

export interface UpdatePolicyStore {
  read(): UpdatePolicyState
  /** The first owner's switch. Writes a clean file (an odd one is replaced; the last press is kept when it can be read). */
  setPeopleMayUpdate(on: boolean): void
  /** A person's press was accepted at `at`: the cooldown starts. */
  stampPress(at: number): void
}

const DEFAULT: UpdatePolicyState = { peopleMayUpdate: true, lastPersonPressAt: null, odd: false }

export function createUpdatePolicy(file: string, log?: Logger): UpdatePolicyStore {
  let said = ''
  const odd = (why: string): UpdatePolicyState => {
    if (why !== said) {
      said = why
      log?.warn(`update-people.json: ${why}; people may not press Update until the first owner switches it again`)
    }
    return { peopleMayUpdate: false, lastPersonPressAt: null, odd: true }
  }

  function read(): UpdatePolicyState {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT }
      return odd(`it could not be read (${(e as NodeJS.ErrnoException).code ?? 'error'})`)
    }
    let raw: unknown
    try {
      raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
    } catch {
      return odd('it is not valid JSON')
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return odd('it is not an object')
    const r = raw as Record<string, unknown>
    if (r.version !== 1 || typeof r.peopleMayUpdate !== 'boolean') return odd('it is not { version: 1, peopleMayUpdate: true|false, ... }')
    let last: number | null = null
    if (r.lastPersonPressAt !== null && r.lastPersonPressAt !== undefined) {
      const t = typeof r.lastPersonPressAt === 'string' ? Date.parse(r.lastPersonPressAt) : Number.NaN
      if (!Number.isFinite(t)) return odd('its last press is not a time')
      last = t
    }
    said = ''
    return { peopleMayUpdate: r.peopleMayUpdate, lastPersonPressAt: last, odd: false }
  }

  const write = (s: { peopleMayUpdate: boolean; lastPersonPressAt: number | null }) =>
    writeAtomic(file, `${JSON.stringify({ version: 1, peopleMayUpdate: s.peopleMayUpdate, lastPersonPressAt: s.lastPersonPressAt === null ? null : new Date(s.lastPersonPressAt).toISOString() }, null, 2)}\n`)

  return {
    read,
    setPeopleMayUpdate(on) {
      const now = read()
      write({ peopleMayUpdate: on, lastPersonPressAt: now.odd ? null : now.lastPersonPressAt })
    },
    stampPress(at) {
      const now = read()
      write({ peopleMayUpdate: now.odd ? false : now.peopleMayUpdate, lastPersonPressAt: at })
    },
  }
}
