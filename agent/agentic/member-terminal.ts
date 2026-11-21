import type { Caller } from '../auth/types.ts'

// F-302 L4 (Agent 14's census; his review of Agent 3's design page, R2 and R5): what a MEMBER PC's page says about who is typing, read from the FIRST LINE of its terminal stream to the Server.
// Honest words about what this is: the member PC is a pinned, token-holding PC and it CLAIMS the person. The Server can judge the claim by its own rules (view, typing, the Server scope, where the chat runs,
// the policy-chat rule, the owner's size), per frame, but it cannot prove the claim: a member PC that is modified or controlled by someone else can claim any person, an administrator included (the same is true
// of the `http` and `tool` ops of the link today). Only a Server-issued proof of the person (Level 2) closes that; this does not.

/**
 * The owner's own unsigned page, as a caller: a MACHINE caller, the one the app itself is when it acts as the owner (auth: `machine` is an administrator). Not `OPEN` (no person, no machine): with sign-in wired that caller has no rights at all,
 * which is the right answer for an unknown page and the wrong one for the owner's own PC.
 */
const OWNER_APP: Caller = { person: null, via: 'local', sid: null, machine: true }

/** A person id is the CRM's: a UUID. Anything else is not a person the Server knows. */
const PERSON_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export type TerminalNoClaim = 'version' | 'no-person' | 'bad-person' | 'open-app-unmarked'
export type TerminalClaim =
  | { kind: 'person'; caller: Caller }
  | { kind: 'open-app'; caller: Caller }
  | { kind: 'none'; why: TerminalNoClaim }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * The claim of a terminal stream's first line: `v` exactly 2 (a future 3 is another contract), then EITHER a person (`by`: {id, username, name}; only those three are read; the id lowercased and a UUID; `canSeeAll`
 * is the Server's own admins list, never the line) OR `by: null` with `openApp: true` (sign-in is off on that PC: its page is the app's owner) accepted only from a PC the owner marked as his. Anything else is no claim:
 * the stream may look and may not type, and says why once. A missing `by` is never the owner.
 */
export function terminalClaimOf(first: Record<string, unknown>, o: { admins: readonly string[]; ownerPc: boolean }): TerminalClaim {
  if (first.v !== 2) return { kind: 'none', why: 'version' }
  const by = first.by
  if (by === null) {
    if (first.openApp !== true) return { kind: 'none', why: 'no-person' }
    return o.ownerPc ? { kind: 'open-app', caller: OWNER_APP } : { kind: 'none', why: 'open-app-unmarked' }
  }
  if (!isObj(by)) return { kind: 'none', why: 'no-person' }
  if (typeof by.id !== 'string') return { kind: 'none', why: 'bad-person' }
  const id = by.id.toLowerCase()
  if (!PERSON_ID.test(id)) return { kind: 'none', why: 'bad-person' }
  const username = typeof by.username === 'string' ? by.username.slice(0, 80) : ''
  const name = typeof by.name === 'string' ? by.name.slice(0, 120) : ''
  return { kind: 'person', caller: { person: { id, username, name, canSeeAll: o.admins.includes(id) }, via: 'local', sid: null } }
}

/** What the page is told, once, when its stream has no usable claim (the terminal page ignores a frame kind it does not know). */
export function terminalNotice(why: TerminalNoClaim): string {
  switch (why) {
    case 'version': return "This PC must update before it can type into the Server's chats; until it does this page can look but not type."
    case 'no-person': return "This page is not signed in as a person the Server can check, so it can look but not type in the Server's chats."
    case 'bad-person': return "The person this page named is not one the Server knows, so it can look but not type in the Server's chats."
    case 'open-app-unmarked': return "The Server's owner has not marked this PC as his, so its unsigned pages can look but not type in the Server's chats."
  }
}

/**
 * What a MEMBER sends in the first line of its terminal stream to the Server, from its own page's caller. A person: `by`. The app's owner with sign-in off (no person, an administrator by being the open app): `by: null` and
 * `openApp: true`. Anyone else (an unsigned stranger): `by: null` alone, which the Server reads as no claim. The claim is of the page the stream was opened for and is fixed for the stream.
 */
export function terminalClaimLine(caller: Caller, isAdmin: boolean): { v: 2; by: { id: string; username: string; name: string } | null; openApp?: true } {
  if (caller.person) return { v: 2, by: { id: caller.person.id, username: caller.person.username, name: caller.person.name } }
  return isAdmin ? { v: 2, by: null, openApp: true } : { v: 2, by: null }
}
