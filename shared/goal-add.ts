// F-343 (Shubham: "can it add goals in the alt+g" / "yes please do it"): the "Add goal" form inside the goals curtain. ONE pure module for what both ends agree on: the exact keys the page may send, their limits, the
// fixed sentence of every way it can fail (never the CRM's own words, never the typed text), and the one word the app's link file keeps for a goal added by hand. The route is POST /agentic/floors/:id/goals
// (agent/agentic/index.ts addGoalByHand); the form is src/chat/AddGoalForm.tsx.

import { hasVisible } from './invisible.ts'

export const GOAL_TITLE_MAX = 500
/** F-344a (Shubham: "dont keep title and description only description, its redundant to keep title"): the form has ONE text field; the CRM needs a title, so the title is the first line of the text, at most this long. */
export const TITLE_FROM_TEXT_MAX = 120
export const GOAL_DESCRIPTION_MAX = 5000
export const GOAL_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
export type GoalPriority = (typeof GOAL_PRIORITIES)[number]
/** The exact keys of the request: nothing else is accepted. */
export const GOAL_ADD_KEYS = ['title', 'description', 'priority', 'dueDate', 'requestId', 'parentGoalId'] as const
/** A client-made id of ONE press of Save (a v4 UUID): a double tap, or a retry, is one goal. */
export const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
/**
 * The goal a person's one text field makes: the TITLE is the first line (trimmed; at most TITLE_FROM_TEXT_MAX characters, cut at a word with an ellipsis when longer), the DESCRIPTION is the whole text (left out when it
 * is the same as the title). Null for a text with nothing in it. The page and the route's own limits (a title of 500, a text of 5000) are unchanged.
 */
export function goalFromText(text: string): { title: string; description?: string } | null {
  const whole = text.trim()
  if (!hasVisible(whole)) return null
  // the first line that DRAWS something (a line of spaces and zero-width characters is skipped, so the title is never one that draws as nothing)
  const first = whole.split(/\r?\n/).find(hasVisible)!.trim()
  let title = first
  if (first.length > TITLE_FROM_TEXT_MAX) {
    const space = first.lastIndexOf(' ', TITLE_FROM_TEXT_MAX - 1)
    title = `${first.slice(0, space > TITLE_FROM_TEXT_MAX / 3 ? space : TITLE_FROM_TEXT_MAX - 1).trimEnd()}…`
  }
  return { title, ...(whole !== title ? { description: whole } : {}) }
}

/** A goal id as the CRM makes them (a UUID of any version). */
export const PARENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** What the app's link file keeps as "the agent" of a goal a person added by hand (no chat made it): a fixed word, so the file's shape and its checks stay as they are. */
export const BY_HAND = 'by-hand'

export interface GoalAdd {
  title: string
  description?: string
  priority?: GoalPriority
  dueDate?: string
  requestId: string
  /** F-344: the goal this one is a sub-goal of (a goal id, lower case); the route checks it is linked to the floor. */
  parentGoalId?: string
}

/** The fixed sentences. `code` is what the route answers with; the page shows only these. */
export const GOAL_ADD_CODES = ['goal-text', 'goal-signin', 'goal-signin-other', 'goal-parent', 'goal-refused', 'goal-down'] as const
export type GoalAddCode = (typeof GOAL_ADD_CODES)[number]
export const GOAL_ADD_WORDS: Record<GoalAddCode, string> = {
  'goal-text': `Check the goal: a title of 1 to ${GOAL_TITLE_MAX} characters, at most ${GOAL_DESCRIPTION_MAX} in the details, a real day for the due date.`,
  'goal-signin': 'Sign in to the app once (Settings/Devices) and try again.',
  'goal-signin-other': 'The CRM on this PC is signed in as someone else. Sign in again as yourself.',
  'goal-parent': "That goal is not one of this floor's goals, so it cannot have a sub-goal here. Nothing was added.",
  'goal-refused': 'The CRM did not accept that goal. Nothing was added; check it and try again.',
  'goal-down': "The CRM can't be reached right now. Nothing was added; try again.",
}
export const GOAL_ADD_OTHER = 'The goal could not be added.'
export const GOAL_ADDED = 'Added.'

/** The words for a failure code the route sent, else the plain one. Never the server's own message. */
export const wordsForGoalAdd = (code: unknown): string => (typeof code === 'string' && (GOAL_ADD_CODES as readonly string[]).includes(code) ? GOAL_ADD_WORDS[code as GoalAddCode] : GOAL_ADD_OTHER)

export type GoalAddChecked = { ok: true; value: GoalAdd } | { ok: false }

/**
 * The request as the route takes it: an object with exactly the allowed keys (an extra one is refused, so nothing but these five can reach the CRM), a title of 1 to 500 characters, a description of at most 5000
 * (empty = none), a priority from the list, a due date that is a short piece of text (the CRM module checks it is a real day), and a request id that is a v4 UUID. No NUL character in any text.
 */
export function checkGoalAdd(body: unknown): GoalAddChecked {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false }
  const b = body as Record<string, unknown>
  for (const k of Object.keys(b)) if (!(GOAL_ADD_KEYS as readonly string[]).includes(k)) return { ok: false }
  const text = (v: unknown, max: number, required: boolean): string | undefined | null => {
    if (v === undefined || v === null) return required ? null : undefined
    if (typeof v !== 'string' || v.includes('\u0000')) return null
    const t = v.trim()
    // a text with nothing that draws (spaces, zero-width characters) is no text: a title of it is refused like an empty one
    if (!t || !hasVisible(t)) return required ? null : undefined
    return t.length > max ? null : t
  }
  const title = text(b.title, GOAL_TITLE_MAX, true)
  const description = text(b.description, GOAL_DESCRIPTION_MAX, false)
  const dueDate = text(b.dueDate, 20, false)
  if (title === null || title === undefined || description === null || dueDate === null) return { ok: false }
  let priority: GoalPriority | undefined
  if (b.priority !== undefined && b.priority !== null && b.priority !== '') {
    if (typeof b.priority !== 'string' || !(GOAL_PRIORITIES as readonly string[]).includes(b.priority)) return { ok: false }
    priority = b.priority as GoalPriority
  }
  if (typeof b.requestId !== 'string' || !REQUEST_ID_RE.test(b.requestId)) return { ok: false }
  let parentGoalId: string | undefined
  if (b.parentGoalId !== undefined && b.parentGoalId !== null) {
    if (typeof b.parentGoalId !== 'string' || !PARENT_ID_RE.test(b.parentGoalId)) return { ok: false }
    parentGoalId = b.parentGoalId.toLowerCase()
  }
  return { ok: true, value: { title, ...(description !== undefined ? { description } : {}), ...(priority ? { priority } : {}), ...(dueDate !== undefined ? { dueDate } : {}), ...(parentGoalId !== undefined ? { parentGoalId } : {}), requestId: b.requestId.toLowerCase() } }
}

/** A fresh request id for ONE open form (a v4 UUID): the same id on a retry after a failure, a new one for the next goal. Works where `crypto.randomUUID` does not exist (a page not served over https). */
export function newRequestId(): string {
  const c = globalThis.crypto
  if (typeof c.randomUUID === 'function') return c.randomUUID()
  const b = new Uint8Array(16)
  c.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
