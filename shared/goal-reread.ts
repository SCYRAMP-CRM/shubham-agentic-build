// F-366 (Shubham: "now i need a refresh button in alt+G because you said you start but i dont see ..."; the Lead's answer: "on each poke re-read the goal list, DEBOUNCED ... plus the manual Refresh; no timer polling when no poke comes"): when the open
// curtain reads its goal list again BY ITSELF. A poke (the events socket's note that an agent reported on a goal of this floor; it carries no text) says something changed, so the list (the CRM's goals, the app's links, the saved order) is read again, once
// the pokes that come together have settled and never sooner than REREAD_GAP_MS after the last read of the list, whoever asked for that read (the open, Refresh, Add goal, an earlier poke). No poke, no read: there is no timer that reads. Pure: no page, no request.

/** At most one read of the list per this, for an open curtain. */
export const REREAD_GAP_MS = 30_000
/** Pokes that come within this of each other (an agent reporting on several goals) are ONE read. */
export const POKE_SETTLE_MS = 2000

/**
 * How long to wait after a poke before the list is read again: the pokes settle first, and the gap since the last read is kept. `lastReadAt` is when that read started (0: none); a clock that went back never makes it wait longer than the gap.
 */
export function rereadDelay(lastReadAt: number, pokedAt: number): number {
  const sinceLast = lastReadAt > pokedAt ? 0 : pokedAt - lastReadAt
  return Math.max(POKE_SETTLE_MS, REREAD_GAP_MS - sinceLast)
}
