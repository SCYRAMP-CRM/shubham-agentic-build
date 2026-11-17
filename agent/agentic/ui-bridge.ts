import { randomUUID } from 'node:crypto'
import { apiError, type WsSocket } from '../api.ts'

// F-070: the way the overlay assistant reaches the screen. Every page of the app keeps one small
// WebSocket here (src/overlay/UiLink.tsx), and says whether it is on screen, whether the overlay is
// open on it and where it was last used. A tool call (ui_screen, ui_control, ...) goes to the ONE
// page the person is looking at: visible first, then the one with the overlay open, then the one
// used last. The page does it (src/overlay/driver.ts) and answers with the call's id.
//   page -> agent   {t:'state', visible, active, overlayOpen, route, phone}   (also the hello)
//                   {t:'result', id, ok, result | error}
//   agent -> page   {t:'cmd', id, cmd, args}
//
// Order o355e (+ o2c59, oe3b1; Shubham: "When people use their screen they will be using localhost"): pages from EVERY origin reach this bridge (a
// member PC passes its own pages' sockets on to the Server's, index.ts 'ui-page'), and every page and every call belongs to a PERSON. A page is
// tagged with whoever is signed in on it; a call with its chat's owner. A call drives only pages in its own scope: a person's own pages, never
// another person's; the owner of the app (an administrator, and a chat with no owner, which is his) shares one scope with the unsigned pages of
// his own PCs. F-219's device choice (order od371) is kept per scope: two of HIS devices open asks HIM, never because of someone else's page.

/** Whose page or call this is: the signed-in person's id (null: nobody signed in, the open app on one of his PCs), and an administrator or not. */
export interface UiWho {
  person: string | null
  admin: boolean
}

/** The owner of the app: a page or a call that says no person (the open app, tests, the chats there were before people). */
export const UI_OWNER: UiWho = { person: null, admin: true }

/** The scope a page or a call is in: the owner's (every administrator, and the open app) or one person's. Null: none (refused). */
export function uiScope(w: UiWho): string | null {
  if (w.admin) return '@owner'
  return w.person ? `person:${w.person.toLowerCase()}` : null
}

export interface UiClientInfo {
  id: string
  visible: boolean
  overlayOpen: boolean
  route: string
  /** The page says it is on a phone-sized screen (the overlay's own rule: narrower than 640px). */
  phone: boolean
  idleMs: number
  /** Order o355e: whose page it is (the scope). */
  scope: string
}

interface Client {
  id: string
  ws: WsSocket
  visible: boolean
  overlayOpen: boolean
  route: string
  phone: boolean
  activeAt: number
  /** Order od371: which device this screen is (the page's own stable id; the socket's id until it says). */
  device: string
  /** The device's name, for "Acting on: <name>". */
  name: string
  /** Order o355e: whose page it is. */
  scope: string
  /** o1e3c: until when a call to this page got no answer and it is passed over (a later time than now; 0: not). Any frame from the page ends it. */
  suspectUntil: number
}

/** Order od371: a device that has the overlay open, as the other devices are told about it. */
export interface OverlayDevice {
  device: string
  name: string
  phone: boolean
}

interface Waiting {
  client: Client
  resolve(v: unknown): void
  reject(e: unknown): void
  timer: ReturnType<typeof setTimeout>
  /** o7e6d: a staff call's page rule; its answer must carry the route the page captured, and that route must pass it. */
  guard?: (route: string) => boolean
}

export const UI_CALL_TIMEOUT_MS = 25_000

// o1e3c / F-273: when a call gets no answer. The page that did not answer may be dead (a network drop leaves its socket registered for up to about 85 s) or only slow, busy or
// frozen, in which case it will still RUN the command later, from its queue. So:
//   - only a READ (a call that looks and changes nothing) is ever tried on a second page; a click, a type, a key, an invoke is never sent twice;
//   - a page that did not answer is passed over by the pick for UI_SUSPECT_MS (any frame from it ends that), so the call that follows a read (the Assistant always reads before it
//     clicks) lands on the page that was read, and a write gets the benefit of the failover without ever being re-sent;
//   - a read with another page ON SCREEN to try gives its first page only UI_READ_FIRST_TRY_MS; with no other page it waits as it always did; the whole call never takes longer than
//     the timeout it was given; never another device, never a page that is hidden (a hidden page is driven only if it is the one picked, and a call to a hidden one is refused).
// The answer of a read that was tried on a second page SAYS so in its first line.
/** Calls that only look. */
const READS = new Set(['screen', 'modules'])
/**
 * The first wait of a read that has another page on screen to try. MEASURED on real Chrome 157 tabs (a production build, headless=new, 17 Nov 2026, two runs of rig/bridge-proof.mjs): a `screen`
 * call on a page in front answered in p50 13-16 ms, p95 19 ms, max 19 ms over 80 calls; a page in the BACKGROUND answered `screen` in about 110 ms and its slowest command (a goto, a smooth scroll) in
 * 1.1-1.2 s (the browser's timer throttling). 5 s is about 260 times the slowest healthy answer in front and about four times the slowest hidden-page command; it is a JUDGEMENT anchored on
 * those numbers (a phone is slower than this machine), not derived from them. A too-short wait moves the Assistant to another window for nothing (and says so); a too-long one only costs the wait.
 */
export const UI_READ_FIRST_TRY_MS = 5_000
/** How long a page that did not answer is passed over: just more than the agent's sweep needs to drop a page that died without a sound (65 s of silence, checked every 20 s: agent/ws-live.ts). */
export const UI_SUSPECT_MS = 90_000

export interface UiBridge {
  /** The handler for a page's socket; `who` is whoever is signed in on that page (default: the owner's open app). */
  socket(): (ws: WsSocket, who?: UiWho) => void
  /** Runs `cmd` on the screen being looked at, of `as`'s own pages only, and answers what the page answered. */
  call(cmd: string, args: unknown, timeoutMs?: number, as?: UiWho, guard?: (route: string) => boolean): Promise<unknown>
  /** Is the screen a call of `as` would drive now a phone? null: there is none to drive (nobody is looking, or it is hidden). */
  onPhone(as?: UiWho): boolean | null
  /** Order od371: which device `as`'s Assistant drives now (null: none, or two are open and none is chosen). */
  driven(as?: UiWho): OverlayDevice | null
  /** Order od371: `as`'s devices with the overlay open right now. */
  overlayDevices(as?: UiWho): OverlayDevice[]
  clients(): UiClientInfo[]
  close(): void
}

/** o1e3c: what the answer of a read that had to be tried on another page begins with, so the Assistant can tell it moved (and tell him). */
function answeredByAnother(result: unknown, skipped: number, ms: number): string {
  const who = skipped === 1 ? 'the window he was last using did' : `${skipped} windows did`
  const other = skipped === 1 ? 'the other' : 'another'
  return `Note: ${who} not answer in ${(ms / 1000).toFixed(1)} s, so this is ${other} window that is on screen. The next actions go to this one.\n\n${typeof result === 'string' ? result : JSON.stringify(result)}`
}

export function createUiBridge(now: () => number = Date.now, opts: { firstTryMs?: number } = {}): UiBridge {
  const firstTryMs = opts.firstTryMs ?? UI_READ_FIRST_TRY_MS
  const clients = new Set<Client>()
  const waiting = new Map<string, Waiting>()
  /** Order od371: the device he chose ("Act on this device"), per scope (o355e); none: the rule below decides. */
  const chosen = new Map<string, string>()

  const inScope = (scope: string) => [...clients].filter(c => c.scope === scope)

  const rank = (c: Client) => (c.visible ? 2 : 0) + (c.overlayOpen ? 1 : 0)
  const suspect = (c: Client) => c.suspectUntil > now()
  /** `a` is a better page to drive than `b`: on screen first, then the overlay open; then one that has not just failed to answer; then the one used last. */
  const better = (a: Client, b: Client) => (rank(a) !== rank(b) ? rank(a) > rank(b) : suspect(a) !== suspect(b) ? !suspect(a) : a.activeAt > b.activeAt)

  /**
   * The page of `list` the person is most likely looking at.
   *
   * KNOWN WEAKNESS (o1e3c / F-273): this picks by what each page LAST REPORTED (on screen, overlay open, touched when), and the bridge has no liveness signal of its own: the
   * agent's ping and its drop of a page that went silent for 65 s live in agent/ws-live.ts and never reach here. A page that died without a sound can therefore still be picked
   * for up to about 85 s (the first 20 s sweep after 65 s of silence), and a call to it ends in 504 "The screen didn't answer in time". That was always so on the nothing-chosen
   * path; a4744ca made it so with a device chosen too (the old pick, the first page registered, answered by luck when the NEWER page was the one that died). What lessens it
   * now: a READ that gets no answer is tried on the next page on screen (run(), below), and the page that did not answer is passed over by this pick (`suspect`) for
   * UI_SUSPECT_MS, so the click that follows the read lands on the page that was read; a write is never sent twice. NOT closed: a dead page whose only live sibling is HIDDEN
   * is still picked (a hidden page is never tried unnamed).
   */
  function bestOf(list: Client[]): Client | null {
    let top: Client | null = null
    for (const c of list) {
      if (!top || better(c, top)) top = c
    }
    return top
  }

  /** o1e3c: the pages a READ may be tried on when the one it went to does not answer: the same device's other pages that are on screen with the overlay open (never another device,
   *  never a hidden page), and, for a staff call, only pages its guard allows; best first. */
  function alternatives(from: Client, tried: Set<Client>, guard?: (route: string) => boolean): Client[] {
    return openClients(from.scope)
      .filter(x => x.device === from.device && x.visible && !tried.has(x) && (!guard || guard(x.route)))
      .sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0))
  }

  function best(scope: string): Client | null {
    return bestOf(inScope(scope))
  }

  const openClients = (scope: string): Client[] => inScope(scope).filter(c => c.overlayOpen)
  /** One entry per device (several tabs of one browser are one device: they share its id). */
  const openDevices = (scope: string): Client[] => {
    const seen = new Map<string, Client>()
    for (const c of openClients(scope)) if (!seen.has(c.device)) seen.set(c.device, c)
    return [...seen.values()]
  }

  /** Order od371: two of the scope's devices have the overlay open and he has not chosen one of them: the Assistant must ask him, not guess. */
  function ambiguous(scope: string): boolean {
    const devices = openDevices(scope)
    const pick = chosen.get(scope)
    return devices.length > 1 && !devices.some(c => c.device === pick)
  }

  /** Order od371: the chosen device when it has the overlay open; with two open and none chosen, nothing; else the one the rule picks (as before). */
  function driving(scope: string): Client | null {
    const pick = chosen.get(scope)
    if (pick !== undefined) {
      // The chosen DEVICE is a browser, and a browser can hold several pages (two tabs; a reload's dead one for up to a minute): the Assistant drives the page
      // that is on screen or was used last, as it does when no device is chosen, never just the first one registered (an older hidden tab was refused as "open
      // but hidden" while he looked at another tab of the same browser).
      const c = bestOf(openClients(scope).filter(x => x.device === pick))
      if (c) return c
    }
    if (ambiguous(scope)) return null
    return best(scope)
  }

  /** Order od371: every open device of a scope is told which one is driven, so each can say "Acting on this device" or "not driven". */
  function tellAll(scope: string) {
    const driven = driving(scope)
    const msg = JSON.stringify({ t: 'acting', driven: driven?.device ?? null, devices: openDevices(scope).map(c => ({ device: c.device, name: c.name, phone: c.phone })) })
    for (const c of inScope(scope)) {
      try {
        c.ws.sendText(msg)
      } catch {
        // A socket that cannot take the word is dropped by its own close.
      }
    }
  }

  function failFor(client: Client, why: string) {
    for (const [id, w] of waiting) {
      if (w.client !== client) continue
      clearTimeout(w.timer)
      waiting.delete(id)
      w.reject(apiError(409, why))
    }
  }

  /** A call's scope, or a refusal: a chat of nobody's (not the owner's, no person) drives no screen. */
  function scopeOf(as: UiWho): string {
    const s = uiScope(as)
    if (s === null) throw apiError(403, "This chat has no owner who could be looking at the app: it drives no one's screen.")
    return s
  }

  /** One command to one page, for `ms`: its answer, or 504 (no answer in time), or 409 (the screen went away). */
  function attempt(c: Client, cmd: string, args: unknown, ms: number, guard?: (route: string) => boolean): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = randomUUID()
      const timer = setTimeout(() => {
        waiting.delete(id)
        reject(apiError(504, "The screen didn't answer in time"))
      }, ms)
      waiting.set(id, { client: c, resolve, reject, timer, guard })
      try {
        // o7e6d: a staff call says so, and the page checks its own route before it runs anything (no field for the owner: unchanged).
        c.ws.sendText(JSON.stringify(guard ? { t: 'cmd', id, cmd, args, staff: true } : { t: 'cmd', id, cmd, args }))
      } catch {
        clearTimeout(timer)
        waiting.delete(id)
        reject(apiError(409, 'The screen went away'))
      }
    })
  }

  /** A call to `first` and, for a READ that gets no answer, to the next page on screen of the same device (the note above UI_READ_FIRST_TRY_MS says why only a read). */
  async function run(first: Client, cmd: string, args: unknown, timeoutMs: number, guard?: (route: string) => boolean): Promise<unknown> {
    const read = READS.has(cmd)
    const tried = new Set<Client>()
    let budget = timeoutMs
    let lost = 0
    let c = first
    for (;;) {
      tried.add(c)
      // With another page on screen to try, a read waits only the short first wait; with none, as long as the call allows.
      const wait = read && alternatives(c, tried, guard).length > 0 ? Math.min(budget, firstTryMs) : budget
      const began = Date.now()
      try {
        const result = await attempt(c, cmd, args, wait, guard)
        return tried.size > 1 ? answeredByAnother(result, tried.size - 1, lost) : result
      } catch (e) {
        const status = (e as { status?: unknown } | null)?.status
        // Whatever the call was, the page that did not answer is passed over by the next pick: the call that follows a read lands on the page that was read.
        if (status === 504) c.suspectUntil = now() + UI_SUSPECT_MS
        const spent = Date.now() - began
        lost += spent
        budget -= spent
        const next = read && (status === 504 || status === 409) ? alternatives(c, tried, guard)[0] : undefined
        if (!next || budget <= 0) throw e
        c = next
      }
    }
  }

  return {
    socket: () => (ws, who = UI_OWNER) => {
      const scope = uiScope(who)
      // A page nobody is signed in on, that is not the owner's own open app, has no one whose Assistant may drive it.
      if (scope === null) {
        ws.close(1008, 'Sign in to let your Assistant use this page')
        return
      }
      const id = randomUUID()
      const me: Client = { id, ws, visible: false, overlayOpen: false, route: '', phone: false, activeAt: now(), device: id, name: 'a device', scope, suspectUntil: 0 }
      clients.add(me)
      ws.onText(text => {
        // o1e3c: a frame of any kind proves this page is alive: it is no longer passed over for not having answered.
        me.suspectUntil = 0
        let m: { t?: unknown; id?: unknown; visible?: unknown; active?: unknown; overlayOpen?: unknown; route?: unknown; phone?: unknown; ok?: unknown; result?: unknown; error?: unknown; device?: unknown; name?: unknown }
        try {
          m = JSON.parse(text)
        } catch {
          return
        }
        if (m.t === 'state') {
          me.visible = m.visible === true
          me.overlayOpen = m.overlayOpen === true
          if (typeof m.route === 'string') me.route = m.route.slice(0, 300)
          me.phone = m.phone === true
          if (typeof m.device === 'string' && m.device) me.device = m.device.slice(0, 80)
          if (typeof m.name === 'string' && m.name) me.name = m.name.replace(/\s+/g, ' ').trim().slice(0, 60) || 'a device'
          if (m.active === true) me.activeAt = now()
          tellAll(scope)
        } else if (m.t === 'choose') {
          // Order od371: "Act on this device" on that device. Only a device with the overlay open can be chosen, and only among its own scope's.
          if (me.overlayOpen) {
            chosen.set(scope, me.device)
            tellAll(scope)
          }
        } else if (m.t === 'result' && typeof m.id === 'string') {
          const w = waiting.get(m.id)
          if (!w || w.client !== me) return
          clearTimeout(w.timer)
          waiting.delete(m.id)
          if (m.ok === true && w.guard) {
            // o7e6d: a staff call is answered only with the route the page captured, and only if that route passes the guard now.
            // A page that moved on (allowed -> forbidden while the call was in flight), an old page, or one that says nothing is refused.
            const captured = typeof m.route === 'string' ? m.route : null
            if (captured === null || !w.guard(captured)) w.reject(apiError(403, 'The page moved to one your Assistant may not look at; it did not look.'))
            else w.resolve(m.result ?? null)
          } else if (m.ok === true) w.resolve(m.result ?? null)
          else w.reject(apiError(422, typeof m.error === 'string' ? m.error : 'That did not work'))
        }
      })
      ws.onClose(() => {
        clients.delete(me)
        if (chosen.get(scope) === me.device && !inScope(scope).some(c => c.device === me.device)) chosen.delete(scope)
        failFor(me, 'The screen went away before it answered')
        tellAll(scope)
      })
    },

    call(cmd, args, timeoutMs = UI_CALL_TIMEOUT_MS, as = UI_OWNER, guard?: (route: string) => boolean) {
      let scope: string
      try {
        scope = scopeOf(as)
      } catch (e) {
        return Promise.reject(e)
      }
      if (ambiguous(scope)) {
        return Promise.reject(apiError(409, 'The overlay is open on two of his devices (his phone and his PC) and he has not chosen which one the Assistant should drive. Ask him which one to use, and do not guess.'))
      }
      const c = driving(scope)
      if (!c) return Promise.reject(apiError(409, 'No screen of the app is open: nobody is looking at the app right now. Ask him to open it (on any of his PCs, localhost or the tailnet address) and sign in.'))
      if (!c.visible) return Promise.reject(apiError(409, "The app's screen is open but hidden (the phone is locked or the tab is in the background), so there is nothing to drive. Ask him to look at the app."))
      // F-162 o7e6d: a guard (a staff chat's page rule) is checked against the page that will be driven, in the same step as the pick. Refused, fail closed.
      if (guard && !guard(c.route)) return Promise.reject(apiError(403, 'That page is not open to your Assistant; it can look at the app\'s main pages only.'))
      return run(c, cmd, args, timeoutMs, guard)
    },

    onPhone(as = UI_OWNER) {
      const scope = uiScope(as)
      const c = scope === null ? null : driving(scope)
      return c?.visible ? c.phone : null
    },

    driven(as = UI_OWNER) {
      const scope = uiScope(as)
      const c = scope === null ? null : driving(scope)
      return c ? { device: c.device, name: c.name, phone: c.phone } : null
    },

    overlayDevices: (as = UI_OWNER) => {
      const scope = uiScope(as)
      return scope === null ? [] : openDevices(scope).map(c => ({ device: c.device, name: c.name, phone: c.phone }))
    },

    clients: () => [...clients].map(c => ({ id: c.id.slice(0, 8), visible: c.visible, overlayOpen: c.overlayOpen, route: c.route, phone: c.phone, idleMs: now() - c.activeAt, scope: c.scope })),

    close() {
      for (const c of clients) c.ws.close(1001, 'the agent is stopping')
      clients.clear()
      for (const [, w] of waiting) {
        clearTimeout(w.timer)
        w.reject(apiError(409, 'The agent is stopping'))
      }
      waiting.clear()
    },
  }
}
