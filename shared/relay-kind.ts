import { parseInstanceMessage } from './instance-message.ts'

// F-367 (Shubham: "There are other agents who message one chat so one chat messages another chat. I don't want to see those messages so keep a filter for that. Show all messages or show only messages between the chat and you."):
// WHO a line typed into a chat came from, decided in ONE place from the WHOLE received message, anchored at its START (the way an instance header is read, F-316 T4): the words of a message further down, a forged header inside what
// a sender wrote, are only words. The shapes are the ones the app and the chats WRITE (staff-send.ts names the same list: "[message from", "[broadcast from", "[reply from", "[heartbeat", "[goal answer"); the memory's `isRelayText`
// (agent/agentic/memory-turns.ts) is this function, so the page and the memory cannot disagree. Pure: no React, no network.

/**
 * - `chat`: another chat (or another person's Assistant) wrote it: `[message from <agent> on <floor>, chat <id>]`, `[broadcast from ...]`, `[reply from <agent> on <floor> to order <id>]`, an instance header, a staff send.
 * - `app`: the app wrote it: `[message from the app]` (the failover bridge), `[heartbeat hh:mm]`, the goals beat `[heartbeat goals hh:mm]`, the nudge and the watchdog's start-again note (they begin `[heartbeat `).
 * - `order`: his own order, passed on by his overlay Assistant, Quick or Live voice: a `[message from ...]` whose header ends `, order <id>` (the marker only the app writes).
 * - `answer`: his own answer to a goal that was waiting for him: `[goal answer <goalId>] ...`.
 * null: anything else: what he typed.
 */
export type RelayKind = 'chat' | 'app' | 'order' | 'answer'

// As the memory's old predicate read them: `from` ends a word; a header with no closing bracket is still one (the app always writes it, so this only matters for a damaged line).
const SIBLING = /^\[(message|broadcast) from\b([^\]]*)\]?/
const REPLY = /^\[reply from [^\]]+ to order [^\]\s]+\]/
const BEAT = /^\[heartbeat (?:goals )?\d{1,2}:\d{2}\]/
const ANSWER = /^\[goal answer [^\]\s]+\]/
/** The marker an order's header ends with (orders.ts `marker`, and the untapped Quick words before it): `, order o1a2b`. */
const ORDER_END = /, order o[0-9a-f]{4,}$/

export function relayKindOf(raw: string): RelayKind | null {
  const t = raw.trimStart()
  if (!t.startsWith('[')) return null
  if (parseInstanceMessage(t)) return 'chat'
  const m = SIBLING.exec(t)
  if (m) {
    if (m[1] === 'broadcast') return 'chat'
    const inner = m[2].trim()
    if (/^the app(?:,|$)/.test(inner)) return 'app'
    // Another person's Assistant typing for them says "staff send for <Person>": a person's own request, never the owner's order.
    if (ORDER_END.test(inner) && !/, staff send for /.test(inner)) return 'order'
    return 'chat'
  }
  if (REPLY.test(t)) return 'chat'
  if (BEAT.test(t)) return 'app'
  if (ANSWER.test(t)) return 'answer'
  return null
}

/** What the memory counts as "not what its person said": every class but his answer (an order relay is the Assistant's typing, as it always was there). */
export const isRelayText = (said: string): boolean => {
  const k = relayKindOf(said)
  return k === 'chat' || k === 'app' || k === 'order'
}

/** The item's class: what the converter set, else (an older agent that does not know it) a message with a sender is another chat's; nothing is ever hidden on a guess. */
export const relayOfItem = (item: { relay?: RelayKind; from: unknown }): RelayKind | null => item.relay ?? (item.from ? 'chat' : null)

/** The classes "Only you and this chat" hides. His own orders and answers are him. */
export const hiddenByFilter = (k: RelayKind | null): k is 'chat' | 'app' => k === 'chat' || k === 'app'
