import { EventEmitter } from 'node:events'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { waPreview, WA_MEDIA_GONE, WA_MEDIA_MAX_BYTES, WA_MEDIA_TOO_BIG, type WaChat, type WaContactDetails, type WaGroupParticipant, type WaMe, type WaMediaFile, type WaMessage, type WaMessageType, type WaNewChat, type WaState } from '../../shared/whatsapp.ts'

// F-079: one linked WhatsApp device, driven through whatsapp-web.js (WhatsApp Web in the PC's own Chrome).
// Ported from techserverbz/whatsapp-backend src/engines/webjs/engine.ts (Oct 2026), keeping what it learned
// on today's WhatsApp:
// - `ready` often never fires, so after `authenticated` WhatsApp Web's own state is polled until CONNECTED,
//   and a client that never gets there is reopened (twice at most);
// - the WhatsApp Web build is never pinned: WhatsApp unlinks an old build a few minutes after it connects;
// - before a launch only the profile's Service Worker is cleared (it can serve another app shell); the rest of
//   the cache stays, so opening again is quick;
// - Chrome is always closed with destroy(): its login is a LevelDB store, and a killed Chrome can corrupt it.
// Not taken: killing Chrome by its command line (this app ends a process by exact PID only), the CRM login,
// and its own copy of every message (this keeps none; WhatsApp Web has the history).
// New here: a generation number, so events from a client that was already closed change nothing.

/** The part of whatsapp-web.js's Client this uses: the real one (worker.ts), or a test's. */
export interface WaClient {
  on(event: string, listener: (...args: unknown[]) => void): unknown
  initialize(): Promise<unknown>
  /** Closes Chrome; the login stays. */
  destroy(): Promise<unknown>
  /** Unlinks the device on WhatsApp's side, closes Chrome and deletes the saved login. */
  logout(): Promise<unknown>
  getState(): Promise<unknown>
  getChats(): Promise<unknown[]>
  getChatById(id: string): Promise<unknown>
  sendMessage(chatId: string, content: string): Promise<unknown>
  requestPairingCode(phone: string, showNotification?: boolean): Promise<unknown>
  // Order oWA S4: what the contact panel, the chat list's numbers and the chat's own actions use. Optional: a program that lacks one answers "it cannot do that", never a crash.
  getContactById?(id: string): Promise<unknown>
  /** Privacy ids (…@lid) to what WhatsApp Web knows of them: [{ lid, pn }] in the order asked, `pn` the phone number's id (…@c.us). */
  getContactLidAndPhone?(ids: string[]): Promise<unknown>
  getProfilePicUrl?(id: string): Promise<unknown>
  sendSeen?(chatId: string): Promise<unknown>
  archiveChat?(chatId: string): Promise<unknown>
  unarchiveChat?(chatId: string): Promise<unknown>
  pinChat?(chatId: string): Promise<unknown>
  unpinChat?(chatId: string): Promise<unknown>
  getNumberId?(number: string): Promise<unknown>
  // Order oWA S3: a message by its id (to open its file).
  getMessageById?(id: string): Promise<unknown>
  info?: unknown
  pupBrowser?: unknown
}

export interface EngineOptions {
  /** A new client (whatsapp-web.js's, or a test's). */
  createClient(): WaClient
  /** The QR's text as an image (a data URL). */
  qrImage(text: string): Promise<string>
  /** This login's Chrome profile (LocalAuth's session-<id> folder): its Service Worker is cleared before a launch. */
  profileDir: string
  /** One line about what happened; never a message, a number or the QR. */
  log?(line: string): void
  /** Tests: shorter waits. */
  pollMs?: number
  pollTries?: number
  retryMs?: number
  /** Order o714a: how long a caller waits for the chat list before being told it is still being read (default 12 s: under the callers' own 20 s). */
  chatsWaitMs?: number
  /** Order o714a: a list read this recently is served as it is (default 2 s). */
  chatsFreshMs?: number
  /** Order o714a: a read that has run this long is given up on, and the next caller starts another (default 5 minutes). */
  chatsStuckMs?: number
  /** Order oWA S4: how long a read of the chat list waits for the phone numbers behind its privacy ids (default 1.5 s; they are filled in as they come, and a later read has them). */
  numbersWaitMs?: number
}

export interface EngineStatus {
  state: WaState
  qr: string | null
  pairingCode: string | null
  me: WaMe | null
  reason: string | null
  loading: number | null
  /** What this run learned: true once connected, false when WhatsApp asks for a scan or let the device go; null before. */
  linked: boolean | null
}

export interface EngineEvents {
  status: [EngineStatus]
  message: [WaMessage]
  ack: [{ id: string; chatId: string; ack: number }]
}

/** Launches tried before giving up (whatsapp-web.js sometimes fails while WhatsApp Web is still loading). */
const LAUNCHES = 4
/** Reopenings when WhatsApp was linked but never reached CONNECTED. */
const RECYCLES = 2

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (typeof v === 'object' && v !== null ? (v as Obj) : {})
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
/** whatsapp-web.js's ids are objects: `_serialized`, or `$1` since WhatsApp renamed it (whatsapp-web.js #201832). */
export const idOf = (v: unknown): string => (typeof v === 'string' ? v : str(obj(v)._serialized) || str(obj(v).$1))
export const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** A library's error, fit for a log line: no numbers, no WhatsApp ids, short. */
export function clean(text: string): string {
  return text
    .replace(/\S*@(c\.us|g\.us|lid|s\.whatsapp\.net|broadcast|newsletter)\b/g, '<id>')
    .replace(/\+?\d[\d\s-]{6,}\d/g, '<number>')
    .replace(/data:[^\s"']+/g, '<data>')
    .replace(/\s+/g, ' ')
    .slice(0, 200)
}

const TYPES = new Set<WaMessageType>(['chat', 'image', 'video', 'audio', 'ptt', 'document', 'sticker', 'location', 'vcard', 'multi_vcard', 'revoked'])
const MEDIA = new Set(['image', 'video', 'audio', 'ptt', 'document', 'sticker'])
/** Chats that aren't conversations: status updates, channels. */
const NOT_A_CHAT = /@(broadcast|newsletter)$/
/** Order oWA S4: a number WhatsApp Web could not place behind a privacy id is asked for again after this. */
const NUMBER_MISS_MS = 10 * 60_000
/** Privacy ids asked about in one go (one that WhatsApp Web cannot place fails the answer, and is then asked alone). */
const NUMBER_BATCH = 25
/** The numbers kept (a privacy id and its number do not change): enough for any chat list, and emptied if it ever grows past this. */
const NUMBERS_KEPT = 5000
/** Members of a group whose names and numbers are looked up for the contact panel, and the most that panel's read may take. */
const MEMBERS_NAMED = 64
const CONTACT_BUDGET_MS = 12_000

/**
 * Digits of a phone number's id (…@c.us, …@s.whatsapp.net) or of a typed number; '' for any other id: the digits of a privacy id (…@lid) or of a group's id are not a number and must
 * never be taken for one.
 */
export function numberFromId(id: string): string {
  const [user, domain] = id.split('@')
  if (domain !== undefined && domain !== 'c.us' && domain !== 's.whatsapp.net') return ''
  return user.replace(/\D/g, '')
}

const unsupported = (what: string) => Object.assign(new Error(`This WhatsApp program cannot ${what}.`), { status: 501 })

/** Whether a message is one a person wrote (not a notification of WhatsApp's own: a key change, a group event, ...). */
export function shown(raw: unknown): boolean {
  return TYPES.has((str(obj(raw).type) || 'chat') as WaMessageType)
}

/** whatsapp-web.js message -> WaMessage. */
export function toMessage(raw: unknown): WaMessage {
  const m = obj(raw)
  const data = obj(m._data)
  const t = str(m.type) || 'chat'
  const type: WaMessageType = TYPES.has(t as WaMessageType) ? (t as WaMessageType) : 'other'
  const fromMe = m.fromMe === true
  const chatId = fromMe ? idOf(m.to) : idOf(m.from)
  return {
    id: idOf(m.id),
    chatId,
    fromMe,
    author: !fromMe && chatId.endsWith('@g.us') ? str(data.notifyName) || null : null,
    type,
    text: str(m.body),
    at: num(m.timestamp) * 1000,
    ack: typeof m.ack === 'number' ? m.ack : 0,
    hasMedia: m.hasMedia === true || MEDIA.has(t),
    filename: str(data.filename) || null,
  }
}

/** whatsapp-web.js chat -> WaChat. */
export function toChat(raw: unknown): WaChat {
  const c = obj(raw)
  const id = idOf(c.id)
  const last = c.lastMessage
  return {
    id,
    name: str(c.name) || id.split('@')[0] || 'Unknown',
    isGroup: c.isGroup === true || id.endsWith('@g.us'),
    unread: num(c.unreadCount),
    at: num(c.timestamp) * 1000,
    last: last ? waPreview(toMessage(last)) : '',
    lastFromMe: obj(last).fromMe === true,
    muted: c.isMuted === true,
    archived: c.archived === true,
    pinned: c.pinned === true,
  }
}

/**
 * A launch error in plain words, and whether trying again could help. A certificate error is a network that won't
 * let WhatsApp Web through (seen 2 Nov 2026 on the office network: a FortiGate firewall re-signs web.whatsapp.com,
 * and only that host, with its own certificate): trying again can't help, and the network's owner has to allow it.
 */
export function explain(raw: string): { reason: string; retry: boolean } {
  if (/ERR_CERT_|ERR_SSL_|CERT_AUTHORITY|certificate/i.test(raw))
    return { reason: "This network won't let WhatsApp Web through: the certificate it shows for web.whatsapp.com isn't WhatsApp's (a firewall is checking or blocking it). Whoever runs the network has to allow web.whatsapp.com for this PC.", retry: false }
  if (/ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_|ERR_CONNECTION_|ERR_TIMED_OUT|ERR_ADDRESS_UNREACHABLE/.test(raw))
    return { reason: `WhatsApp Web could not be reached (${clean(raw)}). Is the internet up?`, retry: true }
  return { reason: `WhatsApp Web did not open: ${clean(raw)}`, retry: true }
}

/** Why WhatsApp let go of the device, in plain words. */
function reasonOf(raw: unknown): string {
  const r = str(raw) || message(raw)
  if (r === 'LOGOUT') return 'This device was unlinked (on the phone, or by WhatsApp). Link it again to use WhatsApp here.'
  if (r === 'CONFLICT') return 'WhatsApp was opened on another computer, so this one let go.'
  return `WhatsApp disconnected (${clean(r) || 'no reason given'}).`
}

const notReady = () => Object.assign(new Error('WhatsApp is not open yet: it opens when it is used. Try again in a moment.'), { status: 409 })

/**
 * Order o714a (17 Nov 2026): the chat list is still being read. The FIRST read after a link is slow (whatsapp-web.js's getChats() waits on WhatsApp for every
 * group's details while WhatsApp Web is still doing its first sync: the backend log showed ready at 11:24:09 and its first error exactly 60 s later), so a caller
 * is told so in plain words, with a code the page reads to wait and ask again by itself. It is a 409 (not ready yet), never a 500 "could not answer".
 */
export const CHATS_LOADING = 'wa-chats-loading'
const stillReading = () =>
  Object.assign(new Error('WhatsApp is still reading your chats. The first time after linking this can take a few minutes. Nothing is lost: it opens by itself, or try again in a minute.'), { status: 409, code: CHATS_LOADING })

interface ChatsRead {
  promise: Promise<WaChat[]>
  /** When it began, and in which generation (a stop or an unlink ends it). */
  at: number
  gen: number
}

export class WaEngine extends EventEmitter<EngineEvents> {
  private readonly o: EngineOptions & { pollMs: number; pollTries: number; retryMs: number; chatsWaitMs: number; chatsFreshMs: number; chatsStuckMs: number; numbersWaitMs: number }
  private client: WaClient | null = null
  /** Order oWA S4: the phone number behind each privacy id WhatsApp Web has placed, the ones it could not (until when not to ask again), and the run asking for the chat list's. */
  private readonly numbers = new Map<string, string>()
  private readonly numberMiss = new Map<string, number>()
  private numberFill: Promise<void> | null = null
  /** The one read of the chat list under way (everyone who asks while it runs is given THAT read), and the list it last gave. */
  private chatsRead: ChatsRead | null = null
  private chatsLast: { list: WaChat[]; at: number; gen: number } | null = null
  /** Goes up at every launch and stop: a client's events count only while their generation is the current one. */
  private gen = 0
  private st: EngineStatus = { state: 'off', qr: null, pairingCode: null, me: null, reason: null, loading: null, linked: null }
  private poll: ReturnType<typeof setInterval> | null = null
  private polls = 0
  private recycles = 0
  private retry: ReturnType<typeof setTimeout> | undefined

  constructor(o: EngineOptions) {
    super()
    this.o = { pollMs: 3000, pollTries: 30, retryMs: 1500, chatsWaitMs: 12_000, chatsFreshMs: 2_000, chatsStuckMs: 5 * 60_000, numbersWaitMs: 1_500, ...o }
  }

  status(): EngineStatus {
    return { ...this.st }
  }

  /** Opens WhatsApp; does nothing when it is open or opening. Progress comes as 'status' events. */
  start(): void {
    if (this.client) return
    this.recycles = 0
    this.set({ state: 'starting', qr: null, pairingCode: null, reason: null, loading: null })
    this.launch(1)
  }

  /** Closes Chrome and keeps the login, so the next start needs no QR. Never rejects. */
  async stop(reason: string | null = null): Promise<void> {
    const c = this.halt()
    // destroy() lets Chrome write its login to disk and close: never skip it.
    if (c) await c.destroy().catch(e => this.o.log?.(`closing: ${clean(message(e))}`))
    this.set({ state: 'off', qr: null, pairingCode: null, loading: null, reason })
  }

  /** Unlinks this device on WhatsApp's side and deletes the saved login. Never rejects; says whether WhatsApp was told. */
  async logout(): Promise<boolean> {
    const c = this.halt()
    let told = false
    if (c) {
      try {
        await c.logout()
        told = true
      } catch (e) {
        this.o.log?.(`unlinking: ${clean(message(e))}`)
      }
      await c.destroy().catch(() => undefined)
    }
    this.set({ state: 'off', qr: null, pairingCode: null, loading: null, me: null, reason: 'Unlinked.', linked: false })
    return told
  }

  /** In place of the QR, a code he types on his phone (Linked devices › Link with phone number instead). */
  async pairCode(phone: string): Promise<string> {
    const digits = phone.replace(/\D/g, '')
    if (digits.length < 8 || digits.length > 15) throw Object.assign(new Error('Give the phone number with its country code, digits only (for India: 91 and the 10 digits).'), { status: 400 })
    if (!this.client || this.st.state !== 'qr') throw Object.assign(new Error('WhatsApp is not waiting to be linked right now.'), { status: 409 })
    const code = str(await this.client.requestPairingCode(digits, true))
    if (!code) throw new Error('WhatsApp gave no code. Try the QR instead.')
    this.set({ pairingCode: code })
    return code
  }

  /**
   * The chats, newest first (no status updates or channels). Order o714a: ONE read of them at a time, for everyone who asks (a second "Try again" while the
   * first is still running used to start another inside WhatsApp Web, which only made the wait longer), and the list is kept:
   * - one read a moment ago is served as it is;
   * - a read that finishes within the caller's wait is its answer;
   * - a read still going after it (the cold first read after a link): the list he last saw if there is one, else a plain "still reading" (409, code
   *   wa-chats-loading), while the read itself goes on and is there for the next caller;
   * - a read that fails is not remembered (its error is the caller's), and one that never answers is given up on after a while (WhatsApp Web wedged).
   */
  async chats(): Promise<WaChat[]> {
    const client = this.need()
    const gen = this.gen
    const last = this.chatsLast
    if (last && last.gen === gen && Date.now() - last.at < this.o.chatsFreshMs) return last.list
    const read = this.readChats(client, gen)
    let timer: ReturnType<typeof setTimeout> | undefined
    const waited = new Promise<null>(resolve => {
      timer = setTimeout(() => resolve(null), this.o.chatsWaitMs)
      timer.unref()
    })
    try {
      const got = await Promise.race([read.promise.then(list => ({ list })), waited])
      if (got) return got.list
    } finally {
      clearTimeout(timer)
    }
    if (this.chatsLast && this.chatsLast.gen === gen) return this.chatsLast.list
    throw stillReading()
  }

  /** The read under way, or a new one when there is none (or the one there is has run past chatsStuckMs, or belongs to a closed session). */
  private readChats(client: WaClient, gen: number): ChatsRead {
    const cur = this.chatsRead
    if (cur && cur.gen === gen && Date.now() - cur.at < this.o.chatsStuckMs) return cur
    const promise = client.getChats().then(async raw => {
      const list = raw
        .map(toChat)
        .filter(c => c.id && !NOT_A_CHAT.test(c.id))
        .sort((a, b) => b.at - a.at)
      if (gen === this.gen) this.chatsLast = { list, at: Date.now(), gen }
      // Order oWA S4: the number behind each privacy id, so the CRM can be matched by it. Waited for only a moment: WhatsApp Web answers as it can, each answer goes into THIS list as it
      // comes, and the next read of the list has them all.
      const learning = this.fillNumbers(client, gen, list)
      if (learning) {
        let timer: ReturnType<typeof setTimeout> | undefined
        const moment = new Promise<void>(resolve => {
          timer = setTimeout(resolve, this.o.numbersWaitMs)
          timer.unref()
        })
        await Promise.race([learning, moment]).finally(() => clearTimeout(timer))
      }
      return list
    })
    const read: ChatsRead = { promise, at: Date.now(), gen }
    this.chatsRead = read
    const done = () => {
      if (this.chatsRead === read) this.chatsRead = null
    }
    promise.then(done, done)
    return read
  }

  /**
   * The latest `count` messages of a chat, or the `count` before message `before`. WhatsApp Web loads older
   * history from the phone as it is asked for, so the window grows until it holds them (or the chat's start).
   */
  async messages(chatId: string, count: number, before?: string): Promise<WaMessage[]> {
    const chat = await this.need().getChatById(chatId)
    const fetchMessages = obj(chat).fetchMessages
    if (typeof fetchMessages !== 'function') throw Object.assign(new Error('No such chat.'), { status: 404 })
    const fetch = async (limit: number): Promise<unknown[]> => {
      const r: unknown = await fetchMessages.call(chat, { limit })
      return Array.isArray(r) ? r : []
    }
    const out = (list: unknown[]) => list.filter(shown).map(toMessage)
    if (!before) return out(await fetch(count))
    let limit = Math.max(count * 4, 200)
    let all: unknown[] = []
    for (let round = 0; round < 6; round++) {
      all = await fetch(limit)
      const i = all.findIndex(m => idOf(obj(m).id) === before)
      if (i === -1) {
        if (all.length < limit) break // the whole chat is here, and `before` is not in it
        limit *= 2
        continue
      }
      if (i >= count || all.length < limit) return out(all.slice(Math.max(0, i - count), i))
      limit *= 2
    }
    const i = all.findIndex(m => idOf(obj(m).id) === before)
    const end = i === -1 ? all.length : i
    return out(all.slice(Math.max(0, end - count), end))
  }

  async send(chatId: string, text: string): Promise<WaMessage> {
    return toMessage(await this.need().sendMessage(chatId, text))
  }

  // --- Order oWA S4: the people behind the chats ---------------------------------------------------------------------------------------------

  /** What is known of the number of a chat's person without asking: its id's own digits, or what WhatsApp Web placed behind a privacy id. '' when it is not known (and for a group). */
  private numberKnown(id: string): string {
    return numberFromId(id) || this.numbers.get(id) || ''
  }

  /** The phone number behind a chat id (digits), asking WhatsApp Web when it is a privacy id; '' when it cannot be known. A success is kept; a miss is not asked again for ten minutes. */
  async numberOf(chatId: string): Promise<string> {
    const known = this.numberKnown(chatId)
    if (known || !chatId.endsWith('@lid')) return known
    const client = this.client
    if (!client || typeof client.getContactLidAndPhone !== 'function' || (this.numberMiss.get(chatId) ?? 0) > Date.now()) return ''
    await this.learnNumbers(client, this.gen, [chatId])
    return this.numbers.get(chatId) ?? ''
  }

  /** Asks WhatsApp Web for the numbers behind these privacy ids, in batches, and keeps what it says (a batch that fails is asked again one id at a time, so one it cannot place costs only itself). */
  private async learnNumbers(client: WaClient, gen: number, ids: string[], into: WaChat[] = []): Promise<void> {
    const ask = client.getContactLidAndPhone
    if (typeof ask !== 'function') return
    const keep = (id: string, row: unknown) => {
      const digits = numberFromId(str(obj(row).pn))
      if (!digits) {
        this.numberMiss.set(id, Date.now() + NUMBER_MISS_MS)
        return
      }
      if (this.numbers.size >= NUMBERS_KEPT) this.numbers.clear()
      this.numbers.set(id, digits)
      this.numberMiss.delete(id)
      for (const c of into) if (c.id === id) c.number = digits
    }
    for (let i = 0; i < ids.length; i += NUMBER_BATCH) {
      if (gen !== this.gen) return
      const batch = ids.slice(i, i + NUMBER_BATCH)
      try {
        const rows = await ask.call(client, batch)
        const answers = Array.isArray(rows) ? rows : []
        batch.forEach((id, k) => keep(id, answers[k]))
      } catch {
        for (const id of batch) {
          if (gen !== this.gen) return
          try {
            const rows = await ask.call(client, [id])
            keep(id, Array.isArray(rows) ? rows[0] : undefined)
          } catch {
            this.numberMiss.set(id, Date.now() + NUMBER_MISS_MS)
          }
        }
      }
    }
  }

  /** For the chat list: the numbers known now go into it, and those of the privacy-id chats not yet placed are asked for (one run at a time). Resolves when that run is done; null: nothing to ask. */
  private fillNumbers(client: WaClient, gen: number, list: WaChat[]): Promise<void> | null {
    for (const c of list) {
      const n = c.isGroup ? '' : this.numberKnown(c.id)
      if (n) c.number = n
    }
    if (this.numberFill) return this.numberFill
    const now = Date.now()
    const ids = list.filter(c => !c.isGroup && c.id.endsWith('@lid') && !c.number && (this.numberMiss.get(c.id) ?? 0) <= now).map(c => c.id)
    if (ids.length === 0 || typeof client.getContactLidAndPhone !== 'function') return null
    const run: Promise<void> = this.learnNumbers(client, gen, ids, list)
      .catch(() => undefined)
      .finally(() => {
        if (this.numberFill === run) this.numberFill = null
      })
    this.numberFill = run
    return run
  }

  /** A picture's address on WhatsApp's own servers (https only), or null: none, not allowed, or this program cannot ask. */
  private async picOf(client: WaClient, id: string): Promise<string | null> {
    if (typeof client.getProfilePicUrl !== 'function') return null
    try {
      const url = await client.getProfilePicUrl(id)
      return typeof url === 'string' && /^https:\/\//.test(url) ? url : null
    } catch {
      return null
    }
  }

  async profilePic(chatId: string): Promise<string | null> {
    return this.picOf(this.need(), chatId)
  }

  /** What the contact panel shows for a chat: a person's (name, their own WhatsApp name, number, about, picture) or a group's (description, owner, members with names and numbers). */
  async contact(chatId: string): Promise<WaContactDetails> {
    const client = this.need()
    const isGroup = chatId.endsWith('@g.us')
    const c = obj(typeof client.getContactById === 'function' ? await client.getContactById(chatId).catch(() => null) : null)
    const number = isGroup ? '' : await this.numberOf(chatId)
    const about = typeof c.getAbout === 'function' ? str(await Promise.resolve((c.getAbout as () => unknown).call(c)).catch(() => null)).trim() : ''
    const pushname = str(c.pushname).trim()
    // Never a privacy id's or a group's digits as a name: they are not one.
    const name = str(c.name).trim() || pushname || number || (isGroup ? 'Group' : chatId.endsWith('@lid') ? 'Unknown' : chatId.split('@')[0])
    const details: WaContactDetails = {
      id: chatId,
      isGroup,
      name,
      ...(pushname && pushname !== name ? { pushname } : {}),
      ...(number ? { number } : {}),
      isBusiness: c.isBusiness === true,
      isMyContact: c.isMyContact === true,
      ...(about ? { about } : {}),
      profilePic: await this.picOf(client, chatId),
    }
    if (isGroup) Object.assign(details, await this.groupOf(client, chatId))
    return details
  }

  /** A group's description, owner and members. The first MEMBERS_NAMED are named and numbered, within CONTACT_BUDGET_MS; the rest are listed by id. */
  private async groupOf(client: WaClient, chatId: string): Promise<Partial<WaContactDetails>> {
    let chat: Obj
    try {
      chat = obj(await client.getChatById(chatId))
    } catch {
      return {}
    }
    const parts = Array.isArray(chat.participants) ? chat.participants : []
    const members = parts
      .slice(0, 1024)
      .map(p => ({ id: idOf(obj(p).id), isAdmin: obj(p).isAdmin === true || obj(p).isSuperAdmin === true, isSuperAdmin: obj(p).isSuperAdmin === true }))
      .filter(m => m.id)
    const named = new Map<string, { name: string; number: string }>()
    const until = Date.now() + CONTACT_BUDGET_MS
    const ids = members.slice(0, MEMBERS_NAMED).map(m => m.id)
    for (let i = 0; i < ids.length && Date.now() < until; i += 16) {
      await Promise.all(
        ids.slice(i, i + 16).map(async id => {
          const m = obj(typeof client.getContactById === 'function' ? await client.getContactById(id).catch(() => null) : null)
          const number = this.numberKnown(id) || str(m.number).replace(/\D/g, '') || (await this.numberOf(id))
          named.set(id, { name: str(m.name).trim() || str(m.pushname).trim() || str(m.shortName).trim(), number })
        }),
      )
    }
    const participants: WaGroupParticipant[] = members.map(m => ({ id: m.id, number: named.get(m.id)?.number ?? this.numberKnown(m.id), name: named.get(m.id)?.name ?? '', isAdmin: m.isAdmin, isSuperAdmin: m.isSuperAdmin }))
    const desc = str(chat.description).trim()
    const owner = idOf(chat.owner)
    return { ...(desc ? { groupDesc: desc } : {}), ...(owner ? { owner } : {}), participantsCount: parts.length, participants }
  }

  /** Tells the other side the chat was read (WhatsApp's read receipt): the person's own request, never a side effect of looking. */
  async seen(chatId: string): Promise<void> {
    const client = this.need()
    if (typeof client.sendSeen !== 'function') throw unsupported('mark a chat as read')
    await client.sendSeen(chatId)
    this.chatsLast = null
  }

  async archive(chatId: string, on: boolean): Promise<void> {
    const client = this.need()
    const act = on ? client.archiveChat : client.unarchiveChat
    if (typeof act !== 'function') throw unsupported(on ? 'archive a chat' : 'unarchive a chat')
    await act.call(client, chatId)
    this.chatsLast = null
  }

  async pin(chatId: string, on: boolean): Promise<void> {
    const client = this.need()
    const act = on ? client.pinChat : client.unpinChat
    if (typeof act !== 'function') throw unsupported(on ? 'pin a chat' : 'unpin a chat')
    // WhatsApp keeps at most three chats pinned: a fourth is answered with false.
    if ((await act.call(client, chatId)) === false) throw Object.assign(new Error(on ? 'WhatsApp keeps at most three chats pinned: unpin one first.' : 'That chat could not be unpinned.'), { status: 409 })
    this.chatsLast = null
  }

  /** A number typed for a new chat: its chat id when it is on WhatsApp, or that it is not. */
  async newChat(number: string): Promise<WaNewChat> {
    const client = this.need()
    const digits = numberFromId(number)
    if (digits.length < 8 || digits.length > 15) throw Object.assign(new Error('That is not a phone number: type its digits with the country code, for example 919820282994.'), { status: 400 })
    if (typeof client.getNumberId !== 'function') throw unsupported('look a number up')
    const id = idOf(await client.getNumberId(digits))
    return id ? { ok: true, id, number: digits } : { ok: false, reason: 'not-on-whatsapp', number: digits }
  }

  /**
   * Order oWA S3: the file of a message (a photo, a sticker, a video, a voice note, a document) of THIS chat. Asked before anything is downloaded: a message that is not in this chat or has no
   * file is a 404; a file WhatsApp says is bigger than WA_MEDIA_MAX_BYTES is a 413 and is NOT downloaded (the page says "open it on your phone"); a file WhatsApp no longer has (it keeps them
   * for a while) is a 404 saying so. Neither is a trouble to retry, so both carry a code the page reads.
   */
  async media(chatId: string, messageId: string): Promise<WaMediaFile> {
    const client = this.need()
    if (typeof client.getMessageById !== 'function') throw unsupported("open a message's file")
    const m = obj(await client.getMessageById(messageId).catch(() => null))
    const inChat = idOf(m.fromMe === true ? m.to : m.from)
    if (!idOf(m.id) || inChat !== chatId) throw Object.assign(new Error('That message is not in this chat.'), { status: 404 })
    if (m.hasMedia !== true || typeof m.downloadMedia !== 'function') throw Object.assign(new Error('That message has no file.'), { status: 404 })
    const meta = obj(m._data)
    const tooBig = (size: number) =>
      Object.assign(new Error(`This file is too big to show here (${Math.ceil(size / 1024 / 1024)} MB): open it on your phone.`), { status: 413, code: WA_MEDIA_TOO_BIG })
    if (num(meta.size) > WA_MEDIA_MAX_BYTES) throw tooBig(num(meta.size))
    const got = obj(await Promise.resolve((m.downloadMedia as () => unknown).call(m)).catch(() => null))
    const data = str(got.data)
    if (!data) throw Object.assign(new Error('This file is no longer available: WhatsApp only keeps files for a while.'), { status: 404, code: WA_MEDIA_GONE })
    const size = Buffer.byteLength(data, 'base64')
    if (size > WA_MEDIA_MAX_BYTES) throw tooBig(size)
    return { mimetype: str(got.mimetype) || str(meta.mimetype) || 'application/octet-stream', filename: str(got.filename) || str(meta.filename) || null, size, data }
  }

  /** The PID of the Chrome this client launched, once there is one. */
  chromePid(): number | null {
    const browser = obj(this.client?.pupBrowser)
    const proc = typeof browser.process === 'function' ? obj((browser.process as () => unknown).call(browser)) : {}
    return typeof proc.pid === 'number' ? proc.pid : null
  }

  // ---------------------------------------------------------------------------------------------

  private set(patch: Partial<EngineStatus>) {
    this.st = { ...this.st, ...patch }
    this.emit('status', this.status())
  }

  private need(): WaClient {
    if (!this.client || this.st.state !== 'ready') throw notReady()
    return this.client
  }

  /** Ends the current generation: its client's events and timers no longer count. Returns that client. */
  private halt(): WaClient | null {
    this.gen++
    this.stopPoll()
    clearTimeout(this.retry)
    // The list and the read under way belong to this session: a later one (another login, after an unlink) never gets them.
    this.chatsRead = null
    this.chatsLast = null
    const c = this.client
    this.client = null
    return c
  }

  private launch(attempt: number): void {
    const gen = ++this.gen
    this.clearServiceWorker()
    let client: WaClient
    try {
      client = this.o.createClient()
    } catch (e) {
      this.set({ state: 'failed', reason: `WhatsApp could not start: ${clean(message(e))}` })
      return
    }
    this.client = client
    this.attach(client, gen)
    client.initialize().catch(async (e: unknown) => {
      if (gen !== this.gen) return
      this.o.log?.(`opening, try ${attempt} of ${LAUNCHES}: ${clean(message(e))}`)
      this.client = null
      await client.destroy().catch(() => undefined)
      if (gen !== this.gen) return
      const why = explain(message(e))
      if (attempt < LAUNCHES && why.retry) {
        this.retry = setTimeout(() => {
          if (gen === this.gen) this.launch(attempt + 1)
        }, this.o.retryMs)
      } else {
        this.set({ state: 'failed', loading: null, reason: why.reason })
      }
    })
  }

  private attach(client: WaClient, gen: number): void {
    const live = () => gen === this.gen
    client.on('qr', (text: unknown) => {
      if (!live()) return
      void this.o.qrImage(str(text)).then(
        qr => live() && this.set({ state: 'qr', qr, loading: null, linked: false }),
        e => live() && this.set({ state: 'failed', reason: `The QR could not be drawn: ${clean(message(e))}` }),
      )
    })
    client.on('code', (code: unknown) => {
      if (live() && str(code)) this.set({ pairingCode: str(code) })
    })
    client.on('loading_screen', (percent: unknown) => {
      if (live() && this.st.state !== 'ready') this.set({ loading: Math.max(0, Math.min(100, Math.round(num(percent)))) })
    })
    client.on('authenticated', () => {
      if (!live()) return
      this.o.log?.('linked: loading WhatsApp')
      this.set({ state: 'linking', qr: null, pairingCode: null })
      this.startPoll(gen)
    })
    client.on('auth_failure', () => {
      if (!live()) return
      this.stopPoll()
      this.set({ state: 'failed', qr: null, reason: 'WhatsApp did not accept the saved login. Link it again.' })
    })
    client.on('ready', () => {
      if (live()) this.finish(gen)
    })
    client.on('change_state', (s: unknown) => {
      if (live()) this.o.log?.(`WhatsApp Web state: ${clean(str(s))}`)
    })
    client.on('disconnected', (why: unknown) => {
      if (!live()) return
      const reason = reasonOf(why)
      this.o.log?.(`disconnected: ${clean(str(why) || message(why))}`)
      const c = this.halt()
      void c?.destroy().catch(() => undefined)
      this.set({ state: 'off', qr: null, pairingCode: null, loading: null, reason, ...(str(why) === 'LOGOUT' ? { me: null, linked: false } : {}) })
    })
    client.on('message', (m: unknown) => {
      if (live() && shown(m)) this.emit('message', toMessage(m))
    })
    // His own messages, from here or from his phone: 'message' carries only the ones he receives.
    client.on('message_create', (m: unknown) => {
      if (live() && obj(m).fromMe === true && shown(m)) this.emit('message', toMessage(m))
    })
    client.on('message_ack', (m: unknown, ack: unknown) => {
      if (!live()) return
      const msg = toMessage(m)
      this.emit('ack', { id: msg.id, chatId: msg.chatId, ack: num(ack) })
    })
  }

  /** CONNECTED: say who is linked (client.info may still be missing when `ready` never fired; the session works anyway). */
  private finish(gen: number) {
    if (gen !== this.gen || this.st.state === 'ready') return
    this.stopPoll()
    this.recycles = 0
    const info = obj(this.client?.info)
    const user = str(obj(info.wid).user)
    this.set({ state: 'ready', qr: null, pairingCode: null, loading: null, reason: null, linked: true, me: info.wid ? { name: str(info.pushname) || null, phone: user || null } : this.st.me })
    this.o.log?.('ready')
  }

  private startPoll(gen: number) {
    this.stopPoll()
    this.polls = 0
    this.poll = setInterval(() => void this.pollOnce(gen), this.o.pollMs)
  }

  private stopPoll() {
    if (this.poll) clearInterval(this.poll)
    this.poll = null
  }

  private async pollOnce(gen: number) {
    const c = this.client
    if (gen !== this.gen || !c) return this.stopPoll()
    this.polls += 1
    let state: unknown = null
    try {
      state = await c.getState()
    } catch {
      // The page is busy loading: ask again next time.
    }
    if (gen !== this.gen) return
    if (state === 'CONNECTED') return this.finish(gen)
    if (this.polls < this.o.pollTries || this.st.state === 'ready') return
    this.stopPoll()
    if (this.recycles >= RECYCLES) {
      this.set({ state: 'failed', reason: 'WhatsApp was linked but never finished opening. Try again.' })
      return
    }
    this.recycles += 1
    this.o.log?.(`linked but not connected after ${Math.round((this.o.pollMs * this.o.pollTries) / 1000)} s: opening again (${this.recycles} of ${RECYCLES})`)
    const old = this.halt()
    await old?.destroy().catch(() => undefined)
    this.set({ state: 'starting', loading: null })
    this.launch(1)
  }

  /**
   * Only the Service Worker: it can serve a whole other WhatsApp Web app shell. IndexedDB and Local Storage (the
   * login) and the HTTP and code caches (a quick start) stay.
   */
  private clearServiceWorker() {
    try {
      rmSync(path.join(this.o.profileDir, 'Default', 'Service Worker'), { recursive: true, force: true })
    } catch {
      // Not there, or locked: leave it.
    }
  }
}
