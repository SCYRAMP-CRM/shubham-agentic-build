// F-346 / F-344b (Shubham: "the view history button also with each task"; "in the SAM CRM BE we need to add a goal history meaning what happened with the goals ... when we click a goal then modal opens show the history modal
// showing what happened with the goals"): what happened to ONE goal, read from the CRM's own trail (GET v1/org/goals/:id/activity, newest first; nothing is added to the CRM). ONE pure module: the route maps the CRM's
// rows with `mapHistory`, the page draws the result as plain text nodes. The CRM's rows hold OTHER PEOPLE'S words (names, titles, comments, labels): every text is cleaned (no invisible or direction characters, no control
// characters, one line) and capped, `metadata` is never read, an action the app does not know is "Changed something" (the raw name is never shown), and at most HISTORY_MAX events are kept.

import { INVISIBLE } from './invisible.ts'
import { PRIORITY_WORDS, STATUS_WORDS, dueDay, normalisePriority, normaliseStatus } from './goals.ts'

export const HISTORY_MAX = 100
export const HISTORY_NAME_MAX = 80
export const HISTORY_VALUE_MAX = 200
export const HISTORY_COMMENT_MAX = 500
/** The one line the page shows when there is nothing to show. */
export const HISTORY_NONE = 'No history yet.'
export const HISTORY_OLDER = 'Older changes are not shown.'

export interface HistoryEvent {
  /** The CRM's own id of the trail row (a short text, used only as a list key). */
  id: string
  /** Who did it: a person's name as the CRM has it, cleaned; "Someone" when it does not say. */
  who: string
  /** When, as an ISO time (UTC); null when the CRM's time is not one. The page shows it in local time. */
  at: string | null
  /** What happened, in plain words (a sentence of at most about 600 characters). */
  words: string
}
export interface History {
  events: HistoryEvent[]
  /** True when the CRM had more than HISTORY_MAX rows: the oldest are left out. */
  older: boolean
}

/** A character that is not text: a control character, a C1 control, or a line or paragraph separator. */
const isControl = (c: string): boolean => {
  const n = c.charCodeAt(0)
  return n < 32 || (n >= 127 && n <= 159) || n === 0x2028 || n === 0x2029
}

/** One line of text for a word of another person: invisible, direction and control characters out, one line, at most `max` characters (cut with an ellipsis). */
export function cleanText(v: unknown, max: number): string {
  const t = typeof v === 'string' ? [...v.replace(INVISIBLE, '')].map(c => (isControl(c) ? ' ' : c)).join('').replace(/\s+/g, ' ').trim() : ''
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

const NOTHING = 'nothing'
const value = (v: unknown, max = HISTORY_VALUE_MAX): string => cleanText(v, max) || NOTHING
const status = (v: unknown): string => (typeof v === 'string' && v.trim() ? STATUS_WORDS[normaliseStatus(v.trim())] : NOTHING)
const priority = (v: unknown): string => (typeof v === 'string' && v.trim() ? PRIORITY_WORDS[normalisePriority(v.trim())] : NOTHING)
const day = (v: unknown): string => (typeof v === 'string' ? (dueDay(v) ?? NOTHING) : NOTHING)

/** The words of ONE trail row; an action the app does not know is "Changed something". */
export function wordsOf(action: unknown, oldValue: unknown, newValue: unknown): string {
  switch (action) {
    case 'created':
      return 'Created the goal'
    case 'title_changed':
      return `Title: ${value(oldValue)} → ${value(newValue)}`
    case 'description_changed':
      return 'Changed the details'
    case 'status_changed':
      return `Status: ${status(oldValue)} → ${status(newValue)}`
    case 'priority_changed':
      return `Priority: ${priority(oldValue)} → ${priority(newValue)}`
    case 'due_date_changed':
      return `Due date: ${day(oldValue)} → ${day(newValue)}`
    case 'assignee_changed':
      return 'Changed who it is for'
    case 'visibility_changed':
      return typeof newValue === 'string' && /^(true|1|t)$/i.test(newValue.trim()) ? 'Switched the goal off' : 'Switched the goal on'
    case 'project_changed':
      return 'Changed the project'
    case 'scope_changed':
      return 'Changed where the goal belongs'
    case 'comment_added':
      return `Comment: ${value(newValue, HISTORY_COMMENT_MAX)}`
    case 'label_added':
      return `Label added: ${value(newValue, HISTORY_NAME_MAX)}`
    case 'label_removed':
      return `Label removed: ${value(newValue, HISTORY_NAME_MAX)}`
    case 'subgoal_added':
      return `Sub-goal added: ${value(newValue)}`
    default:
      return 'Changed something'
  }
}

const isoOf = (v: unknown): string | null => {
  if (typeof v !== 'string' || v.length > 40) return null
  const ms = Date.parse(v)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/**
 * The CRM's answer ({ activity: [...] }, or the list itself) as the history the page draws: at most HISTORY_MAX events, in the order the CRM gave (newest first), each { id, who, at, words }. A row that is not an object is
 * left out. `metadata` and every other field are never read.
 */
export function mapHistory(raw: unknown): History {
  const list = Array.isArray(raw) ? raw : raw !== null && typeof raw === 'object' && Array.isArray((raw as { activity?: unknown }).activity) ? (raw as { activity: unknown[] }).activity : []
  const events: HistoryEvent[] = []
  for (const row of list.slice(0, HISTORY_MAX)) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) continue
    const r = row as Record<string, unknown>
    events.push({
      id: cleanText(r.id, 64),
      who: cleanText(r.actorName, HISTORY_NAME_MAX) || cleanText(r.actorUsername, HISTORY_NAME_MAX) || 'Someone',
      at: isoOf(r.createdAt),
      words: wordsOf(r.action, r.oldValue, r.newValue),
    })
  }
  return { events, older: list.length > HISTORY_MAX }
}

/** The fixed sentences of a history that could not be read. `code` is what the route answers with; the page shows only these (never the CRM's own words). */
export const HISTORY_CODES = ['history-signin', 'history-signin-other', 'history-not-here', 'history-gone', 'history-down'] as const
export type HistoryCode = (typeof HISTORY_CODES)[number]
export const HISTORY_WORDS: Record<HistoryCode, string> = {
  'history-signin': 'Sign in to the app once (Settings/Devices) and try again.',
  'history-signin-other': 'The CRM on this PC is signed in as someone else. Sign in again as yourself.',
  'history-not-here': "That goal is not one of this floor's goals, so its history is not shown here.",
  'history-gone': 'That goal is not in the CRM any more.',
  'history-down': "The CRM can't be reached right now; try again.",
}
export const HISTORY_OTHER = 'The history could not be read.'
export const HISTORY_SLOW = 'The history is too slow to read. Try again.'
export const wordsForHistory = (code: unknown): string => (typeof code === 'string' && (HISTORY_CODES as readonly string[]).includes(code) ? HISTORY_WORDS[code as HistoryCode] : HISTORY_OTHER)

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * The page's own check of what the route answered (the page never trusts a shape): { events, older } with at most HISTORY_MAX events, each { id, who, at, words } of the right kinds; every text cleaned and capped
 * again. Null for anything else (the page then says "The history could not be read.", never the answer's own words).
 */
export function checkHistory(raw: unknown): History | null {
  if (!isRecord(raw) || !Array.isArray(raw.events) || typeof raw.older !== 'boolean' || raw.events.length > HISTORY_MAX) return null
  const events: HistoryEvent[] = []
  for (const e of raw.events) {
    if (!isRecord(e) || typeof e.id !== 'string' || typeof e.who !== 'string' || typeof e.words !== 'string' || !(e.at === null || typeof e.at === 'string')) return null
    events.push({ id: cleanText(e.id, 64), who: cleanText(e.who, HISTORY_NAME_MAX) || 'Someone', at: isoOf(e.at), words: cleanText(e.words, HISTORY_COMMENT_MAX + 100) || 'Changed something' })
  }
  return { events, older: raw.older }
}
