// F-328 (Shubham's order o23ce), the Memory page, step 1: a sidebar with a People | Agents filter, and HIS OWN memory first. This file is the page's words and rules with no screen in them,
// so a test can hold them: the filter, the one people row, what the page says for each state (never a fake list), and the lines under the name.
//
// HIS memory is the F-051 layer of the first owner (core.md, the wiki, his floors' notes and what he said in his own chats), read through the routes the Agents page's Memory tab already uses
// (GET /agentic/memory/status, /wiki, /page, /search, and /read for "All of it" on a note or a chat turn: FIVE reading routes, no other). Nothing here asks for another person's: only the first owner has a layer (shared/memory.ts, agent/agentic/memory-people.ts), and the
// layer is OFF for everybody while a second administrator exists (the F-051 guard), which is what the "off" sentence says on the real Server today.

export type MemoryFilter = 'people' | 'agents'

/** In the order the filter shows them: People first. */
export const MEMORY_FILTERS: { value: MemoryFilter; label: string }[] = [
  { value: 'people', label: 'People' },
  { value: 'agents', label: 'Agents' },
]

export const DEFAULT_MEMORY_FILTER: MemoryFilter = 'people'

/** The address says which filter ("?filter=agents"); anything else is People. */
export const parseMemoryFilter = (v: string | null | undefined): MemoryFilter => (v === 'agents' ? 'agents' : DEFAULT_MEMORY_FILTER)

/** The address's "?who=me": a person's memory is open (on a phone the list and the memory are two screens). */
export const WHO_PARAM = 'who'
export const WHO_SELF = 'me'

/** What the Agents filter says: no list, no fake data. */
export const AGENTS_LATER = 'Agents’ memory comes next.'

/** The name the page uses when nobody is signed in (the open app is the owner's: Shubham). */
export const OPEN_APP_NAME = 'Shubham'

export interface PeopleRow {
  key: typeof WHO_SELF
  /** The CRM name of the person signed in here. */
  name: string
  /** The row's caption. */
  caption: string
}

/** Who can be listed: the person signed in here, and nobody else (their layers are not built; the agent would refuse). */
export function peopleRows(person: { name?: string | null; username?: string | null } | null): PeopleRow[] {
  const name = (person?.name ?? '').trim() || (person?.username ?? '').trim() || OPEN_APP_NAME
  return [{ key: WHO_SELF, name, caption: 'Your memory' }]
}

/** The error of a call as store.ts raises it: the agent's words, the HTTP status and the agent's code. */
export interface CallFailure {
  status?: number
  code?: string
  message?: string
}

export type FailureKind = 'off' | 'not-built' | 'not-yours' | 'old-agent' | 'error'

export interface FailureWords {
  kind: FailureKind
  title: string
  text: string
  /** A second try can help (the agent did not answer); the others are not a matter of trying again. */
  retry: boolean
}

export const OFF_WORDS: FailureWords = {
  kind: 'off',
  title: 'Your memory is switched off',
  text: 'It is off for everybody while another owner (administrator) exists, because an administrator can read an owner’s chats. Nothing is lost: it comes back when that changes.',
  retry: false,
}

export const NOT_BUILT_WORDS: FailureWords = {
  kind: 'not-built',
  title: 'Your own memory is not built yet',
  text: 'Only the first owner’s memory exists so far. Yours comes later.',
  retry: false,
}

const NOT_YOURS_WORDS: FailureWords = { kind: 'not-yours', title: 'This is not open to you', text: 'The memory is the owner’s. Ask the owner to open it to you.', retry: false }
const OLD_AGENT_WORDS: FailureWords = { kind: 'old-agent', title: 'This agent has no memory yet', text: 'It is an older build without the memory.', retry: false }

/** What the page says for a call that failed: one sentence set per cause, in plain words. */
export function failureWords(e: CallFailure): FailureWords {
  if (e.status === 409 && e.code === 'memory-admins') return OFF_WORDS
  if (e.status === 409 && e.code === 'memory-others-not-built') return NOT_BUILT_WORDS
  if (e.status === 403) return NOT_YOURS_WORDS
  if (e.status === 404) return OLD_AGENT_WORDS
  const said = (e.message ?? '').trim()
  return { kind: 'error', title: 'The memory did not answer', text: said || 'The agent could not be reached. Try again.', retry: true }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * The parts of the layer's status (shared/memory.ts MemoryStatus has them all) that these lines read. A type of its own so that this file imports none of the memory's modules: they are the
 * doors' census (agent/agentic/memory-doors.test.ts), and a page's words are not a door. A status from an older agent that leaves a part out reads as nothing.
 */
export interface StatusParts {
  live?: boolean
  index?: { notes?: number; turns?: number }
  wiki?: { pages?: number }
  runs?: readonly { state: string; endedAt: string | null }[]
}

export interface StatusLines {
  /** Whether the chats read this memory. */
  chats: string
  /** What is kept. */
  counts: string
  /** When the librarian last finished a compile (ISO), or null: never. */
  compiledAt: string | null
  /** Nothing kept at all but the always page: the page says so. */
  empty: boolean
}

/** The compile line; the page gives the way to show a time, so the words stay here. */
export const compiledLine = (at: string | null, show: (iso: string) => string): string => (at ? `Last compiled ${show(at)}` : 'Never compiled')

export const EMPTY_WORDS = 'Nothing is kept yet: no notes and no chat turns. It fills as your chats and notes are read.'

/** The lines under the name, from the layer's own status (a missing part reads as nothing, never as a number). */
export function statusLines(s: StatusParts): StatusLines {
  const notes = s.index?.notes ?? 0
  const turns = s.index?.turns ?? 0
  const pages = s.wiki?.pages ?? 0
  const done = (s.runs ?? []).find(r => r.state === 'done' && r.endedAt)
  return {
    chats: s.live ? 'Switched on for your chats: each chat reads it.' : 'Not switched on for your chats yet: they do not read it. This page shows what is kept.',
    counts: `${plural(pages, 'wiki page', 'wiki pages')} · ${plural(notes, 'note', 'notes')} · ${plural(turns, 'chat turn', 'chat turns')} kept`,
    compiledAt: done?.endedAt ?? null,
    empty: notes === 0 && turns === 0 && pages <= 1,
  }
}
