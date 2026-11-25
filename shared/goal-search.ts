// F-358 (Shubham: "gie serach also", said right after the done-checkbox ask): a SEARCH box at the top of the Alt+G goals curtain. PURE: how a typed query is cleaned, which of the goals on show it matches, and which rows stay
// on the list so the tree is still readable (a match is shown under its parents; a parent that does not match is greyed). It works on what the curtain has ALREADY loaded: no request of its own, nothing logged, nothing
// kept (the query is the box's own state). Words are other people's: they are only compared here, never drawn from here.

import { INVISIBLE } from './invisible.ts'
import { parentsOf, type TreeInput } from './goal-tree.ts'

/** The longest query: more is cut. */
export const SEARCH_MAX = 100
/** How much of a goal's details is searched (the CRM allows 5000). */
export const SEARCH_DETAILS_MAX = 5000
/** The one line the list shows when nothing matches. */
export const SEARCH_NONE = 'No goal matches. The search looks in titles and details.'
/** What the box says before anything is typed. */
export const SEARCH_PLACEHOLDER = 'Search titles and details'
/** The caption while a search is on: the moves are off (a drag among a part of the list would not mean what it says). */
export const SEARCH_MOVES_OFF = 'Moving goals is off while you search.'

const squash = (t: string): string => t.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim().toLowerCase()

/** The query as it is compared: invisible and direction characters out, one line, lower case, at most SEARCH_MAX characters. "" is no search. */
export function queryOf(raw: unknown): string {
  const t = typeof raw === 'string' ? squash(raw) : ''
  return t.length > SEARCH_MAX ? t.slice(0, SEARCH_MAX).trimEnd() : t
}

/** What is searched of one goal: its title and its details, cleaned the same way (so a hidden character cannot hide a word). */
export function haystack(title: unknown, description: unknown): string {
  const d = typeof description === 'string' ? description.slice(0, SEARCH_DETAILS_MAX) : ''
  return squash(`${typeof title === 'string' ? title : ''} ${d}`)
}

/** Does a goal match? Every word of the query is somewhere in its title or details, in any order. */
export function matches(query: string, hay: string): boolean {
  if (query === '') return true
  for (const word of query.split(' ')) if (word && !hay.includes(word)) return false
  return true
}

export interface Found {
  /** The goals that match. */
  matches: Set<string>
  /** The goals to keep on the list: the matches and every parent above them (a parent that does not match is only context). */
  shown: Set<string>
}

/** Which of `rows` match `query` and which rows to keep so each match stays under its parents. A row with no text known (`hay` has nothing for it) never matches. */
export function searchRows<T extends TreeInput>(rows: readonly T[], hay: ReadonlyMap<string, string>, query: string): Found {
  const parents = parentsOf(rows)
  const hit = new Set<string>()
  for (const r of rows) if (matches(query, hay.get(r.id) ?? '')) hit.add(r.id)
  const shown = new Set<string>(hit)
  for (const id of hit) {
    let up = parents.get(id) ?? null
    for (let i = 0; up !== null && i < 64 && !shown.has(up); i++) {
      shown.add(up)
      up = parents.get(up) ?? null
    }
  }
  return { matches: hit, shown }
}

/** "3 of 46": the matches and the goals in the view being searched. */
export const searchCount = (found: number, of: number): string => `${found} of ${of}`
