// F-308 (his order o8f16: "Take the full page instead of the half page and introduce the whole assistant ... Give Maximize and Minimize buttons. In Minimize it will give us an option to resize it according to the
// screen. When I open it it will open at the same size. If it was maximized (the whole screen), it will open on the whole screen."). The phone app's card (src/panel/, the F-305 route /assistant-panel) is the whole
// Assistant now, in one of two modes: Minimize, the sheet at the bottom of the window, whose height he sets by dragging its top edge, and Maximize, the whole window. What is kept is the mode and the height as a FRACTION
// of the window (so the keyboard and a turn of the phone keep the proportion). This file is everything of it that needs no browser, so it is tested by tables (shared/panel-view.test.ts): the bounds, the drag, the keys,
// what is read back from storage, the key it is kept under and the words of the button.

export type PanelMode = 'min' | 'max'
export interface PanelView {
  mode: PanelMode
  /** The sheet's height as a fraction of the window, in Minimize (kept in Maximize too, for when he goes back). */
  h: number
}

/** Never smaller than this share of the window, nor larger than this (the top of the page stays his transparent tap). */
export const PANEL_H_MIN = 0.35
export const PANEL_H_MAX = 0.92
/** The first open and a double tap: about 72% of the window, as the card was before this (F-305). */
export const PANEL_H_DEFAULT = 0.72
/** Never under 360 px, whatever the share says (a short window gets the whole window). */
export const PANEL_MIN_PX = 360
export const DEFAULT_VIEW: PanelView = { mode: 'min', h: PANEL_H_DEFAULT }

/** An arrow key moves the edge this far (a share of the window); with Shift, this far. */
export const KEY_STEP = 0.04
export const KEY_STEP_LARGE = 0.12

/** A share inside the fixed bounds (not knowing the window): what is stored and read back. */
export const clampHeight = (h: number): number => (Number.isFinite(h) ? Math.min(PANEL_H_MAX, Math.max(PANEL_H_MIN, h)) : PANEL_H_DEFAULT)

/**
 * The bounds for a window `windowH` px tall: the lower is the larger of 35% and 360 px (and never more than the window itself: a window shorter than 360 px gets the whole window, so Minimize and Maximize
 * look the same there), the upper is 92% (or the lower, when that is more).
 */
export function hBounds(windowH: number): { lower: number; upper: number } {
  if (!Number.isFinite(windowH) || windowH <= 0) return { lower: PANEL_H_MIN, upper: PANEL_H_MAX }
  const lower = Math.min(1, Math.max(PANEL_H_MIN, PANEL_MIN_PX / windowH))
  return { lower, upper: Math.max(lower, PANEL_H_MAX) }
}

/** A share inside the bounds of THIS window. */
export function fitHeight(h: number, windowH: number): number {
  const { lower, upper } = hBounds(windowH)
  const v = Number.isFinite(h) ? h : PANEL_H_DEFAULT
  return Math.min(upper, Math.max(lower, v))
}

/** The sheet's height while its top edge is dragged: the finger went from `startY` to `y` (up is taller), the sheet started at share `startH` of a window `windowH` tall. */
export function dragHeight(startH: number, startY: number, y: number, windowH: number): number {
  if (!(windowH > 0)) return clampHeight(startH)
  return fitHeight((startH * windowH + (startY - y)) / windowH, windowH)
}

/** What a key does on the edge (a horizontal separator: up is taller; Home the smallest, End the tallest, Enter the usual 72%); null for any other key. */
export function heightAfterKey(h: number, key: string, shift: boolean, windowH: number): number | null {
  const step = shift ? KEY_STEP_LARGE : KEY_STEP
  const { lower, upper } = hBounds(windowH)
  switch (key) {
    case 'ArrowUp':
      return fitHeight(h + step, windowH)
    case 'ArrowDown':
      return fitHeight(h - step, windowH)
    case 'Home':
      return lower
    case 'End':
      return upper
    case 'Enter':
      return fitHeight(PANEL_H_DEFAULT, windowH)
    default:
      return null
  }
}

/** The CSS height of the sheet in Minimize: the share of the window, never under 360 px and never over the window (dvh follows the keyboard: the window resizes). */
export const heightCss = (h: number): string => `min(100dvh, max(${Math.round(clampHeight(h) * 1000) / 10}dvh, ${PANEL_MIN_PX}px))`

// --- what is kept -----------------------------------------------------------------------------------------------------------------------------------------

/** The page's storage key: per person (their id), or 'open' while the app is open without sign-in: a browser two people use keeps two sizes. */
export const panelKey = (personId: string | null | undefined): string => `sad-panel-view:${typeof personId === 'string' && personId.trim() ? personId.trim().toLowerCase() : 'open'}`

/** What is read back: anything that is not a well-formed view is the first-open view (Minimize at 72%); a share outside the bounds is brought inside; only 'max' is Maximize. */
export function parseView(raw: unknown): PanelView {
  if (typeof raw !== 'string') return { ...DEFAULT_VIEW }
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return { ...DEFAULT_VIEW }
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return { ...DEFAULT_VIEW }
  const r = v as Record<string, unknown>
  return { mode: r.mode === 'max' ? 'max' : 'min', h: typeof r.h === 'number' ? clampHeight(r.h) : PANEL_H_DEFAULT }
}

/** What is written: the mode and the share (three decimals). */
export const serializeView = (v: PanelView): string => JSON.stringify({ mode: v.mode === 'max' ? 'max' : 'min', h: Math.round(clampHeight(v.h) * 1000) / 1000 })

// --- the button -------------------------------------------------------------------------------------------------------------------------------------------

export const nextMode = (m: PanelMode): PanelMode => (m === 'max' ? 'min' : 'max')

/** What the Maximize / Minimize button is called (a screen reader's name, and the tooltip): it says what a press does. */
export function panelModeWords(mode: PanelMode): { label: string; title: string } {
  return mode === 'max' ? { label: 'Minimize the Assistant', title: 'Minimize' } : { label: 'Maximize the Assistant', title: 'Maximize' }
}
