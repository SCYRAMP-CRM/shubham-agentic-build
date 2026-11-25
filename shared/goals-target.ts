// F-334-1 (Shubham: "The curtain should open on top of every chat window"): WHICH curtain, and for WHICH floor. ONE pure function, used by the Alt+G key, the slim Goals button and the row in a chat window's menu,
// so the three can never disagree. A curtain has a HOST: a chat window's pane ("pane:<slot>"), or the page's floor view ("page"), which is what is left when no window is on screen.
// The floor is the floor of the agent in that window (windows hold ANY floor's agent), never the page's selected floor, unless there is no window to ask.

export type CurtainHost = 'page' | `pane:${number}`

export const paneHost = (pane: number): CurtainHost => `pane:${pane}`

/** The slot of a window host, or null for the page. */
export function paneOfHost(host: CurtainHost): number | null {
  const m = /^pane:(\d+)$/.exec(host)
  return m ? Number(m[1]) : null
}

/** A chat window with an agent in it, and the floor of that agent. */
export interface WindowFloor {
  pane: number
  floorId: string
}

/** F-344: where the goals curtain opens: 'middle' (a centred panel over the page, the default) or 'pane' (the old way: over the chat window it is about). */
export type CurtainPlace = 'middle' | 'pane'

export interface CurtainTarget {
  host: CurtainHost
  floorId: string
}

const usable = (w: WindowFloor | null | undefined): w is WindowFloor => !!w && Number.isInteger(w.pane) && w.pane >= 0 && typeof w.floorId === 'string' && w.floorId !== ''

/**
 * `pane`: a window named by the caller (the row in THAT window's menu: that window, whatever has the focus). Else `focused`: the window with the focus (the one drawn with the ring). Else the page's own floor,
 * with the curtain over the page as before: no window is on screen (another tab, a phone showing only the list) or the focused one is empty. Null when there is nothing to open on.
 */
export function curtainTargetOf(o: { focused: WindowFloor | null; pageFloorId: string | null; pane?: WindowFloor | null; place?: CurtainPlace }): CurtainTarget | null {
  const w = usable(o.pane) ? o.pane : usable(o.focused) ? o.focused : null
  // F-344: IN THE MIDDLE (the default) every target opens on the ONE page host, carrying the floor the target names: the floor of the window that has the focus (or the menu row's window), else the page's. WHICH floor is decided exactly as before.
  if (o.place === 'middle') {
    const floorId = w ? w.floorId : o.pageFloorId
    return floorId ? { host: 'page', floorId } : null
  }
  if (w) return { host: paneHost(w.pane), floorId: w.floorId }
  return o.pageFloorId ? { host: 'page', floorId: o.pageFloorId } : null
}

// ---- F-334-1 follow-up (Shubham: "when I click on the chat window it should automatically change the floor"): a chat window that gains the focus selects ITS agent's floor on the page.

/** 'follow': a window that gains the focus selects its agent's floor (the default); 'stay': the old way, only the sidebar changes the floor. */
export type FollowFloor = 'follow' | 'stay'

/**
 * The floor to select when a chat window gains the focus by a person's act (a press, Tab moving in, a pick or a drop, "Only this window"), or null to leave the page's floor alone. `windowFloorId` is the floor of the
 * agent in that window (the same floor the focused-window store publishes and `curtainTargetOf` reads). Null when: the setting is the old way; the window holds no agent; its floor is already selected (no thrash); an
 * agent is being dragged (a drag or a pick in progress changes nothing on the page); or nothing is selected on a phone's list view (no window is on screen there, so this is never asked).
 */
export function floorToFollow(o: { setting: FollowFloor; windowFloorId: string | null; selectedFloorId: string | null; dragging: boolean }): string | null {
  if (o.setting !== 'follow' || o.dragging) return null
  if (typeof o.windowFloorId !== 'string' || o.windowFloorId === '') return null
  return o.windowFloorId === o.selectedFloorId ? null : o.windowFloorId
}
