import { GOAL_ID_RE, LINK_ID_RE } from './goal-floors.ts'
import { mergeOrder } from './goal-order.ts'

// F-334 addendum (Shubham: "If we press the All G button, then we should also have the ability to reorder the goals"): the order a floor's goals are shown in, kept per floor in the app's own small file
// (goal-order.json, next to goal-floors.json). IDS AND POSITIONS ONLY: never a title or any word of a goal. The CRM is not touched: its Goals page and its ranking stay as they are. Pure, so a test pins every
// rule. The moves themselves (up, down, drop before) and "a filtered view keeps the hidden goals where they were" are the Goals page's own helpers (shared/goal-order.ts, F-128): one rule, used twice.

export const ORDER_VERSION = 1
/** At most this many goals are kept in order for one floor, and in all floors together. */
export const MAX_ORDER_PER_FLOOR = 2_000
export const MAX_ORDER_TOTAL = 8_000
export const MAX_ORDER_FILE_BYTES = 2_000_000
/** One request carries at most this many ids (it must stay under the usual body cap). */
export const MAX_REQUEST_IDS = 1_000

export interface GoalOrderFile {
  version: typeof ORDER_VERSION
  floors: Record<string, string[]>
}

export const emptyGoalOrder = (): GoalOrderFile => ({ version: ORDER_VERSION, floors: {} })

/** What a file says. Fail closed: a missing, odd, oversize or wrong-version file is "no order" (never a crash); a bad id, a repeat or a bad floor id is dropped; the caps hold. */
export function parseGoalOrder(text: unknown): GoalOrderFile {
  const out = emptyGoalOrder()
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_ORDER_FILE_BYTES) return out
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return out
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out
  const file = raw as { version?: unknown; floors?: unknown }
  if (file.version !== ORDER_VERSION || typeof file.floors !== 'object' || file.floors === null || Array.isArray(file.floors)) return out
  let total = 0
  for (const [floorId, list] of Object.entries(file.floors as Record<string, unknown>)) {
    if (!LINK_ID_RE.test(floorId) || !Array.isArray(list)) continue
    const seen = new Set<string>()
    const ids: string[] = []
    for (const id of list) {
      if (ids.length >= MAX_ORDER_PER_FLOOR || total >= MAX_ORDER_TOTAL) break
      if (typeof id !== 'string' || !GOAL_ID_RE.test(id) || seen.has(id)) continue
      seen.add(id)
      ids.push(id)
      total++
    }
    if (ids.length) out.floors[floorId] = ids
  }
  return out
}

export const serializeGoalOrder = (file: GoalOrderFile): string => `${JSON.stringify({ version: ORDER_VERSION, floors: file.floors })}\n`

/** What the page is sent: floor id -> goal ids in order. Ids only. */
export const ordersForWire = (file: GoalOrderFile): Record<string, string[]> => ({ ...file.floors })

export type OrderProblem = 'not-list' | 'empty' | 'too-many' | 'duplicate' | 'bad-id' | 'not-linked'

/**
 * The ids of a reorder request: a list of 1 to MAX_REQUEST_IDS goal ids, no repeat, every one linked to THIS floor (`linkedHere`). Nothing else is accepted, so a goal of another floor, one that no floor made,
 * or a made-up id can never be put in order. Returns what is wrong (never the id), or null.
 */
export function checkOrderIds(ids: unknown, linkedHere: ReadonlySet<string>): OrderProblem | null {
  if (!Array.isArray(ids)) return 'not-list'
  if (ids.length === 0) return 'empty'
  if (ids.length > MAX_REQUEST_IDS) return 'too-many'
  const seen = new Set<string>()
  for (const id of ids) {
    if (typeof id !== 'string' || !GOAL_ID_RE.test(id)) return 'bad-id'
    if (seen.has(id)) return 'duplicate'
    seen.add(id)
  }
  for (const id of ids as string[]) if (!linkedHere.has(id)) return 'not-linked'
  return null
}

/** The file with this floor's list replaced; 'full' when a cap would be passed (nothing is changed then). */
export function setFloorOrder(file: GoalOrderFile, floorId: string, order: readonly string[]): GoalOrderFile | 'full' {
  if (!LINK_ID_RE.test(floorId) || order.length > MAX_ORDER_PER_FLOOR) return 'full'
  const floors = { ...file.floors, [floorId]: [...order] }
  let total = 0
  for (const l of Object.values(floors)) total += l.length
  return total > MAX_ORDER_TOTAL ? 'full' : { version: ORDER_VERSION, floors }
}

/**
 * A reorder: `ids` are the goals the person was looking at (a filter may hide the rest), in their NEW order. The saved ids that are no longer linked to this floor are dropped; then the shown goals are put back into
 * the places the shown goals held, in the new order, and every goal that is not shown stays EXACTLY where it was (shared/goal-order.ts mergeOrder, the Goals page's rule). A shown goal never placed before is added
 * after the placed ones, and the page shows an unplaced goal first anyway (a new goal goes to the top). Returns the new file and this floor's order, or 'full'.
 */
export function reorderFloor(file: GoalOrderFile, floorId: string, ids: readonly string[], linkedHere: ReadonlySet<string>): { file: GoalOrderFile; order: string[] } | 'full' {
  const placed = (file.floors[floorId] ?? []).filter(id => linkedHere.has(id))
  const order = mergeOrder(placed, ids, ids)
  const next = setFloorOrder(file, floorId, order)
  return next === 'full' ? 'full' : { file: next, order }
}
