import type { FloorAgent } from '../../shared/agentic.ts'

// Orders of95c / o9ccb / ocf0e, Agent 3's review: a broadcast types into chats, so it goes only where its sender may type, by the ONE typing rule
// (access.mayType, with his choice in Settings › Access), never by "not view only" (which skipped his choice: under the 15 Nov rule a Can type
// share was still a target). Today the staff fence keeps every non-administrator's chat from broadcasting at all; this holds without it.

/**
 * The running chats a broadcast from chat `from` on floor `floorId` goes to: the same floor's other chats that its owner may type into now.
 * `at` is where a session is bound now (the hub's floors), `mayType` the typing rule for the broadcaster's owner.
 */
export function broadcastTargets<T>(
  running: [string, T][],
  from: string,
  floorId: string,
  at: (sessionId: string) => { floor: { id: string }; agent: FloorAgent } | null | undefined,
  mayType: (agent: FloorAgent) => boolean,
): [string, T][] {
  return running.filter(([sid]) => {
    if (sid === from) return false
    const here = at(sid)
    return !!here && here.floor.id === floorId && mayType(here.agent)
  })
}
