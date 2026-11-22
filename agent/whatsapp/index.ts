import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { WA_EVENTS_WAIT_MAX_MS, WA_IDLE_MS, WA_PREFIX, WA_READ_MAX, WA_TEXT_MAX, type WaChat, type WaContactDetails, type WaDraft, type WaLive, type WaMediaFile, type WaMessage, type WaNewChat, type WaSendRequest, type WaRoute, type WaSetup, type WaStatus, type WaTunnelSeen } from '../../shared/whatsapp.ts'
import type { ProofRequest } from '../agentic/index.ts'
import { apiError, type ApiMount, type MountRequest, type WsSocket } from '../api.ts'
import { writeAtomic } from '../config.ts'
import type { Logger } from '../log.ts'
import { findChrome } from './chrome.ts'
import { createDrafts } from './drafts.ts'
import { message, type EngineStatus } from './engine.ts'
import { createEventRing } from './events.ts'
import { createHost, type HostOptions } from './host.ts'
import { LOGIN_ID, type WorkerEvent } from './protocol.ts'
import { installLib, libReady, MANIFEST_DIR } from './setup.ts'
import { checkTunnel, type TunnelCheck } from './tunnel.ts'

// F-079: WhatsApp in the app, on the hub. Shubham's own WhatsApp, linked once as a device by his QR scan, then read
// and written from the WhatsApp page and, within limits, by the overlay Assistant.
// - On demand: WhatsApp (worker.ts, its Chrome) runs only while it is used, and closes WA_IDLE_MS after the last
//   use with no WhatsApp page open, unless he sets it to stay on. The login is kept between runs.
// - Sending is his alone: every send carries his approval device's signature over exactly that chat and those
//   words (as Send as me does, F-076), so neither the Assistant nor anything driving this PC can send.
// - The Assistant reads only when asked and only drafts (drafts.ts); its drafts wait on his page for his tap.
// - Nothing about a message, a chat or a number is logged; the login stays in <state>\whatsapp\auth, locked to his
//   Windows account, and is deleted when he unlinks.

export interface WhatsAppOptions {
  /** The state folder's WhatsApp part: %LOCALAPPDATA%\shubham-agentic\whatsapp. */
  dir: string
  /**
   * F-312: where WhatsApp's packages are (the shared install). Left out: `<dir>\lib`, as it always was. An extra number keeps its own login folder in its own `dir` and shares these packages with the first.
   */
  lib?: string
  /**
   * F-312: asked just before this WhatsApp's Chrome would start; it throws (a 409 in plain words) to refuse. Given only to the extra numbers (agent/whatsapp-backend/accounts.ts: not enough memory free
   * right now); the first number is not given one and opens exactly as before.
   */
  beforeOpen?(): void
  /**
   * F-312 (his rule: an extra number opens on use and closes after idle): this number never stays open. A saved "Stay open" on it is ignored (it is not shown as on, it does not keep the number from closing, and it
   * does not open the number again at the next start), and a request to turn it on is refused. Given only to the extra numbers; the first number is not given it and stays open when set to, exactly as before.
   */
  neverStayOpen?: boolean
  log: Logger
  /** His approval device's signature over a WhatsApp send (agentic's humanProof): who it was, or it throws 401/403. */
  human(kind: 'wa-send', fields: (string | number | boolean)[], sig: unknown, r?: ProofRequest): string
  // Tests:
  script?: string
  env?: Record<string, string>
  chrome?: string | null
  ready?: () => boolean
  install?: () => Promise<void>
  now?: () => number
  idleMs?: number
  /** Lock the login folder to this Windows user (icacls); default on Windows. */
  lock?: boolean
  host?: Partial<HostOptions>
  /**
   * Order o55b6: where this WhatsApp can go out another way, through the Z800's SSH SOCKS tunnel (Agent 6 keeps it and notes it in `file`;
   * tunnel.ts checks it). Given only to the WhatsApp backend; without it there is no route setting and Chrome goes out directly.
   */
  tunnel?: { file: string; check?: (file: string) => Promise<TunnelCheck>; everyMs?: number }
}

/** What the Assistant's tools use (agentic/index.ts, through whatsapp/tools.ts). */
export interface WaTools {
  status(): WaStatus
  chats(): Promise<WaChat[]>
  read(chatId: string, count: number): Promise<WaMessage[]>
  draft(chatId: string, text: string, why: string): Promise<WaDraft>
  /** Order of5a0 (A2): wa_status's own text, where it says more than this login's status (which login answered, and the other). */
  describe?(): Promise<string>
}

export interface WhatsApp {
  mount: ApiMount
  tools: WaTools
  status(): WaStatus
  /** Order oWA S3: the file of a message of a chat (bytes), or a 404 / 413 in plain words (and a code: wa-media-gone, wa-media-too-big). The page's route for it is the backend's (server.ts). */
  media(chatId: string, messageId: string): Promise<{ bytes: Buffer; mimetype: string; filename: string | null }>
  /** The app is stopping: Chrome closes properly (the login is kept). */
  close(): Promise<void>
}

const CHAT_ID = /^[\w.:-]{1,80}@(c\.us|g\.us|lid|s\.whatsapp\.net)$/
/** A message's id (whatsapp-web.js: true_<chat>_<hex>, with the writer's id added in a group). */
const MESSAGE_ID = /^[\w.:@-]{1,200}$/
/** His own sends: at most this many a minute (a stuck button, not a limit on him). */
const MINE_PER_MINUTE = 10
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

interface Settings {
  alwaysOn: boolean
  /** A login was made and WhatsApp hasn't let it go since (the folder alone can't say: Chrome makes it at once). */
  linked: boolean
  /** His WhatsApp name, to show while it is closed. */
  name: string | null
  /** Order o55b6: the way out he chose; null: not chosen (through the Z800 where there is a tunnel to choose). */
  route: WaRoute | null
  /** F-312: when it was last connected (ISO), and how it last stopped being (plain words, with when). Written only once there is something to say: until then the file keeps its old shape. */
  lastConnectedAt: string | null
  lastEnd: { at: string; why: string } | null
}

export function createWhatsApp(o: WhatsAppOptions): WhatsApp {
  const now = o.now ?? Date.now
  const log = o.log
  const authDir = path.join(o.dir, 'auth')
  const libDir = o.lib ?? path.join(o.dir, 'lib')
  const profile = path.join(authDir, `session-${LOGIN_ID}`)
  const settingsFile = path.join(o.dir, 'settings.json')
  const chrome = o.chrome !== undefined ? o.chrome : findChrome()
  const isReady = o.ready ?? (() => libReady(libDir, MANIFEST_DIR))
  const drafts = createDrafts({ now })
  const sockets = new Set<WsSocket>()
  const waiters = new Set<() => void>()
  // Order oWA S7: what happens on WhatsApp (a message, a tick), in memory only, for GET /events: the new page follows it live over plain HTTP (the proxy has no socket).
  const events = createEventRing()

  let settings = readSettings()
  /** F-312: whether this number is kept open: what it was set to, except an extra number (never). */
  const stays = (): boolean => settings.alwaysOn && o.neverStayOpen !== true
  let engine: EngineStatus = { state: 'off', qr: null, pairingCode: null, me: null, reason: null, loading: null, linked: null }
  let setup: { state: WaSetup; note: string | null } = { state: isReady() ? 'ready' : 'missing', note: null }
  let idle: ReturnType<typeof setTimeout> | null = null
  let closesAt: string | null = null
  let mine: number[] = []
  let locked = false
  let queued = false

  function readSettings(): Settings {
    try {
      const raw = JSON.parse(readFileSync(settingsFile, 'utf8')) as Record<string, unknown>
      const end = raw.lastEnd as { at?: unknown; why?: unknown } | null | undefined
      return {
        alwaysOn: raw.alwaysOn === true,
        linked: raw.linked === true,
        name: typeof raw.name === 'string' ? raw.name : null,
        route: raw.route === 'direct' || raw.route === 'z800' ? raw.route : null,
        lastConnectedAt: typeof raw.lastConnectedAt === 'string' ? raw.lastConnectedAt : null,
        lastEnd: end && typeof end.at === 'string' && typeof end.why === 'string' ? { at: end.at, why: end.why } : null,
      }
    } catch {
      return { alwaysOn: false, linked: false, name: null, route: null, lastConnectedAt: null, lastEnd: null }
    }
  }
  function saveSettings(patch: Partial<Settings>) {
    settings = { ...settings, ...patch }
    try {
      mkdirSync(o.dir, { recursive: true })
      // Order o55b6: the way out is written only once he has chosen one; until then the file keeps its old shape.
      // F-312: and the same for the two things he is told about how it last connected and ended (written once there is something to say).
      const { route: chosen, lastConnectedAt, lastEnd, ...rest } = settings
      writeAtomic(settingsFile, `${JSON.stringify({ ...rest, ...(chosen ? { route: chosen } : {}), ...(lastConnectedAt ? { lastConnectedAt } : {}), ...(lastEnd ? { lastEnd } : {}) }, null, 2)}\n`)
    } catch (e) {
      log.warn(`could not save the WhatsApp settings: ${message(e)}`)
    }
  }

  // Order o55b6: the way out. Where there is a tunnel to choose, his choice, else the Z800 (his "Yes ok do however please" to option 3); the old
  // way, directly, stays a setting. Without one: directly, as before, and no setting.
  const route = (): WaRoute | null => (o.tunnel ? (settings.route ?? 'z800') : null)
  let tunnelSeen: WaTunnelSeen | null = null
  let tunnelAt = 0
  /** The proxy the running Chrome was started with (null: directly, or not running). */
  let proxyInUse: string | null = null
  const seeTunnel = (t: TunnelCheck) => {
    tunnelAt = now()
    tunnelSeen = t.ok ? { up: true, why: null, via: t.via, at: new Date(tunnelAt).toISOString() } : { up: false, why: t.why, via: null, at: new Date(tunnelAt).toISOString() }
  }
  const checkNow = async (): Promise<TunnelCheck> => {
    const t = await (o.tunnel!.check ?? checkTunnel)(o.tunnel!.file).catch((e: unknown): TunnelCheck => ({ ok: false, why: `the tunnel could not be checked (${message(e)})` }))
    seeTunnel(t)
    return t
  }

  const linked = () => {
    if (!settings.linked) return false
    try {
      return readdirSync(profile).length > 0
    } catch {
      return false
    }
  }

  const host = createHost({
    script: o.script ?? path.join(import.meta.dirname, 'worker.ts'),
    env: { SAD_WA_LIB: libDir, SAD_WA_AUTH: authDir, ...(chrome ? { SAD_WA_CHROME: chrome } : {}), ...o.env },
    pidFile: path.join(o.dir, 'running.json'),
    log,
    on: onWorker,
    onExit: code => {
      clearIdle()
      proxyInUse = null
      if (code !== 0) log.warn(`WhatsApp's process ended unexpectedly (code ${code ?? 'none'})`)
      engine = { ...engine, state: engine.state === 'failed' ? 'failed' : 'off', qr: null, pairingCode: null, loading: null, reason: code === 0 ? engine.reason : 'WhatsApp stopped unexpectedly. It opens again when it is used.' }
      changed()
    },
    ...o.host,
  })

  /**
   * F-312: what he is told about each number: when it was last connected, and why it stopped being. On 19 Nov the first number was logged out by WhatsApp 32 s after a restart and nothing said so
   * (the logs had to be read): a connected session that ends for ANY reason is written down in the words the engine gave (LOGOUT, a conflict, a dropped link), and a saved login that WhatsApp
   * refuses (it shows a QR instead) is too. A number that was never linked asking for its first scan is not an end.
   */
  function noteEnds(was: EngineStatus['state'], next: EngineStatus, wasLinked: boolean) {
    const at = new Date(now()).toISOString()
    if (next.state === 'ready' && was !== 'ready') saveSettings({ lastConnectedAt: at })
    else if ((was === 'ready' || was === 'linking') && (next.state === 'off' || next.state === 'failed')) saveSettings({ lastEnd: { at, why: next.reason ?? 'It disconnected.' } })
    else if (next.state === 'qr' && was !== 'qr' && wasLinked) saveSettings({ lastEnd: { at, why: 'WhatsApp asked for a new scan: the login saved here was not accepted.' } })
  }

  function onWorker(e: WorkerEvent) {
    if (e.t === 'status') {
      const was = engine.state
      engine = e.status
      if (was !== engine.state) log.info(`WhatsApp: ${engine.state}`)
      noteEnds(was, engine, settings.linked)
      if (engine.linked === true && (!settings.linked || (engine.me?.name && engine.me.name !== settings.name))) saveSettings({ linked: true, name: engine.me?.name ?? settings.name })
      if (engine.linked === false && settings.linked) saveSettings({ linked: false })
      changed()
    } else if (e.t === 'message') {
      push({ t: 'message', message: e.message as WaMessage })
      events.add({ t: 'message', message: e.message as WaMessage })
    } else if (e.t === 'ack') {
      push({ t: 'ack', id: e.id, chatId: e.chatId, ack: e.ack })
      events.add({ t: 'ack', id: e.id, chatId: e.chatId, ack: e.ack })
    }
  }

  function status(): WaStatus {
    const open = host.running()
    const state = open ? engine.state : engine.state === 'failed' ? 'failed' : 'off'
    return {
      setup: setup.state,
      setupNote: setup.note,
      state,
      linked: linked(),
      me: engine.me ?? (settings.name ? { name: settings.name, phone: null } : null),
      qr: state === 'qr' ? engine.qr : null,
      pairingCode: state === 'qr' ? engine.pairingCode : null,
      loading: open ? engine.loading : null,
      reason: engine.reason,
      alwaysOn: stays(),
      closesAt,
      lastConnectedAt: settings.lastConnectedAt,
      lastEnd: settings.lastEnd,
      drafts: drafts.list(),
      assistantSentLastHour: drafts.sentLastHour(),
      ...(route() ? { route: route()!, tunnel: tunnelSeen } : {}),
    }
  }

  function push(m: WaLive) {
    const text = JSON.stringify(m)
    for (const s of sockets) s.sendText(text)
  }
  /** Something changed: the open pages hear the new status (once per turn), and whoever waits looks again. */
  function changed() {
    for (const w of [...waiters]) w()
    if (queued) return
    queued = true
    queueMicrotask(() => {
      queued = false
      if (sockets.size) push({ t: 'status', status: status() })
    })
  }
  const nextChange = (ms: number) =>
    new Promise<void>(resolve => {
      const done = () => {
        clearTimeout(t)
        waiters.delete(done)
        resolve()
      }
      const t = setTimeout(done, ms)
      waiters.add(done)
    })

  // --- on demand ------------------------------------------------------------------------------

  function clearIdle() {
    if (idle) clearTimeout(idle)
    idle = null
    closesAt = null
  }
  /** It was used: it closes WA_IDLE_MS from now, unless it stays on or a WhatsApp page is open. */
  function touch() {
    clearIdle()
    if (host.running() && !stays() && sockets.size === 0) {
      const ms = o.idleMs ?? WA_IDLE_MS
      closesAt = new Date(now() + ms).toISOString()
      idle = setTimeout(() => {
        idle = null
        closesAt = null
        log.info('WhatsApp closes: not used for a while')
        void shut('Closed after 10 minutes without use. It opens again when it is used.')
      }, ms)
      idle.unref?.()
    }
    changed()
  }

  /** The login folder: this Windows user only (icacls, inherited rights removed), before Chrome writes anything in it. */
  function lockAuth() {
    mkdirSync(authDir, { recursive: true })
    if (locked || o.lock === false || process.platform !== 'win32') return
    const user = `${process.env.USERDOMAIN ?? ''}\\${process.env.USERNAME ?? ''}`
    const r = spawnSync('icacls', [authDir, '/inheritance:r', '/grant:r', `${user}:(OI)(CI)F`], { encoding: 'utf8', windowsHide: true })
    if (r.status !== 0) throw apiError(500, `The login folder could not be locked to your Windows account: ${(r.stdout || r.stderr || '').trim().slice(0, 200)}`)
    locked = true
  }

  async function open(): Promise<void> {
    if (!isReady()) throw apiError(409, 'WhatsApp is not set up on this PC yet. Set it up on the WhatsApp page first.')
    if (!chrome) throw apiError(409, 'There is no Chrome on this PC: WhatsApp runs in Google Chrome. Install it, then try again.')
    // F-312: an extra number is refused here, in plain words, when the Server has no memory to spare (the first number is given no such check).
    if (!(host.running() && engine.state !== 'off' && engine.state !== 'failed')) o.beforeOpen?.()
    lockAuth()
    if (host.running() && engine.state !== 'off' && engine.state !== 'failed') return touch()
    // Order o55b6: through the Z800, Chrome starts only with a tunnel checked just now (its note, its listener's PID, a SOCKS5 greeting). If it is
    // not there, WhatsApp does not open, and says why: it never goes out directly in its place (Lead's condition 2).
    let start: { proxy?: string } = {}
    if (route() === 'z800') {
      const t = await checkNow()
      if (!t.ok) {
        const why = `WhatsApp goes out through the Z800 here, and that way is not ready: ${t.why}. It does not go out directly instead; to go directly, choose "Directly" on the WhatsApp page.`
        engine = { ...engine, state: 'failed', qr: null, pairingCode: null, loading: null, reason: why }
        log.warn(`WhatsApp not opened: ${t.why}`)
        // F-312: the first time it could not open is the time to keep (18 Nov: three starts in a row said so and nothing was kept); a later one says the same and leaves it.
        if (!settings.lastEnd?.why.startsWith('Could not open')) saveSettings({ lastEnd: { at: new Date(now()).toISOString(), why: `Could not open: ${t.why}.` } })
        changed()
        throw apiError(503, why)
      }
      start = { proxy: t.proxy }
    }
    await host.spawn()
    if (engine.state === 'off' || engine.state === 'failed') {
      await host.call('start', start)
      proxyInUse = start.proxy ?? null
    }
    touch()
  }

  /** Open and connected (the Assistant's reads and his sends wait up to `ms` for it). */
  async function connected(ms = 60_000): Promise<void> {
    if (!linked() && engine.state !== 'ready') throw apiError(409, 'WhatsApp is not linked yet: Shubham links it once on the WhatsApp page (a QR to scan with his phone).')
    await open()
    const until = now() + ms
    while (engine.state !== 'ready') {
      if (engine.state === 'qr') throw apiError(409, 'WhatsApp needs linking again: Shubham scans the QR on the WhatsApp page.')
      if (engine.state === 'failed') throw apiError(502, `WhatsApp could not open: ${engine.reason ?? 'no reason given'}`)
      if (!host.running()) throw apiError(503, 'WhatsApp stopped while it was opening.')
      const left = until - now()
      if (left <= 0) throw apiError(504, 'WhatsApp is still opening (it can take a minute). Try again shortly.')
      await nextChange(Math.min(left, 1000))
    }
    touch()
  }

  async function shut(reason: string | null) {
    clearIdle()
    proxyInUse = null
    const wasReady = engine.state === 'ready'
    await host.quit()
    if (wasReady) saveSettings({ lastEnd: { at: new Date(now()).toISOString(), why: reason ?? 'Closed.' } })
    engine = { ...engine, state: 'off', qr: null, pairingCode: null, loading: null, reason }
    changed()
  }

  // --- what he does ---------------------------------------------------------------------------

  function startSetup() {
    if (setup.state === 'installing') return
    if (setup.state === 'ready' && isReady()) return
    setup = { state: 'installing', note: "Getting WhatsApp's program…" }
    changed()
    const progress = (note: string) => {
      setup = { ...setup, note }
      changed()
    }
    const job = o.install ? o.install() : installLib({ libDir, log, progress })
    job.then(
      () => {
        setup = { state: 'ready', note: null }
        changed()
      },
      e => {
        log.warn(`the WhatsApp setup failed: ${message(e)}`)
        setup = { state: 'failed', note: `The setup failed: ${message(e)}` }
        changed()
      },
    )
  }

  async function pairCode(body: unknown): Promise<{ code: string }> {
    const phone = isObject(body) && typeof body.phone === 'string' ? body.phone : ''
    if (engine.state !== 'qr' || !host.running()) throw apiError(409, 'WhatsApp is not showing a QR right now: open it first.')
    touch()
    return host.call<{ code: string }>('pairCode', { phone })
  }

  async function unlink(): Promise<{ told: boolean }> {
    let told = false
    if (linked() || engine.state === 'ready') {
      try {
        await connected(60_000)
        told = (await host.call<{ told: boolean }>('logout')).told
      } catch (e) {
        log.warn(`unlinking: WhatsApp could not be told (${message(e)})`)
      }
    }
    clearIdle()
    await host.quit()
    for (let i = 0; i < 8 && existsSync(profile); i++) {
      try {
        rmSync(profile, { recursive: true, force: true })
      } catch {
        // Chrome lets go of its files a moment after it ends.
      }
      if (existsSync(profile)) await sleep(500)
    }
    if (existsSync(profile)) log.warn('the saved WhatsApp login could not be deleted yet (its files are still in use)')
    saveSettings({ linked: false, name: null })
    engine = {
      state: 'off',
      qr: null,
      pairingCode: null,
      me: null,
      loading: null,
      linked: false,
      reason: told ? 'Unlinked: WhatsApp no longer lists this device.' : 'The login saved here is deleted. If "Shubham Agentic" is still under Linked devices on your phone, log it out there.',
    }
    log.info(told ? 'WhatsApp unlinked' : 'WhatsApp: the saved login was deleted (WhatsApp itself could not be told)')
    changed()
    return { told }
  }

  async function send(body: unknown, r?: ProofRequest): Promise<WaMessage> {
    const req = (isObject(body) ? body : {}) as Partial<WaSendRequest>
    const chatId = typeof req.chatId === 'string' ? req.chatId : ''
    const text = typeof req.text === 'string' ? req.text : ''
    const draft = typeof req.draft === 'string' ? req.draft : ''
    if (!CHAT_ID.test(chatId)) throw apiError(400, 'Expected {chatId, text, sig}')
    if (!text.trim()) throw apiError(400, 'The message is empty.')
    if (text.length > WA_TEXT_MAX) throw apiError(400, `A message is at most ${WA_TEXT_MAX} characters.`)
    // His tap, signed on his approval device over exactly this chat, these words and this draft: before anything else.
    const who = o.human('wa-send', [chatId, sha256(text), draft], req.sig, r)
    if (draft) {
      drafts.get(draft, chatId)
      drafts.allowSend()
    } else {
      const t = now()
      mine = mine.filter(x => x > t - 60_000)
      if (mine.length >= MINE_PER_MINUTE) throw apiError(429, `${MINE_PER_MINUTE} messages in a minute: wait a moment.`)
      mine.push(t)
    }
    await connected()
    const m = await host.call<WaMessage>('send', { chatId, text })
    if (draft) {
      drafts.drop(draft)
      drafts.sent()
    }
    log.info(`a WhatsApp message was sent${draft ? " (the Assistant's draft)" : ''}, signed by ${who}`)
    changed()
    return m
  }

  // --- the Assistant ----------------------------------------------------------------------------

  const tools: WaTools = {
    status,
    async chats() {
      await connected()
      return host.call<WaChat[]>('chats')
    },
    async read(chatId, count) {
      if (!CHAT_ID.test(chatId)) throw apiError(400, 'That is not a WhatsApp chat id (they come from wa_chats).')
      await connected()
      return host.call<WaMessage[]>('messages', { chatId, count: Math.max(1, Math.min(20, Math.floor(count) || 10)) })
    },
    async draft(chatId, text, why) {
      if (!CHAT_ID.test(chatId)) throw apiError(400, 'That is not a WhatsApp chat id (they come from wa_chats).')
      await connected()
      const chat = (await host.call<WaChat[]>('chats')).find(c => c.id === chatId)
      if (!chat) throw apiError(404, 'Shubham has no chat with that id. The Assistant drafts only to people he already has a chat with (see wa_chats).')
      const d = drafts.add(chat, text, why)
      log.info('the Assistant drafted a WhatsApp message')
      changed()
      return d
    },
  }

  // --- the page's API ---------------------------------------------------------------------------

  async function http(req: MountRequest): Promise<unknown> {
    const { method, rest, query, body } = req
    const route = `${method} ${rest}`
    switch (route) {
      case 'GET /status':
        return status()
      case 'POST /setup':
        startSetup()
        return status()
      case 'POST /open':
        await open()
        return status()
      case 'POST /close':
        await shut('Closed.')
        return status()
      case 'POST /pair-code':
        return pairCode(body)
      case 'POST /unlink':
        return { ...(await unlink()), status: status() }
      case 'GET /chats':
        await connected()
        return host.call<WaChat[]>('chats')
      case 'GET /events': {
        // Order oWA S7: what is new since a position (no position: where the feed is now). `wait` (ms, at most WA_EVENTS_WAIT_MAX_MS) makes an ask with nothing new wait for the next event.
        const raw = query.get('since')
        const since = raw !== null && /^\d{1,15}$/.test(raw) ? Number(raw) : null
        const wait = Math.max(0, Math.min(Number(query.get('wait')) || 0, WA_EVENTS_WAIT_MAX_MS))
        return events.read({ since, run: query.get('run'), waitMs: wait })
      }
      case 'GET /messages': {
        const chatId = query.get('chat') ?? ''
        if (!CHAT_ID.test(chatId)) throw apiError(400, 'Expected ?chat=<chat id>')
        const count = Math.max(1, Math.min(WA_READ_MAX, Number(query.get('count')) || 40))
        await connected()
        return host.call<WaMessage[]>('messages', { chatId, count, ...(query.get('before') ? { before: query.get('before') } : {}) })
      }
      // Order oWA S4: the people behind the chats (the contact panel, read receipts, archive, pin, a number typed for a new chat).
      case 'GET /contact': {
        const chatId = query.get('chat') ?? ''
        if (!CHAT_ID.test(chatId)) throw apiError(400, 'Expected ?chat=<chat id>')
        await connected()
        return host.call<WaContactDetails>('contact', { chatId })
      }
      case 'GET /profile-pic': {
        const chatId = query.get('chat') ?? ''
        if (!CHAT_ID.test(chatId)) throw apiError(400, 'Expected ?chat=<chat id>')
        await connected()
        return host.call<{ url: string | null }>('profilePic', { chatId })
      }
      case 'POST /seen':
      case 'POST /archive':
      case 'POST /pin': {
        const op = rest === '/seen' ? 'seen' : rest === '/archive' ? 'archive' : 'pin'
        const b = isObject(body) ? body : {}
        const chatId = typeof b.chatId === 'string' ? b.chatId : ''
        if (!CHAT_ID.test(chatId)) throw apiError(400, 'Expected {chatId}')
        if (op !== 'seen' && typeof b.on !== 'boolean') throw apiError(400, 'Expected {chatId, on: true | false}')
        await connected()
        await host.call(op, op === 'seen' ? { chatId } : { chatId, on: b.on })
        return { ok: true }
      }
      case 'POST /new-chat': {
        const number = isObject(body) && typeof body.number === 'string' ? body.number : ''
        if (!number || number.length > 40) throw apiError(400, 'Expected {number}')
        await connected()
        return host.call<WaNewChat>('newChat', { number })
      }
      case 'POST /send':
        return send(body, req)
      case 'PATCH /settings': {
        if (isObject(body) && body.route !== undefined && body.alwaysOn === undefined) return setRoute(body.route)
        if (!isObject(body) || typeof body.alwaysOn !== 'boolean') throw apiError(400, 'Expected {alwaysOn} or {route}')
        if (body.alwaysOn && o.neverStayOpen) throw apiError(400, 'Only the first number can stay open. This one opens when it is used and closes after a while without use.')
        saveSettings({ alwaysOn: body.alwaysOn })
        if (body.alwaysOn && linked()) await open()
        else touch()
        return status()
      }
    }
    const drop = /^DELETE \/drafts\/([\w-]{1,64})$/.exec(route)
    if (drop) {
      drafts.drop(drop[1])
      changed()
      return status()
    }
    throw apiError(404, `No such path: ${WA_PREFIX}${rest}`)
  }

  const mount: ApiMount = {
    prefix: WA_PREFIX,
    http,
    ws(rest) {
      if (rest !== '/live') return null
      return socket => {
        sockets.add(socket)
        socket.sendText(JSON.stringify({ t: 'status', status: status() } satisfies WaLive))
        touch()
        socket.onClose(() => {
          sockets.delete(socket)
          touch()
        })
      }
    },
  }

  /** Order o55b6: his choice of the way out. A WhatsApp open the other way is closed, saying so; it opens the new way when next used. */
  async function setRoute(raw: unknown): Promise<WaStatus> {
    if (!o.tunnel) throw apiError(400, 'This WhatsApp has no other way out to choose.')
    if (raw !== 'direct' && raw !== 'z800') throw apiError(400, 'Expected {route: "direct" | "z800"}')
    if (raw === route()) return status()
    saveSettings({ route: raw })
    log.info(`WhatsApp now goes out ${raw === 'z800' ? 'through the Z800' : 'directly'}`)
    if (host.running()) await shut(`Closed: it now goes out ${raw === 'z800' ? 'through the Z800' : 'directly'}, and opens that way when it is next used.`)
    if (raw === 'z800') await checkNow()
    else tunnelSeen = null
    changed()
    return status()
  }

  // Order o55b6: while Chrome runs through the tunnel, the tunnel is checked again every everyMs (30 s). Gone, moved (another port), or held by
  // another PID: WhatsApp is closed and says why, never left to fall back. While it is closed, the status the page reads is refreshed at the
  // same pace, so the page shows the tunnel as it is before he opens.
  const tunnelTimer = o.tunnel
    ? setInterval(() => {
        if (route() !== 'z800') return
        const running = host.running() && proxyInUse !== null
        if (!running && now() - tunnelAt < (o.tunnel!.everyMs ?? 30_000)) return
        void checkNow().then(t => {
          if (!running || !host.running() || proxyInUse === null) return changed()
          if (!t.ok || t.proxy !== proxyInUse) {
            const why = t.ok ? `the tunnel moved (now ${t.proxy}, Chrome was started with ${proxyInUse})` : t.why
            log.warn(`WhatsApp closed: the way through the Z800 changed: ${why}`)
            void shut(`Closed: WhatsApp goes out through the Z800 here, and that way stopped: ${why}. It does not go out directly instead.`)
          } else changed()
        })
      }, Math.min(o.tunnel.everyMs ?? 30_000, 30_000))
    : null
  tunnelTimer?.unref?.()
  if (o.tunnel) void checkNow().then(() => changed())

  // A crash may have left the last run's Chrome holding the login: end exactly that. Then, if it stays on, open it.
  void host.sweep().then(() => {
    if (stays() && linked() && isReady()) open().catch(e => log.warn(`WhatsApp did not open at start: ${message(e)}`))
  })

  return {
    mount,
    tools,
    status,
    async media(chatId, messageId) {
      if (!CHAT_ID.test(chatId)) throw apiError(400, 'Expected ?chat=<chat id>')
      if (!MESSAGE_ID.test(messageId)) throw apiError(400, 'Expected ?msg=<message id>')
      await connected()
      const f = await host.call<WaMediaFile>('media', { chatId, messageId })
      return { bytes: Buffer.from(f.data, 'base64'), mimetype: f.mimetype, filename: f.filename }
    },
    async close() {
      clearIdle()
      events.close()
      if (tunnelTimer) clearInterval(tunnelTimer)
      await host.quit()
    },
  }
}
