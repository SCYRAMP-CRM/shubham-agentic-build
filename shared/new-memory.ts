// F-332 (Shubham's order o4d57: "Yes" to reading and fixing the new memory from his phone), step 1, READ ONLY: the Memory page shows the NEW standalone memory (F-331: its own service, its own
// store, a loopback door) on HIS row. This file is what the server module (agent/agentic/memory-door.ts) and the page share, with no screen and no request in it: the answers' shapes, the error
// codes, the words for every state, the view choice ("New memory | Notes and chats") and the one rule about a scope name. Nothing here knows the door's address or its key.

/** Under the agentic mount: /agentic/memory/new/status and /agentic/memory/new/brain. */
export const NEW_MEMORY_PREFIX = '/memory/new'

// ---- the view choice on his row

export type MemoryView = 'new' | 'old'
export const VIEW_PARAM = 'view'
/** In the order they show: the new memory first (the default); the F-328 content (notes and chats, the F-051 layer) stays as the second choice. */
export const MEMORY_VIEWS: { value: MemoryView; label: string }[] = [
  { value: 'new', label: 'New memory' },
  { value: 'old', label: 'Notes and chats' },
]
/** Only "old" in the address picks the old way; anything else (nothing, junk, another case) is the new memory. */
export const parseMemoryView = (v: string | null | undefined): MemoryView => (v === 'old' ? 'old' : 'new')

// ---- what the server answers

/** What the door looks like from the app: ready; not set up here; or not answering in one of three ways. */
export type DoorState = 'ready' | 'not-connected' | 'down' | 'slow' | 'bad'
/** Why it is not connected: a fixed word each, never a path or an address. */
export type NotConnectedWhy = 'no-config' | 'bad-config' | 'address-not-allowed' | 'token-unreadable'

export interface NewMemoryStatus {
  state: DoorState
  why?: NotConnectedWhy
}

export interface NewMemoryBrain {
  markdown: string
  /** The brain's own hash of its content: it changes only when the content does. */
  etag: string
  /** The `## Scope <x>` names in the brain, as the real scope names (the brain's escapes undone). */
  scopes: string[]
}

/** The codes of the refusals (the HTTP status each goes with is the server module's). */
export const DOOR_CODES = {
  off: 'memory-door-off',
  denied: 'memory-door-denied',
  down: 'memory-door-down',
  slow: 'memory-door-slow',
  bad: 'memory-door-bad',
  scope: 'memory-door-scope',
  /** The F-051 guard's own code, the same one the old Memory routes answer: another administrator exists, so the memory is off for everybody. */
  guard: 'memory-admins',
} as const
export type DoorCode = (typeof DOOR_CODES)[keyof typeof DOOR_CODES]

// ---- a scope name (the picker asks for one; the server checks it again before anything is sent)

export const DOOR_SCOPE_MAX = 120
/** Letters, digits and `_ . - /`, not starting with a dot or a slash: a path-like name. The server module and the page use this one test. */
export function isDoorScope(s: unknown): s is string {
  return typeof s === 'string' && s.length > 0 && s.length <= DOOR_SCOPE_MAX && /^[A-Za-z0-9_-][A-Za-z0-9_./-]*$/.test(s) && !s.includes('..') && !s.includes('//') && !s.endsWith('/')
}

// ---- the words, one set per state (never the door's own text; never a path, an address or a key)

export type NewFailureKind = 'sign-in' | 'not-yours' | 'off' | 'not-connected' | 'denied' | 'down' | 'slow' | 'bad' | 'scope' | 'error'

export interface NewFailureWords {
  kind: NewFailureKind
  title: string
  text: string
  /** A second try can help. */
  retry: boolean
}

const NOT_CONNECTED_TEXT: Record<NotConnectedWhy, string> = {
  'no-config': 'This app has no address and key for it yet. The owner sets that up on the Server.',
  'bad-config': 'The setup this app has for it is not in the right shape. The owner has to fix it on the Server.',
  'address-not-allowed': 'The address set up for it is not allowed: it must be this Server’s own. The owner has to fix it on the Server.',
  'token-unreadable': 'This app cannot read its key for it. The owner has to fix that on the Server.',
}

export const SIGN_IN_WORDS: NewFailureWords = { kind: 'sign-in', title: 'Sign in to read the new memory', text: 'Sign in through CRM on this app page. The new memory is for the person signed in as the owner.', retry: false }
export const NOT_YOURS_WORDS: NewFailureWords = { kind: 'not-yours', title: 'The new memory is the first owner’s', text: 'It is not open to anybody else.', retry: false }
export const NEW_OFF_WORDS: NewFailureWords = {
  kind: 'off',
  title: 'The new memory is switched off',
  text: 'It is off for everybody while another owner (administrator) exists, because an administrator can read an owner’s chats. Nothing is lost: it comes back when that changes.',
  retry: false,
}

export function notConnectedWords(why: NotConnectedWhy | undefined): NewFailureWords {
  return { kind: 'not-connected', title: 'The new memory is not connected', text: NOT_CONNECTED_TEXT[why ?? 'no-config'] ?? NOT_CONNECTED_TEXT['no-config'], retry: false }
}

const STATE_WORDS: Record<'down' | 'slow' | 'bad', NewFailureWords> = {
  down: { kind: 'down', title: 'The new memory is not answering', text: 'It may be stopped on the Server. Try again in a moment.', retry: true },
  slow: { kind: 'slow', title: 'The new memory took too long', text: 'It did not answer in time. Try again.', retry: true },
  bad: { kind: 'bad', title: 'The new memory gave an answer this app could not read', text: 'Try again; if it keeps happening the owner has to look at it on the Server.', retry: true },
}
const DENIED_WORDS: NewFailureWords = { kind: 'denied', title: 'The new memory refused this app’s key', text: 'This is a setup problem, not yours: the owner has to fix it on the Server.', retry: false }
const SCOPE_WORDS: NewFailureWords = { kind: 'scope', title: 'That scope cannot be asked for', text: 'Pick another one from the list.', retry: false }

/** The error of a call as the page's store raises it: the status, the agent's code and its words. */
export interface CallFailure {
  status?: number
  code?: string
  message?: string
}

/** What the page says for a failed call: one sentence set per cause, from the status and the CODE (the agent's own text is never shown for a known cause). */
export function newMemoryFailure(e: CallFailure): NewFailureWords {
  if (e.status === 401) return SIGN_IN_WORDS
  if (e.status === 409 && e.code === DOOR_CODES.guard) return NEW_OFF_WORDS
  if (e.status === 409 && e.code === DOOR_CODES.off) return notConnectedWords('no-config')
  if (e.status === 403) return NOT_YOURS_WORDS
  if (e.status === 400 && e.code === DOOR_CODES.scope) return SCOPE_WORDS
  if (e.status === 502 && e.code === DOOR_CODES.denied) return DENIED_WORDS
  if (e.status === 502 && e.code === DOOR_CODES.down) return STATE_WORDS.down
  if (e.status === 504 && e.code === DOOR_CODES.slow) return STATE_WORDS.slow
  if (e.status === 502 && e.code === DOOR_CODES.bad) return STATE_WORDS.bad
  const said = (e.message ?? '').trim()
  return { kind: 'error', title: 'The new memory did not answer', text: said || 'The agent could not be reached. Try again.', retry: true }
}

/** What the status line says: null when the door is ready (the page goes on to the brain); else the words for the state. */
export function statusWords(s: NewMemoryStatus): NewFailureWords | null {
  if (s.state === 'ready') return null
  if (s.state === 'not-connected') return notConnectedWords(s.why)
  return STATE_WORDS[s.state]
}

// ---- "updated": the brain's etag changes only when its content does

export type EtagChange = 'first' | 'same' | 'updated'
export const etagChange = (before: string | null, after: string): EtagChange => (before === null ? 'first' : before === after ? 'same' : 'updated')

export const EMPTY_BRAIN_WORDS = 'Nothing is kept yet.'

/** The status line over the brain: the door answered; whether this look found something new; when. (The page gives the time already written for a person.) */
export const connectedLine = (change: EtagChange, at: string): string => (change === 'updated' ? `Connected · updated, read ${at}` : change === 'same' ? `Connected · nothing new, checked ${at}` : `Connected · read ${at}`)
