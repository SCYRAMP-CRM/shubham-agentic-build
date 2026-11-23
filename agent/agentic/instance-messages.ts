import { INSTANCE_HOP_MAX, INSTANCE_HOP_WINDOW_MS, INSTANCE_MIN_WORDS, INSTANCE_SENDER_PER_MINUTE, INSTANCE_TEMPLATE_PER_MINUTE, wordsIn } from '../../shared/instance-message.ts'

// F-316 T4: the loop safeguards of message_instance (an instance of a template messages another instance of the SAME template), kept in memory by the one agent that runs the tool. Nothing here
// reads a word of a message but how many there are; nothing is written to disk (a restart forgets the chain, on purpose: it can only let ONE more message through, and the rates start again).
//
//   HOPS    every message a chat receives from an instance is remembered for the receiving chat: how many hops it had and when. A message that chat sends within INSTANCE_HOP_WINDOW_MS goes out
//           at that hop plus one, whoever it is for and whatever it says: the server cannot read meaning, so an unrelated message in the window counts one more hop too. That is conservative on
//           purpose. A message at hop INSTANCE_HOP_MAX + 1 is refused (429, "chain too long"). A chat that gets two messages in the window keeps the HIGHER hop, never the lower one.
//   RATES   one chat sends at most INSTANCE_SENDER_PER_MINUTE messages a minute, and all the chats of one template together at most INSTANCE_TEMPLATE_PER_MINUTE. (index.ts relayAllowed adds the
//           pair's five seconds and the target's six a minute, as for every relayed message.)
//   COUNTS  a message counts when it is TAKEN, so two sent at the same moment cannot both pass the same last place; what is not delivered gives its place back (undo); the receiving chat's hop
//           is remembered only when the message landed.

const MINUTE_MS = 60_000
/** The most receivers remembered at once; older, expired ones are dropped first. */
const LINEAGE_CAP = 500

export interface InstanceMessageTaken {
  ok: true
  /** The hop this message goes out at (1 for the first). */
  hop: number
  /** Give the place back: the message was not delivered. */
  undo(): void
  /** The message was delivered: the receiving chat now carries this hop. */
  landed(): void
}
export type InstanceMessageRefused = { ok: false; why: 'chain' | 'sender' | 'template'; words: string }

export const CHAIN_WORDS = `Chain too long: messages between instances stop after hop ${INSTANCE_HOP_MAX}, and this would be hop ${INSTANCE_HOP_MAX + 1}. Nothing was sent. Do the work yourself, or tell the owner what you need.`

export interface InstanceMessages {
  /** Count one message from the chat `from` to the chat `to` of the template `template`, or refuse it. */
  take(from: string, to: string, template: string): InstanceMessageTaken | InstanceMessageRefused
  /** Tests: how many receivers are remembered. */
  remembered(): number
}

/** Why a text is not sent as it is ('' when it is). Under INSTANCE_MIN_WORDS words says nothing new. */
export function instanceTextProblem(text: string): string {
  if (wordsIn(text) < INSTANCE_MIN_WORDS) return `A message between instances needs at least ${INSTANCE_MIN_WORDS} words: say what you need or what you found. "ok" and "thanks" are not sent, so two chats cannot keep answering each other.`
  return ''
}

export function createInstanceMessages(now: () => number = () => Date.now()): InstanceMessages {
  const lastIn = new Map<string, { hop: number; at: number }>()
  const bySender = new Map<string, number[]>()
  const byTemplate = new Map<string, number[]>()
  const recent = (list: number[] | undefined, t: number) => (list ?? []).filter(x => t - x < MINUTE_MS)
  const without = (list: number[], t: number) => {
    const i = list.indexOf(t)
    return i < 0 ? list : [...list.slice(0, i), ...list.slice(i + 1)]
  }
  const keep = (map: Map<string, number[]>, key: string, list: number[]) => {
    if (list.length) map.set(key, list)
    else map.delete(key)
  }
  const sweep = (t: number) => {
    if (lastIn.size <= LINEAGE_CAP) return
    for (const [k, v] of lastIn) if (t - v.at >= INSTANCE_HOP_WINDOW_MS) lastIn.delete(k)
    // Still over (many live chains): the oldest go. Forgetting one only lets ONE more message through.
    if (lastIn.size > LINEAGE_CAP) for (const k of [...lastIn.keys()].slice(0, lastIn.size - LINEAGE_CAP)) lastIn.delete(k)
  }
  return {
    take(from, to, template) {
      const t = now()
      const got = lastIn.get(from)
      const hop = (got && t - got.at < INSTANCE_HOP_WINDOW_MS ? got.hop : 0) + 1
      if (hop > INSTANCE_HOP_MAX) return { ok: false, why: 'chain', words: CHAIN_WORDS }
      const mine = recent(bySender.get(from), t)
      if (mine.length >= INSTANCE_SENDER_PER_MINUTE) return { ok: false, why: 'sender', words: `You have sent ${mine.length} messages to other instances in the last minute; wait a little. Nothing was sent.` }
      const all = recent(byTemplate.get(template), t)
      if (all.length >= INSTANCE_TEMPLATE_PER_MINUTE) return { ok: false, why: 'template', words: `The instances of this template have sent ${all.length} messages to each other in the last minute; wait a little. Nothing was sent.` }
      keep(bySender, from, [...mine, t])
      keep(byTemplate, template, [...all, t])
      let settled = false
      return {
        ok: true,
        hop,
        undo() {
          if (settled) return
          settled = true
          keep(bySender, from, without(recent(bySender.get(from), now()), t))
          keep(byTemplate, template, without(recent(byTemplate.get(template), now()), t))
        },
        landed() {
          if (settled) return
          settled = true
          const prev = lastIn.get(to)
          lastIn.set(to, { hop: prev && t - prev.at < INSTANCE_HOP_WINDOW_MS ? Math.max(prev.hop, hop) : hop, at: t })
          sweep(t)
        },
      }
    },
    remembered: () => lastIn.size,
  }
}
