import { GOAL_ID_RE, LINK_ID_RE } from './goal-floors.ts'
import { rankByOrderNewFirst } from './goal-order.ts'
import { assigneesOf, dueDay, normaliseStatus, normalisePriority, rankGoals, PRIORITY_WORDS, type Goal, type GoalStatus, type Member } from './goals.ts'

// F-334: what the curtain of ONE floor shows. Pure: the CRM's goals (as the Goals page reads them), the CRM's people, and the app's links (goal id -> floor id) go in; the rows of this floor, their
// counts and the two honest numbers come out. Goals are other people's words: everything here is plain text for the page to draw as text nodes, and the only cut is a length cap.

/** A title is shown at most this long (a longer one ends with an ellipsis); the page never builds an address from it. */
export const TITLE_MAX = 200
/** Who is named at most this many times in a row; more are counted ("+2"). */
export const WHO_MAX = 6

export interface CurtainRow {
  id: string
  title: string
  status: GoalStatus
  priority: string
  /** The priority as the Goals page words it ("High"). */
  priorityWord: string
  /** The due calendar day ("2026-11-28") or null. */
  due: string | null
  /** The assignees' names, owner first; "Someone" for a person the CRM did not list. */
  who: string[]
  /** How many more assignees there are than `who` shows. */
  whoMore: number
}

export interface Curtain {
  /** This floor's goals, open ones first (ranked as the Goals page ranks them), then done, then abandoned. */
  rows: CurtainRow[]
  counts: Record<GoalStatus, number>
  /** Linked to THIS floor, but the CRM no longer lists them or has them switched off: counted, never named. */
  gone: number
  /** CRM goals (switched on) that no floor made: "N older goals are not linked to any floor". A number only. */
  unlinked: number
}

/** Characters that draw nothing but can hide or reorder what is around them (a zero-width space, direction marks and overrides, isolates, the byte-order mark, invisible operators). The joiners U+200C and U+200D stay: emoji and some scripts need them. */
const INVISIBLE = /[​‎‏‪-‮⁠-⁤⁦-⁩﻿]/g

export function capTitle(title: unknown): string {
  const t = typeof title === 'string' ? title.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim() : ''
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1).trimEnd()}…` : t
}

/** A person's name as the curtain shows it: the same invisible characters stripped as from a title (a name can hide or reorder text around it too), one line, at most NAME_MAX characters; "" when nothing is left. */
export const NAME_MAX = 80
export function capName(name: unknown): string {
  const t = typeof name === 'string' ? name.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim() : ''
  return t.length > NAME_MAX ? `${t.slice(0, NAME_MAX - 1).trimEnd()}…` : t
}

const ORDER: Record<GoalStatus, number> = { todo: 0, done: 1, abandoned: 2 }

/**
 * What a floor's curtain shows. `order` is the floor's saved order (the person's own, from the app's order file): with one, the goals never placed come FIRST (the newest first: a new goal goes to the top), then the placed
 * ones in their saved order, all statuses in ONE list (a status filter then shows its goals in their relative order, so the hidden ones keep their place). Without one, the Goals page's own ranking, open goals first.
 */
export function curtainOf(goals: readonly Goal[], members: readonly Member[], links: Readonly<Record<string, string>>, floorId: string, order: readonly string[] = []): Curtain {
  const listed = new Map(goals.map(g => [g.id, g]))
  const on = goals.filter(g => !g.isDisabled)
  const here = on.filter(g => Object.hasOwn(links, g.id) && links[g.id] === floorId)
  const named = (id: string) => capName(members.find(m => m.userId === id)?.fullName) || 'Someone'
  const byDefault = rankGoals(here).sort((a, b) => ORDER[normaliseStatus(a.status)] - ORDER[normaliseStatus(b.status)])
  const ranked = order.length ? rankByOrderNewFirst(byDefault, order, g => (g.createdAt && Number.isFinite(Date.parse(g.createdAt)) ? Date.parse(g.createdAt) : null)) : byDefault
  const rows = ranked.map<CurtainRow>(g => {
    const all = assigneesOf(g)
    const priority = normalisePriority(g.priority)
    return { id: g.id, title: capTitle(g.title), status: normaliseStatus(g.status), priority, priorityWord: PRIORITY_WORDS[priority], due: dueDay(g.dueDate), who: all.slice(0, WHO_MAX).map(named), whoMore: Math.max(0, all.length - WHO_MAX) }
  })
  const counts: Record<GoalStatus, number> = { todo: 0, done: 0, abandoned: 0 }
  for (const r of rows) counts[r.status]++
  const gone = Object.entries(links).filter(([id, f]) => f === floorId && (!listed.has(id) || listed.get(id)!.isDisabled)).length
  const unlinked = on.filter(g => !Object.hasOwn(links, g.id)).length
  return { rows, counts, gone, unlinked }
}

// ---- the words, the filters and the dates of the curtain (pure; the page only draws them)

export type CurtainFailure = 'signin' | 'offline' | 'slow' | 'links' | 'other'
/** One fixed sentence per way the curtain can fail: never the CRM's own words, never an address or a key. */
export const FAILURE_WORDS: Record<CurtainFailure, string> = {
  signin: 'The CRM is not signed in on this PC.',
  offline: "The CRM can't be reached right now.",
  slow: 'The CRM took too long to answer.',
  links: 'The app could not say which goals belong to this floor.',
  other: 'The goals could not be read.',
}

/** What the page took from GET /goal-floors: only well-formed goal id -> floor id pairs; anything else is refused (null), so a wrong answer cannot put text on the page. */
export function cleanLinks(raw: unknown): Record<string, string> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const links = (raw as { links?: unknown }).links
  if (typeof links !== 'object' || links === null || Array.isArray(links)) return null
  const out: Record<string, string> = {}
  for (const [id, floor] of Object.entries(links as Record<string, unknown>)) if (GOAL_ID_RE.test(id) && typeof floor === 'string' && LINK_ID_RE.test(floor)) out[id] = floor
  return out
}

export const FILTERS = ['todo', 'done', 'abandoned'] as const
export const FILTER_WORDS: Record<GoalStatus, string> = { todo: 'Open', done: 'Done', abandoned: 'Dropped' }
/** What the curtain shows first: the open goals, or (when there are none) the first kind there is. */
export const firstFilter = (counts: Record<GoalStatus, number>): GoalStatus => FILTERS.find(f => counts[f] > 0) ?? 'todo'

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)
/** "12 older goals are not linked to any floor." A number, never a name; nothing when there are none. */
export const unlinkedLine = (n: number): string | null => (n <= 0 ? null : plural(n, '1 older goal is not linked to any floor.', `${n} older goals are not linked to any floor.`))
export const goneLine = (n: number): string | null => (n <= 0 ? null : plural(n, '1 goal of this floor is no longer in the CRM or is switched off.', `${n} goals of this floor are no longer in the CRM or are switched off.`))
export const NONE_WORDS = "No goals are connected to this floor yet. Goals this floor's chats add to the CRM show here."
export const noneIn = (filter: GoalStatus): string => `No ${FILTER_WORDS[filter].toLowerCase()} goals on this floor.`

const at = (day: string) => new Date(`${day}T12:00:00Z`)
const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...o })
/** A real calendar day. A well-shaped impossible one ("2026-99-99", "2026-02-31") is not: formatting it would throw (or move it to another day), and a throw in a render takes the whole page down. */
const realDay = (day: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(at(day).getTime()) && at(day).toISOString().startsWith(day)
/** "28 Nov" for a calendar day (the day as the CRM keeps it: no time zone shifts it); an impossible day is shown as the CRM wrote it. Never throws. */
export const dueShort = (day: string): string => (realDay(day) ? fmt({ day: 'numeric', month: 'short' }).format(at(day)) : day)
/** "Sat 28 Nov 2026"; an impossible day is shown as the CRM wrote it. Never throws. */
export const dueLong = (day: string): string => (realDay(day) ? fmt({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(at(day)).replace(',', '') : day)

// ---- the order: what the page takes from the order answer, and what it says about a move

/** One floor's saved order from GET /goal-floors: only well-formed goal ids, no repeat; anything else is "no order". */
export function cleanOrder(raw: unknown, floorId: string): string[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return []
  const orders = (raw as { orders?: unknown }).orders
  if (typeof orders !== 'object' || orders === null || Array.isArray(orders) || !Object.hasOwn(orders, floorId)) return []
  const list = (orders as Record<string, unknown>)[floorId]
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of list) {
    if (typeof id !== 'string' || !GOAL_ID_RE.test(id) || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/** What a failed save says (the order is put back as it was). Never the server's words. */
export const ORDER_FAILED = 'The order could not be saved. It is back as it was.'
/** Said to a screen reader after a move ("Moved to position 3 of 12."). */
export const movedWords = (position: number, count: number): string => `Moved to position ${position} of ${count}.`
