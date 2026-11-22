import { createAuditFile } from './audit-file.ts'

// The floors' structural history (Agent 3, built 18 Nov 2026 on Lead's order; the gap was found 17 Nov): who made, removed, adopted, filled, moved or shared
// what, and when. The audit trail already said who changed an ACCESS choice (access-log.jsonl) and what was answered (approvals.jsonl), but nothing said who
// created, deleted or adopted a floor, who put a chat on one, or moved it, so "was it used" could not be answered for any floor-based exposure, and the only
// record of such a change was the one an agent wrote by hand. One append-only line per structural change, written by the floor STORE (floors.ts), not by the
// routes: the store is the one place every entry point (a page, a chat's own tool, a member's adoption, the own-Assistant path) goes through.
//
// WHAT IT NEVER HOLDS: no message, brief, prompt, file or path. Only ids and names (the person's, the floor's, the chat's), counts, and share levels.
//
// ITS WORDS ARE PART OF ITS CORRECTNESS (Lead's rule, 18 Nov, from Agent 6's review): this is the one record somebody will trust without being able to check it,
// so every event NAME says what OCCURRED, from the owner's point of view, never the function that ran. A member PC dropping its own copy of a floor the Server
// took in is "handed over" (the floor MOVED: nothing was deleted), never "removed": read next month, "removed" would be taken for data loss, and this log would be
// the evidence. A floor a PC sends is "adopted", not "created"; people the Server did not take on a PC's word are counted as "restamped" (put back by the Server),
// never told as an owner change by the owner. Name a new event by what happened, and make its sentence say who it happened to.
//
// WHERE ITS BOUNDARY IS (so nobody reads it as more): it records a floor's STRUCTURE (made, removed, adopted, an agent added, dropped or moved, a share changed,
// an Assistant made). It does NOT record what happens INSIDE a chat: an interactive menu answered on a chat's own screen (a model changed that way, found on
// 18 Nov by Agent 18, is not here), a chat's tools, what was typed, an engine switch, a floor's rename or its preamble; and it is this PC's own log (a member PC
// keeps its own for the floors it holds itself).

export type FloorEventKind =
  | 'floor-created'
  | 'floor-removed'
  | 'floor-adopted'
  | 'floor-handed-over'
  | 'agent-added'
  | 'agents-changed'
  | 'agent-moved'
  | 'share-changed'
  | 'owners-assigned'
  | 'assistant-made'
  // F-316: a chat added as a copy of another (the family it joins, and which chat it was copied from), and the owner's one click that gave a floor's chats a template, and took it away again.
  | 'agent-copied'
  | 'template-stamped'
  | 'template-unstamped'

export interface FloorEventRef {
  id: string
  name: string
}

export interface FloorEvent {
  at: string
  kind: FloorEventKind
  /** The person who did it (their CRM id and name). null: nobody to name: the Server's own start-up migration, or a linked PC's adoption (see `pc`). */
  by: FloorEventRef | null
  /** floor-adopted: the linked PC that sent the floor. */
  pc?: FloorEventRef
  /** floor-handed-over (written on a MEMBER PC): the PC that holds the floor now, after this PC's own copy was dropped because the Server took it in. Not a removal. */
  heldBy?: FloorEventRef
  /** A chat's own tool made the change: the first 8 characters of that chat's session id. */
  chat?: string
  /** The floor it happened on (absent for owners-assigned, which is every floor at once). */
  floor?: FloorEventRef
  /** agent-moved: the floor it went to. */
  to?: FloorEventRef
  agent?: FloorEventRef
  /** The floor's agent count after the change (before it, for a removed floor). */
  agents?: number
  /** agents-changed: who joined and who left the floor's list. */
  added?: FloorEventRef[]
  removed?: FloorEventRef[]
  /** floor-removed / floor-adopted: who had made the floor, and when (so the line says "made 14:04, removed 14:12"). For an adopted floor: who it says made it AFTER the trust check. */
  madeBy?: FloorEventRef | null
  madeAt?: string
  /**
   * floor-adopted: what the Server did NOT take on the sending PC's word (F-127, adopt-trust), as counts only: floor makers and chat owners it does not list that it
   * made its own owner, and sharees it does not list that it left out. All zero: every person the floor named was already known to the Server. Absent: this store
   * does not check (it adopts nothing).
   */
  restamped?: { makers: number; owners: number; sharees: number }
  /** share-changed: the list as it is AFTER the change (ids and levels only). */
  sharedWith?: { id: string; can: string }[]
  /** owners-assigned: how many rows were given an owner. template-stamped / template-unstamped: how many chats. */
  count?: number
  /** F-316, agent-copied / template-stamped / template-unstamped: the template (its id and its name). */
  template?: FloorEventRef
  /** F-316, agent-copied: the chat it was copied from, and its floor. */
  source?: FloorEventRef
  sourceFloor?: FloorEventRef
}

export type FloorEventInput = Omit<FloorEvent, 'at'>

export interface FloorEventLog {
  /** Throws when the file cannot be written: the caller decides how loud that is (index.ts recordFloorEvent). */
  add(e: FloorEventInput): FloorEvent
  /** Newest first. */
  list(limit?: number): FloorEvent[]
}

const NAME_CAP = 80
const LIST_CAP = 64

const text = (v: unknown, cap = NAME_CAP): string => (typeof v === 'string' ? v : '').replace(/[\r\n\t]+/g, ' ').slice(0, cap)
const ref = (v: unknown): FloorEventRef | null => {
  if (typeof v !== 'object' || v === null) return null
  const r = v as Record<string, unknown>
  return typeof r.id === 'string' ? { id: text(r.id, 64), name: text(r.name) } : null
}
const refs = (v: unknown): FloorEventRef[] | undefined => (Array.isArray(v) ? v.slice(0, LIST_CAP).flatMap(x => { const r = ref(x); return r ? [r] : [] }) : undefined)
const count = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined)

/**
 * The line that is stored: ONLY the fields this record is defined to hold, names cut short, lists capped. A field the caller adds (a message, a path, a
 * brief) is not copied, so no caller can put content into this file by mistake.
 */
export function floorEventOf(e: FloorEventInput, at: string): FloorEvent {
  const out: FloorEvent = { at, kind: e.kind, by: ref(e.by) }
  const set = <K extends keyof FloorEvent>(key: K, value: FloorEvent[K] | undefined | null) => { if (value !== undefined && value !== null) out[key] = value }
  set('pc', ref(e.pc))
  set('heldBy', ref(e.heldBy))
  set('chat', e.chat === undefined ? undefined : text(e.chat, 16))
  set('floor', ref(e.floor))
  set('to', ref(e.to))
  set('agent', ref(e.agent))
  set('agents', count(e.agents))
  set('added', refs(e.added))
  set('removed', refs(e.removed))
  if (e.madeBy !== undefined) out.madeBy = ref(e.madeBy)
  set('madeAt', e.madeAt === undefined ? undefined : text(e.madeAt, 40))
  if (typeof e.restamped === 'object' && e.restamped !== null) set('restamped', { makers: count(e.restamped.makers) ?? 0, owners: count(e.restamped.owners) ?? 0, sharees: count(e.restamped.sharees) ?? 0 })
  set('sharedWith', Array.isArray(e.sharedWith) ? e.sharedWith.slice(0, LIST_CAP).map(s => ({ id: text(s.id, 64), can: text(s.can, 8) })) : undefined)
  set('count', count(e.count))
  set('template', ref(e.template))
  set('source', ref(e.source))
  set('sourceFloor', ref(e.sourceFloor))
  return out
}

/** What an adoption did not take on the sending PC's word, in plain words ('' when the store did not check). */
function notOnItsWord(r: FloorEvent['restamped']): string {
  if (!r) return ''
  if (r.makers + r.owners + r.sharees === 0) return '; every person it named was already listed by the Server'
  return `; not taken on the PC's word: ${r.makers} floor makers and ${r.owners} chat owners put back as the Server's owner, ${r.sharees} sharees left out`
}

/** One plain sentence for the hub's log and the heartbeat: who, what, where. Names and counts only. */
export function describeFloorEvent(e: FloorEventInput): string {
  const who = e.by ? e.by.name || e.by.id.slice(0, 8) : e.pc ? `PC ${e.pc.name}` : 'the Server'
  const on = e.floor ? `floor "${e.floor.name}"` : 'every floor'
  const through = e.chat ? ` (through chat ${e.chat})` : ''
  const names = (list: FloorEventRef[] | undefined) => (list ?? []).map(x => `"${x.name}"`).join(', ') || 'none'
  switch (e.kind) {
    case 'floor-created': return `${who} made ${on}${through}`
    case 'floor-removed': return `${who} removed ${on} (${e.agents ?? '?'} agents; made by ${e.madeBy?.name || 'nobody on record'}${e.madeAt ? ` at ${e.madeAt}` : ''})${through}`
    case 'floor-adopted': return `${who} sent ${on}, taken in with ${e.agents ?? '?'} agents (made by ${e.madeBy?.name || 'nobody on record'})${notOnItsWord(e.restamped)}`
    case 'floor-handed-over': return `this PC dropped its own copy of ${on}: PC ${e.heldBy?.name ?? 'the Server'} holds it now (${e.agents ?? '?'} agents); not a removal`
    case 'agent-added': return `${who} added "${e.agent?.name ?? '?'}" to ${on}${through}`
    case 'agents-changed': return `${who} changed the agents on ${on}: added ${names(e.added)}; removed ${names(e.removed)}${through}`
    case 'agent-moved': return `${who} moved "${e.agent?.name ?? '?'}" from ${on} to floor "${e.to?.name ?? '?'}"${through}`
    case 'share-changed': return `${who} changed who "${e.agent?.name ?? '?'}" on ${on} is shared with (${e.sharedWith?.length ?? 0} people now)${through}`
    case 'owners-assigned': return `${who} gave ${e.count ?? '?'} floors and chats that had no owner an owner`
    case 'assistant-made': return `${who} made "${e.agent?.name ?? '?'}" on ${on} that person's own Assistant${through}`
    case 'agent-copied': return `${who} added "${e.agent?.name ?? '?'}" to ${on} as a copy of "${e.source?.name ?? '?'}" on floor "${e.sourceFloor?.name ?? '?'}", an instance of template "${e.template?.name ?? '?'}"${through}`
    case 'template-stamped': return `${who} made ${e.count ?? '?'} chats on ${on} instances of template "${e.template?.name ?? '?'}"`
    case 'template-unstamped': return `${who} took ${e.count ?? '?'} chats on ${on} out of template "${e.template?.name ?? '?'}"`
  }
}

/** The log: one JSON line per change, in one file, kept (never rewritten); a read looks at its end. Same shape and care as the approvals log (approvals.ts); the machinery is audit-file.ts (shared with the chat-presence record). */
export function createFloorEventLog(file: string, now = () => new Date()): FloorEventLog {
  return createAuditFile<FloorEventInput, FloorEvent>(file, floorEventOf, now)
}
