import * as nodeFs from 'node:fs'
import path from 'node:path'

// Order o7e6d, S1 (Agent 3's re-review; Lead's F1 decision of 15 Nov): the staff fence, kept on disk so it outlives the agent (an Update, a crash).
// A run of a staff Assistant found unsafe (started without the staff policy, or with one this build does not know) is fenced by its session id AND
// that run's start time (its incarnation): it takes no input and no tool, whatever its floor entry says later (moved, deleted, bound to someone
// else). The record lives in <state>/staff/fenced.json, private, written atomically, and is read before the chat host's chats are taken over.
//
// Failure is never a silent reset:
//   - fenced.json missing: nothing was ever fenced here;
//   - fenced.json unreadable or not a fence record: 'bad'. It is left exactly where and as it is (never renamed, removed or rewritten by the app),
//     and every start reads it again and finds it bad again;
//   - fenced.poison present: a write of the record began and may not have landed (the marker is written FIRST, durably, and taken away only
//     after the record is in place): 'dirty';
//   - bad or dirty, the fence fails CLOSED (F1): every chat taken over without the staff policy is fenced, the owner's too, until it is stopped
//     and opened again (a new run is judged afresh). Only a person removes a bad file or a stale marker (an explicit, approved action);
//   - a fence that could not be written at all (not even the marker) holds in memory and is reported (staffPreflight) as not durable.
// An entry goes only on complete evidence from the chat host's own list of its chats (reconcile): that exact run is not there (it ended), or a
// newer run of that session is. Never because a floor changed, nor on an incomplete list, a lost link or a timeout.

export interface FenceEntry {
  sessionId: string
  /** The fenced run's start time, as its chat records it (ChatInfo.startedAt). */
  startedAt: string
  at: string
}

export type FenceState = 'ok' | 'bad' | 'dirty'

/** The file operations the store uses (node:fs; a test hands in failing ones). */
export interface FenceIo {
  readFileSync(file: string, enc: 'utf8'): string
  writeFileSync(file: string, data: string, opt: { mode: number; flush: boolean }): void
  renameSync(from: string, to: string): void
  rmSync(file: string, opt: { force: boolean }): void
  existsSync(file: string): boolean
  mkdirSync(dir: string, opt: { recursive: boolean }): unknown
}

export interface FenceStore {
  /** 'ok', or why it fails closed. */
  state(): FenceState
  /** True when the store can't be trusted to name every fenced run: fence every taken-over chat without the staff policy. */
  failClosed(): boolean
  /** Is this exact run fenced here? */
  has(sessionId: string, startedAt: string): boolean
  /** Fences this run, durably: the poison marker first, then the record, then the marker goes. A failure leaves it fenced in memory (and dirty). */
  add(sessionId: string, startedAt: string): void
  /**
   * The chat host's complete list of its chats now (session id → that run's start time, or null when its run could not be read): every entry whose
   * run is not on it, or whose session runs as another (newer) run, goes. Only from a list known complete; nothing else ever removes an entry.
   */
  reconcile(hostRuns: ReadonlyMap<string, string | null>): void
  /** What the preflight shows: the store's own problems (empty when it is sound). */
  problems(): string[]
  /** The entries held now (a test reads them). */
  entries(): FenceEntry[]
}

const FILE = 'fenced.json'
const POISON = 'fenced.poison'

function parse(text: string): FenceEntry[] | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || (raw as { version?: unknown }).version !== 1 || !Array.isArray((raw as { runs?: unknown }).runs)) return null
  const out: FenceEntry[] = []
  for (const r of (raw as { runs: unknown[] }).runs) {
    if (!r || typeof r !== 'object') return null
    const { sessionId, startedAt, at } = r as Record<string, unknown>
    if (typeof sessionId !== 'string' || !sessionId || typeof startedAt !== 'string' || !startedAt || typeof at !== 'string') return null
    out.push({ sessionId, startedAt, at })
  }
  return out
}

export function createFenceStore(dir: string, o: { io?: FenceIo; now?: () => Date; log?: { warn(m: string): void } } = {}): FenceStore {
  const io: FenceIo = o.io ?? nodeFs
  const now = o.now ?? (() => new Date())
  const file = path.join(dir, FILE)
  const poison = path.join(dir, POISON)
  let entries: FenceEntry[] = []
  let state: FenceState = 'ok'
  /** Fences held only in memory: not even the poison marker could be written. */
  let undurable = false

  // Read once, at the start, before any chat is taken over.
  if (io.existsSync(poison)) state = 'dirty'
  if (io.existsSync(file)) {
    let text: string | null = null
    try {
      text = io.readFileSync(file, 'utf8')
    } catch {
      text = null
    }
    const parsed = text === null ? null : parse(text)
    if (parsed === null) state = 'bad'
    else entries = parsed
  }
  if (state !== 'ok') o.log?.warn(`staff fence: ${state === 'bad' ? `${file} can't be read as a fence record` : `${poison} is there (a write may not have landed)`}; every chat taken over without the staff policy is fenced until a person clears it`)

  /** Written whole to a temporary file (flushed to the disk), then put in place by a rename: never half a file. */
  const atomic = (target: string, data: string) => {
    io.mkdirSync(dir, { recursive: true })
    const tmp = `${target}.${process.pid}.tmp`
    io.writeFileSync(tmp, data, { mode: 0o600, flush: true })
    io.renameSync(tmp, target)
  }
  const record = () => `${JSON.stringify({ version: 1, runs: entries }, null, 2)}\n`

  /**
   * The record, written in the poison-marker protocol: the marker first (durably), then the record, then the marker goes, only while the store is
   * sound. Once dirty (found so at the start, or a write failed here), the marker stays for good: a later good write can't prove nothing was lost,
   * so every later start fails closed too, until a person clears it. A bad record is never overwritten (it stays the evidence).
   */
  function persist(): boolean {
    if (state === 'bad') return false
    try {
      atomic(poison, `${JSON.stringify({ at: now().toISOString() })}\n`)
    } catch {
      undurable = true
      return false
    }
    try {
      atomic(file, record())
    } catch {
      // The marker stays: the next start finds it and fails closed.
      state = 'dirty'
      return false
    }
    if (state !== 'ok') return true
    try {
      io.rmSync(poison, { force: true })
    } catch {
      // Left behind: the next start fails closed (a stale marker is cleared only by a person).
      state = 'dirty'
    }
    return true
  }

  return {
    state: () => state,
    failClosed: () => state !== 'ok',
    has: (sessionId, startedAt) => entries.some(e => e.sessionId === sessionId && e.startedAt === startedAt),
    add(sessionId, startedAt) {
      if (entries.some(e => e.sessionId === sessionId && e.startedAt === startedAt)) return
      entries = [...entries, { sessionId, startedAt, at: now().toISOString() }]
      if (!persist()) o.log?.warn(`staff fence: chat ${sessionId.slice(0, 8)} is fenced, but the record could not be written (${state === 'bad' ? 'the record is bad' : undurable ? 'not even its marker' : 'the marker stays'})`)
    },
    reconcile(hostRuns) {
      const keep = entries.filter(e => {
        if (!hostRuns.has(e.sessionId)) return false
        const run = hostRuns.get(e.sessionId)
        return run === null || run === e.startedAt
      })
      if (keep.length === entries.length) return
      entries = keep
      persist()
    },
    problems() {
      const out: string[] = []
      if (state === 'bad') out.push('fence-store-bad')
      if (state === 'dirty') out.push('fence-store-dirty')
      if (undurable) out.push('fence-not-durable')
      return out
    },
    entries: () => entries.map(e => ({ ...e })),
  }
}
