// F-274 + F-273 (Shubham, orders o1e3c and ob4c0, his words: "we need to solve multiple browser issue how to solve multiple browser isseu so seeing the two assistnat on smae pc loggd in with smae accoutn hwo do we sovle ths" and
// "if i have three instance of the servertail3692 open teh n i shuld be abel to controll all three from here ok that way i cna look at more thigns ok"): several windows of the app on one device, each with a short number the
// Assistant can name. A window is one PAGE of the app (one open socket to the screen bridge); the number is "Window N", the lowest free number among the pages of that device (that browser) of that person, kept for as long as
// the page lives. Used by the agent's screen bridge (agent/agentic/ui-bridge.ts), its tools (agent/agentic/tools.ts, index.ts) and the overlay's "Acting on" line.

/** The most windows of one device that are numbered. */
export const UI_WINDOW_MAX = 99

/** What a window is called, to him and to the Assistant. */
export const windowName = (n: number): string => `Window ${n}`

/**
 * The `window` argument of the screen tools: a whole number from 1 to UI_WINDOW_MAX, or the same as words ("2", "Window 2", "window2"). Anything else (a float, 0, a name, an object) is not a window: null.
 */
export function parseWindowRef(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 1 && value <= UI_WINDOW_MAX ? value : null
  if (typeof value !== 'string') return null
  const m = /^\s*(?:window\s*)?(\d{1,2})\s*$/i.exec(value)
  if (!m) return null
  const n = Number(m[1])
  return n >= 1 && n <= UI_WINDOW_MAX ? n : null
}

/** The answer when a window is named and the setting "Windows by name" is off (Settings > Assistant). Nothing was done. */
export const WINDOWS_OFF_WHY =
  'Driving a window by its number is switched off (Settings > Assistant > "Windows by name"). Nothing was done. Act on the window he is looking at, as before: leave `window` out.'

/** What the overlay says when this page is one of several windows of this device: "Window 2 of 3". */
export const windowOfWords = (n: number, of: number): string => `${windowName(n)} of ${of}`
