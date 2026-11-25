// F-344 (Shubham: "the nesting of goals still not available in the alt+g please add it it is essential"): the goals curtain shows a goal's sub-goals under it. PURE: the same rules as the Goals page (src/goals/nest.ts: a
// goal nests under its parent only when the parent is in the same list; never a goal under itself or its own sub-goals; at most MAX_INDENT_DEPTH levels are drawn, deeper ones stay flat at the last level), applied to
// the curtain's rows. The page keeps only what is folded (a set of goal ids) and draws; the moves in Reorder are among SIBLINGS only (a goal never changes level here: un-nesting or moving under another goal edits
// an existing goal in the CRM and is done through the chat tool crm_goal_update, never from this page).

import { capTitle } from './goal-curtain.ts'

export interface TreeInput {
  id: string
  title: string
  parentId: string | null
}

export interface TreeRow<T> {
  row: T
  /** 0 for a top-level row; 1, 2, 3 for sub-goals, never more (a deeper one is drawn at 3). */
  depth: number
  /** Every sub-goal of this row that is on the same list (children, their children, and so on): the number its count says. */
  subs: number
  /** Its direct children on the list. */
  kids: number
  /** The id of the goal it is a sub-goal of when that goal is NOT on this list (so it stays at the top level, with a caption); else null. */
  orphanOf: string | null
}

/** The most levels drawn (the Goals page's own MAX_INDENT_DEPTH). */
export const TREE_MAX_DEPTH = 3
/** The longest "under <title>" caption of a sub-goal whose parent is not on the list. */
export const ORPHAN_TITLE_MAX = 40

const cut = (t: string) => (t.length > ORPHAN_TITLE_MAX ? `${t.slice(0, ORPHAN_TITLE_MAX - 1)}…` : t)

/** Each row's parent as the curtain draws it: the row it names when that row is on the list, is not the row itself and the chain above does not come back round; else null (top level). */
export function parentsOf<T extends TreeInput>(rows: readonly T[]): Map<string, string | null> {
  const byId = new Map<string, T>(rows.map(r => [r.id, r]))
  const out = new Map<string, string | null>()
  for (const r of rows) {
    let parent: string | null = null
    if (r.parentId !== null && r.parentId !== r.id && byId.has(r.parentId)) {
      parent = r.parentId
      const seen = new Set<string>([r.id])
      for (let up: T | undefined = byId.get(r.parentId); up; up = up.parentId === null ? undefined : byId.get(up.parentId)) {
        if (seen.has(up.id)) {
          parent = null
          break
        }
        seen.add(up.id)
      }
    }
    out.set(r.id, parent)
  }
  return out
}

/**
 * The curtain's rows as a tree, in drawing order: a top-level row, then (when it is open) its sub-goals, each followed by its own, siblings in the order they have in `rows`. `open` holds the goals whose sub-goals
 * are showing; `all` shows every level (Reorder). A row whose parent is not in `rows`, or whose parent chain loops, is top level (with `orphanOf` when the parent is just not on the list).
 */
export function treeOf<T extends TreeInput>(rows: readonly T[], o: { open: ReadonlySet<string>; all?: boolean }): TreeRow<T>[] {
  const parents = parentsOf(rows)
  const onList = new Set(rows.map(r => r.id))
  const children = new Map<string, T[]>()
  const roots: T[] = []
  for (const r of rows) {
    const p = parents.get(r.id) ?? null
    if (p !== null) children.set(p, [...(children.get(p) ?? []), r])
    else roots.push(r)
  }
  const countSubs = (id: string): number => (children.get(id) ?? []).reduce((n, c) => n + 1 + countSubs(c.id), 0)
  const out: TreeRow<T>[] = []
  const walk = (r: T, depth: number) => {
    const kids = children.get(r.id) ?? []
    const orphan = r.parentId !== null && r.parentId !== r.id && !onList.has(r.parentId)
    out.push({ row: r, depth: Math.min(depth, TREE_MAX_DEPTH), subs: countSubs(r.id), kids: kids.length, orphanOf: orphan ? r.parentId : null })
    if (o.all || o.open.has(r.id)) for (const k of kids) walk(k, depth + 1)
  }
  for (const r of roots) walk(r, 0)
  return out
}

/** The caption of a sub-goal whose parent is not on the list: "under <title>" (cut), from the goals the page knows (`titleOf`), else null (the parent is not in the CRM list at all: nothing is said of it). */
export function orphanCaption(row: TreeInput, onList: ReadonlySet<string>, titleOf: (id: string) => string | null | undefined): string | null {
  if (row.parentId === null || row.parentId === row.id || onList.has(row.parentId)) return null
  // the parent's title is the CRM's own word (another person's): the same invisible and direction characters are taken out as from a row's title (capTitle), then it is cut
  const t = capTitle(titleOf(row.parentId))
  return t ? `under ${cut(t)}` : null
}

/** The siblings of a row on the list (the rows with the same drawn parent, in list order), the row included. */
export function siblingsOf<T extends TreeInput>(rows: readonly T[], id: string): T[] {
  const parents = parentsOf(rows)
  if (!parents.has(id)) return []
  const mine = parents.get(id) ?? null
  return rows.filter(r => (parents.get(r.id) ?? null) === mine)
}

/**
 * A move among siblings: the new FLAT order (the one the order route takes) when `id` moves one place up or down among its siblings. The two siblings swap the places they hold in the flat list; every other goal keeps
 * its place, so the order route and its file are unchanged. Null when there is no sibling that way (a move never changes level).
 */
export function moveAmongSiblings<T extends TreeInput>(flat: readonly string[], rows: readonly T[], id: string, by: -1 | 1): string[] | null {
  const sibs = siblingsOf(rows, id).map(r => r.id).filter(x => flat.includes(x))
  const at = sibs.indexOf(id)
  const other = sibs[at + by]
  if (at < 0 || other === undefined) return null
  const next = [...flat]
  const a = next.indexOf(id)
  const b = next.indexOf(other)
  next[a] = other
  next[b] = id
  return next
}

/** A drop BEFORE another row (or at the end, `beforeId` null): the new flat order when both are siblings, else null (a goal never changes level by a drag, and nothing changes when it lands where it was). */
export function dropAmongSiblings<T extends TreeInput>(flat: readonly string[], rows: readonly T[], id: string, beforeId: string | null): string[] | null {
  const sibs = siblingsOf(rows, id).map(r => r.id).filter(x => flat.includes(x))
  if (!sibs.includes(id)) return null
  if (beforeId !== null && !sibs.includes(beforeId)) return null
  // the siblings in their new order, put back into the places the siblings hold in the flat list
  const order = sibs.filter(x => x !== id)
  order.splice(beforeId === null ? order.length : order.indexOf(beforeId), 0, id)
  const places = sibs.map(x => flat.indexOf(x)).sort((x, y) => x - y)
  const next = [...flat]
  places.forEach((place, i) => {
    next[place] = order[i]!
  })
  return next.every((x, i) => x === flat[i]) ? null : next
}

/** The rows drawn directly under `parentId` (null: the top level), in list order. */
export function childrenOf<T extends TreeInput>(rows: readonly T[], parents: ReadonlyMap<string, string | null>, parentId: string | null): T[] {
  return rows.filter(r => (parents.get(r.id) ?? null) === parentId)
}

/** How many sub-goals of every level a row has on the list (what its count says). */
export function subCount<T extends TreeInput>(rows: readonly T[], parents: ReadonlyMap<string, string | null>, id: string): number {
  return childrenOf(rows, parents, id).reduce((n, c) => n + 1 + subCount(rows, parents, c.id), 0)
}

/** Each row's place among its siblings that are in `movable` (the goals the order route knows): its index and how many there are. A row not in `movable` has index -1. */
export function siblingPlaces<T extends TreeInput>(rows: readonly T[], movable: ReadonlySet<string>): Map<string, { index: number; count: number }> {
  const parents = parentsOf(rows)
  const out = new Map<string, { index: number; count: number }>()
  for (const parent of new Set(parents.values())) {
    const sibs = childrenOf(rows, parents, parent).filter(r => movable.has(r.id))
    for (const r of childrenOf(rows, parents, parent)) out.set(r.id, { index: sibs.findIndex(s => s.id === r.id), count: sibs.length })
  }
  return out
}
