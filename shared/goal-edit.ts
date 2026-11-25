// F-344b (Shubham's orders, folded into F-344: "add edit goals also" in the middle curtain): the "Edit goal" form inside the goals curtain. ONE pure module for what both ends agree on: the exact keys the page may send
// to PATCH /agentic/floors/:floorId/goals/:goalId, their limits (the same as adding a goal, shared/goal-add.ts), the fixed sentence of every way it can fail (never the CRM's own words, never the typed text), and the
// way the one text field of the form is made from a goal's title and details and back. The route is agent/agentic/index.ts editGoalByHand; the form is src/chat/AddGoalForm.tsx in its edit mode.

import { GOAL_ADD_WORDS, GOAL_DESCRIPTION_MAX, GOAL_PRIORITIES, GOAL_TITLE_MAX, goalFromText, type GoalPriority } from './goal-add.ts'
import { GOAL_ID_RE } from './goal-floors.ts'
import { hasVisible } from './invisible.ts'

/** The statuses the CRM keeps for a goal. */
export const GOAL_STATUSES = ['todo', 'done', 'abandoned'] as const
export type GoalEditStatus = (typeof GOAL_STATUSES)[number]
/** The exact keys of the request: nothing else is accepted (not the floor, the agent, the assignees: those are not changed from here; the parent is changed only by its own request, GoalNest, never beside these keys). */
export const GOAL_EDIT_KEYS = ['title', 'description', 'priority', 'status', 'dueDate'] as const

/**
 * What a person changed: only the keys that are there are changed. `description` "" and `dueDate` "" mean "take it away". A key that is not there is left as it is (the CRM is sent only the changes).
 */
export interface GoalEdit {
  title?: string
  description?: string
  priority?: GoalPriority
  status?: GoalEditStatus
  dueDate?: string
}

/**
 * F-353 (Shubham: "in the lat g the nesting of goals shoudl wokr on drag and drop ok"): the ONE other request the same route takes: exactly `{ parentGoalId }`, the goal this one is to be a sub-goal of, or null for the top
 * level. Never mixed with the keys above (the edit form cannot change the parent, a drag cannot change the text).
 */
export interface GoalNest {
  parentGoalId: string | null
}
/** True for a request that names `parentGoalId` at all (then it is a nesting request and nothing else). */
export const isNestBody = (body: unknown): boolean => typeof body === 'object' && body !== null && !Array.isArray(body) && Object.hasOwn(body, 'parentGoalId')
export type GoalNestChecked = { ok: true; value: GoalNest } | { ok: false }
/** The nesting request as the route takes it: an object with exactly the one key, a goal id (the CRM's own id shape) or null. */
export function checkGoalNest(body: unknown): GoalNestChecked {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false }
  const keys = Object.keys(body)
  if (keys.length !== 1 || keys[0] !== 'parentGoalId') return { ok: false }
  const v = (body as { parentGoalId?: unknown }).parentGoalId
  if (v === null) return { ok: true, value: { parentGoalId: null } }
  return typeof v === 'string' && GOAL_ID_RE.test(v) ? { ok: true, value: { parentGoalId: v } } : { ok: false }
}

/**
 * F-356 (Shubham: "no opeiton to disable goal"): the THIRD exact request the same route takes: exactly `{ disabled }` (true: switch the goal off, false: switch it on again). The CRM keeps it as a soft delete (isDisabled) and
 * records it in the goal's trail. Never mixed with the keys above or with { parentGoalId }.
 */
export interface GoalDisable {
  disabled: boolean
}
/** True for a request that names `disabled` at all (then it is a disable request and nothing else). */
export const isDisableBody = (body: unknown): boolean => typeof body === 'object' && body !== null && !Array.isArray(body) && Object.hasOwn(body, 'disabled')
export type GoalDisableChecked = { ok: true; value: GoalDisable } | { ok: false }
/** The disable request as the route takes it: an object with exactly the one key, a boolean. */
export function checkGoalDisable(body: unknown): GoalDisableChecked {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false }
  const keys = Object.keys(body)
  if (keys.length !== 1 || keys[0] !== 'disabled') return { ok: false }
  const v = (body as { disabled?: unknown }).disabled
  return typeof v === 'boolean' ? { ok: true, value: { disabled: v } } : { ok: false }
}

/** The fixed sentences. `code` is what the route answers with; the page shows only these. The sign-in and refusal ones are the add form's own words. */
export const GOAL_EDIT_CODES = ['goal-text', 'goal-signin', 'goal-signin-other', 'goal-not-here', 'goal-gone', 'goal-refused', 'goal-down', 'goal-parent-not-here', 'goal-nest-loop', 'goal-nest-deep', 'goal-nest-gone'] as const
export type GoalEditCode = (typeof GOAL_EDIT_CODES)[number]
export const GOAL_EDIT_WORDS: Record<GoalEditCode, string> = {
  'goal-text': GOAL_ADD_WORDS['goal-text'],
  'goal-signin': GOAL_ADD_WORDS['goal-signin'],
  'goal-signin-other': GOAL_ADD_WORDS['goal-signin-other'],
  'goal-not-here': "That goal is not one of this floor's goals, so it cannot be changed here. Nothing was changed.",
  'goal-gone': 'That goal is not in the CRM any more. Nothing was changed.',
  'goal-refused': 'The CRM did not accept that change. Nothing was changed; check it and try again.',
  'goal-down': "The CRM can't be reached right now. Nothing was changed; try again.",
  'goal-parent-not-here': "That goal is not one of this floor's goals, so nothing can be put under it here. Nothing was changed.",
  'goal-nest-loop': 'A goal cannot go under itself or under one of its own sub-goals. Nothing was changed.',
  'goal-nest-deep': 'That would nest the goals deeper than the curtain shows. Nothing was changed.',
  'goal-nest-gone': 'The goal to put it under is not in the CRM any more. Nothing was changed.',
}
export const GOAL_EDIT_OTHER = 'The goal could not be changed.'
export const GOAL_EDITED = 'Saved.'

/** The words for a failure code the route sent, else the plain one. Never the server's own message. */
export const wordsForGoalEdit = (code: unknown): string => (typeof code === 'string' && (GOAL_EDIT_CODES as readonly string[]).includes(code) ? GOAL_EDIT_WORDS[code as GoalEditCode] : GOAL_EDIT_OTHER)

export type GoalEditChecked = { ok: true; value: GoalEdit } | { ok: false }

/**
 * The request as the route takes it: an object with at least one of the allowed keys and nothing else, a title of 1 to 500 characters that draws something, details of at most 5000 characters ("" = none), a priority from
 * the list, a status from the list, and a due date that is a short piece of text ("" = none; the route checks it is a real day). No NUL character in any text. A null is the same as not there.
 */
export function checkGoalEdit(body: unknown): GoalEditChecked {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false }
  const b = body as Record<string, unknown>
  const keys = Object.keys(b)
  for (const k of keys) if (!(GOAL_EDIT_KEYS as readonly string[]).includes(k)) return { ok: false }
  const out: GoalEdit = {}
  const text = (v: unknown, max: number): string | null => {
    if (typeof v !== 'string' || v.includes('\u0000')) return null
    const t = v.trim()
    return t.length > max ? null : t
  }
  if (b.title !== undefined && b.title !== null) {
    const t = text(b.title, GOAL_TITLE_MAX)
    if (t === null || !hasVisible(t)) return { ok: false }
    out.title = t
  }
  if (b.description !== undefined && b.description !== null) {
    const t = text(b.description, GOAL_DESCRIPTION_MAX)
    if (t === null) return { ok: false }
    out.description = hasVisible(t) ? t : ''
  }
  if (b.dueDate !== undefined && b.dueDate !== null) {
    const t = text(b.dueDate, 20)
    if (t === null) return { ok: false }
    out.dueDate = hasVisible(t) ? t : ''
  }
  if (b.priority !== undefined && b.priority !== null) {
    if (typeof b.priority !== 'string' || !(GOAL_PRIORITIES as readonly string[]).includes(b.priority)) return { ok: false }
    out.priority = b.priority as GoalPriority
  }
  if (b.status !== undefined && b.status !== null) {
    if (typeof b.status !== 'string' || !(GOAL_STATUSES as readonly string[]).includes(b.status)) return { ok: false }
    out.status = b.status as GoalEditStatus
  }
  return Object.keys(out).length === 0 ? { ok: false } : { ok: true, value: out }
}

/**
 * The ONE text field of the edit form, made from a goal: when the details already begin with the title (a goal made here: the title is the first line of the text and the details the whole text) it is the details; else
 * the title, a blank line and the details; with no details it is the title. A person who changes nothing in the field changes neither the title nor the details.
 */
export function textOfGoal(title: string, description: string | null | undefined): string {
  const t = title.trim()
  const d = (description ?? '').trim()
  if (!d) return t
  return d.startsWith(t) ? d : `${t}\n\n${d}`
}

/**
 * What the text field changed: nothing at all when it is the text the goal already makes (`textOfGoal`); else the title (when its first line is not the title already) and the details (the whole text, or "" when it is
 * only the title). Null for a text with nothing visible (a goal needs a title). The caller adds the priority, status and due day it changed.
 */
export function editFromText(text: string, title: string, description: string | null | undefined): { title?: string; description?: string } | null {
  const made = goalFromText(text)
  if (made === null) return null
  if (text.trim() === textOfGoal(title, description)) return {}
  const details = made.description ?? ''
  return {
    ...(made.title !== title.trim() ? { title: made.title } : {}),
    ...(details !== (description ?? '').trim() ? { description: details } : {}),
  }
}
