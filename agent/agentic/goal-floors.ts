import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { MAX_FILE_BYTES, floorOfGoal, linkGoal, linksForWire, madeForWire, parseGoalFloors, serializeGoalFloors, type GoalFloorsFile, type LinkResult } from '../../shared/goal-floors.ts'
import { writeAtomic } from '../config.ts'
import type { Logger } from '../log.ts'

// F-334 (Shubham's orders odf14, o09a5, o307d): which CRM goal was made by which floor's chat. The CRM keeps no such field and gets none; the app keeps its own small file next to its other state,
// written whole to a temp name and renamed (a reader never sees half a file). The rules (what a file may hold, first link wins, the caps) are shared/goal-floors.ts. The file holds goal ids, floor ids,
// agent ids and times, NEVER a title or any word of a goal, and nothing here logs one. A missing, odd or oversize file is "nothing linked"; a failed write never fails the tool that asked.

export const GOAL_FLOORS_FILE = 'goal-floors.json'

export interface GoalFloors {
  /** The links as the page is sent them: goal id -> floor id. Fail closed: any trouble reading is "nothing linked". */
  links(): Record<string, string>
  /** F-361: the floor this goal is linked to (the floor of the chat that made it), or null. */
  floorOf(goalId: unknown): string | null
  /** F-361: who made each goal linked to this floor, and when (ids and a time). */
  made(floorId: string): Record<string, { agentId: string; at: string }>
  /** Records that `goalId` was made by a chat of this floor and agent (first link wins). Never throws: a failure is one log line (ids only) and `write-failed`. */
  link(goalId: unknown, by: { floorId: string; agentId: string }): LinkResult | 'write-failed'
}

export function createGoalFloors(o: { dir: string; log?: Pick<Logger, 'warn'>; now?: () => number; /** Tests only: what reads the file (so a test can count the reads). */ readText?: (file: string) => string | null }): GoalFloors {
  const file = path.join(o.dir, GOAL_FLOORS_FILE)
  const now = o.now ?? Date.now

  function read(): GoalFloorsFile {
    try {
      if (o.readText) return parseGoalFloors(o.readText(file))
      if (statSync(file).size > MAX_FILE_BYTES) return parseGoalFloors(null)
      return parseGoalFloors(readFileSync(file, 'utf8'))
    } catch {
      return parseGoalFloors(null)
    }
  }

  return {
    links: () => linksForWire(read()),
    floorOf: goalId => floorOfGoal(read(), goalId),
    made: floorId => madeForWire(read(), floorId),
    link(goalId, by) {
      const id = typeof goalId === 'string' ? goalId.slice(0, 64) : '?'
      try {
        const before = read()
        const done = linkGoal(before, goalId, { floorId: by.floorId, agentId: by.agentId, at: new Date(now()).toISOString() })
        if (done.result === 'linked') writeAtomic(file, serializeGoalFloors(done.file))
        if (done.result === 'invalid' || done.result === 'full') o.log?.warn(`goal link not saved (${done.result}): goal ${id}, floor ${String(by.floorId).slice(0, 64)}`)
        return done.result
      } catch {
        // The goal exists in the CRM: the tool still answers. Ids only in the line, never a word of a goal.
        o.log?.warn(`goal link not saved (write failed): goal ${id}, floor ${String(by.floorId).slice(0, 64)}`)
        return 'write-failed'
      }
    },
  }
}
