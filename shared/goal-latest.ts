import { rollUpLastAt } from './goal-progress.ts'
import { parentsOf, type TreeInput } from './goal-tree.ts'
import { compareWaitingFirst } from './goal-wait.ts'

// F-361 (Shubham: "the thing that is happening the latest should show on top"): the goals curtain's ORDER switch. Two views of the SAME goals:
//   "Latest activity" (the default): the goal with the newest sign of life first (an agent's report, the CRM's own update time, the time an agent made it), a parent taking the newest of its whole family, goals with
//     no sign of life after the active ones in the page's default order. Open goals stay above done above dropped, at every level. Nothing can be moved here (the grip, Move up / down / in / out are off, like in a search).
//   "My order": his own drag order, exactly as before. It is what the Lead's rank reads and it is never changed by looking at the other view.
// Which one is shown is a per-browser convenience (src/chat/goal-sort.ts), never a setting that matters. This file is the pure side, so the order a test pins is the order the page shows.

export type GoalSort = 'latest' | 'mine'
export const GOAL_SORTS: readonly GoalSort[] = ['latest', 'mine']
export const DEFAULT_SORT: GoalSort = 'latest'
export const SORT_WORDS: Record<GoalSort, string> = { latest: 'Latest activity', mine: 'My order' }
export const SORT_GROUP_LABEL = 'Order'
export const isGoalSort = (v: unknown): v is GoalSort => v === 'latest' || v === 'mine'
/** The one key the choice is kept under, in this browser only. */
export const SORT_KEY = 'sad-goals-sort'
/** Said under the switch while goals are sorted by latest activity (the grip and the Move buttons are not drawn). */
export const LATEST_MOVES_OFF = 'Goals are sorted by latest activity, so they cannot be moved here. Switch to My order to move them.'

const STATUS_RANK: Record<string, number> = { todo: 0, done: 1, abandoned: 2 }

/**
 * `rows` (the list the page would draw in "My order") in the order of "Latest activity": at every level open goals first, then done, then dropped; inside each, the goal whose family has the newest sign of life first
 * (`lastAt` is a goal's OWN newest sign of life in ms, or null), goals with no sign after those with one, and ties keep the incoming order. A new array: the input is never changed. A sub-goal still sits under its parent
 * when the page draws the tree from this list, so the order of a flat list is the order of every sibling group in it.
 * F-362: `waitingAt` (a goal's OWN wait, in ms, or null) puts the goals that wait for him FIRST inside each group, the newest wait first (shared/goal-wait.ts compareWaitingFirst); a parent takes the newest wait of its family,
 * so a goal with a waiting sub-goal is up there too. Without it (the default) nothing waits and the order is the plain "Latest activity".
 */
export function latestRows<T extends TreeInput & { status: string }>(rows: readonly T[], lastAt: (id: string) => number | null, waitingAt: (id: string) => number | null = () => null): T[] {
  const parents = parentsOf(rows)
  const kids = new Map<string, string[]>()
  for (const r of rows) {
    const p = parents.get(r.id) ?? null
    if (p === null) continue
    const list = kids.get(p)
    if (list) list.push(r.id)
    else kids.set(p, [r.id])
  }
  const rolled = rollUpLastAt(
    rows.map(r => r.id),
    lastAt,
    id => kids.get(id) ?? [],
  )
  const rolledWait = rollUpLastAt(
    rows.map(r => r.id),
    waitingAt,
    id => kids.get(id) ?? [],
  )
  return rows
    .map((row, index) => ({ row, index, rank: STATUS_RANK[row.status] ?? 3, lastAt: rolled.get(row.id) ?? null, waitingAt: rolledWait.get(row.id) ?? null }))
    .sort((a, b) => a.rank - b.rank || compareWaitingFirst(a, b))
    .map(x => x.row)
}
