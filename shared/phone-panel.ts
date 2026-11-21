// F-305 (his order of763: a floating Assistant button on his Android phone, over other apps). The phone app (mobile/agentic) draws the button and, on a tap, a translucent panel screen whose
// WebView loads THIS page from the Server: /assistant-panel?from=app-panel[&talk=1], on the app's own sign-in and storage. Agent 6 wrote the contract (C:/saw/f305-compact-route-contract.md); this
// file is the part of it that needs no browser, so it is tested by tables (shared/phone-panel.test.ts): which address is the panel, what the page says to the app, who may see the panel,
// and what a close does when the app's channel is there, is on its way, or is not there at all.

/** The panel's address (a page of the web app, outside its shell, its router and its sign-in screen: src/panel/). */
export const PANEL_ROUTE = '/assistant-panel'
/** The one query value that says the page was opened by the app's panel. */
export const PANEL_FROM = 'app-panel'
/** What the app lists in SadApp.info.can when it can show the panel (an older app does not). */
export const PHONE_PANEL_CAN = 'panel'

export type PanelEntry = 'app' | 'panel' | 'redirect'

/**
 * What main.tsx does with an address, before anything of the app is made: 'panel' (the panel's own small root), 'redirect' (the panel's address without `from=app-panel`: a desktop browser
 * never lands on it, it goes to the app's start), or 'app' (every other address: the app, exactly as before).
 */
export function panelEntry(pathname: string, search: string): PanelEntry {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  if (path !== PANEL_ROUTE) return 'app'
  return new URLSearchParams(search).get('from') === PANEL_FROM ? 'panel' : 'redirect'
}

/** `talk=1` on the address: Talk starts once when the chat is ready, and only at the page's load (the app loads a fresh page on every open). */
export const wantsTalk = (search: string): boolean => new URLSearchParams(search).get('talk') === '1'

// --- what the page says to the app (page to app only, in this first version) ---------------------------------------------------------------------

export type PanelMessage = { t: 'panel'; op: 'close' } | { t: 'panel'; op: 'open-app'; path?: string }

const MAX_PATH = 2000
/** A control character (a tab or a newline can hide a "/" from a reader and be dropped by a URL parser: "/\t/host" becomes "//host"). */
const hasControl = (s: string): boolean => {
  for (const ch of s) {
    const c = ch.charCodeAt(0)
    if (c < 0x20 || c === 0x7f) return true
  }
  return false
}

/**
 * A path of THIS server's origin and nothing else (the app checks it again and treats anything else as no path): it starts with one "/" (never "//"), has no backslash and no control
 * character, and resolves against an origin of its own to that origin.
 */
export function sameOriginPath(v: unknown): string | null {
  if (typeof v !== 'string' || v.length === 0 || v.length > MAX_PATH) return null
  if (!v.startsWith('/') || v.startsWith('//') || v.includes('\\') || hasControl(v)) return null
  try {
    const u = new URL(v, 'http://app.invalid')
    return u.origin === 'http://app.invalid' ? v : null
  } catch {
    return null
  }
}

export const closeMessage = (): PanelMessage => ({ t: 'panel', op: 'close' })
/** "Open in app", and the not-signed-in button: the app closes the panel and brings itself forward (to `path` when it is a path of this origin). */
export function openAppMessage(path?: unknown): PanelMessage {
  const p = sameOriginPath(path)
  return p ? { t: 'panel', op: 'open-app', path: p } : { t: 'panel', op: 'open-app' }
}

// --- the app's channel ----------------------------------------------------------------------------------------------------------------------------

/** The part of the app's channel the page uses: window.SadApp.panel (the app's start script makes it only for a page the panel opened). */
export interface PanelChannel {
  send(o: unknown): void
}

/** The channel of a SadApp object, or null when it has none (a desktop browser, an older app, a hello that has not come yet). */
export function panelChannel(app: unknown): PanelChannel | null {
  if (typeof app !== 'object' || app === null) return null
  const p = (app as { panel?: unknown }).panel
  return typeof p === 'object' && p !== null && typeof (p as { send?: unknown }).send === 'function' ? (p as PanelChannel) : null
}

/** How long after the page loaded the app's hello may still be on its way (it comes "a moment after the page loads"): a tap before then waits for it, a tap after then does not. */
export const HELLO_GRACE_MS = 3000
/** How much of the grace is left `sinceLoadMs` after the page loaded (0 when it is over). */
export const graceLeft = (sinceLoadMs: number): number => Math.max(0, HELLO_GRACE_MS - Math.max(0, sinceLoadMs))

/**
 * F-305 (Agent 14's review of the route, D): whether Talk may start by itself on load. `talk=1` is only an address, and a same-origin link can open it in the app's MAIN WebView, where the microphone is already granted and no
 * panel was opened: Talk then would start listening without anyone having asked. The page the app's panel opened is the only one the app gives window.SadApp.panel (mobile PageBridge: the panel has its own start script with the
 * panel channel, the app's own has none), so Talk starts on load only when the address asked for it AND that channel is there. Read again at each look (the app's hello comes a moment after the page loads).
 */
export const talkMayStart = (wanted: boolean, app: unknown): boolean => wanted && panelChannel(app) !== null

/**
 * F-308 (Agent 14's review, F308-1): whether a link the card drew would take the card's WebView AWAY FROM THE CARD. The app's panel lets a top-level navigation to its own server's origin load INSIDE its WebView
 * (mobile core/Links.kt: the same origin is INSIDE, any other http(s) address goes to the phone's browser, the rest to the app that owns it or nowhere), so a plain `<a href="/crm">` in a notice or in the
 * Assistant's words would load the whole app inside the card. `raw` is the link's href as written (a relative one is resolved against `here`, the page's own address, as the WebView resolves it). True for a
 * link on the page's own origin (http or https) that is not this very page (the part after # aside: a link to an anchor, or to the card's own address, goes nowhere). Every other address is false: it is not
 * the card that decides there (the app's own filter does), and a blob: address is a file the page made.
 */
export function leavesTheCard(raw: unknown, here: string): boolean {
  if (typeof raw !== 'string') return false
  try {
    const page = new URL(here)
    const to = new URL(raw, page)
    if (to.protocol !== 'http:' && to.protocol !== 'https:') return false
    if (to.origin !== page.origin) return false
    return !(to.pathname === page.pathname && to.search === page.search)
  } catch {
    return false
  }
}

/** Sends one message over the channel; false when there is none or it threw (the caller then does its fallback). */
export function sendPanel(app: unknown, m: PanelMessage): boolean {
  const c = panelChannel(app)
  if (!c) return false
  try {
    c.send(m)
    return true
  } catch {
    return false
  }
}

/**
 * The X, a tap on the transparent part: closes through the app's channel; with no channel, history.back() when there is history, else nothing (the route is not meant to work in a desktop
 * browser). Returns what it did.
 */
export function closePanel(app: unknown, history: { length: number; back(): void }): 'sent' | 'back' | 'nothing' {
  if (sendPanel(app, closeMessage())) return 'sent'
  if (history.length > 1) {
    history.back()
    return 'back'
  }
  return 'nothing'
}

// --- who sees the panel ----------------------------------------------------------------------------------------------------------------------------

/** What the page knows of its sign-in (src/auth/session.ts useAuth(): the agent's /auth/status). */
export interface PanelAuth {
  phase: 'loading' | 'ready' | 'down'
  status: { needsSignIn: boolean; person: { canSeeAll?: boolean } | null } | null
}

export type PanelGate = 'wait' | 'sign-in' | 'down' | 'not-owner' | 'ready'

/**
 * 'wait': the first answer is on its way (nothing is drawn but the transparent page). 'sign-in': this browser must sign in first (the panel never shows a sign-in form). 'down': the agent does not answer.
 * 'not-owner': a person signed in who is not the owner (the owner's Assistant is the owner's: their own Assistant in the panel is a later job). 'ready': the owner, or an app that is open as before.
 */
export function panelGate(a: PanelAuth): PanelGate {
  if (a.phase === 'loading' && !a.status) return 'wait'
  if (a.status?.needsSignIn) return 'sign-in'
  if (!a.status) return 'down'
  const person = a.status.person
  if (person && person.canSeeAll !== true) return 'not-owner'
  return 'ready'
}

/** The one calm line of each state the panel does not show the Assistant in (plain words; the button under it is always "Open the app"). */
export const PANEL_WORDS: Readonly<Record<Exclude<PanelGate, 'wait' | 'ready'>, string>> = {
  'sign-in': 'Sign in in the app first.',
  down: "The app isn't answering right now.",
  'not-owner': "This panel is for the owner's Assistant. Open the app for yours.",
}
