import { createAuditFile } from './audit-file.ts'

// WHO WAS PRESENT AT A CHAT, AND HOW (Agent 3, built 18 Nov 2026 on Lead's order; the gap was found 18 Nov by Agent 18, who saw a Codex chat's model changed by an
// answer at a menu on its own screen with no record of WHO answered). Three things are recorded, one line each, appended and never rewritten, owner-read only:
//   keys-reached-terminal  keys reached a chat's terminal: from whom, and of which CLASS (Enter, an arrow or Esc, a control key, text).
//   keys-relayed           keys a RELAY handed to the link toward a chat on ANOTHER PC (Agent 6's review, R3). NOT "reached": the relay never learns whether the chat on the far PC took them
//                          (only that PC's own record knows). Its own name, because an event says what OCCURRED. Noted where the relay receives the frame, as before; noting it at the WRITE
//                          (so a frame that dies in the buffer of a link that never opens is not recorded) is FILED: no test can drive these paths here, so moving them would be unverifiable.
//   screen-driven          an Assistant drove the person's screen (looked, opened a page, pressed, typed ...): which Assistant, which act, how it ended.
// "Who started a chat" is the third part and lives in chat-log.ts (a `by` on the start events that file already had: no new store for it).
//
// WHAT THIS IS FOR: to name the ACTOR of anything that happened at a chat to the minute. It is PRESENCE, not a transcript: it never says what was typed, what page was
// opened, which element was pressed or which handler was called.
//
// A FACT, NEVER A MAGNITUDE (Lead's condition for recording `text` at all, 18 Nov; it is ABSOLUTE and it is written here so that whoever next wants to "improve" this
// reads why first). That text was typed in a minute is recorded, because without it a minute of only typing is an empty line, indistinguishable from a minute of
// nothing: a false negative in a presence record, the same fault as exposure pointed the other way. But it stays a FACT. There is no count, no length, no first
// character, no sample, and no difference between one keystroke and a thousand, and it must NEVER become a number later "because it is only a number": a LENGTH leaks a
// password's length and a COUNT leaks rhythm. So the types below hold no number at all (only `at`, a minute), a class is written once per minute per actor however
// many keys there were, and the one function that sees the keys (classesOfInput) returns only names from a closed list. The same goes for the screen: that an Assistant
// typed is a fact; what, where and how often is not kept.
//
// QUICK IS ITS OWN VALUE, AND THAT IS NOT TIDINESS (Lead: the same shape as his "Others 91.6%" usage complaint, where a chat's usage was filed under a blank key and his
// spend landed in a bucket that was not his: a synthetic or empty identity inheriting a real one's attribution). Quick is not a chat: index.ts fastCall builds a made-up
// agent (id 'fast-assistant', no session) from the Orchestrator's and calls the tool with an EMPTY session id, and that agent PASSES isOrchestratorAgent. Filed by that
// test, Quick's calls would read as the overlay Assistant's. `by.kind === 'quick'` keeps them apart on purpose; do not merge it into 'overlay-assistant' as a tidy-up.
//
// THE LABEL COMES FROM WHERE IT STOPPED, NEVER FROM THE STATUS NUMBER (Lead's naming rule: an event says what OCCURRED). A 504 does not mean "it did not happen": the
// bridge's own comment says a page that did not answer "will still RUN the command later, from its queue", so it is `no-answer-may-still-have-run`, never "failed". And a
// 409 can come from the bridge (no screen) or from this app's own rule (Goals on the phone), so a status alone cannot say; ui-bridge.ts tags each refusal with the stage it
// came from (`stage: 'not-sent' | 'asked'`) and screenOutcomeOf reads that.
//
// WHERE IT ENDS, so nobody reads an empty stretch as "nothing happened":
//  - Only calls that REACHED the screen bridge are recorded. A call a rule refused BEFORE it (not an Assistant at all, a staff Assistant asking for more than a look, the
//    Goals-on-phone setting, the spoken latch, the staff policy) is told to the chat and is not here. The case somebody would later want is an ARGUMENT THAT CLIMBS OUT OF
//    A PATH (`../` in ui_invoke): repeated probing is exactly a pre-bridge refusal. It is not recorded. If it is ever wanted it is a SECOND HOOK, not a widening of this one.
//  - Keys are recorded where they reach the chat pool (the `chats` facade in index.ts) and where a page relays them to a chat on another PC (remoteTerminal). Keys from a
//    member PC to a chat on the Server name only the PC (the person on it is not carried: index.ts serveTerminal); keys a member sends to a chat on ANOTHER member
//    through the Server are noted on the Server by the PC as it passes them on (before anyone knows they arrived); the app's own Esc keys (his Stop, his Cancel, live talk's
//    Let go) and the Approvals route's answers are named as the app and the Approvals route, so a line may name a surface rather than a person. Text put into a chat's input line through the chat box's live mirror, and messages sent through the send routes and tools,
//    are other paths and are not here. Xterm's own replies (focus reports, answers to queries) are not people and are not recorded.
//  - KEYS THE ASSISTANT MAKES ON HIS PAGE ARE FILED AS HIM (Agent 6's review, 18 Nov, R1: the ORIGINAL case, so it is said here and in every answer of GET /chat-presence). The
//    Assistant's press (with no ref it goes to the page's active element: src/overlay/driver.ts) and its clicks on the page's key buttons (src/agentic/TouchKeys.tsx,
//    src/chat/Conversation.tsx) arrive at the server on the page's OWN terminal socket as ordinary keys, and the server files them as the person signed in on that page, or the
//    open app. A menu answered by the Assistant therefore reads as his own Enter. The screen-driven line of the same minute names the Assistant ('pressed'), but nothing
//    links the two. The real fix is on the page (it would mark keys that did not come from his own hands): FILED, not done here.
//  - Presence by the minute: at most one line per (chat, actor, class) per minute, so at most 4 a minute while someone types (about 300 bytes each: at most about 1.7 MB a day for
//    one person typing without a break, 4 x 1,440 x 300, and a third of that is typical). NO RETENTION: nothing is rotated or deleted, and list() reads only the LAST 512 KB of
//    the file (audit-file.ts), so older lines exist on disk but the route cannot reach them (filed). It starts empty: nothing before this build is in it. Since this run, a line
//    that could not be written is kept in memory (50) and told to the owner once in the heartbeat.

export const INPUT_CLASSES = ['enter', 'escape-sequence', 'control-key', 'text'] as const
export type InputClass = (typeof INPUT_CLASSES)[number]

export const SCREEN_TOOLS = ['ui_screen', 'ui_control', 'ui_modules', 'ui_invoke'] as const
export type ScreenTool = (typeof SCREEN_TOOLS)[number]

export const SCREEN_ACTS = ['looked', 'opened-a-page', 'scrolled', 'waited', 'pressed', 'typed', 'pressed-a-key', 'called-a-page-handler', 'other'] as const
export type ScreenAct = (typeof SCREEN_ACTS)[number]

/** How a call ended, by where it stopped: answered; stopped before any page was asked; the page said it could not; the page's answer was withheld by a page rule; no answer (it may still run); not known. */
export const SCREEN_OUTCOMES = ['answered', 'not-sent', 'page-said-no', 'answer-withheld', 'no-answer-may-still-have-run', 'cannot-tell'] as const
export type ScreenOutcome = (typeof SCREEN_OUTCOMES)[number]

export type Door = 'local' | 'tailnet'

/** A person or a PC: its id in our own store and its name there (cut to 80). */
export interface PresenceRef {
  id: string
  name: string
}

/** A chat: the first characters of its session id, and the names of its agent and floor. */
export interface ChatRef {
  id: string
  agent?: string
  floor?: string
}

/**
 * Who. Closed: every value is built by this app from an identity it already holds, never from anything typed or sent. A call that did not say who is `unattributed`
 * (never filed as somebody), so a caller that forgets shows up as exactly that.
 */
export type ChatActor =
  | { kind: 'person'; person: PresenceRef; door: Door }
  | { kind: 'owner-open-app'; door: Door }
  | { kind: 'pc'; pc: PresenceRef }
  | { kind: 'app' }
  | { kind: 'approvals' }
  | { kind: 'chat'; chat: ChatRef }
  | { kind: 'overlay-assistant'; chat: ChatRef }
  | { kind: 'quick' }
  | { kind: 'person-assistant'; person: PresenceRef; chat: ChatRef }
  | { kind: 'unattributed' }

export interface KeysInput {
  kind: 'keys-reached-terminal'
  chat: ChatRef
  by: ChatActor
  class: InputClass
}
/** Keys a RELAY handed to the link toward a chat on another PC: from whom, of which class, toward which PC (where the chat runs), when the relay knows it. Arrival is not known here. */
export interface RelayedInput {
  kind: 'keys-relayed'
  chat: ChatRef
  by: ChatActor
  class: InputClass
  toPc?: PresenceRef
}
export interface ScreenInput {
  kind: 'screen-driven'
  by: ChatActor
  tool: ScreenTool
  act: ScreenAct
  outcome: ScreenOutcome
}
export type PresenceInput = KeysInput | RelayedInput | ScreenInput
/** `at` is the START OF THE MINUTE the thing happened in (never finer: nothing here needs the second). */
export type PresenceEvent = PresenceInput & { at: string }

export const UNATTRIBUTED: ChatActor = { kind: 'unattributed' }
export const APP: ChatActor = { kind: 'app' }

// ---- cleaning: only known shapes survive, names are cut, anything else is dropped -------------------------------------------------------------------------
const NAME_CAP = 80
const text = (v: unknown, cap = NAME_CAP): string => (typeof v === 'string' ? v : '').replace(/[\r\n\t]+/g, ' ').slice(0, cap)
const ID = /^[A-Za-z0-9._:-]{1,64}$/
const SHORT_ID = /^[A-Za-z0-9_-]{1,12}$/
const refOf = (v: unknown): PresenceRef | null => {
  if (typeof v !== 'object' || v === null) return null
  const r = v as Record<string, unknown>
  return typeof r.id === 'string' && ID.test(r.id) ? { id: r.id, name: text(r.name) } : null
}
export const chatRefOf = (v: unknown): ChatRef | null => {
  if (typeof v !== 'object' || v === null) return null
  const r = v as Record<string, unknown>
  if (typeof r.id !== 'string' || !SHORT_ID.test(r.id.slice(0, 12))) return null
  const out: ChatRef = { id: r.id.slice(0, 12) }
  if (typeof r.agent === 'string' && r.agent) out.agent = text(r.agent)
  if (typeof r.floor === 'string' && r.floor) out.floor = text(r.floor)
  return out
}
const doorOf = (v: unknown): Door => (v === 'tailnet' ? 'tailnet' : 'local')

/** A who, cleaned to the closed shape above; anything that does not fit is `unattributed`, never somebody. */
export function cleanActor(v: unknown): ChatActor {
  if (typeof v !== 'object' || v === null) return UNATTRIBUTED
  const a = v as Record<string, unknown>
  switch (a.kind) {
    case 'person': {
      const person = refOf(a.person)
      return person ? { kind: 'person', person, door: doorOf(a.door) } : UNATTRIBUTED
    }
    case 'owner-open-app':
      return { kind: 'owner-open-app', door: doorOf(a.door) }
    case 'pc': {
      const pc = refOf(a.pc)
      return pc ? { kind: 'pc', pc } : UNATTRIBUTED
    }
    case 'app':
      return APP
    case 'approvals':
      return { kind: 'approvals' }
    case 'chat': {
      const chat = chatRefOf(a.chat)
      return chat ? { kind: 'chat', chat } : UNATTRIBUTED
    }
    case 'overlay-assistant': {
      const chat = chatRefOf(a.chat)
      return chat ? { kind: 'overlay-assistant', chat } : UNATTRIBUTED
    }
    case 'quick':
      return { kind: 'quick' }
    case 'person-assistant': {
      const person = refOf(a.person)
      const chat = chatRefOf(a.chat)
      return person && chat ? { kind: 'person-assistant', person, chat } : UNATTRIBUTED
    }
    default:
      return UNATTRIBUTED
  }
}

/** A who as a key for "already told this minute": built from the cleaned actor only. */
function actorKey(a: ChatActor): string {
  switch (a.kind) {
    case 'person': return `person:${a.person.id}:${a.door}`
    case 'owner-open-app': return `owner:${a.door}`
    case 'pc': return `pc:${a.pc.id}`
    case 'chat': return `chat:${a.chat.id}`
    case 'overlay-assistant': return `overlay:${a.chat.id}`
    case 'person-assistant': return `pa:${a.person.id}:${a.chat.id}`
    default: return a.kind
  }
}

// ---- the keys: the only function that ever sees them -------------------------------------------------------------------------------------------------------
/** How far into one frame it looks: a paste larger than this is classed by its first 64 KB. */
const SCAN_CAP = 64 * 1024

/** How many characters an escape sequence that starts at `i` spans (at least 1): CSI (arrows, function keys), SS3, OSC/DCS up to their end, or Alt plus one character. */
function escapeLength(d: string, i: number, end: number): number {
  if (i + 1 >= end) return 1
  const next = d[i + 1]
  let j = i + 2
  if (next === '[') {
    while (j < end && d.charCodeAt(j) >= 0x30 && d.charCodeAt(j) <= 0x3f) j++
    while (j < end && d.charCodeAt(j) >= 0x20 && d.charCodeAt(j) <= 0x2f) j++
    if (j < end && d.charCodeAt(j) >= 0x40 && d.charCodeAt(j) <= 0x7e) j++
    return j - i
  }
  if (next === 'O') return Math.min(i + 3, end) - i
  if (next === ']' || next === 'P') {
    while (j < end && d[j] !== '\x07' && !(d[j] === '\x1b' && d[j + 1] === '\\')) j++
    return Math.min(j + (d[j] === '\x1b' ? 2 : 1), end) - i
  }
  return 2
}

/**
 * The CLASSES of a frame of terminal keys, from the closed list and in its order: a paste of "ls" and Enter is text and enter. This is the only function that is given
 * the keys, and it returns nothing but names: no number, no character, no length (see "A FACT, NEVER A MAGNITUDE" above). Xterm's own replies are not passed to it
 * (index.ts skips isAutomaticInput first); the markers that wrap a bracketed paste are framing, not keys: the start says text was pasted, the end says nothing.
 */
export function classesOfInput(d: string): InputClass[] {
  const found = new Set<InputClass>()
  const end = Math.min(d.length, SCAN_CAP)
  let i = 0
  while (i < end && found.size < INPUT_CLASSES.length) {
    const c = d.charCodeAt(i)
    if (c === 0x1b) {
      const n = escapeLength(d, i, end)
      const seq = d.slice(i, i + n)
      if (seq === '\x1b[200~') found.add('text')
      else if (seq !== '\x1b[201~') found.add('escape-sequence')
      i += n
    } else if (c === 0x0d) {
      found.add('enter')
      i++
    } else if (c < 0x20 || c === 0x7f) {
      found.add('control-key')
      i++
    } else {
      found.add('text')
      i++
    }
  }
  return INPUT_CLASSES.filter(k => found.has(k))
}

// ---- the screen: the only reading of a call's arguments ----------------------------------------------------------------------------------------------------
export const screenToolOf = (name: unknown): ScreenTool | null => SCREEN_TOOLS.find(t => t === name) ?? null

/** What a call DID, from its tool and, for ui_control, its action: a name from the closed list, never the action's text (anything unknown is `other`). Nothing else of the arguments is read. */
export function screenActOf(tool: ScreenTool, action: unknown): ScreenAct {
  switch (tool) {
    case 'ui_screen':
    case 'ui_modules':
      return 'looked'
    case 'ui_invoke':
      return 'called-a-page-handler'
    case 'ui_control':
      switch (action) {
        case 'goto':
        case 'crm_goto':
        case 'browse':
          return 'opened-a-page'
        case 'scroll':
          return 'scrolled'
        case 'wait':
          return 'waited'
        case 'click':
          return 'pressed'
        case 'type':
          return 'typed'
        case 'key':
          return 'pressed-a-key'
        default:
          return 'other'
      }
  }
}

/**
 * How a call ended, from WHERE it stopped (ui-bridge.ts tags a refusal `stage`), never from the status alone: a 409 is "no screen" from the bridge and a rule of ours from
 * elsewhere, and a 504 or a page that went away may still have run. `failure` is what the call threw; null: it answered.
 */
export function screenOutcomeOf(failure: unknown): ScreenOutcome {
  if (failure === null) return 'answered'
  const f = (typeof failure === 'object' ? failure : {}) as { stage?: unknown; status?: unknown }
  if (f.stage === 'not-sent') return 'not-sent'
  if (f.stage !== 'asked') return 'cannot-tell'
  if (f.status === 504 || f.status === 409) return 'no-answer-may-still-have-run'
  if (f.status === 422) return 'page-said-no'
  if (f.status === 403) return 'answer-withheld'
  return 'cannot-tell'
}

/**
 * WHICH Assistant is calling a screen tool, from facts index.ts already holds. `quick` is asked FIRST and on its own: Quick's made-up agent is spread from the Orchestrator's,
 * so it is ALSO an orchestrator by index.ts's test, and filing it by that test would read as the overlay Assistant's (see "QUICK IS ITS OWN VALUE" above). Anything that
 * is none of the three is `unattributed`, never filed as one of them.
 */
export function screenCallerOf(c: { quick: boolean; personAssistantOf: PresenceRef | null; orchestrator: boolean; chat: ChatRef }): ChatActor {
  if (c.quick) return { kind: 'quick' }
  if (c.personAssistantOf) return { kind: 'person-assistant', person: c.personAssistantOf, chat: c.chat }
  if (c.orchestrator) return { kind: 'overlay-assistant', chat: c.chat }
  return UNATTRIBUTED
}

// ---- the line that is stored ------------------------------------------------------------------------------------------------------------------------------
/** The start of the minute `at` is in, as an ISO time. */
const minuteOf = (at: string): string => {
  const t = Date.parse(at)
  if (!Number.isFinite(t)) throw new Error('chat-presence: not a time')
  return new Date(Math.floor(t / 60_000) * 60_000).toISOString()
}

const member = <T extends string>(list: readonly T[], v: unknown, what: string): T => {
  const hit = list.find(x => x === v)
  if (hit === undefined) throw new Error(`chat-presence: not ${what}`)
  return hit
}

/**
 * The line that is stored: ONLY the fields this record is defined to hold, every name from a closed list or cut, no number. A field the caller adds is not copied. A
 * value outside a closed list throws (a bug, told loudly by the recorder), never copied and never turned into a guess.
 */
export function presenceOf(e: PresenceInput, at: string): PresenceEvent {
  const minute = minuteOf(at)
  if (e.kind === 'keys-reached-terminal') {
    const chat = chatRefOf(e.chat)
    if (!chat) throw new Error('chat-presence: not a chat')
    return { at: minute, kind: 'keys-reached-terminal', chat, by: cleanActor(e.by), class: member(INPUT_CLASSES, e.class, 'a class of keys') }
  }
  if (e.kind === 'keys-relayed') {
    const chat = chatRefOf(e.chat)
    if (!chat) throw new Error('chat-presence: not a chat')
    // The PC it was handed toward: a known shape (an id and a cut name) or nothing; a shape that does not fit is dropped, never copied.
    const toPc = e.toPc === undefined ? null : refOf(e.toPc)
    return { at: minute, kind: 'keys-relayed', chat, by: cleanActor(e.by), class: member(INPUT_CLASSES, e.class, 'a class of keys'), ...(toPc ? { toPc } : {}) }
  }
  if (e.kind === 'screen-driven') {
    return {
      at: minute,
      kind: 'screen-driven',
      by: cleanActor(e.by),
      tool: member(SCREEN_TOOLS, e.tool, 'a screen tool'),
      act: member(SCREEN_ACTS, e.act, 'a screen act'),
      outcome: member(SCREEN_OUTCOMES, e.outcome, 'a screen outcome'),
    }
  }
  throw new Error('chat-presence: not a kind of presence')
}

// ---- in words ---------------------------------------------------------------------------------------------------------------------------------------------
const chatName = (c: ChatRef): string => (c.agent ? `${c.agent}${c.floor ? ` on ${c.floor}` : ''} (chat ${c.id.slice(0, 8)})` : `chat ${c.id.slice(0, 8)}`)
/** Each PC keeps its own file, so "local" is the PC the file is on. */
const doorWords = (d: Door): string => (d === 'tailnet' ? 'over the tailnet' : 'on this PC')

function whoWords(a: ChatActor): string {
  switch (a.kind) {
    case 'person': return `${a.person.name || a.person.id} (${doorWords(a.door)})`
    case 'owner-open-app': return `the open app, nobody signed in (${doorWords(a.door)})`
    case 'pc': return `somebody at PC ${a.pc.name || a.pc.id} (the person is not carried to the Server)`
    case 'app': return 'the app itself'
    case 'approvals': return 'the Approvals route, for an answer given there (the approvals record says who gave it)'
    case 'chat': return `${chatName(a.chat)}, through its own tool`
    case 'overlay-assistant': return `the overlay Assistant (${chatName(a.chat)})`
    case 'quick': return 'Quick (not a chat: the Assistant that talks)'
    case 'person-assistant': return `${a.person.name || a.person.id}'s own Assistant (${chatName(a.chat)})`
    case 'unattributed': return 'something that did not say who it was'
  }
}

const CLASS_WORDS: Record<InputClass, string> = {
  enter: 'Enter',
  'escape-sequence': 'an arrow, Esc or another escape key',
  'control-key': 'a control key',
  text: 'text (what, and how much, is not recorded)',
}
const ACT_WORDS: Record<ScreenAct, string> = {
  looked: 'looked at the screen',
  'opened-a-page': 'opened a page',
  scrolled: 'scrolled',
  waited: 'waited',
  pressed: 'pressed something',
  typed: 'typed into the page (what is not recorded)',
  'pressed-a-key': 'pressed a key',
  'called-a-page-handler': "called one of the page's own handlers",
  other: 'did something else',
}
const OUTCOME_WORDS: Record<ScreenOutcome, string> = {
  answered: 'the page answered',
  'not-sent': 'stopped before any page was asked',
  'page-said-no': 'the page said it could not',
  'answer-withheld': 'the page answered but a page rule withheld the answer; it may have acted',
  'no-answer-may-still-have-run': 'no answer in time; the page may still have done it',
  'cannot-tell': 'how it ended is not known',
}

/** One event in a sentence; it says WHAT OCCURRED and who it happened to, from the owner's point of view. */
export function describePresence(e: PresenceEvent | PresenceInput): string {
  if (e.kind === 'keys-reached-terminal') return `${whoWords(e.by)} sent ${CLASS_WORDS[e.class]} to the terminal of ${chatName(e.chat)}`
  if (e.kind === 'keys-relayed') return `${whoWords(e.by)} sent ${CLASS_WORDS[e.class]} toward the terminal of ${chatName(e.chat)} on ${e.toPc ? `PC ${e.toPc.name || e.toPc.id}` : 'another PC'}: handed to the link, and whether it arrived is not known on this PC`
  return `${whoWords(e.by)} ${ACT_WORDS[e.act]} on the screen it drives (${OUTCOME_WORDS[e.outcome]})`
}

// ---- the recorder -----------------------------------------------------------------------------------------------------------------------------------------
/**
 * WHERE THE RECORD ENDS, in the words the owner reads in the answer of GET /chat-presence (Agent 6's review, R4: the limits lived only in this file's header and the commit, not where
 * somebody reads the record). A CONSTANT: no sentence of it is made from anything that happened, so it can name no person, no chat and no key. An empty stretch of the record is not
 * "nothing happened"; it is "nothing that is listed here as recorded".
 */
export const NOT_RECORDED: readonly string[] = [
  "KEYS THE ASSISTANT MAKES ON HIS PAGE are filed as HIM: its press and its clicks on the page's key buttons reach the server on the page's own terminal socket as ordinary keys, and the record names the person signed in on that page, or the open app. A menu answered by the Assistant reads as his own Enter. The screen-driven line of the same minute names the Assistant; nothing links the two lines.",
  'Calls that a rule refused BEFORE the screen bridge (not an Assistant at all, a staff Assistant asking for more than a look, the Goals-on-phone setting, the spoken latch, the staff policy): told to the chat, not recorded here. An argument that climbs out of a path is one of them.',
  "Text put into a chat's input line through the chat box's live mirror, and messages sent through the send routes and tools: other paths, not recorded here.",
  'Keys to a chat on ANOTHER PC: this PC records that it HANDED them to the link (keys-relayed); only the PC that holds the chat knows what reached it. Keys from a member PC to a chat on this Server name the PC, not the person: the person on that PC is not carried over the link.',
  "The app and the Approvals route as SURFACES: the app's own Esc keys (for his Stop, his Cancel and live talk's Let go) are named as the app, and an answer given in Approvals as the Approvals route (approvals.jsonl says who gave it), so a line may name a surface and not a person.",
  "xterm's own replies (focus reports, answers to queries) are not people and are not recorded.",
  'Starts through paths that do not say who (the PC Control open, an order or a hand-off opening a chat, the execution switch) carry no actor: absent means "not said here", not "nobody".',
  'No retention: nothing is rotated or deleted, and this answer reads only the last 512 KB of the file, so older lines exist on disk and cannot be reached from here.',
  'It starts empty: nothing before it was built is in it.',
]

export interface Presence {
  /**
   * Keys reached chat `sid`: one line per class per actor per minute, the first time that class is seen in that minute. `chat` is asked for only when a line is written. Never
   * throws: a record that fails must never stop anybody typing.
   */
  keys(sid: string, chat: () => ChatRef, classes: readonly InputClass[], by: ChatActor): void
  /** Keys a RELAY handed to the link toward a chat on another PC (kind `keys-relayed`, never "reached"): one line per class per actor per minute, `toPc` when the relay knows it. Never throws. */
  relayed(sid: string, chat: () => ChatRef, classes: readonly InputClass[], by: ChatActor, toPc?: PresenceRef): void
  /** An Assistant drove the screen: one line per actor, tool, act and outcome per minute. Never throws. */
  screen(by: ChatActor, tool: ScreenTool, act: ScreenAct, outcome: ScreenOutcome): void
  /** Newest first. */
  list(limit?: number): PresenceEvent[]
  /** Lines that could not be written since this run started, newest first (50). */
  unrecorded(): PresenceEvent[]
  /** The lines that could not be written and have not been told yet; each is returned once. */
  news(): PresenceEvent[]
}

export function createPresence(o: { file: string; now?: () => Date; error?: (message: string) => void }): Presence {
  const real = o.now ?? (() => new Date())
  // ONE reading of the clock per call to keys(), relayed() or screen() (Agent 6's review, R8b): the "already told this minute" check and the stored `at` must agree on the minute even when the
  // clock crosses a boundary between two reads, or the next key of the same class in the new minute would be told again with the SAME `at`. These calls are synchronous, so one variable is enough.
  let tick: Date | null = null
  const now = () => tick ?? real()
  const file = createAuditFile<PresenceInput, PresenceEvent>(o.file, presenceOf, now)
  /** (what, who, class) -> the minute it was last told. Set BEFORE the write, so a file that cannot be written costs one attempt per minute, not one per key. */
  const seen = new Map<string, number>()
  const failed: PresenceEvent[] = []
  let failedCount = 0
  let told = 0

  const isNew = (key: string): boolean => {
    const minute = Math.floor(now().getTime() / 60_000)
    if (seen.get(key) === minute) return false
    seen.set(key, minute)
    if (seen.size > 4096) for (const [k, m] of seen) if (m < minute - 1) seen.delete(k)
    return true
  }
  function write(e: PresenceInput) {
    try {
      file.add(e)
    } catch (err) {
      let kept: PresenceEvent
      try {
        kept = presenceOf(e, now().toISOString())
      } catch {
        // The line itself was bad (a bug): there is nothing safe to keep but that it happened.
        o.error?.(`chat presence: a line could not be built (${err instanceof Error ? err.message : String(err)})`)
        return
      }
      failed.unshift(kept)
      failed.splice(50)
      failedCount++
      o.error?.(`chat presence: a line could not be recorded (${err instanceof Error ? err.message : String(err)}): ${describePresence(kept)}`)
    }
  }
  return {
    keys(sid, chat, classes, by) {
      try {
        tick = real()
        const who = cleanActor(by)
        for (const k of classes) if (isNew(`k|${sid}|${actorKey(who)}|${k}`)) write({ kind: 'keys-reached-terminal', chat: chat(), by: who, class: k })
      } catch (err) {
        o.error?.(`chat presence: keys could not be noted (${err instanceof Error ? err.message : String(err)})`)
      } finally {
        tick = null
      }
    },
    relayed(sid, chat, classes, by, toPc) {
      try {
        tick = real()
        const who = cleanActor(by)
        for (const k of classes) if (isNew(`r|${sid}|${actorKey(who)}|${k}`)) write({ kind: 'keys-relayed', chat: chat(), by: who, class: k, ...(toPc ? { toPc } : {}) })
      } catch (err) {
        o.error?.(`chat presence: relayed keys could not be noted (${err instanceof Error ? err.message : String(err)})`)
      } finally {
        tick = null
      }
    },
    screen(by, tool, act, outcome) {
      try {
        tick = real()
        const who = cleanActor(by)
        if (isNew(`s|${actorKey(who)}|${tool}|${act}|${outcome}`)) write({ kind: 'screen-driven', by: who, tool, act, outcome })
      } catch (err) {
        o.error?.(`chat presence: a screen call could not be noted (${err instanceof Error ? err.message : String(err)})`)
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
