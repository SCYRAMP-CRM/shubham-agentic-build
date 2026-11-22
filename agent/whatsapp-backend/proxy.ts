import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { WA_ACCOUNT_RE, WA_BACKEND_PREFIX, WA_MAIN_ACCOUNT, WA_MEDIA_MAX_BYTES, WA_MEDIA_TOO_BIG, WA_PREFIX, type WaBackendCode } from '../../shared/whatsapp.ts'
import { apiError, type ApiMount, type MountRequest } from '../api.ts'
import { mediaHeaders } from '../whatsapp/media.ts'
import type { AssistantTools } from './assistant-tools.ts'
import type { NotesStore } from './notes.ts'
import { SEND_TICKET_HEADER, type SendFields } from './send-ticket.ts'
import type { BackendView } from './supervisor.ts'

// Order o8416 (F-223): the WhatsApp page talks to the agent, and the agent passes its requests to the WhatsApp backend on
// 127.0.0.1 (server.ts), adding the backend's token itself. The page never sees the token.
// - This mount is not `scoped`, so the agent's own guard lets only the owner (sbskrrt) through before any of this runs.
// - Only the routes the WhatsApp page uses are passed on; anything else is 404.
// - Sends still need the backend's own answer: the backend refuses them (server.ts), so a page send cannot go through yet.
// Order of5a0: the backend is the hub's to keep running (supervisor.ts). Its port is the one the RUNNING backend said it got (its ready word), never
// a port file that may be stale (another program may hold that port by now, and the token would go to it). Not running, a 503 that says the
// truth, with a code the page reads (WaBackendCode): starting (or starting again after a failure, and which), stopped (and why), off, no answer.

interface Route {
  method: string
  pattern: RegExp
}

const ROUTES: Route[] = [
  { method: 'GET', pattern: /^\/status$/ },
  { method: 'POST', pattern: /^\/setup$/ },
  { method: 'POST', pattern: /^\/open$/ },
  { method: 'POST', pattern: /^\/close$/ },
  { method: 'POST', pattern: /^\/pair-code$/ },
  { method: 'POST', pattern: /^\/unlink$/ },
  { method: 'PATCH', pattern: /^\/settings$/ },
  // F-312: the numbers: the list (a read), a new one and a name (a person's own request, below).
  { method: 'GET', pattern: /^\/accounts$/ },
  { method: 'POST', pattern: /^\/accounts$/ },
  { method: 'PATCH', pattern: /^\/accounts\/[^/]+$/ },
  { method: 'GET', pattern: /^\/chats$/ },
  { method: 'GET', pattern: /^\/messages$/ },
  // Order oWA S7: what is new since a position (a message, a tick), waiting a few seconds when there is nothing: the new page follows WhatsApp live with it. A read.
  { method: 'GET', pattern: /^\/events$/ },
  { method: 'POST', pattern: /^\/send$/ },
  // Order oWA S4: the people behind the chats. The four that change something (or ask WhatsApp about a number) need a person's own request (CHANGES below).
  { method: 'GET', pattern: /^\/contact$/ },
  { method: 'GET', pattern: /^\/profile-pic$/ },
  { method: 'POST', pattern: /^\/(seen|archive|pin|new-chat)$/ },
  { method: 'DELETE', pattern: /^\/drafts\/[^/]+$/ },
]

/** Order oWA S4: what changes something on WhatsApp's side (a read receipt, archive, pin) or asks it about a number: a person's own request, like a send's first gate. */
const CHANGES = /^\/(seen|archive|pin|new-chat)$/

export const allowedRoute = (method: string, rest: string): boolean => ROUTES.some(r => r.method === method && r.pattern.test(rest))

/** F-312: the number a request is for: `?acct=` (left out: the first, so every older caller is unchanged). Anything that is not an id this app makes is a 400. */
export function acctOf(query: URLSearchParams): string {
  const a = query.get('acct') ?? WA_MAIN_ACCOUNT
  if (!WA_ACCOUNT_RE.test(a)) throw Object.assign(apiError(400, 'That is not a WhatsApp number of this app.'), { code: 'wa-bad-account' })
  return a
}

/**
 * Order obf15 (oWA S2, Lead's design approval): the agent's gates for a send. A send reaches the backend only after: (1) human(): a person's own signed-in request
 * (requireCrmHuman: a CRM session, never a chat's key; it throws 401/403 and is asked FIRST, so a stranger learns nothing about the switch); (2) the switch ON (his, a
 * file, OFF by default); (3) a well-formed send; (4) a ticket made for exactly that chat and those words. Each refusal is before the backend is called.
 */
export interface SendsOptions {
  /** Whether sending is switched on. */
  on(): boolean
  /** Who tapped: this request is a signed-in person's own, or it throws (401 no session, 403 a chat's key or not an administrator). */
  human(req: MountRequest): string
  /** A ticket for this send by this person, or null when the backend holds no key. */
  ticket(f: SendFields, by: string): string | null
  /** Switches sending ON or OFF (the file, then the backend's key), by this person; resolves whether the backend confirmed it holds what it should. */
  set(on: boolean, by: string): Promise<boolean>
}

export interface ProxyOptions {
  /** The backend's state folder: its token file is <dir>\token. */
  dir: string
  /** Order of5a0: the hub's supervisor, as it stands now (null where none runs: not the Server). */
  backend?: () => BackendView | null
  /** Order of5a0 (A2): which login the Assistant's WhatsApp tools use (the hub's), shown with the status and chosen here. */
  assistantTools?: () => AssistantTools | null
  /** Order obf15: the gates for sending. Without them (a hand-run backend, a test) a send is passed on as it was and the backend itself refuses it. */
  sends?: SendsOptions
  /** Order oWA S6: the person's own notes about chats (kept here on the Server, never sent to the backend, WhatsApp or the CRM). Without it those paths do not exist. F-312: or a function that gives each NUMBER its own (a chat id is a different chat in each number, so its notes are too). */
  notes?: NotesStore | ((acct: string) => NotesStore)
  /**
   * F-312: the seam for a rule about WHO may use WHICH number (F-313, a later yes): asked with every request and the number it is for; it throws (a 403) to refuse. Not given: every owner may use every number, as the
   * first number has always been the owner's alone. Nothing is decided here: the place for it is.
   */
  mayUse?(req: MountRequest, acct: string): void
  /** Tests: a backend on a known port, with no supervisor. */
  port?: number
  /** Tests: a fetch to use in place of the network. */
  fetchImpl?: typeof fetch
  /** Tests: how long one call may take. */
  timeoutMs?: number
  /** Order oWA S3: how long a file may take to come (default 60 s). */
  mediaTimeoutMs?: number
  /** Order oWA S7: how long a live-feed ask may take: it waits up to WA_EVENTS_WAIT_MAX_MS for the next event, so the usual 20 s would cut it off (default 30 s). */
  eventsTimeoutMs?: number
}

const down = (code: WaBackendCode, message: string) => Object.assign(apiError(503, message), { code })

/** The port to call, or the true reason there is none (a 503 with its code). */
export function backendPort(view: BackendView | null): number {
  if (view === null) throw down('wa-backend-off', 'WhatsApp runs on the Server; its backend does not run on this PC.')
  if (view.state === 'running' && view.port !== null) return view.port
  if (view.state === 'starting')
    throw down('wa-backend-starting', view.why ? `The WhatsApp backend is starting again after a failure (${view.why}). Try again in a few seconds.` : 'The WhatsApp backend is starting on this Server. Try again in a few seconds.')
  if (view.state === 'stopped') throw down('wa-backend-stopped', `The WhatsApp backend is stopped: ${view.why ?? 'no reason was given'}.`)
  throw down('wa-backend-off', view.why ? `The WhatsApp backend is not running on this Server: ${view.why}.` : 'The WhatsApp backend is not running on this Server.')
}

/** The request behind a raw route, shaped for the seam (a raw route has no body and no parsed query of its own). */
const mediaReq = (req: { headers: MountRequest['headers'] }): MountRequest => ({ method: 'GET', rest: '/media', query: new URLSearchParams(), body: undefined, headers: req.headers }) as MountRequest

export function createWhatsAppBackendProxy(o: ProxyOptions): ApiMount {
  const doFetch = o.fetchImpl ?? fetch
  const timeoutMs = o.timeoutMs ?? 20_000
  const tokenFile = `${o.dir}/token`

  /** Read fresh each call: a restarted backend that made a new token is picked up at once. */
  function token(): string {
    if (!existsSync(tokenFile)) throw down('wa-backend-no-token', 'The WhatsApp backend has not made its token on this Server yet.')
    const t = readFileSync(tokenFile, 'utf8').trim()
    if (!/^[0-9a-f]{64}$/.test(t)) throw down('wa-backend-no-token', 'The WhatsApp backend has no valid token on this Server yet.')
    return t
  }

  return {
    prefix: WA_BACKEND_PREFIX,
    /**
     * Order oWA S3: a message's file, as bytes. The agent's own answer to the page, so what a browser is told about its kind is decided HERE (agent/whatsapp/media.ts): only a photo, a sound or a
     * video is sent to be shown, anything else is a download, and every file carries nosniff and a sandbox. Reading is the owner's (this mount); a file is never forwarded unread.
     */
    raw(rest, url) {
      if (rest !== '/media') return null
      return async (req, res) => {
        if (req.method !== 'GET') throw apiError(405, 'A file is read with GET')
        const chat = url.searchParams.get('chat') ?? ''
        const msg = url.searchParams.get('msg') ?? ''
        const acct = acctOf(url.searchParams)
        o.mayUse?.(mediaReq(req), acct)
        if (!chat || chat.length > 100 || !msg || msg.length > 200) throw apiError(400, 'Expected ?chat=<chat id>&msg=<message id>')
        const port = o.port ?? backendPort(o.backend?.() ?? null)
        let up: Response
        try {
          up = await doFetch(`http://127.0.0.1:${port}${WA_PREFIX}/media?chat=${encodeURIComponent(chat)}&msg=${encodeURIComponent(msg)}${acct === WA_MAIN_ACCOUNT ? '' : `&acct=${acct}`}`, {
            method: 'GET',
            cache: 'no-store',
            headers: { 'x-sad-token': token() },
            signal: AbortSignal.timeout(o.mediaTimeoutMs ?? 60_000),
          })
        } catch (e) {
          const cause = (e as { cause?: { code?: unknown } }).cause?.code
          const what = (e as Error).name === 'TimeoutError' ? 'no answer in time' : typeof cause === 'string' ? cause : 'the connection failed'
          throw down('wa-backend-unreachable', `The WhatsApp backend did not answer (${what}).`)
        }
        if (!up.ok) {
          const data = (await up.json().catch(() => null)) as { error?: unknown; code?: unknown } | null
          throw Object.assign(apiError(up.status, typeof data?.error === 'string' ? data.error : `The WhatsApp backend answered ${up.status}`), typeof data?.code === 'string' ? { code: data.code } : {})
        }
        const declared = Number(up.headers.get('content-length') ?? 0)
        if (declared > WA_MEDIA_MAX_BYTES) throw Object.assign(apiError(413, 'This file is too big to show here: open it on your phone.'), { code: WA_MEDIA_TOO_BIG })
        const bytes = Buffer.from(await up.arrayBuffer())
        if (bytes.length > WA_MEDIA_MAX_BYTES) throw Object.assign(apiError(413, 'This file is too big to show here: open it on your phone.'), { code: WA_MEDIA_TOO_BIG })
        let name: string | null = null
        try {
          name = decodeURIComponent(up.headers.get('x-wa-media-name') ?? '') || null
        } catch {
          name = null
        }
        res.writeHead(200, { ...mediaHeaders(up.headers.get('content-type') ?? '', name), 'content-length': bytes.length })
        res.end(bytes)
      }
    },
    async http(req: MountRequest): Promise<unknown> {
      const { method, rest, query, body } = req
      const acct = acctOf(query)
      o.mayUse?.(req, acct)
      // Order of5a0 (A2): his choice of the Assistant's login is the agent's own, not the backend's.
      if (method === 'PATCH' && rest === '/assistant-tools') {
        const at = o.assistantTools?.() ?? null
        if (!at) throw apiError(404, 'The Assistant has only one WhatsApp here.')
        const b = body as { use?: unknown; by?: unknown } | undefined
        return at.choose(b?.use, b?.by)
      }
      // Order oWA S6: the notes are the agent's own (never forwarded). Reading is the owner's (this mount); writing is a person's own request.
      const notes = typeof o.notes === 'function' ? o.notes(acct) : o.notes
      if (notes) {
        if (method === 'GET' && rest === '/note-index') return notes.index()
        if (rest === '/notes') {
          const chat = query.get('chat') ?? ''
          if (method === 'GET') return notes.list(chat)
          if (method === 'POST') {
            o.sends?.human(req)
            const b = (body ?? {}) as { chatId?: unknown; text?: unknown }
            if (typeof b.chatId !== 'string' || typeof b.text !== 'string') throw apiError(400, 'Expected {chatId, text}')
            return notes.add(b.chatId, b.text)
          }
        }
        const one = /^\/notes\/([\w-]{1,64})$/.exec(rest)
        if (one && method === 'DELETE') {
          o.sends?.human(req)
          return notes.remove(query.get('chat') ?? '', one[1])
        }
      }
      // Order obf15 (oWA S2): the switch, and the gates of a send. A person's own request comes FIRST in both.
      const sends = o.sends
      let ticket: string | null = null
      if (sends && method === 'PATCH' && rest === '/sending') {
        const by = sends.human(req)
        const on = (body as { on?: unknown } | undefined)?.on
        if (typeof on !== 'boolean') throw apiError(400, 'Expected {on: true | false}')
        const confirmed = await sends.set(on, by)
        return { on: sends.on(), confirmed }
      }
      if (!allowedRoute(method, rest)) throw apiError(404, `No such WhatsApp path: ${method} ${rest}`)
      // F-312: a new number or a new name is a person's own request (a CRM session; a chat's key is refused) before it reaches the backend. The list is a read.
      if (sends && method !== 'GET' && rest.startsWith('/accounts')) sends.human(req)
      // Order oWA S4: a person's own request (a CRM session; a chat's key is refused) before anything reaches the backend. No ticket and no switch: it sends no message.
      if (sends && method === 'POST' && CHANGES.test(rest)) sends.human(req)
      if (sends && method === 'POST' && rest === '/send') {
        const by = sends.human(req)
        if (!sends.on()) throw apiError(403, 'Sending is switched off. A person switches it on in the WhatsApp settings.')
        const b = (body ?? {}) as Record<string, unknown>
        const chatId = typeof b.chatId === 'string' ? b.chatId : ''
        const text = typeof b.text === 'string' ? b.text : ''
        const draft = b.draft === undefined ? '' : typeof b.draft === 'string' ? b.draft : null
        if (!chatId || chatId.length > 200 || !text.trim() || draft === null || draft.length > 64) throw apiError(400, 'Expected {chatId, text, draft?}')
        ticket = sends.ticket({ chatId, textSha: createHash('sha256').update(text, 'utf8').digest('hex'), draft, acct }, by)
        if (ticket === null) throw apiError(503, 'Sending is not available right now: the WhatsApp backend holds no send key yet (it may be starting). Try again in a moment.')
      }
      const port = o.port ?? backendPort(o.backend?.() ?? null)
      const qs = query.toString()
      const url = `http://127.0.0.1:${port}${WA_PREFIX}${rest}${qs ? `?${qs}` : ''}`
      const json = method !== 'GET' && method !== 'HEAD' && body !== undefined
      const headers = { 'x-sad-token': token(), ...(json ? { 'content-type': 'application/json' } : {}), ...(ticket ? { [SEND_TICKET_HEADER]: ticket } : {}) }
      let res: Response
      // A live-feed ask waits for the next event (up to WA_EVENTS_WAIT_MAX_MS) before it answers: it is given longer than an ordinary call, and only it.
      const allowedMs = rest === '/events' ? (o.eventsTimeoutMs ?? 30_000) : timeoutMs
      try {
        res = await doFetch(url, { method, cache: 'no-store', headers, body: json ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(allowedMs) })
      } catch (e) {
        const cause = (e as { cause?: { code?: unknown } }).cause?.code
        const what = (e as Error).name === 'TimeoutError' ? `no answer within ${Math.round(allowedMs / 1000)} s` : typeof cause === 'string' ? cause : 'the connection failed'
        throw down('wa-backend-unreachable', `The WhatsApp backend did not answer (${what}).`)
      }
      const data = (await res.json().catch(() => null)) as unknown
      if (!res.ok) {
        const why = (data as { code?: unknown } | null)?.code
        // Order o714a: the backend's own code (wa-chats-loading) goes on to the page, which waits and asks again instead of failing.
        throw Object.assign(apiError(res.status, typeof (data as { error?: unknown })?.error === 'string' ? (data as { error: string }).error : `The WhatsApp backend answered ${res.status}`), typeof why === 'string' ? { code: why } : {})
      }
      const isStatus = method === 'GET' && rest === '/status'
      // The Assistant's login choice is about the first number only (F-312).
      const at = isStatus && acct === WA_MAIN_ACCOUNT ? (o.assistantTools?.() ?? null) : null
      const extra = { ...(at ? { assistantTools: at.state() } : {}), ...(isStatus && sends ? { sends: { on: sends.on() } } : {}) }
      return data !== null && typeof data === 'object' && Object.keys(extra).length > 0 ? { ...(data as Record<string, unknown>), ...extra } : data
    },
  }
}
