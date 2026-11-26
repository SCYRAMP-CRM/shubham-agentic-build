import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { CrmSessionInfo } from '../../shared/crm.ts'
import { apiError } from '../api.ts'
import { SESSION_MS, sameCrm, trimUrl } from '../claude/crm.ts'
import { withCooldown } from '../claude/crm-cooldown.ts'
import type { Logger } from '../log.ts'

// F-054: the CRM built into the page talks to the CRM's backend through this. The backend allows
// only the CRM's own sites as origins, so a call from this app's address would be refused by CORS;
// forwarded from here, where CORS doesn't apply, it is not. It is also what makes one sign-in
// serve both: the CRM session this PC already holds (crm-session.json, from Settings › Devices'
// sign-in) is attached here, so the page never has the CRM's cookie, and the CRM's own login
// form isn't needed (agentic-claude-manager's /api/crm-proxy, ported). The session, its cookie and
// the CSRF token are never logged, never put in an answer, and never written anywhere else.

/** The most a request body may be: it is held whole (a CSRF retry needs to send it again). */
const MAX_BODY = 25 * 1024 * 1024
const TIMEOUT_MS = 120_000

/** Not passed to the CRM: hop-by-hop, ours to set, or this app's own credentials and origin. */
const NOT_FORWARDED = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade',
  'host', 'origin', 'referer', 'content-length', 'accept-encoding', 'cookie', 'x-csrf-token', 'x-sad-token', 'x-sad-chat-key',
])
/** Not passed back: ours to set, or about the CRM's own site (the page is not a frame of it, nor a CORS client). */
const NOT_RETURNED = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'content-length', 'set-cookie', 'strict-transport-security',
  'content-security-policy', 'x-frame-options', 'cross-origin-opener-policy', 'cross-origin-resource-policy', 'cross-origin-embedder-policy',
])

interface Login {
  /** The CRM, without a trailing slash. */
  url: string
  /** "crm_token=<JWT>". Never leaves this file. */
  cookie: string
  name: string
  username: string | null
  expiresAt: number
}

/** Order oc186 (slice 2): one CRM login, the PC's own or a signed-in person's. */
export type CrmLogin = Login

/** Order oc186 (slice 2): a signed-in person's own CRM session (agent/auth viewerCrm), as the CRM login for their calls. */
export function crmLoginOf(s: { url: string; cookie: string; signedInAt: string; user: { name?: string | null; username?: string | null } }): CrmLogin {
  return {
    url: s.url.replace(/\/+$/, ''),
    cookie: s.cookie,
    name: s.user.name ?? s.user.username ?? 'Signed in',
    username: s.user.username ?? null,
    expiresAt: Date.parse(s.signedInAt) + SESSION_MS,
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/**
 * This PC's CRM session, read as it is now (Settings › Devices signs in and out under it), or null. F-339: given `crmUrl` (the address this run talks to), a login made at ANY other address is ended: null, exactly as
 * an expired one, so every reader says what it says for a login that has ended and nothing is ever sent to that other address. The file is left as it is. Left out, no address is checked (a test's own scratch file).
 */
export function readLogin(file: string, now = Date.now(), crmUrl?: string): Login | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (!isObject(raw)) return null
    const url = text(raw.url)
    const cookie = text(raw.cookie)
    const signedIn = Date.parse(String(raw.signedInAt))
    if (!url || !cookie || !/^https?:\/\//.test(url) || !Number.isFinite(signedIn)) return null
    if (crmUrl !== undefined && !sameCrm(url, crmUrl)) return null
    const expiresAt = signedIn + SESSION_MS
    if (now >= expiresAt) return null
    const user = isObject(raw.user) ? raw.user : {}
    return { url: trimUrl(url), cookie, name: text(user.name) ?? text(user.username) ?? 'Signed in', username: text(user.username), expiresAt }
  } catch {
    return null
  }
}

export interface CrmProxyOptions {
  /** crm-session.json. */
  file: string
  fetch?: typeof fetch
  now?: () => number
  /** Only for what ended early (the path, never the query, a cookie or a token). Left out (a test, the accounts script), nothing is logged. */
  log?: Pick<Logger, 'warn'>
  /** How long one request to the CRM may take in all (default 120 s). A test makes it short. */
  timeoutMs?: number
  /** F-339: the CRM address of this run (crm.ts crmUrlOf). A login at any other address is ended: not read, never forwarded to. Left out (a test's scratch proxy), no address is checked. */
  crmUrl?: string
}

export interface CrmProxy {
  /** Whether the CRM is signed in on this PC, and as whom. */
  session(): CrmSessionInfo
  /** Forwards one request of the page to the CRM, with the session; `sub` is the path after /crm-proxy/. */
  handle(req: IncomingMessage, res: ServerResponse, sub: string, search: string): Promise<void>
  /**
   * Order o9465: the same, on a signed-in person's OWN CRM session (their sign-in to this app, auth.viewerCrm), never this PC's: Goals and the CRM
   * page for someone Settings › Access opened them to. The CRM itself decides what that person may see and do.
   */
  handleAs(login: { url: string; cookie: string }, req: IncomingMessage, res: ServerResponse, sub: string, search: string): Promise<void>
  /**
   * F-126: one call from this agent itself (the CRM files), with the session and, for a change, the CSRF pair (mended once, as in `handle`). `sub` is the path on the CRM, e.g. "org/files?all=true".
   * Throws a CrmNotSignedIn when nobody is signed in. The answer is the CRM's, untouched; the caller reads it.
   */
  request(method: string, sub: string, init?: { json?: unknown; body?: string | Buffer; headers?: Record<string, string>; signal?: AbortSignal }): Promise<Response>
  /** Order oc186 (slice 2): the same call with a given login (a signed-in person's own CRM session), not the PC's. */
  requestAs(login: CrmLogin, method: string, sub: string, init?: { json?: unknown; body?: string | Buffer; headers?: Record<string, string>; signal?: AbortSignal }): Promise<Response>
}

/** F-126: no CRM session on this PC (or it ran out). */
export class CrmNotSignedIn extends Error {
  constructor() {
    super('The CRM is not signed in on this PC: sign in from the CRM page, or Devices')
    this.name = 'CrmNotSignedIn'
  }
}

const MUTATES = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

async function bodyOf(req: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) throw apiError(413, `A request to the CRM is at most ${MAX_BODY / 1024 / 1024} MB here`)
    chunks.push(chunk as Buffer)
  }
  return chunks.length ? Buffer.concat(chunks) : undefined
}

export function createCrmProxy(o: CrmProxyOptions): CrmProxy {
  // F-371: every call to the CRM from here goes through the app's one cooldown (agent/claude/crm-cooldown.ts), whatever fetch is under it.
  const fetchFn = withCooldown(o.fetch ?? fetch)
  const now = o.now ?? Date.now
  /**
   * The CSRF token the CRM gave each session (its double-submit pair, middleware/csrf.js), by the session's cookie: kept in memory only. This PC's
   * session and (order o9465) the people's own sessions each keep theirs; the oldest goes when there are too many.
   */
  const csrf = new Map<string, string>()

  async function csrfFor(login: { url: string; cookie: string }, force = false): Promise<string | null> {
    const kept = csrf.get(login.cookie)
    if (!force && kept) return kept
    try {
      const r = await fetchFn(`${login.url}/v1/auth/csrf-token`, { headers: { cookie: login.cookie, accept: 'application/json' }, signal: AbortSignal.timeout(20_000) })
      const body: unknown = await r.json().catch(() => null)
      const token = isObject(body) ? text(body.csrfToken) : null
      if (r.status !== 200 || !token || !/^[A-Za-z0-9_-]{16,256}$/.test(token)) return null
      csrf.delete(login.cookie)
      csrf.set(login.cookie, token)
      while (csrf.size > 64) csrf.delete(csrf.keys().next().value as string)
      return token
    } catch {
      return null
    }
  }

  /** One request of the page, forwarded to the CRM with this session (this PC's, or a person's own). */
  async function forward(login: { url: string; cookie: string }, req: IncomingMessage, res: ServerResponse, sub: string, search: string): Promise<void> {
    const method = (req.method ?? 'GET').toUpperCase()
    if (method === 'OPTIONS') {
      res.writeHead(204, { 'Cache-Control': 'no-store' })
      return void res.end()
    }
    if (!['GET', 'HEAD', ...MUTATES].includes(method)) throw apiError(405, `The CRM proxy doesn't forward ${method}`)

    // Only a path on the CRM: never another host, whatever the page asks for.
    const base = new URL(login.url)
    const target = new URL(`/${sub.replace(/^\/+/, '')}${search}`, base)
    if (target.origin !== base.origin) throw apiError(400, 'That is not a path on the CRM')

    const body = MUTATES.has(method) ? await bodyOf(req) : undefined
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined || NOT_FORWARDED.has(k.toLowerCase()) || k.toLowerCase().startsWith('sec-')) continue
      headers[k] = Array.isArray(v) ? v.join(', ') : v
    }

    const send = async (force: boolean) => {
      const h: Record<string, string> = { ...headers, cookie: login.cookie }
      if (MUTATES.has(method)) {
        const token = await csrfFor(login, force)
        if (token) {
          h.cookie = `${login.cookie}; crm_csrf=${token}`
          h['x-csrf-token'] = token
        }
      }
      return fetchFn(target, { method, headers: h, body, redirect: 'manual', signal: AbortSignal.timeout(o.timeoutMs ?? TIMEOUT_MS) })
    }

    let upstream: Response
    try {
      upstream = await send(false)
      // A rejected CSRF pair is mended once: ask for a new token and send it again.
      if (MUTATES.has(method) && upstream.status === 403) {
        const peek = await upstream.clone().text().catch(() => '')
        if (/csrf/i.test(peek)) upstream = await send(true)
      }
    } catch (e) {
      const code = (e as { cause?: { code?: string } }).cause?.code ?? (e as { name?: string }).name ?? 'error'
      throw apiError(502, `Couldn't reach the CRM at ${base.host}: ${code}`)
    }

    const out: Record<string, string> = { 'Cache-Control': 'no-store' }
    upstream.headers.forEach((v, k) => {
      const key = k.toLowerCase()
      if (NOT_RETURNED.has(key) || key.startsWith('access-control-') || key === 'cache-control') return
      out[k] = v
    })
    res.writeHead(upstream.status, out)
    if (!upstream.body || method === 'HEAD') return void res.end()
    // 23 Nov 2026 (his hub stopped itself 39 times in a day on "TimeoutError: The operation was aborted due to timeout"): this line was `Readable.fromWeb(body).pipe(res)`.
    // `.pipe` puts no error listener on the SOURCE, so when the fetch's own AbortSignal.timeout fired while the answer was still coming (the CRM slow, or the page
    // gone and the body left unread: the timer kept running either way), the Readable's 'error' event had nobody to go to and Node threw it as an UNCAUGHT exception, which
    // the app answers by stopping itself (and every chat). pipeline() listens to both ends: an error ends the answer here (the page sees a cut connection, never a
    // half answer passed off as whole), and a page that hangs up lets the CRM's body go at once instead of holding it until the timer fires.
    try {
      await pipeline(Readable.fromWeb(upstream.body as never), res)
    } catch (e) {
      const why = (e as { code?: string }).code === 'ERR_STREAM_PREMATURE_CLOSE' ? 'the page hung up' : ((e as { name?: string }).name ?? 'error')
      // pipeline has already destroyed both ends (the page's connection is cut, the CRM's body is cancelled): all that is left is to say so.
      o.log?.warn(`crm proxy: ${method} ${target.pathname}: the answer ended early (${why})`)
    }
  }

  return {
    async request(method, sub, init = {}) {
      const login = readLogin(o.file, now(), o.crmUrl)
      if (!login) throw new CrmNotSignedIn()
      return this.requestAs(login, method, sub, init)
    },

    async requestAs(login, method, sub, init = {}) {
      // F-339: a login at another address than this run's has ended: not one request goes there (not a CSRF ask either).
      if (o.crmUrl !== undefined && !sameCrm(login.url, o.crmUrl)) throw apiError(401, 'Your CRM sign-in here has ended: sign in again.')
      const m = method.toUpperCase()
      const base = new URL(login.url)
      const target = new URL(`/${sub.replace(/^\/+/, '')}`, base)
      if (target.origin !== base.origin) throw apiError(400, 'That is not a path on the CRM')
      const body = init.json !== undefined ? JSON.stringify(init.json) : init.body
      const send = async (force: boolean) => {
        const h: Record<string, string> = { accept: 'application/json', ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}), ...init.headers, cookie: login.cookie }
        if (MUTATES.has(m)) {
          const token = await csrfFor(login, force)
          if (token) {
            h.cookie = `${login.cookie}; crm_csrf=${token}`
            h['x-csrf-token'] = token
          }
        }
        return fetchFn(target, { method: m, headers: h, body, redirect: 'manual', signal: init.signal ?? AbortSignal.timeout(o.timeoutMs ?? TIMEOUT_MS) })
      }
      let r = await send(false)
      if (MUTATES.has(m) && r.status === 403) {
        const peek = await r.clone().text().catch(() => '')
        if (/csrf/i.test(peek)) r = await send(true)
      }
      return r
    },

    session() {
      const login = readLogin(o.file, now(), o.crmUrl)
      return login
        ? { signedIn: true, name: login.name, username: login.username, expiresAt: new Date(login.expiresAt).toISOString() }
        : { signedIn: false, name: null, username: null, expiresAt: null }
    },

    async handle(req, res, sub, search) {
      const login = readLogin(o.file, now(), o.crmUrl)
      if (!login) throw apiError(401, 'The CRM is not signed in on this PC: sign in from the CRM page, or Devices')
      return forward(login, req, res, sub, search)
    },

    async handleAs(login, req, res, sub, search) {
      if (!/^https?:\/\//.test(login.url) || !login.cookie || (o.crmUrl !== undefined && !sameCrm(login.url, o.crmUrl))) throw apiError(401, 'Your CRM sign-in here has ended: sign in again.')
      return forward({ url: trimUrl(login.url), cookie: login.cookie }, req, res, sub, search)
    },
  }
}
