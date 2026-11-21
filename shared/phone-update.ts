// F-307 (his order o5a91: "If someone has installed the APK then there should be an update button within the APK. If they click on it then it will update the APK itself ... That update APK button will not be in a
// normal browser. It will be only on APK and you have to identify that."). The page end of the phone app's self-update; Agent 6 wrote the contract (C:/saw/f307-update-contract.md) and builds the native installer and the
// Server's routes. The page only talks to the app (window.SadApp.update, the app's private MessagePort, the same style as SadApp.browser); the app talks to the Server. This file is everything of it that needs no browser,
// so it is tested by tables (shared/phone-update.test.ts): whether this page is in an APK that can update itself, how the app's state is read, what the card says in each phase, and the controller that listens to the app.

/** What the app lists in SadApp.info.can when it can update itself (an older app does not). */
export const PHONE_UPDATE_CAN = 'update'

export const UPDATE_PHASES = ['idle', 'checking', 'uptodate', 'ready', 'needs-permission', 'downloading', 'verifying', 'installing', 'confirm', 'failed', 'none'] as const
export type UpdatePhase = (typeof UPDATE_PHASES)[number]

export interface OfferedApp {
  versionName: string
  versionCode: number
  bytes: number
  notes?: string
}

/** The app's FULL state, sent every time (the page keeps only the last). */
export interface UpdateState {
  phase: UpdatePhase
  installedName: string
  installedCode: number
  offered: OfferedApp | null
  newer: boolean
  progress: number
  error: string
}

/** What the page asks of the app (the app drops anything else). */
export type UpdateOp = 'check' | 'install' | 'permission'
export const UPDATE_OPS: readonly UpdateOp[] = ['check', 'install', 'permission']
/**
 * The message to the app: `{ t: 'update', op }`. Contract section 7: the app asks the Server at most ONCE per ten minutes for a plain `check` (what the page sends on every `sad-app`, i.e. every page load) and answers
 * in between with the state it keeps; a check the PERSON asked for is never held back: `{ op: 'check', now: true }` when the card opens, on "Try again" and on "Check now". `now` is the boolean true, on a `check` only
 * (it means nothing for install and permission, so it is never put there); the page NEVER sends it by itself.
 */
export const updateMessage = (op: UpdateOp, now = false): { t: 'update'; op: UpdateOp; now?: true } => (op === 'check' && now === true ? { t: 'update', op, now: true } : { t: 'update', op })

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')

/** One message of the app, as the page reads it (a JSON string or the object itself); null for anything that is not a well-formed state. Nothing is trusted: every field is checked and cut. */
export function parseUpdateState(raw: unknown): UpdateState | null {
  let m: unknown = raw
  if (typeof raw === 'string') {
    try {
      m = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!isRecord(m) || m.t !== 'update') return null
  if (typeof m.phase !== 'string' || !(UPDATE_PHASES as readonly string[]).includes(m.phase)) return null
  let offered: OfferedApp | null = null
  if (m.offered !== null && m.offered !== undefined) {
    const o = m.offered
    if (!isRecord(o) || typeof o.versionName !== 'string' || !isInt(o.versionCode) || !isInt(o.bytes) || o.bytes < 0) return null
    offered = { versionName: o.versionName.slice(0, 80), versionCode: o.versionCode, bytes: o.bytes, ...(typeof o.notes === 'string' && o.notes.trim() ? { notes: o.notes.slice(0, 2000) } : {}) }
  }
  const progress = typeof m.progress === 'number' && Number.isFinite(m.progress) ? Math.min(100, Math.max(0, Math.round(m.progress))) : 0
  return {
    phase: m.phase as UpdatePhase,
    installedName: text(m.installedName, 80),
    installedCode: isInt(m.installedCode) ? m.installedCode : 0,
    offered,
    newer: m.newer === true,
    progress,
    error: text(m.error, 300),
  }
}

// --- is this page in an APK that can update itself ---------------------------------------------------------------------------------------------------------

export type UpdateSupport = 'none' | 'old' | 'ready'

/**
 * 'ready': the app's hello lists 'update' in info.can AND window.SadApp.update has send and listen. 'old': the app (info.app is 'android') whose can has no 'update': an older APK. 'none': everything else:
 * a normal browser or a PWA (no SadApp), a hello that has not come yet (info is not there at first paint: nothing shows until it is), the page the F-305 panel opened (it has SadApp.panel and never SadApp.update), a
 * hello that says 'update' without the channel. NEVER decided by the User-Agent.
 */
export function updateSupport(app: unknown): UpdateSupport {
  if (!isRecord(app)) return 'none'
  if (app.panel !== undefined && app.panel !== null) return 'none'
  const info = app.info
  if (!isRecord(info)) return 'none'
  const can = Array.isArray(info.can) ? info.can : []
  if (can.includes(PHONE_UPDATE_CAN)) {
    const u = app.update
    return isRecord(u) && typeof u.send === 'function' && typeof u.listen === 'function' ? 'ready' : 'none'
  }
  return info.app === 'android' ? 'old' : 'none'
}

/**
 * Whether the button (or the old-app line) is drawn: the app is there and not the panel's page, the person may use the Phone app (the Access row `phone-app`, the owner always: the Server answers 403 to anyone else
 * and the app then says phase 'none' too), and the app has not said phase 'none'.
 */
export const buttonShown = (support: UpdateSupport, state: UpdateState | null, mayPhoneApp: boolean): boolean => support !== 'none' && mayPhoneApp && state?.phase !== 'none'

/** The dot on the button: a newer phone app is on offer (never in the phases where nothing is on offer). */
export const dotShown = (state: UpdateState | null): boolean => state !== null && state.newer && state.phase !== 'none' && state.phase !== 'uptodate' && state.phase !== 'failed'

// --- the words ----------------------------------------------------------------------------------------------------------------------------------------------

export const OLD_APP_LINE = "This version of the phone app can't update itself yet. Install the new one once."
export const BUTTON_LABEL = 'Update this phone app'
export const FAILED_FALLBACK = 'The update did not work.'

export type UpdateAction = { op: UpdateOp; label: string; /** A check the person asked for (the app never holds it back): `now: true` is sent with it. */ now?: true }

export interface UpdateCard {
  title: string
  /** Plain text lines (never HTML). */
  lines: string[]
  /** A status line for the phase (what is happening now), or null. */
  status: string | null
  /** 0..100 while downloading, else null. */
  progress: number | null
  /** The one button of the phase, or null. */
  action: UpdateAction | null
}

const mb = (bytes: number): string => `${(bytes / 1048576).toFixed(1)} MB`

/** What the card says for the old app: the one line, no button. */
export const oldAppCard = (): UpdateCard => ({ title: 'Phone app', lines: [], status: OLD_APP_LINE, progress: null, action: null })

/** What the card says for the app's state (null: the app has not answered yet). */
export function updateCard(state: UpdateState | null): UpdateCard {
  if (!state) return { title: 'Phone app', lines: [], status: 'Looking for a new version…', progress: null, action: null }
  const lines: string[] = []
  if (state.installedName) lines.push(`This phone: ${state.installedName}`)
  if (state.offered && state.phase !== 'uptodate') {
    lines.push(`New: ${state.offered.versionName} · ${mb(state.offered.bytes)}`)
    if (state.offered.notes) lines.push(state.offered.notes)
  }
  const base = { lines, progress: null as number | null }
  switch (state.phase) {
    case 'uptodate':
      return { title: 'This phone app is up to date', lines: state.installedName ? [`This phone: ${state.installedName}`] : [], status: null, progress: null, action: { op: 'check', label: 'Check now', now: true } }
    case 'ready':
      return { title: state.newer ? 'A new phone app is ready' : 'Phone app', ...base, status: null, action: state.newer ? { op: 'install', label: 'Update this app' } : null }
    case 'needs-permission':
      return { title: state.newer ? 'A new phone app is ready' : 'Phone app', ...base, status: 'Android needs your OK once for this app to install updates.', action: { op: 'permission', label: "Open Android's page" } }
    case 'downloading':
      return { title: state.newer ? 'A new phone app is ready' : 'Phone app', ...base, status: `Downloading… ${state.progress}%`, progress: state.progress, action: null }
    case 'verifying':
      return { title: state.newer ? 'A new phone app is ready' : 'Phone app', ...base, status: 'Checking the download…', action: null }
    case 'installing':
      return { title: state.newer ? 'A new phone app is ready' : 'Phone app', ...base, status: 'Handing it to Android…', action: null }
    case 'confirm':
      return { title: state.newer ? 'A new phone app is ready' : 'Phone app', ...base, status: 'Android will ask you to confirm. Tap Update on its screen.', action: null }
    case 'failed':
      return { title: 'Phone app', ...base, status: state.error || FAILED_FALLBACK, action: { op: 'check', label: 'Try again', now: true } }
    case 'idle':
    case 'checking':
    case 'none':
    default:
      return { title: 'Phone app', ...base, status: 'Looking for a new version…', action: null }
  }
}

// --- the controller: listens to the app, keeps the last state, asks ------------------------------------------------------------------------------------

/** The part of the app's channel the page uses: window.SadApp.update. */
interface Channel {
  send(o: unknown): void
  listen(fn: (o: unknown) => void): void
}

export interface PhoneUpdate {
  support(): UpdateSupport
  state(): UpdateState | null
  subscribe(fn: () => void): () => void
  /** Looks at the app now: when its channel is there and not listened to yet, listens and asks once (`check`). Called when the app's hello comes (the `sad-app` event, a short retry). */
  sync(): void
  /** Sends one op to the app (a person's tap: the callers check that); `now: true` (a check the person asked for) only with `check`; false when there is no channel or it threw. */
  send(op: UpdateOp, now?: boolean): boolean
}

/**
 * The page's end of the channel, with the app object injected (window.SadApp in the page) so it is tested without a browser. It listens ONCE per channel object (a new object, say after the app restarts its port, is
 * listened to again), asks `check` right after listening (the app sends one state after each check and one on every change), keeps only the last state, drops anything that is not a state, and never throws: a browser
 * or the panel has no channel and nothing happens. It installs nothing by itself: only send('install') does, and the only caller of that is a person's own tap.
 */
export function createPhoneUpdate(getApp: () => unknown): PhoneUpdate {
  let state: UpdateState | null = null
  let hooked: unknown = null
  const listeners = new Set<() => void>()
  const channel = (): Channel | null => {
    if (updateSupport(getApp()) !== 'ready') return null
    return (getApp() as { update: Channel }).update
  }
  const emit = () => listeners.forEach(l => l())
  const send = (op: UpdateOp, now = false): boolean => {
    const c = channel()
    if (!c || !UPDATE_OPS.includes(op)) return false
    try {
      c.send(updateMessage(op, now))
      return true
    } catch {
      return false
    }
  }
  return {
    support: () => updateSupport(getApp()),
    state: () => state,
    subscribe(fn) {
      listeners.add(fn)
      return () => void listeners.delete(fn)
    },
    sync() {
      const c = channel()
      if (!c || hooked === c) return
      hooked = c
      try {
        c.listen(raw => {
          const next = parseUpdateState(raw)
          if (!next) return
          state = next
          emit()
        })
      } catch {
        hooked = null
        return
      }
      send('check')
      emit()
    },
    send,
  }
}
