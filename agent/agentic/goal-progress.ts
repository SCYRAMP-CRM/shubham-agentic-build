import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { GOAL_ID_RE } from '../../shared/goal-floors.ts'
import { MAX_FILE_BYTES, cleanLine, createProgressGate, parseProgress, progressForWire, serializeProgress, setEntry, type ProgressGate, type ProgressWire, type ReportResult } from '../../shared/goal-progress.ts'
import { writeAtomic } from '../config.ts'
import type { Logger } from '../log.ts'

// F-361 (Shubham: "can we modifyt hte goals for floor to be more laive to see whihc agent is wokring on it and where it has reached?"): the app's own small file of WHERE EACH GOAL HAS REACHED, next to
// the two other small goal files of the app (the goal links and the curtain's order). Unlike those two it holds TEXT: the one short line an agent last reported on a goal (chat text: other people's words), cleaned and capped before it is kept
// (shared/goal-progress.ts). Written ONLY by the goal_progress tool and by the app's own fixed words after crm_goal_update (both in toolFor), read ONLY by GET /floors/:id/goal-progress (the first owner's page).
// Written whole to a temp name and renamed. The CRM is never touched. A missing, odd or oversize file is "nothing reported"; a failed write is told to the agent in a fixed sentence. NOTHING here logs a line or
// a goal's words: a failed write logs ids only. A change tells the page with a text-free poke (onChange), at most one per floor each EVENT_GAP_MS (the first at once, the last one after the pause).

export const GOAL_PROGRESS_FILE = 'goal-progress.json'
export const EVENT_GAP_MS = 2_000

export interface GoalProgress {
  /** The entries of the goals linked to this floor, as the page is sent them. Fail closed: any trouble reading is "nothing reported". */
  forFloor(floorId: string): ProgressWire
  /** The agent's own report. `goalFloor` is the floor the goal is linked to (goal-floors), which must be the caller's own floor; `agentId` and `floorId` are the calling chat's, never the arguments'. */
  report(a: { goalId: unknown; line: unknown; floorId: string; agentId: string; goalFloor: string | null }): ReportResult
  /** The app's own fixed words after an agent changed a goal. Never throws and never says no: a refusal of any kind is silent (the tool that asked has already done its work). */
  stamp(a: { goalId: unknown; line: string; floorId: string; agentId: string; goalFloor: string | null; /** 'answered' (F-362): the app's words after his answer; 'dismissed': after he ended a wait without answering. Default 'updated'. */ kind?: 'updated' | 'answered' | 'dismissed' }): void
  /** Stops a poke that is waiting. */
  close(): void
}

export function createGoalProgress(o: {
  dir: string
  log?: Pick<Logger, 'warn'>
  now?: () => number
  /** Told, with the floor id and nothing else, that something on that floor changed. */
  onChange?: (floorId: string) => void
  /** Tests only: the pause between two pokes of one floor, and what reads the file (so a test can count the reads). */
  eventGapMs?: number
  readText?: (file: string) => string | null
  gate?: ProgressGate
}): GoalProgress {
  const file = path.join(o.dir, GOAL_PROGRESS_FILE)
  const now = o.now ?? Date.now
  const gap = o.eventGapMs ?? EVENT_GAP_MS
  const gate = o.gate ?? createProgressGate({ now })
  const pokes = new Map<string, { last: number; timer: ReturnType<typeof setTimeout> | null }>()

  function read() {
    try {
      if (o.readText) return parseProgress(o.readText(file))
      if (statSync(file).size > MAX_FILE_BYTES) return parseProgress(null)
      return parseProgress(readFileSync(file, 'utf8'))
    } catch {
      return parseProgress(null)
    }
  }

  function poke(floorId: string) {
    if (!o.onChange) return
    const p = pokes.get(floorId) ?? { last: 0, timer: null }
    pokes.set(floorId, p)
    if (p.timer) return
    // The pause between two pokes is real time (the entries' own times come from `now`, which a test moves by hand).
    const wait = p.last + gap - Date.now()
    if (wait <= 0) {
      p.last = Date.now()
      o.onChange(floorId)
      return
    }
    p.timer = setTimeout(() => {
      p.timer = null
      p.last = Date.now()
      o.onChange?.(floorId)
    }, wait)
    p.timer.unref?.()
  }

  /** Writes one entry; the result says what happened. A failure logs ids only. */
  function keep(goalId: string, gateKey: string, entry: { floorId: string; agentId: string; line: string; kind: 'reported' | 'updated' | 'answered' | 'dismissed' }): ReportResult {
    try {
      const done = setEntry(read(), goalId, { ...entry, at: new Date(now()).toISOString() })
      if (done.result === 'invalid') return 'bad-line'
      if (done.result === 'same') return 'same'
      // The gate is asked only for a write that WOULD change the file: the same line again is a quiet yes, never a 429.
      const refused = gate.allow(entry.agentId, gateKey)
      if (refused !== null) return refused
      writeAtomic(file, serializeProgress(done.file))
      gate.record(entry.agentId, gateKey)
      poke(entry.floorId)
      return 'ok'
    } catch {
      // Ids only in the line, never a word of a goal or of a report.
      o.log?.warn(`goal progress not saved (write failed): goal ${goalId.slice(0, 64)}, floor ${entry.floorId.slice(0, 64)}`)
      return 'write-failed'
    }
  }

  return {
    forFloor: floorId => progressForWire(read(), floorId),
    report(a) {
      if (typeof a.goalId !== 'string' || !GOAL_ID_RE.test(a.goalId)) return 'bad-goal'
      const line = cleanLine(a.line)
      if (line === null) return 'bad-line'
      if (a.goalFloor === null || a.goalFloor !== a.floorId) return 'not-here'
      return keep(a.goalId, a.goalId, { floorId: a.floorId, agentId: a.agentId, line, kind: 'reported' })
    },
    stamp(a) {
      try {
        if (typeof a.goalId !== 'string' || !GOAL_ID_RE.test(a.goalId) || a.goalFloor === null || a.goalFloor !== a.floorId) return
        const line = cleanLine(a.line)
        // A change of the goal has its OWN place in the gap rule (a goal changed right after a report is still stamped), and shares the agent's hourly count.
        const kind = a.kind ?? 'updated'
        const key = `${a.goalId}#${kind}`
        if (line === null) return
        keep(a.goalId, key, { floorId: a.floorId, agentId: a.agentId, line, kind })
      } catch {
        // never says no
      }
    },
    close() {
      for (const p of pokes.values()) if (p.timer) clearTimeout(p.timer)
      pokes.clear()
    },
  }
}
