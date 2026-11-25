// F-354 (Shubham: "also when we click on the hisotyr give abiliy tto add history"): a NOTE added to a goal's History from the History modal. ONE pure module for what both ends agree on: the exact request the route takes
// (POST /agentic/floors/:floorId/goals/:goalId/notes { note }), the limit of a note, and the fixed sentence of every way it can fail (never the CRM's own words, never the typed text). The CRM keeps the note as a comment
// on the goal and records it in the goal's trail (POST v1/org/goals/:id/comments), which the History shows as "Comment: <text>" (shared/goal-history.ts cuts a comment at HISTORY_COMMENT_MAX, so a note is never longer than that).
// The route is agent/agentic/index.ts noteGoalByHand; the box is src/chat/GoalHistoryModal.tsx.

import { GOAL_ADD_WORDS } from './goal-add.ts'
import { HISTORY_COMMENT_MAX } from './goal-history.ts'
import { hasVisible } from './invisible.ts'

/** The longest note: what the History can show of it. */
export const NOTE_MAX = HISTORY_COMMENT_MAX
/** The exact key of the request: nothing else is accepted. */
export const NOTE_KEYS = ['note'] as const

export interface GoalNote {
  note: string
}
export type GoalNoteChecked = { ok: true; value: GoalNote } | { ok: false }

/** The request as the route takes it: an object with exactly `note`, text that draws something, of 1 to NOTE_MAX characters once trimmed, with no NUL character. */
export function checkGoalNote(body: unknown): GoalNoteChecked {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false }
  const keys = Object.keys(body)
  if (keys.length !== 1 || keys[0] !== 'note') return { ok: false }
  const v = (body as { note?: unknown }).note
  if (typeof v !== 'string' || v.includes('\u0000')) return { ok: false }
  const t = v.trim()
  return t.length > NOTE_MAX || !hasVisible(t) ? { ok: false } : { ok: true, value: { note: t } }
}

/** The fixed sentences. `code` is what the route answers with; the page shows only these. The sign-in ones are the add form's own words. */
export const NOTE_CODES = ['note-text', 'note-signin', 'note-signin-other', 'note-not-here', 'note-gone', 'note-refused', 'note-down'] as const
export type NoteCode = (typeof NOTE_CODES)[number]
export const NOTE_WORDS: Record<NoteCode, string> = {
  'note-text': `A note needs some text, at most ${NOTE_MAX} characters. Nothing was added.`,
  'note-signin': GOAL_ADD_WORDS['goal-signin'],
  'note-signin-other': GOAL_ADD_WORDS['goal-signin-other'],
  'note-not-here': "That goal is not one of this floor's goals, so no note can be added to its history here. Nothing was added.",
  'note-gone': 'That goal is not in the CRM any more. Nothing was added.',
  'note-refused': 'The CRM did not accept that note. Nothing was added; check it and try again.',
  'note-down': "The CRM can't be reached right now. Nothing was added; try again.",
}
export const NOTE_OTHER = 'The note could not be added.'
/** An answer that does not come in time: the note may or may not be there, so the history is the place to look. */
export const NOTE_SLOW = 'The note is slow to add. Read the history again before you try again: it may already be there, and a second try could add it twice.'
export const NOTE_ADDED = 'Note added.'
/** Said beside the box (Agent 14's read): who the note is written as, and who reads it. The CRM takes no request key, so there is no way to take a note back from here. */
export const NOTE_WHO = 'The note is written in the CRM as you, and everyone who can see this goal can read it. It cannot be taken back from here.'

/** The words for a failure code the route sent, else the plain one. Never the server's own message. */
export const wordsForNote = (code: unknown): string => (typeof code === 'string' && (NOTE_CODES as readonly string[]).includes(code) ? NOTE_WORDS[code as NoteCode] : NOTE_OTHER)
