// F-345 (Agent 14's read): limits on the chats' crm_goal_add that the paragraph's words cannot keep, now that every task he gives becomes a goal in the company's CRM by itself.
// They live in ONE place, toolFor's crm_goal_add case, and the owner's hand-add route (a person's own tap) is not counted.
//
//  1. A count per chat, keyed by the AGENT's id (it stays the same across restarts and new conversations of that agent): at most GOAL_ADD_CAP goals in GOAL_ADD_WINDOW_MS (an hour). The 21st gets a fixed
//     sentence, nothing is sent to the CRM, and it says what to do.
//  2. One backstop across ALL chats: at most GOAL_ADD_ALL_CAP goals in the same hour, with its own fixed sentence (a loop that spreads over many agents is still stopped).
//     A call that made no goal (the CRM refused it, was down, or the answer was the goal already there) gives its place back in BOTH counts, so only real new goals count. The counts are in memory: an
//     app restart gives everyone a fresh hour, which is fine for a brake against a loop.
//  3. The CRM login is the first owner's: crmGoals.add(args, origin, { userId }) refuses when the CRM on this PC is signed in as someone else (F-342 keeps another person's good login), so a goal
//     is never made AS that person, assigned to them, by a chat.

export const GOAL_ADD_CAP = 20
export const GOAL_ADD_ALL_CAP = 60
export const GOAL_ADD_WINDOW_MS = 60 * 60 * 1000

/** The fixed refusal of the 21st goal in an hour from one chat (HTTP 429). */
export const GOAL_ADD_CAP_WORDS = `This chat has already added ${GOAL_ADD_CAP} goals in the last hour, which is the most one chat may add. Nothing was added. Tell Shubham and carry on with the work; do not retry.`

/** The fixed refusal when all the chats together have added GOAL_ADD_ALL_CAP goals in the last hour (HTTP 429). */
export const GOAL_ADD_ALL_CAP_WORDS = `The chats have already added ${GOAL_ADD_ALL_CAP} goals in the last hour between them, which is the most they may add. Nothing was added. Tell Shubham and carry on with the work; do not retry.`

/** The refusal when the CRM on this PC is signed in as someone else than the first owner (HTTP 409, code crm-other-person). */
export const GOAL_ADD_OTHER_PERSON_WORDS = "The CRM on this PC is signed in as someone else than Shubham, so no goal was added. Say so once and carry on with the task; do not retry."

export type GoalAddSlot = { ok: true; undo(): void } | { ok: false; why: 'chat' | 'all' }

export interface GoalAddCap {
  /** Asks for a place for one new goal from this agent's chat; `undo` gives it back (the goal was not made). `why` says which limit refused: the chat's own is asked first. */
  take(key: string): GoalAddSlot
}

export function createGoalAddCap(o: { max?: number; allMax?: number; windowMs?: number; now?: () => number } = {}): GoalAddCap {
  const max = o.max ?? GOAL_ADD_CAP
  const allMax = o.allMax ?? GOAL_ADD_ALL_CAP
  const windowMs = o.windowMs ?? GOAL_ADD_WINDOW_MS
  const now = o.now ?? Date.now
  const held = new Map<string, Array<{ at: number }>>()
  let all: Array<{ at: number }> = []
  return {
    take(key) {
      const t = now()
      const live = (held.get(key) ?? []).filter(x => t - x.at < windowMs)
      held.set(key, live)
      all = all.filter(x => t - x.at < windowMs)
      // The chat's own limit is asked first (it is the more specific words), then the one across all chats. A refusal takes no place in either.
      if (live.length >= max) return { ok: false, why: 'chat' }
      if (all.length >= allMax) return { ok: false, why: 'all' }
      const mine = { at: t }
      live.push(mine)
      all.push(mine)
      // The map never grows with chats that stopped long ago: a key with nothing live is dropped whenever another chat asks.
      if (held.size > 64) for (const [k, v] of held) if (k !== key && v.every(x => t - x.at >= windowMs)) held.delete(k)
      return {
        ok: true,
        undo() {
          const list = held.get(key)
          const at = list ? list.indexOf(mine) : -1
          if (list && at >= 0) list.splice(at, 1)
          const inAll = all.indexOf(mine)
          if (inAll >= 0) all.splice(inAll, 1)
        },
      }
    },
  }
}
