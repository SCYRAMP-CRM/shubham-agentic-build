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
  /** F-333: the text of an add is refused before anything is sent (empty, too long, a bad request id, a key the browser may not send). */
  text: 'memory-door-text',
  /** F-333: the memory's own secret policy refused the text (the owner set it to refuse). */
  refused: 'memory-door-refused',
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

export type NewFailureKind = 'sign-in' | 'not-yours' | 'off' | 'not-connected' | 'denied' | 'down' | 'slow' | 'bad' | 'scope' | 'text' | 'refused' | 'error'

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
const TEXT_WORDS: NewFailureWords = { kind: 'text', title: 'That could not be saved', text: 'Check the text and try again.', retry: false }
const REFUSED_WORDS: NewFailureWords = { kind: 'refused', title: 'The new memory refused this text', text: 'Its own rules about secrets do not keep text like this. Nothing was saved.', retry: false }
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
  if (e.status === 400 && e.code === DOOR_CODES.text) return TEXT_WORDS
  if (e.status === 422 && e.code === DOOR_CODES.refused) return REFUSED_WORDS
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

// ============================================================================================================================================================================================
// F-333 (Shubham's order ofa0b: "add button add memory in the each people"): ADD ONLY, into the NEW memory. The browser sends ONLY { text, requestId }; the scope, the subject, the predicate and the source are built
// ON THE SERVER from the signed-in person with the PURE functions below (so a test can pin every one), never typed, never sent. One fact per add, with a UNIQUE predicate per add: a predicate the memory does not
// know is cardinality "one" (facts.mjs), so a fixed predicate like "note" would SUPERSEDE his first memory with his second; a unique one can never clash, and nothing depends on a one-time defineAttribute.
// ============================================================================================================================================================================================

/** The memory's own cap on a body (records.mjs: 20000); the page and the server use this one number. */
export const NEW_MEMORY_ADD_MAX = 20000
/** The page shows a counter from here. */
export const NEW_MEMORY_ADD_COUNT_FROM = 18000
/** The route's body: exactly these two keys. */
export const ADD_KEYS = ['text', 'requestId'] as const
export const SAVED_LINE = 'Saved to the new memory.'

export type AddProblem = 'empty' | 'too-long' | 'nul' | 'not-text'

/** What is wrong with a typed text, or null. The same function runs on the page (before sending) and on the server (before anything is sent to the door). */
export function addTextProblem(text: unknown): AddProblem | null {
  if (typeof text !== 'string') return 'not-text'
  if (text.includes('\u0000')) return 'nul'
  if (!text.trim()) return 'empty'
  if (text.length > NEW_MEMORY_ADD_MAX) return 'too-long'
  return null
}

export const ADD_PROBLEM_WORDS: Record<AddProblem, string> = {
  empty: 'Write something first.',
  'too-long': `That is too long: at most ${NEW_MEMORY_ADD_MAX} characters.`,
  nul: 'That text has a character the memory cannot keep.',
  'not-text': 'Write something first.',
}

/** A client-made id for ONE dialog: one tap, one record, however many times Save is pressed or retried. */
export const isRequestId = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

/** What the route answers: the new record's id and the scope it went into (a scope NAME, never a word of the text). */
export interface NewMemoryAdded {
  ok: true
  id: number
  scope: string
}

/** The person an add is for, as the server knows them (the CRM row): never from the browser. */
export interface AddPerson {
  id: string
  name?: string | null
  username?: string | null
}

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** `shubham-bhole`: the name, accents folded, anything but letters and digits a hyphen, at most 60; with nothing left, `person-<first 8 of the id>`. */
export function personSlug(p: AddPerson): string {
  const make = (s: string | null | undefined) => fold(String(s ?? '')).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/g, '')
  return make(p.name) || make(p.username) || `person-${String(p.id).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'unknown'}`
}

/** The scope of a person's memories: `people/shubham-bhole` (a path-like name the door accepts). */
export const personScope = (p: AddPerson): string => `people/${personSlug(p)}`

/** The subject of an add: the person's name (the door allows 300), else their username, else a plain word. */
export function personSubject(p: AddPerson): string {
  const name = String(p.name ?? '').replace(/\s+/g, ' ').trim() || String(p.username ?? '').replace(/\s+/g, ' ').trim() || `person ${String(p.id).slice(0, 8)}`
  return name.slice(0, 300)
}

const pad = (n: number, w: number) => String(n).padStart(w, '0')

/** `note-20261124-130501-123`: UTC, to the millisecond (at most 100 characters: the door's limit); unique per add. */
export function notePredicate(at: Date): string {
  return `note-${pad(at.getUTCFullYear(), 4)}${pad(at.getUTCMonth() + 1, 2)}${pad(at.getUTCDate(), 2)}-${pad(at.getUTCHours(), 2)}${pad(at.getUTCMinutes(), 2)}${pad(at.getUTCSeconds(), 2)}-${pad(at.getUTCMilliseconds(), 3)}`
}

/** Where an add says it came from: a person, on the Memory page (the door finds or makes the source by kind and ref). */
export const addSource = (name: string) => ({ kind: 'person' as const, ref: 'memory-page', title: `added by ${name.slice(0, 120)} on the Memory page`, weight: 1 })

/** The ONE input the server sends to the door for an add: exactly these five keys, all built here. The body is the text as typed. */
export function addFactInput(p: AddPerson, text: string, at: Date) {
  const subject = personSubject(p)
  return { scope: personScope(p), subject, predicate: notePredicate(at), body: text, source: addSource(subject) }
}
export type AddFactInput = ReturnType<typeof addFactInput>
