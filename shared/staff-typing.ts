// Orders of95c, o9ccb and ocf0e (Shubham, 16 Nov 2026): Ravi "cannot type in any chat"; his "yes" (o9ccb) and his "A" (ocf0e, the widest
// option, chosen after he was told that a chat acts with its OWNER's powers) reverse the 15 Nov staff rule (o7e6d B2, refinement2 line 53: a
// non-admin types only into their own person-assistant) for chats a person OWNS and chats shared to them as "Can type", on every PC. The old
// rule is kept as a choice (his standing rule). Who may SEE a chat, "Can view" shares, a person's Assistant (theirs alone), the app owner's
// own rights and PC control are unchanged by either choice.
//
// Where the choice comes from (Lead's call, ocf0e): NO saved choice is his decision, A (DEFAULT_STAFF_TYPING); a saved choice that cannot be
// read is a failure and falls to the restrictive side, the 15 Nov rule (OLD_STAFF_TYPING). A member PC uses the Server's choice from the
// Server's current state frame, and the 15 Nov rule while it has none.

/** Which chats a signed-in person who is not the app's owner may type into (besides their own Assistant, which they always may). */
export type StaffTypingRule =
  /** o9ccb / ocf0e, the default: a chat they own, and a chat shared to them as "Can type". */
  | 'owned-and-type-shares'
  /** The 15 Nov rule (o7e6d B2): their own Assistant only; every other chat is view only. */
  | 'own-assistant-only'

/** Where the rule above opens typing. Agent 3's narrower variant keeps the Server's own chats closed to staff. */
export type StaffTypingScope =
  /** Chats on any PC (ocf0e: what he chose). */
  | 'every-pc'
  /** Not a chat whose home is the Server: a chat on the Server runs as the Server's Windows user with full tools. */
  | 'not-on-server'

export interface StaffTyping {
  rule: StaffTypingRule
  scope: StaffTypingScope
}

/** No saved choice: what he chose (o9ccb, ocf0e "A"). */
export const DEFAULT_STAFF_TYPING: Readonly<StaffTyping> = Object.freeze({ rule: 'owned-and-type-shares', scope: 'every-pc' })

/** The 15 Nov rule: what an unreadable saved choice falls back to (the restrictive side), and what code given no choice at all uses. */
export const OLD_STAFF_TYPING: Readonly<StaffTyping> = Object.freeze({ rule: 'own-assistant-only', scope: 'every-pc' })

export const isStaffTypingRule = (v: unknown): v is StaffTypingRule => v === 'owned-and-type-shares' || v === 'own-assistant-only'
export const isStaffTypingScope = (v: unknown): v is StaffTypingScope => v === 'every-pc' || v === 'not-on-server'

/** A saved or sent choice, or null when it is not one (an object with a known rule and a known scope; other keys are not read). */
export function staffTypingOf(v: unknown): StaffTyping | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const { rule, scope } = v as Record<string, unknown>
  return isStaffTypingRule(rule) && isStaffTypingScope(scope) ? { rule, scope } : null
}

/** GET/PUT /agentic/staff-typing (the owner's only; a change only by a person signed in through CRM on the Server's own page). */
export interface StaffTypingAnswer {
  settings: StaffTyping
  /** The saved choice could not be read: the 15 Nov rule is in force until a choice is saved again. */
  unreadable?: true
}
