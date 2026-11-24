import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { MAX_ORDER_FILE_BYTES, checkOrderIds, ordersForWire, parseGoalOrder, reorderFloor, serializeGoalOrder } from '../../shared/floor-goal-order.ts'
import { writeAtomic } from '../config.ts'
import type { Logger } from '../log.ts'

// F-334 addendum (Shubham: "we should also have the ability to reorder the goals"): the order of a floor's goals in the Goals curtain, kept in the app's own small file next to the goal link file. Goal ids and positions
// ONLY (shared/floor-goal-order.ts holds the rules): never a title or any word of a goal, so there is none to log. Written whole to a temp name and renamed. The CRM is never touched. A missing, odd or oversize file
// is "no order"; a failed write is reported to the caller (the route says so in a fixed sentence) and nothing is half written.

export const GOAL_ORDER_FILE = 'goal-order.json'

export class GoalOrderError extends Error {
  readonly kind: 'invalid' | 'full' | 'write-failed'
  constructor(kind: GoalOrderError['kind']) {
    super(kind)
    this.kind = kind
  }
}

export interface GoalOrder {
  /** Every floor's saved order as the page is sent it: floor id -> goal ids. Fail closed: any trouble reading is "no order". */
  orders(): Record<string, string[]>
  /**
   * Puts `ids` (the goals the person was looking at, in their NEW order) into this floor's order; the goals not among them keep their place. `linkedHere` is every goal linked to THIS floor: the ids are checked against it
   * again here (so this module can never save another floor's goal), before the file is read for the change. Returns the floor's order as saved. Throws GoalOrderError.
   */
  save(floorId: string, ids: readonly string[], linkedHere: ReadonlySet<string>): string[]
}

export function createGoalOrder(o: { dir: string; log?: Pick<Logger, 'info' | 'warn'>; readText?: (file: string) => string | null }): GoalOrder {
  const file = path.join(o.dir, GOAL_ORDER_FILE)

  function read() {
    try {
      if (o.readText) return parseGoalOrder(o.readText(file))
      if (statSync(file).size > MAX_ORDER_FILE_BYTES) return parseGoalOrder(null)
      return parseGoalOrder(readFileSync(file, 'utf8'))
    } catch {
      return parseGoalOrder(null)
    }
  }

  return {
    orders: () => ordersForWire(read()),
    save(floorId, ids, linkedHere) {
      if (checkOrderIds(ids, linkedHere) !== null) throw new GoalOrderError('invalid')
      const done = reorderFloor(read(), floorId, ids, linkedHere)
      if (done === 'full') {
        o.log?.warn(`goal order not saved (full): floor ${String(floorId).slice(0, 64)}`)
        throw new GoalOrderError('full')
      }
      try {
        writeAtomic(file, serializeGoalOrder(done.file))
      } catch {
        o.log?.warn(`goal order not saved (write failed): floor ${String(floorId).slice(0, 64)}`)
        throw new GoalOrderError('write-failed')
      }
      o.log?.info(`goal order saved: floor ${String(floorId).slice(0, 64)}, ${done.order.length} goals`)
      return done.order
    },
  }
}
