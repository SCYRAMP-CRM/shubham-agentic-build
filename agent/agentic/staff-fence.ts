import * as nodeFs from 'node:fs'
import path from 'node:path'

// o25c1 C0: provenance, not the old broad S1 verdict, makes a runtime fence. Old fenced.json entries can name an ordinary/non-admin run or
// an F1/unknown-origin finding. They are UNCLASSIFIED evidence: keep the file byte-for-byte, show it at staff preflight, never infer 'staff'.
// New, typed evidence is additive, in provenance.json. It names an exact SID + run incarnation and survives rebind/delete. Neither an
// unreadable record nor an unfinished write freezes an unrelated chat. They hold STAFF ACTIVATION; known unsafe staff runs stay guarded.

export type FenceReason = 'staff' | 'unknown-policy'
export interface FenceEntry {
  sessionId: string
  /** ChatInfo.startedAt, not a mutable floor binding. */
  startedAt: string
  at: string
  /** Absent on every old generic record. Only independently observed provenance may supply a reason. */
  why?: FenceReason
}
export type FenceState = 'ok' | 'bad' | 'dirty'
export type FenceProblem = 'fence-store-bad' | 'fence-store-dirty' | 'fence-not-durable' | 'fence-unclassified'

export interface FenceIo {
  readFileSync(file: string, enc: 'utf8'): string
  writeFileSync(file: string, data: string, opt: { mode: number; flush: boolean }): void
  renameSync(from: string, to: string): void
  rmSync(file: string, opt: { force: boolean }): void
  existsSync(file: string): boolean
  mkdirSync(dir: string, opt: { recursive: boolean }): unknown
}

export interface FenceStore {
  state(): FenceState
  /** Store safety is an activation condition, NEVER a generic runtime-input/tools verdict. */
  activationBlocked(): boolean
  /** Evidence exists (including unclassified history); not permission to fence a runtime. */
  has(sessionId: string, startedAt: string): boolean
  /** Only typed evidence for this exact incarnation. Old generic rows never supply a reason. */
  reason(sessionId: string, startedAt: string): FenceReason | null
  /** Poison first, then typed evidence. A failed write retains the reason in memory; a later observation retries it. */
  add(sessionId: string, startedAt: string, why: FenceReason): void
  /** Only a COMPLETE authoritative host enumeration may retire an ended/replaced incarnation. Legacy bytes are retained as history. */
  reconcile(hostRuns: ReadonlyMap<string, string | null>): void
  problems(): FenceProblem[]
  entries(): FenceEntry[]
}

const LEGACY = 'fenced.json'
const LEGACY_POISON = 'fenced.poison'
const FILE = 'provenance.json'
const POISON = 'provenance.poison'

function parse(text: string, typed: boolean): FenceEntry[] | null {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return null }
  if (!raw || typeof raw !== 'object' || (raw as { version?: unknown }).version !== 1 || !Array.isArray((raw as { runs?: unknown }).runs)) return null
  const out: FenceEntry[] = []
  for (const r of (raw as { runs: unknown[] }).runs) {
    if (!r || typeof r !== 'object') return null
    const { sessionId, startedAt, at, why } = r as Record<string, unknown>
    if (typeof sessionId !== 'string' || !sessionId || typeof startedAt !== 'string' || !startedAt || typeof at !== 'string') return null
    if (typed && why !== 'staff' && why !== 'unknown-policy') return null
    // Even a reason-looking extra field on the OLD format is not trusted as provenance.
    out.push({ sessionId, startedAt, at, ...(typed ? { why: why as FenceReason } : {}) })
  }
  return out
}

export function createFenceStore(dir: string, o: { io?: FenceIo; now?: () => Date; log?: { warn(m: string): void } } = {}): FenceStore {
  const io: FenceIo = o.io ?? nodeFs
  const now = o.now ?? (() => new Date())
  const file = path.join(dir, FILE), poison = path.join(dir, POISON)
  let legacy: FenceEntry[] = [], typed: FenceEntry[] = []
  let bad = false, typedBad = false, dirty = false, typedDirty = false, undurable = false, pending = false

  // Both records are read BEFORE adoption. Do not move, delete, repair or reset bad evidence. New definite evidence can still be written
  // beside a bad legacy file; otherwise a rebinding would lose a KNOWN staff finding just because old history is corrupt.
  for (const name of [LEGACY_POISON, POISON]) {
    try {
      if (io.existsSync(path.join(dir, name))) { dirty = true; if (name === POISON) typedDirty = true }
    } catch { bad = true; if (name === POISON) typedBad = true }
  }
  for (const name of [LEGACY, FILE]) {
    try {
      if (!io.existsSync(path.join(dir, name))) continue
      const parsed = parse(io.readFileSync(path.join(dir, name), 'utf8'), name === FILE)
      if (parsed === null) { bad = true; if (name === FILE) typedBad = true }
      else if (name === FILE) typed = parsed
      else legacy = parsed
    } catch { bad = true; if (name === FILE) typedBad = true }
  }
  if (bad || dirty) o.log?.warn('staff provenance: unreadable evidence or an unfinished write holds staff activation; ordinary chats are not fenced by it')

  const atomic = (target: string, data: string) => {
    io.mkdirSync(dir, { recursive: true })
    const tmp = `${target}.${process.pid}.tmp`
    io.writeFileSync(tmp, data, { mode: 0o600, flush: true })
    io.renameSync(tmp, target)
  }
  function persist(): boolean {
    if (typedBad) { undurable = true; return false }
    try { atomic(poison, `${JSON.stringify({ at: now().toISOString() })}\n`) }
    catch { undurable = true; return false }
    try { atomic(file, `${JSON.stringify({ version: 1, runs: typed }, null, 2)}\n`) }
    catch { dirty = typedDirty = true; return false }
    pending = false
    // A marker found at boot or left by a failed write stays: a subsequent success cannot prove that nothing else was lost. Never touch the
    // legacy record/marker. Removing only our OWN successful marker does not certify or clear old evidence.
    if (!typedDirty) {
      try { io.rmSync(poison, { force: true }) } catch { dirty = typedDirty = true }
    }
    // A failed FIRST poison write remains an activation problem for this agent lifetime even if an explicit later observation persists it.
    return true
  }
  const entries = () => [...legacy, ...typed]
  const problems = (): FenceProblem[] => {
    const out: FenceProblem[] = []
    if (bad) out.push('fence-store-bad')
    if (dirty) out.push('fence-store-dirty')
    if (undurable) out.push('fence-not-durable')
    if (legacy.length) out.push('fence-unclassified')
    return out
  }

  return {
    state: () => bad ? 'bad' : dirty ? 'dirty' : 'ok',
    activationBlocked: () => problems().length !== 0,
    has: (sid, start) => entries().some(e => e.sessionId === sid && e.startedAt === start),
    reason: (sid, start) => typed.find(e => e.sessionId === sid && e.startedAt === start)?.why ?? null,
    add(sessionId, startedAt, why) {
      if (why !== 'staff' && why !== 'unknown-policy') throw new Error('A staff fence needs independently observed provenance')
      if (!typed.some(e => e.sessionId === sessionId && e.startedAt === startedAt)) {
        typed = [...typed, { sessionId, startedAt, at: now().toISOString(), why }]
        pending = true
      }
      if (pending && !persist()) o.log?.warn(`staff provenance: chat ${sessionId.slice(0, 8)} is guarded but its typed evidence is not durable; staff activation is held`)
    },
    reconcile(hostRuns) {
      const live = (e: FenceEntry) => hostRuns.has(e.sessionId) && (hostRuns.get(e.sessionId) === null || hostRuns.get(e.sessionId) === e.startedAt)
      // Suppress ended legacy findings in this view only. On the next boot the complete enumeration must prove it again; the original bytes
      // remain intact. A floor move/delete/rebind, disconnection or partial host list is never evidence that an incarnation ended.
      legacy = legacy.filter(live)
      const keep = typed.filter(live)
      if (keep.length !== typed.length) { typed = keep; pending = true }
      if (pending) persist()
    },
    problems,
    entries: () => entries().map(e => ({ ...e })),
  }
}
