// order oa0e8 (F-201). His words, 18 Nov 2026: "Codebase window should only occupy the space on the left not the assistant space." This is the pure part of the codebase window beside the
// Assistant: the two ways it can be drawn (a device setting, the earlier way kept), when a window opens beside the Assistant's docked pane, how far from the right edge it stops, which presses and keys
// from the pane leave it open, and the timing of its right edge while the pane slides in or out. The browser side is src/accounts/codebase-window.ts (the setting and the pane test), useDockRoom() in
// src/overlay/dock.ts (the room the pane takes and whether it is easing: the app's own frame publishes it) and CodebaseModal.tsx (the window).

/** How the window is drawn. 'beside' (the start): in the part of the screen the docked Assistant leaves, with the Assistant free to use beside it. 'over': how it was, over everything, the Assistant too. */
export type CodebaseWindowWay = 'beside' | 'over'

/** What the choice is kept under on this device (this browser). */
export const WAY_KEY = 'sad-codebase-window'

/** A stored way: only the exact word "over" is the earlier way; a new device, junk and no storage are all the new way. */
export const parseWay = (raw: string | null | undefined): CodebaseWindowWay => (raw === 'over' ? 'over' : 'beside')

const roomy = (room: number): boolean => Number.isFinite(room) && room > 0

/** Does a window that OPENS now sit beside the Assistant? Only in the new way, and only while the Assistant is a docked pane that is open (it takes room). With the pane shut, floating, a phone's sheet or maximized (no room), and in the earlier way, the window is today's: over the page. */
export const opensBeside = (way: CodebaseWindowWay, room: number): boolean => way === 'beside' && roomy(room)

/**
 * What the window remembers between renders: whether it was open, and whether it is drawn beside the pane. The way is decided when the window OPENS and kept until it shuts, because Radix gives a modal and a
 * non-modal dialog different parts: changing it while the window is up would throw the whole content away (the tab, the scroll, a half-typed field), and the window's content has forms of its own.
 */
export interface Latch {
  open: boolean
  beside: boolean
}

/** The first state. A window that is shut is decided when it opens (nextLatch); one that mounts open is decided now. */
export const firstLatch = (open: boolean, way: CodebaseWindowWay, room: number): Latch => ({ open, beside: opensBeside(way, room) })

/** The state after a render: decided again only at the moment it opens; kept through the whole time it is up, through its exit, and while it is shut. The same object when nothing changed. */
export function nextLatch(prev: Latch, open: boolean, way: CodebaseWindowWay, room: number): Latch {
  if (open === prev.open) return prev
  return { open, beside: open ? opensBeside(way, room) : prev.beside }
}

/** How far from the right edge of the screen (px) the window stops short, besides its own 16 px margin: the pane's room while the window sits beside it, nothing otherwise. */
export const windowRight = (beside: boolean, room: number): number => (beside && roomy(room) ? room : 0)

/** A press or an Esc that comes from inside the Assistant's pane leaves a window that sits beside it open (the Assistant is used while the window is up); anywhere else both close it, as they always did, and a window over the page closes on both. */
export const staysOpen = (beside: boolean, inPane: boolean): boolean => beside && inPane

export type RoomEasing = 'in' | 'out'

/**
 * The window's right edge moves with the SAME times and curve as the app's margin beside the pane (src/overlay/overlay.css, [data-overlay-dock-frame]), so it never leaves a gap beside the pane while it
 * slides in and never lies over it while it slides out. Opening is a little quicker than the 260 ms slide; closing waits 100 ms and is slower. Pinned equal to that CSS in codebase-window.test.mjs.
 */
export const ROOM_EASE = { in: { ms: 220, waitMs: 0 }, out: { ms: 280, waitMs: 100 } } as const

/** The CSS transition of the right edge (undefined: none, the edge follows at once: a drag of the pane's handle, a key step, a resized window, the reduced-motion setting). */
export function roomTransition(easing: RoomEasing | null): string | undefined {
  if (easing === null) return undefined
  const { ms, waitMs } = ROOM_EASE[easing]
  return `right ${ms}ms var(--ease-out-expo)${waitMs > 0 ? ` ${waitMs}ms` : ''}`
}
