import type { IncomingMessage, ServerResponse } from 'node:http'
import { apiError } from '../api.ts'
import { authError, type Caller } from '../auth/types.ts'

// F-221 (order oeb56, "Quick should answer right after I finish"): live talk's turn records in the hub's log. The page (src/talk/session.ts)
// keeps, for each turn of his it asked, how long each step took after his last word: the end-of-turn tone, his words sent to Whisper, back,
// the ask sent to Quick, Quick's first words, their first sound; the early guess, an ack, a cut-in, where talk ran, Whisper's own time. It
// sends each finished record to POST /agent-api/agentic/talk/stage, and this writes ONE line of it:
//   talk turn: end→audio=2310ms (tone=560 stt=300 text=1650 ask=1700 delta=3100 audio=3300) guess=used device=pc ack=no cut-in=no whisper=1310ms
// so "it answered slowly" can be told from the log: which step took the time. Numbers and fixed words only: a record that carries anything
// else (a text, an unknown field, a step that is not a whole number of ms) is refused whole, so his words can never reach the log. Small
// (1 KB), at most STAGE_PER_MINUTE a minute, and his page's only (the owner's, never a chat's key), as every /talk route is.
// oeb56 review: a step out of range no longer loses the turn's line (the page ignores a refusal): a negative one (the page's clock stalled
// between two of its steps) is logged as not known, '-', and one over STAGE_MAX_MS (a direct order answered after more than 10 minutes) as
// '>600000'; the turn's other steps are logged as they are.

/** The body's size at most: a record is about 200 bytes. */
export const STAGE_MAX_BYTES = 1024
/** Records taken a minute at most (a turn of his takes seconds; this is many sessions' worth): more are refused (429), not logged. */
export const STAGE_PER_MINUTE = 30
/** A step's time logged as its number at most (10 minutes); a longer one is logged as over it (stageLine). */
export const STAGE_MAX_MS = 600_000

const STEPS = ['tone', 'stt', 'text', 'ask', 'delta', 'audio'] as const
type Step = (typeof STEPS)[number]

/** A turn record as the page sends it (src/talk/session.ts StageRecord): ms after his last word, null when the step did not happen. */
export type StageRecord = Record<Step, number | null> & {
  guess: 'used' | 'wasted' | 'off'
  ack: boolean
  cutIn: boolean
  device: 'pc' | 'phone'
  whisper: number | null
}

const KEYS = new Set<string>([...STEPS, 'guess', 'ack', 'cutIn', 'device', 'whisper'])
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * A step's time: null, or a whole number of ms; undefined (the record is refused) for anything else. oeb56 review: a negative one is null,
 * not known (the page's clock stalled); one over STAGE_MAX_MS is kept, and its line says it is over it.
 */
function ms(v: unknown): number | null | undefined {
  if (v === null) return null
  if (typeof v !== 'number' || !Number.isInteger(v)) return undefined
  return v < 0 ? null : v
}

/** The record, checked whole (strict: every field there, of its kind, nothing else); or why it is refused. */
export function parseStage(raw: unknown): { ok: true; record: StageRecord } | { ok: false; why: string } {
  if (!isObject(raw)) return { ok: false, why: 'Send the turn record as a JSON object.' }
  for (const k of Object.keys(raw)) if (!KEYS.has(k)) return { ok: false, why: 'The turn record has a field it should not have.' }
  const steps = {} as Record<Step, number | null>
  for (const k of STEPS) {
    const v = ms(raw[k])
    if (v === undefined) return { ok: false, why: `${k} is not a time in ms.` }
    steps[k] = v
  }
  const whisper = raw.whisper === undefined ? null : ms(raw.whisper)
  if (whisper === undefined) return { ok: false, why: 'whisper is not a time in ms.' }
  const { guess, ack, cutIn, device } = raw
  if (guess !== 'used' && guess !== 'wasted' && guess !== 'off') return { ok: false, why: 'guess is used, wasted or off.' }
  if (typeof ack !== 'boolean' || typeof cutIn !== 'boolean') return { ok: false, why: 'ack and cutIn are true or false.' }
  if (device !== 'pc' && device !== 'phone') return { ok: false, why: 'device is pc or phone.' }
  return { ok: true, record: { ...steps, guess, ack, cutIn, device, whisper } }
}

/** The record's one log line (numbers and fixed words only). A step over STAGE_MAX_MS is logged as over it ('>600000'), never its number. */
export function stageLine(r: StageRecord): string {
  const n = (v: number | null) => (v === null ? '-' : v > STAGE_MAX_MS ? `>${STAGE_MAX_MS}` : String(v))
  const yn = (b: boolean) => (b ? 'yes' : 'no')
  const end = r.audio === null ? 'none' : `${n(r.audio)}ms`
  return `talk turn: end→audio=${end} (${STEPS.map(k => `${k}=${n(r[k])}`).join(' ')}) guess=${r.guess} device=${r.device} ack=${yn(r.ack)} cut-in=${yn(r.cutIn)} whisper=${r.whisper === null ? '-' : `${n(r.whisper)}ms`}`
}

export interface TalkStageDeps {
  now(): number
  /** The caller is the owner of the app (or the open app): live talk's routes are his page's. */
  isOwner(c: Caller): boolean
  /** Notes a refused caller, as the other owner routes do. */
  deny?(c: Caller, route: string): void
  log?: { info(m: string): void }
}

/** Reads the body, at most `limit` bytes (413 past it). */
async function readBody(req: IncomingMessage, limit: number): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > limit) throw apiError(413, 'A turn record is small.')
    chunks.push(c as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** POST /talk/stage: the raw route (the API has checked the app's token and the Origin, and passes the caller). */
export function createTalkStage(d: TalkStageDeps) {
  let taken: number[] = []
  return async (req: IncomingMessage, res: ServerResponse, caller: Caller): Promise<void> => {
    const route = 'POST /agent-api/agentic/talk/stage'
    if (req.method !== 'POST') throw apiError(405, 'POST the turn record')
    // His page's only: a chat's key, or the fast Assistant's (both come as x-sad-chat-key), is refused before anything is read.
    if (req.headers['x-sad-chat-key'] !== undefined) throw authError(403, 'Only his own page may do this; not a chat tool.', 'not-yours')
    if (!d.isOwner(caller)) {
      d.deny?.(caller, route)
      throw authError(403, 'This is for the owner of this app.', 'admin-only')
    }
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) throw apiError(415, 'Send the turn record as application/json')
    const text = await readBody(req, STAGE_MAX_BYTES)
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      throw apiError(400, 'The body is not valid JSON')
    }
    const p = parseStage(raw)
    if (!p.ok) throw apiError(400, p.why)
    const now = d.now()
    taken = taken.filter(t => now - t < 60_000)
    if (taken.length >= STAGE_PER_MINUTE) throw apiError(429, 'Too many turn records in a minute; this one was not logged.')
    taken.push(now)
    d.log?.info(stageLine(p.record))
    if (res.headersSent || res.destroyed) return
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end('{"ok":true}')
  }
}
