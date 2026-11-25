import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { GOAL_ID_RE } from '../../shared/goal-floors.ts'
import { cleanLine, type ProgressGate } from '../../shared/goal-progress.ts'
import {
  MAX_WAIT_FILE_BYTES, agentIsWaiting, clearWait, createWaitGate, dropExpired, isWaitKind, parseWaits, serializeWaits, setWait, waitsForWire,
  type WaitEntry, type WaitResult, type WaitsWire,
} from '../../shared/goal-wait.ts'
import { writeAtomic } from '../config.ts'
import type { Logger } from '../log.ts'

// F-362 (Shubham: "... its waiting for me to say yes ive understood lets move to to next step."): the app's own small file of the goals that are WAITING FOR HIM, next to the goal-progress file. It holds TEXT
// (the agent's one cleaned line: chat text, other people's words), so it is written whole to a temp name and renamed, a missing, odd or oversize file is "nothing is waiting", and NOTHING here logs a line (a failed
// write logs ids only). Written ONLY by the goal_wait tool (set) and by his answer or his "Not waiting any more" (clear), both in index.ts; read ONLY by GET /floors/:id/goal-progress (his page), his answer route
// (which asks who waits and for what), and the heartbeat (agentIsWaiting: a chat that waits for him is not beaten). There is no way for an agent to end a wait.

export const GOAL_WAITS_FILE = 'goal-waits.json'

export interface GoalWait {
  /** The waits of this floor's goals, as the page is sent them. Fail closed: any trouble reading is "nothing is waiting". */
  forFloor(floorId: string): WaitsWire
  /** One goal's wait with its floor, or null. */
  get(goalId: unknown): WaitEntry | null
  /** The agent's own wait: `goalFloor` is the floor the goal is linked to (goal-floors), which must be the caller's own floor; `agentId` and `floorId` are the calling chat's, never the arguments'. */
  report(a: { goalId: unknown; kind: unknown; line: unknown; floorId: string; agentId: string; goalFloor: string | null }): WaitResult
  /** His answer or dismissal (index.ts asks first who he is): ends the wait. true when there was one. A failed write throws, and nothing is cleared. */
  clear(goalId: unknown): boolean
  /** Whether this agent waits for him on a goal that is still open (`isOpen` is the caller's knowledge). */
  agentIsWaiting(agentId: string, isOpen: (goalId: string) => boolean): boolean
}

export function createGoalWait(o: {
  dir: string
  log?: Pick<Logger, 'warn'>
  now?: () => number
  /** Told, with the floor id and nothing else, that something on that floor changed. */
  onChange?: (floorId: string) => void
  /** Tests only: what reads the file, and the gate. */
  readText?: (file: string) => string | null
  gate?: ProgressGate
}): GoalWait {
  const file = path.join(o.dir, GOAL_WAITS_FILE)
  const now = o.now ?? Date.now
  const gate = o.gate ?? createWaitGate({ now })

  // A wait nobody answered for WAIT_TTL_MS is not there any more (it frees its place and falls off the page); the file itself is cleaned by the next write.
  function read() {
    try {
      if (o.readText) return dropExpired(parseWaits(o.readText(file)), now())
      if (statSync(file).size > MAX_WAIT_FILE_BYTES) return parseWaits(null)
      return dropExpired(parseWaits(readFileSync(file, 'utf8')), now())
    } catch {
      return parseWaits(null)
    }
  }

  return {
    forFloor: floorId => waitsForWire(read(), floorId),
    get(goalId) {
      if (typeof goalId !== 'string' || !GOAL_ID_RE.test(goalId)) return null
      const f = read()
      return Object.hasOwn(f.waits, goalId) ? f.waits[goalId] : null
    },
    report(a) {
      if (typeof a.goalId !== 'string' || !GOAL_ID_RE.test(a.goalId)) return 'bad-goal'
      if (!isWaitKind(a.kind)) return 'bad-kind'
      const line = cleanLine(a.line)
      if (line === null) return 'bad-line'
      if (a.goalFloor === null || a.goalFloor !== a.floorId) return 'not-here'
      try {
        const done = setWait(read(), a.goalId, { floorId: a.floorId, agentId: a.agentId, kind: a.kind, line, at: new Date(now()).toISOString() })
        if (done.result === 'invalid') return 'bad-line'
        if (done.result === 'same' || done.result === 'taken' || done.result === 'too-many' || done.result === 'full') return done.result
        // The gate is asked only for a write that WOULD change the file: the same wait again is a quiet yes.
        const refused = gate.allow(a.agentId, a.goalId)
        if (refused !== null) return refused
        writeAtomic(file, serializeWaits(done.file))
        gate.record(a.agentId, a.goalId)
        o.onChange?.(a.floorId)
        return 'ok'
      } catch {
        // Ids only in the line, never a word of a wait.
        o.log?.warn(`goal wait not saved (write failed): goal ${a.goalId.slice(0, 64)}, floor ${a.floorId.slice(0, 64)}`)
        return 'write-failed'
      }
    },
    clear(goalId) {
      const before = read()
      const entry = typeof goalId === 'string' && Object.hasOwn(before.waits, goalId) ? before.waits[goalId] : null
      if (entry === null) return false
      writeAtomic(file, serializeWaits(clearWait(before, goalId)))
      o.onChange?.(entry.floorId)
      return true
    },
    agentIsWaiting: (agentId, isOpen) => agentIsWaiting(read(), agentId, isOpen),
  }
}
