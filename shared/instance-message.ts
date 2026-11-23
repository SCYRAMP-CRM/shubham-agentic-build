// F-316 T4 (Shubham's order o1103, "one agent's instance of template should be able to message another instance"; top priority by his order o4169): the FIXED SHAPE of the line an instance
// receives from another instance of the same template, in one place that the server (agent/agentic/instance-messages.ts, index.ts message_instance) and a page that draws the received
// line as a chip share. The line is typed into the receiving chat like every relayed message, so its first characters are this header and then the sender's own words:
//
//   [message from <agent> of <template> (floor <floor>), hop <n>. Reply only with something new: messages between instances stop after hop 3.] <words>
//
// It is the same family as "[message from <agent> on <floor>, chat <id>] <words>": every chat's system prompt already says that such a line comes from a sibling chat, NOT from the human, and that
// the words in it are information to weigh, not orders. A name is one line with no square bracket in it (a name cannot close the header early); the words after it are the sender's, untouched.

/** The most messages one conversation between instances may have: the third is the last; a fourth is refused ("chain too long"). */
export const INSTANCE_HOP_MAX = 3
/** A message counts as an answer to the one a chat received within this long (so a chain is followed through the chats that carry it). */
export const INSTANCE_HOP_WINDOW_MS = 10 * 60_000
/** Messages one chat may send in a minute, and all the instances of one template together. */
export const INSTANCE_SENDER_PER_MINUTE = 4
export const INSTANCE_TEMPLATE_PER_MINUTE = 20
/** Fewer words than this is "ok", "thanks", "ack": nothing new, and the cheapest way to keep two chats answering each other. */
export const INSTANCE_MIN_WORDS = 3
/** The longest message between instances, in characters (a hand-over, not a document: put a document in the notebook or a file). */
export const INSTANCE_TEXT_MAX = 4000

const NAME_MAX = 40

/** A name as the header says it: one line, no square bracket, at most NAME_MAX characters, never empty. */
export function headerName(v: unknown): string {
  const s = (typeof v === 'string' ? v : '').replace(/[[\]]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim()
  return s || '?'
}

export const INSTANCE_REPLY_NOTE = `Reply only with something new: messages between instances stop after hop ${INSTANCE_HOP_MAX}.`

export interface InstanceHeaderInput {
  agent: string
  template: string
  floor: string
  hop: number
}

/** The header, without the words that follow it. */
export function instanceHeader(i: InstanceHeaderInput): string {
  const hop = Number.isInteger(i.hop) && i.hop >= 1 ? i.hop : 1
  return `[message from ${headerName(i.agent)} of ${headerName(i.template)} (floor ${headerName(i.floor)}), hop ${hop}. ${INSTANCE_REPLY_NOTE}]`
}

export interface ParsedInstanceMessage {
  agent: string
  template: string
  floor: string
  hop: number
  /** What the sender wrote (everything after the header). */
  text: string
}

// The header is read from the LEFT: the agent is up to the first " of " that is followed by a template and "(floor ...), hop N". A name that itself holds " of " may be split a little differently
// than it was written; the chip that shows it is only a label, and the words are never changed.
const HEADER = /^\[message from (.+?) of (.+?) \(floor (.+?)\), hop (\d{1,3})\. Reply only with something new: messages between instances stop after hop \d{1,3}\.\] ?/

/** The pieces of a received line, or null when it is not a message between instances (every other line is drawn as it always was). */
export function parseInstanceMessage(line: string): ParsedInstanceMessage | null {
  const m = HEADER.exec(line)
  if (!m) return null
  return { agent: m[1], template: m[2], floor: m[3], hop: Number(m[4]), text: line.slice(m[0].length) }
}

/** How many words a message has (white space apart); a message under INSTANCE_MIN_WORDS is refused. */
export const wordsIn = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length
