import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { SBSKRRT_ID } from '../../shared/auth.ts'
import type { Logger } from '../log.ts'
import { appendAccessLog } from './access-log.ts'

// A SECOND OWNER of the app (Shubham's order o4e4e, 21 Nov 2026). "The owner" in this code is the admins list in auth.json, which the hub loads at start and
// writes back from memory, so a hand edit of it while the hub runs is lost. This file is the other way in: `owners.json`, beside auth.json,
//
//   { "version": 1, "also": [ { "id": "<CRM user id>", "name": "...", "by": "...", "at": "..." } ] }
//
// which the hub only READS. Nothing in this program writes it, no route edits it, and no page can: whoever may edit files on the Server edits it (the same hand
// that edits auth.json). It adds people to the owners; it never removes one (the owner by id, SBSKRRT_ID, stays whatever it holds). Publish and the phone's
// pairing are not decided here: they stay Shubham's by his id (auth/index.ts canPublish, publish-policy.ts, pc-build.ts, agentic/phone.ts).
//
// FAIL CLOSED: a file that is missing, unreadable, too big, not valid JSON, not this shape, or longer than OWNERS_MAX entries gives no extra owner at all; an entry
// without a plain text id is left out; nothing here throws. The file is read when the hub starts and again when its size or modified time has changed, looked at
// no more often than every OWNERS_RECHECK_MS, so deleting it or removing a line takes effect within seconds with no restart. Every change of who is an owner
// is one line in access-log.jsonl (who: "owners.json", who was added, who was removed) and one line in the hub's own log; a start with owners listed is one such line too.

export const OWNERS_MAX = 5
export const OWNERS_MAX_BYTES = 8 * 1024
export const OWNERS_RECHECK_MS = 5000
export const OWNERS_LOG_BY = 'owners.json'

export interface AlsoOwner {
  /** The CRM user id, lowercase. */
  id: string
  /** The name written in the file (for the log lines; it decides nothing). */
  name: string
}

export interface OwnersChange {
  added: AlsoOwner[]
  removed: AlsoOwner[]
}

export interface OwnersOptions {
  /** owners.json. */
  file: string
  /** The folder of access-log.jsonl (the auth folder). */
  logDir: string
  now?: () => number
  log?: Logger
  /** Called after the list has changed (not at start), when it already stands: the sessions of someone just removed are ended by it. */
  onChange?: (change: OwnersChange) => void
}

export interface Owners {
  /** Whether this CRM user id is an extra owner now (the file looked at again when its time has come). */
  has(id: string): boolean
  /** The extra owners now, in the file's order. */
  list(): readonly AlsoOwner[]
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const ID = /^[^\s]{1,64}$/

/** A name goes into log lines only: cut at 120, and no line end or other control character can ride in it. */
const plain = (s: string): string => [...s.slice(0, 120)].map(c => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? ' ' : c)).join('')

/** The extra owners a file's text holds: an empty list for anything wrong with it (never thrown). `why` says what was wrong, for the log. */
export function parseOwners(text: string): { owners: AlsoOwner[]; why: string | null } {
  let raw: unknown
  try {
    // Windows PowerShell 5.1 (> , Out-File, Set-Content -Encoding utf8) writes a byte-order mark, which JSON.parse refuses: it is not part of the text.
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch {
    return { owners: [], why: 'it is not valid JSON' }
  }
  if (!isObject(raw) || raw.version !== 1 || !Array.isArray(raw.also)) return { owners: [], why: 'it is not { version: 1, also: [ ... ] }' }
  if (raw.also.length > OWNERS_MAX) return { owners: [], why: `it lists more than ${OWNERS_MAX} owners` }
  const owners: AlsoOwner[] = []
  for (const e of raw.also) {
    if (!isObject(e) || typeof e.id !== 'string') continue
    const id = e.id.trim().toLowerCase()
    // The owner by id is an owner already; he is not "added" by a file, and a file never takes him off.
    if (!ID.test(id) || id === SBSKRRT_ID || owners.some(x => x.id === id)) continue
    owners.push({ id, name: typeof e.name === 'string' ? plain(e.name) : '' })
  }
  return { owners, why: null }
}

export function createOwners(o: OwnersOptions): Owners {
  const now = o.now ?? Date.now
  let owners: AlsoOwner[] = []
  /** What the file looked like at the last read (size and modified time), so it is read again only when that changes. */
  let seen: string | null = null
  let checkedAt = Number.NEGATIVE_INFINITY
  let lastWhy: string | null = null
  let started = false

  const said = (why: string) => {
    if (why === lastWhy) return
    lastWhy = why
    o.log?.warn(`owners.json: no extra owners, ${why}`)
  }

  /** What the file holds now, or null when it could not be read this time (the old answer stays until the next look). */
  function read(): AlsoOwner[] | null {
    let st
    try {
      st = statSync(o.file)
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      seen = `absent:${code ?? ''}`
      if (code !== 'ENOENT') said(`it could not be looked at (${code ?? 'error'})`)
      return []
    }
    const sig = `${st.size}:${st.mtimeMs}`
    if (sig === seen) return null
    if (!st.isFile()) {
      seen = sig
      said('it is not a file')
      return []
    }
    if (st.size > OWNERS_MAX_BYTES) {
      seen = sig
      said(`it is bigger than ${OWNERS_MAX_BYTES} bytes`)
      return []
    }
    let text: string
    try {
      text = readFileSync(o.file, 'utf8')
    } catch (e) {
      // Not recorded as seen: it is tried again at the next look.
      said(`it could not be read (${(e as NodeJS.ErrnoException).code ?? 'error'})`)
      return []
    }
    seen = sig
    if (text.length > OWNERS_MAX_BYTES) {
      said(`it is bigger than ${OWNERS_MAX_BYTES} characters`)
      return []
    }
    const parsed = parseOwners(text)
    if (parsed.why) said(parsed.why)
    else lastWhy = null
    return parsed.owners
  }

  function refresh() {
    const t = now()
    // A clock set BACK (t before the last look) makes the gap negative, which is below 5 s: the look is due now, or a removed owner would stay one until the clock caught up.
    if (started && t >= checkedAt && t - checkedAt < OWNERS_RECHECK_MS) return
    checkedAt = t
    const next = read()
    if (next === null) return
    const first = !started
    started = true
    const before = new Set(owners.map(x => x.id))
    const after = new Set(next.map(x => x.id))
    const added = next.filter(x => !before.has(x.id))
    const removed = owners.filter(x => !after.has(x.id))
    owners = next
    const who = (list: AlsoOwner[]) => list.map(x => `${x.name || 'unnamed'} (${x.id.slice(0, 8)})`).join(', ')
    // The hub's own log says once, at start, who the extra owners are (or that there are none).
    if (first) o.log?.info(next.length ? `owners.json: ${next.length} extra owner${next.length === 1 ? '' : 's'}: ${who(next)}` : 'owners.json: no extra owners')
    if (!added.length && !removed.length) return
    if (!first) o.log?.warn(`owners.json changed: ${[added.length ? `added ${who(added)}` : '', removed.length ? `removed ${who(removed)}` : ''].filter(Boolean).join('; ')}`)
    appendAccessLog(o.logDir, { at: new Date(t).toISOString(), by: { id: OWNERS_LOG_BY, name: OWNERS_LOG_BY }, owners: { ...(first ? { start: true } : {}), added, removed } }, m => o.log?.warn(m))
    if (!first) {
      try {
        o.onChange?.({ added, removed })
      } catch (e) {
        o.log?.warn(`owners.json: a listener failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  refresh()
  return {
    has(id) {
      refresh()
      return owners.some(x => x.id === id)
    },
    list() {
      refresh()
      return owners.map(x => ({ ...x }))
    },
  }
}

/** The path of owners.json beside an auth file (main.ts hands none: it is always here). */
export const ownersFileBeside = (authFile: string) => path.join(path.dirname(authFile), 'owners.json')
