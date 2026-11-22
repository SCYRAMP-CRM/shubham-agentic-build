import { AGENT_API_PREFIX } from './agent-api.ts'

// F-310 (his order oa0fe: the floating card on his phone opens slowly): what the card's page does at its very start, before the app's code has even arrived. index.html's own small script (it is a classic
// script, so it cannot import this file: the values below are pinned against it by src/panel/card-speed-wiring.test.mjs, which also runs it) does three things only on the card's address:
//   1. SHEET: sizes a plain skeleton of the card from what the card kept last time (the last key written, then its mode and share), so the card is on screen the moment the HTML and its stylesheet are in, not
//      after the whole app has been loaded and he has been asked who he is. The real card takes its place at the same size.
//   2. AUTH: asks the agent who this browser is (GET /agent-api/auth/status, the very request the page's own sign-in check makes) at once, and keeps the answer for the page's first check to take: one round trip
//      less on the way to the first drawn card. Taken once, and only when still fresh; otherwise the page asks as it always did.
//   3. PRELOAD: starts fetching the card's own chunks (the build lists them in #panel-preload) while the app's entry is still loading, instead of after it has run.

/** The key the card writes whenever it keeps a view (src/panel/panel-view.ts): which of the per-person keys was used last, so the first paint of the next open can size the skeleton before it knows who is signed in. */
export const PANEL_LAST_KEY = 'sad-panel-last-key'
/** The keys the card keeps its view under (shared/panel-view.ts panelKey): the last-key pointer is only believed when it points at one of these. */
export const PANEL_VIEW_PREFIX = 'sad-panel-view:'
/** What the start script asks, and what src/auth/session.ts takes the answer for: the sign-in check's own address. */
export const EARLY_AUTH_PATH = `${AGENT_API_PREFIX}/auth/status`
/** An early answer older than this (ms since the page's time origin) is not used: the page asks again. */
export const EARLY_AUTH_MAX_AGE_MS = 15_000
/** The element the build puts the card's own chunk files in (a JSON list of paths), and the one `window` field the start script keeps its early request in. */
export const PANEL_PRELOAD_ID = 'panel-preload'

export interface EarlyAuth {
  /** The pending response of GET EARLY_AUTH_PATH. */
  auth: Promise<Response>
  /** performance.now() when it was asked. */
  at: number
}
export interface EarlyHolder {
  __sadEarly?: EarlyAuth
}

/** The early sign-in answer, once: it is taken off `holder` whether it is used or not, and used only when it is still fresh (`now` is performance.now()). */
export function takeEarlyAuth(holder: EarlyHolder, now: number): Promise<Response> | null {
  const early = holder.__sadEarly
  delete holder.__sadEarly
  if (!early || typeof early.at !== 'number' || !(now >= early.at) || now - early.at > EARLY_AUTH_MAX_AGE_MS) return null
  return early.auth && typeof (early.auth as { then?: unknown }).then === 'function' ? early.auth : null
}

/**
 * The files the build lists for the card to fetch early, as the page reads them: only JavaScript files directly under /assets/ (a plain name: no other slash, no colon, no query), at most 40; anything
 * else in the list is dropped. (The start script in index.html applies the same rule: src/panel/card-speed-wiring.test.mjs runs it against this one.)
 */
export function preloadList(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(v)) return []
  return v.filter((p): p is string => typeof p === 'string' && /^\/assets\/[A-Za-z0-9._-]+\.js$/.test(p)).slice(0, 40)
}
