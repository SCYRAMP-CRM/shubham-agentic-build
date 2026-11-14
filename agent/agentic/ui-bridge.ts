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
}

export const UI_CALL_TIMEOUT_MS = 25_000

export interface UiBridge {
  /** The handler for a page's socket; `who` is whoever is signed in on that page (default: the owner's open app). */
  socket(): (ws: WsSocket, who?: UiWho) => void
  /** Runs `cmd` on the screen being looked at, of `as`'s own pages only, and answers what the page answered. */
  call(cmd: string, args: unknown, timeoutMs?: number, as?: UiWho): Promise<unknown>
  /** Is the screen a call of `as` would drive now a phone? null: there is none to drive (nobody is looking, or it is hidden). */
  onPhone(as?: UiWho): boolean | null
  /** Order od371: which device `as`'s Assistant drives now (null: none, or two are open and none is chosen). */
  driven(as?: UiWho): OverlayDevice | null
  /** Order od371: `as`'s devices with the overlay open right now. */
  overlayDevices(as?: UiWho): OverlayDevice[]
  clients(): UiClientInfo[]
  close(): void
}

export function createUiBridge(now: () => number = Date.now): UiBridge {
  const clients = new Set<Client>()
  const waiting = new Map<string, Waiting>()
  /** Order od371: the device he chose ("Act on this device"), per scope (o355e); none: the rule below decides. */
  const chosen = new Map<string, string>()

  const inScope = (scope: string) => [...clients].filter(c => c.scope === scope)

  function best(scope: string): Client | null {
    let top: Client | null = null
    const rank = (c: Client) => (c.visible ? 2 : 0) + (c.overlayOpen ? 1 : 0)
    for (const c of inScope(scope)) {
      if (!top || rank(c) > rank(top) || (rank(c) === rank(top) && c.activeAt > top.activeAt)) top = c
    }
    return top
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
      const c = openClients(scope).find(x => x.device === pick)
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

  return {
    socket: () => (ws, who = UI_OWNER) => {
      const scope = uiScope(who)
      // A page nobody is signed in on, that is not the owner's own open app, has no one whose Assistant may drive it.
      if (scope === null) {
        ws.close(1008, 'Sign in to let your Assistant use this page')
        return
      }
      const id = randomUUID()
      const me: Client = { id, ws, visible: false, overlayOpen: false, route: '', phone: false, activeAt: now(), device: id, name: 'a device', scope }
      clients.add(me)
      ws.onText(text => {
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
          if (m.ok === true) w.resolve(m.result ?? null)
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

    call(cmd, args, timeoutMs = UI_CALL_TIMEOUT_MS, as = UI_OWNER) {
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
      return new Promise((resolve, reject) => {
        const id = randomUUID()
        const timer = setTimeout(() => {
          waiting.delete(id)
          reject(apiError(504, "The screen didn't answer in time"))
        }, timeoutMs)
        waiting.set(id, { client: c, resolve, reject, timer })
        try {
          c.ws.sendText(JSON.stringify({ t: 'cmd', id, cmd, args }))
        } catch {
          clearTimeout(timer)
          waiting.delete(id)
          reject(apiError(409, 'The screen went away'))
        }
      })
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
