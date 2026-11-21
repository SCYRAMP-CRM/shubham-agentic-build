import { createAuditFile } from './audit-file.ts'
import { STAFF_SEND_OUTCOMES, STAFF_SEND_REFUSALS, cleanSendName, type StaffSendOutcome, type StaffSendRefusal } from './staff-send.ts'

// WHAT A PERSON'S OWN ASSISTANT SENT, AND WHERE (Agent 3, 18 Nov 2026; F-297 stage A, Lead's approval of f297-design.md). staff-sends.jsonl beside the other audit files, one JSON line each, appended and never
// rewritten, owner-read only (GET /staff-sends: an OWNER row in POLICY and humanOnly). The same machinery as the floors' and the presence records (audit-file.ts).
//
// NEVER THE TEXT, NOT EVEN ITS LENGTH. The types below hold no string a caller can fill with words and no number at all: a person, two chats (a short id and the names of their agent and floor), a PC's name, a
// closed word and the minute. The receiving chat's own conversation holds what was typed; this says WHO sent to WHOM and whether it was allowed, so the owner can see it without reading anyone's words.
//
// WRITE-AHEAD, AND FAIL CLOSED. There is no tap on a staff send, so this record is the oversight: the ATTEMPT line is appended BEFORE anything is typed, and if it cannot be written (attempt() throws) the caller types
// nothing. What happened after is a second line (the OUTCOME), written by what occurred: a message the receiving PC took is `delivered`; one handed to another PC's link with no answer, `handed-over` (only that PC
// knows whether it arrived); a right taken away while the send waited, `revoked-mid-send`; a chat that stopped, `stopped`; the pool's refusal, `blocked`. A crash between the two lines leaves an attempt with no outcome, and
// that is shown as it is. The outcome and a refusal never stop anything: a line that cannot be written is kept in memory (50), said in the log, and told to the owner once in the heartbeat (as the presence record does).
//
// A REFUSAL is one line per person, reason and target chat per minute (a loop that is refused all day is one line a minute, not a flood).

/** What the owner is told the record does not cover, in every answer of GET /staff-sends (a constant: made from nothing that happened). */
export const STAFF_SEND_NOT_RECORDED: readonly string[] = [
  "Never the text of a message, and not its length: the receiving chat's own conversation holds what was typed.",
  "Only what a person's own Assistant sends. A send by the owner's Assistant, by a coding chat or through the send routes is not recorded here.",
  'A line is written BEFORE anything is typed (the attempt) and what happened after is a second line (the outcome); a crash between them leaves an attempt with no outcome, and that is shown as it is.',
  "A message handed to another PC's link is recorded as handed over: only that PC knows whether it arrived.",
  'A refusal is one line per person, reason and chat per minute.',
  'No retention: nothing is rotated or deleted, and this answer reads only the last 512 KB of the file, so older lines exist on disk and cannot be reached from here.',
  'It starts empty: nothing before it was built is in it.',
]

export interface SendPerson { id: string; name: string }
export interface SendChat { id: string; agent?: string; floor?: string }

export type StaffSendInput =
  | { kind: 'send-attempt'; person: SendPerson; from: SendChat; to: SendChat; pc: string }
  | { kind: 'send-outcome'; outcome: StaffSendOutcome; person: SendPerson; from: SendChat; to: SendChat; pc: string }
  | { kind: 'send-refused'; reason: StaffSendRefusal; person: SendPerson; from: SendChat; to?: SendChat }
/** `at` is the START OF THE MINUTE the thing happened in (never finer). */
export type StaffSendLine = StaffSendInput & { at: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHORT = /^[0-9a-f]{8}$/i

const minuteOf = (at: string): string => {
  const t = Date.parse(at)
  if (!Number.isFinite(t)) throw new Error('staff-sends: not a time')
  return new Date(Math.floor(t / 60_000) * 60_000).toISOString()
}
const member = <T extends string>(list: readonly T[], v: unknown, what: string): T => {
  const hit = list.find(x => x === v)
  if (hit === undefined) throw new Error(`staff-sends: not ${what}`)
  return hit
}
const personOf = (v: unknown): SendPerson => {
  const r = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>
  if (typeof r.id !== 'string' || !UUID.test(r.id)) throw new Error('staff-sends: not a person')
  return { id: r.id.toLowerCase(), name: cleanSendName(r.name) }
}
const chatOf = (v: unknown): SendChat => {
  const r = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>
  if (typeof r.id !== 'string' || !SHORT.test(r.id.slice(0, 8))) throw new Error('staff-sends: not a chat')
  const out: SendChat = { id: r.id.slice(0, 8).toLowerCase() }
  if (typeof r.agent === 'string' && r.agent) out.agent = cleanSendName(r.agent)
  if (typeof r.floor === 'string' && r.floor) out.floor = cleanSendName(r.floor)
  return out
}

/**
 * The line that is stored: ONLY the fields this record is defined to hold, every name cut and cleaned, no number, no text. A field the caller adds is not copied. A value outside a closed list, or an id that is not
 * one, throws (a bug, told loudly), never copied and never turned into a guess.
 */
export function staffSendOf(e: StaffSendInput, at: string): StaffSendLine {
  const minute = minuteOf(at)
  if (e.kind === 'send-attempt') return { at: minute, kind: 'send-attempt', person: personOf(e.person), from: chatOf(e.from), to: chatOf(e.to), pc: cleanSendName(e.pc) }
  if (e.kind === 'send-outcome') return { at: minute, kind: 'send-outcome', outcome: member(STAFF_SEND_OUTCOMES, e.outcome, 'an outcome'), person: personOf(e.person), from: chatOf(e.from), to: chatOf(e.to), pc: cleanSendName(e.pc) }
  if (e.kind === 'send-refused') return { at: minute, kind: 'send-refused', reason: member(STAFF_SEND_REFUSALS, e.reason, 'a reason'), person: personOf(e.person), from: chatOf(e.from), ...(e.to ? { to: chatOf(e.to) } : {}) }
  throw new Error('staff-sends: not a kind of send')
}

/** One line in words, from the owner's point of view (it says what OCCURRED, and what is not known). */
export function describeStaffSend(e: StaffSendLine | StaffSendInput): string {
  const who = `${e.person.name}'s Assistant`
  const chat = (c: SendChat) => (c.agent ? `${c.agent}${c.floor ? ` on ${c.floor}` : ''} (chat ${c.id.slice(0, 8)})` : `chat ${c.id.slice(0, 8)}`)
  if (e.kind === 'send-attempt') return `${who} was about to send a message to ${chat(e.to)} on ${e.pc || 'a PC'}`
  if (e.kind === 'send-outcome') {
    const how: Record<StaffSendOutcome, string> = {
      delivered: 'the chat took it',
      'handed-over': "it was handed to that PC's link and whether it arrived is not known here",
      'revoked-mid-send': "the person's right to send there was taken away while it waited, so it was not typed",
      stopped: 'the chat stopped before it was typed',
      blocked: 'the chat refused it (a question on its screen, or unsent words in its box)',
    }
    return `${who} sent a message to ${chat(e.to)}: ${how[e.outcome]}`
  }
  return `${who} was refused (${e.reason})${e.to ? ` when it tried to send to ${chat(e.to)}` : ''}`
}

export interface StaffSendRecord {
  /** The write-ahead line. THROWS when it cannot be written: the caller types nothing. */
  attempt(e: Extract<StaffSendInput, { kind: 'send-attempt' }>): void
  /** What happened after the attempt. Never throws. */
  outcome(e: Extract<StaffSendInput, { kind: 'send-outcome' }>): void
  /** A refused send: one line per person, reason and chat per minute. Never throws. */
  refused(e: Extract<StaffSendInput, { kind: 'send-refused' }>): void
  /** Newest first. */
  list(limit?: number): StaffSendLine[]
  /** Lines (outcomes and refusals) that could not be written since this run started, newest first (50). */
  unrecorded(): StaffSendLine[]
  /** The lost lines not told yet; each is returned once (the heartbeat). */
  news(): StaffSendLine[]
}

export function createStaffSendRecord(o: { file: string; now?: () => Date; error?: (message: string) => void }): StaffSendRecord {
  const real = o.now ?? (() => new Date())
  // ONE reading of the clock per call (the presence record's R8b): the "already told this minute" check and the stored `at` must agree on the minute.
  let tick: Date | null = null
  const now = () => tick ?? real()
  const file = createAuditFile<StaffSendInput, StaffSendLine>(o.file, staffSendOf, now)
  const seen = new Map<string, number>()
  const failed: StaffSendLine[] = []
  let failedCount = 0
  let told = 0
  const isNew = (key: string): boolean => {
    const minute = Math.floor(now().getTime() / 60_000)
    if (seen.get(key) === minute) return false
    seen.set(key, minute)
    if (seen.size > 1024) for (const [k, m] of seen) if (m < minute - 1) seen.delete(k)
    return true
  }
  /** Writes a line that must never stop anything: a failure is kept, said and told once. */
  function keep(e: StaffSendInput) {
    try {
      file.add(e)
    } catch (err) {
      let kept: StaffSendLine
      try {
        kept = staffSendOf(e, now().toISOString())
      } catch {
        o.error?.(`staff sends: a line could not be built (${err instanceof Error ? err.message : String(err)})`)
        return
      }
      failed.unshift(kept)
      failed.splice(50)
      failedCount++
      o.error?.(`staff sends: a line could not be recorded (${err instanceof Error ? err.message : String(err)}): ${describeStaffSend(kept)}`)
    }
  }
  return {
    attempt(e) {
      tick = real()
      try {
        file.add(e)
      } finally {
        tick = null
      }
    },
    outcome(e) {
      tick = real()
      try {
        keep(e)
      } finally {
        tick = null
      }
    },
    refused(e) {
      tick = real()
      try {
        if (isNew(`${String(e.person?.id)}|${e.reason}|${String(e.to?.id)}`)) keep(e)
      } catch (err) {
        o.error?.(`staff sends: a refusal could not be noted (${err instanceof Error ? err.message : String(err)})`)
      } finally {
        tick = null
      }
    },
    list: limit => file.list(limit),
    unrecorded: () => [...failed],
    news() {
      const fresh = failed.slice(0, Math.min(failedCount - told, failed.length))
      told = failedCount
      return fresh
    },
  }
}
