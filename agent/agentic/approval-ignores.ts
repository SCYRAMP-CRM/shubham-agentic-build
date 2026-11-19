// F-294 (his order o8c55, "and give button ignroe pleae"): the prompts a person has hidden from their OWN cards. Nothing here answers, types or sends anything: a record only says
// "this person does not want to see this card". Kept by the app, not by a browser, so the phone and the PC agree (every page of one person asks the same Server).
//
// A record is tied to ONE prompt: the id an answer already checks (the id GET /approvals lists), in ONE chat, for ONE person. The same still-open prompt stays hidden; any other
// prompt of that chat has another id, so it is a new card. When the chat is no longer at a question (answered, ended, gone) its records go (sweep): the same words asked again
// later are then a new question, never a hidden one.
//
// In memory only, on purpose. A prompt's id is made with this run's epoch (index.ts promptOfChat), so after the app restarts no saved id could ever match again: a file would
// keep records that can never hide anything. What lasts is the approvals log's record of who ignored what and when (approvals.jsonl, kinds ignore and restore).

/**
 * The fixed sentences the approvals log carries for an ignore and for a restore. Ids and kinds say the rest: the record never holds what the prompt said, nor how long it
 * was, nor how many options or lines it had (the same rule as the presence record: a fact, never a magnitude).
 */
export const IGNORE_DETAIL = 'Hid this card from the person who tapped Ignore. Nothing was answered, typed or sent; the agent is still waiting.'
export const RESTORE_DETAIL = 'Brought this card back for the person who tapped Restore. Nothing was answered, typed or sent.'

export interface IgnoreRecord {
  personId: string
  sessionId: string
  /** The id an answer checks (ApprovalItem.id) of the prompt that was hidden. */
  promptId: string
  floorId: string
  agentId: string
  /** The floor, agent and PC names as they were then, so a Restore's record can say which chat it was even once the chat is gone. Never anything the prompt said. */
  floor: string
  agent: string
  pc: string
  at: string
}

export interface ApprovalIgnores {
  /** This person's records, newest first (copies). */
  list(personId: string): IgnoreRecord[]
  /** Whether this person has ignored exactly this prompt of this chat. */
  has(personId: string, sessionId: string, promptId: string): boolean
  /** One record per person and chat: ignoring another prompt of the same chat replaces the one before. */
  add(rec: IgnoreRecord): void
  /** Drops this person's record for exactly this prompt of this chat; the record that was dropped, or null when there was none. */
  remove(personId: string, sessionId: string, promptId: string): IgnoreRecord | null
  /** How many records are held (the sweep has nothing to look at when it is none). */
  size(): number
  /**
   * Drops every record of each chat that has been away from its question for `graceMs` in a row (`atQuestion` says whether it is at one now). The wait is for a state that
   * flips for a moment while a chat paints: a hide must not be undone by a blink. Returns how many records were dropped.
   */
  sweep(atQuestion: (sessionId: string) => boolean): number
}

export function createApprovalIgnores(o: { now?: () => number; graceMs?: number } = {}): ApprovalIgnores {
  const now = o.now ?? Date.now
  const graceMs = o.graceMs ?? 3_000
  // One record per person and chat. A key holds nothing but the two ids.
  const records = new Map<string, IgnoreRecord>()
  // When each chat that has a record was first seen away from its question (forgotten the moment it is seen at one again).
  const away = new Map<string, number>()
  const keyOf = (personId: string, sessionId: string) => JSON.stringify([personId, sessionId])
  const copy = (r: IgnoreRecord): IgnoreRecord => ({ ...r })
  return {
    list: personId => [...records.values()].filter(r => r.personId === personId).sort((a, b) => b.at.localeCompare(a.at)).map(copy),
    has: (personId, sessionId, promptId) => records.get(keyOf(personId, sessionId))?.promptId === promptId,
    add(rec) {
      records.set(keyOf(rec.personId, rec.sessionId), copy(rec))
      away.delete(rec.sessionId)
    },
    remove(personId, sessionId, promptId) {
      const key = keyOf(personId, sessionId)
      const rec = records.get(key)
      if (!rec || rec.promptId !== promptId) return null
      records.delete(key)
      return rec
    },
    size: () => records.size,
    sweep(atQuestion) {
      const sessions = new Set([...records.values()].map(r => r.sessionId))
      for (const sid of [...away.keys()]) if (!sessions.has(sid)) away.delete(sid)
      const t = now()
      let dropped = 0
      for (const sid of sessions) {
        if (atQuestion(sid)) {
          away.delete(sid)
          continue
        }
        const since = away.get(sid) ?? t
        away.set(sid, since)
        if (t - since < graceMs) continue
        for (const [key, r] of [...records]) {
          if (r.sessionId !== sid) continue
          records.delete(key)
          dropped++
        }
        away.delete(sid)
      }
      return dropped
    },
  }
}
