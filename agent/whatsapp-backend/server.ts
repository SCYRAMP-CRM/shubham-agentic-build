import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { WA_ACCOUNT_MIN_FREE_BYTES, WA_ACCOUNT_RE, WA_MAIN_ACCOUNT, WA_PREFIX, type WaAccount } from '../../shared/whatsapp.ts'
import { writeAtomic } from '../config.ts'
import type { Logger } from '../log.ts'
import { listProcesses } from '../proc-tree.ts'
import { clean } from '../whatsapp/engine.ts'
import { createWhatsApp, type WhatsApp, type WhatsAppOptions } from '../whatsapp/index.ts'
import { cleanType } from '../whatsapp/media.ts'
import { createAccounts } from './accounts.ts'
import { createTicketVerifier, SEND_TICKET_HEADER } from './send-ticket.ts'

// Order o8d7e (F-223): WhatsApp's backend as its own server, on this Server only.
// - Listens on 127.0.0.1 and nowhere else; on a port of 50000 or higher. The agent's API (21221) is untouched.
// - Order of5a0: given a band (shared/whatsapp.ts WA_BACKEND_PORTS), it takes the FIRST FREE port of it and writes down which (`port` beside the
//   token; the hub also hears it in the backend's ready word). The band is shared on purpose, never its own: read the comment there.
// - One backend per state folder (`backend.lock`): two would drive one WhatsApp login from two Chromes.
// - Every request needs the backend's token (x-sad-token, from <dir>\token, made on first start, compared in constant time),
//   a Host of 127.0.0.1 or localhost, and no Origin (a browser page is refused until the page is wired in).
// - Sends are refused here unless they carry a TICKET (send-ticket.ts): one the agent made after a signed-in person's own request, for exactly that chat and
//   those words, good once for 30 s, made with a key that lives in memory only. No key (how it starts, and what sending OFF is) refuses everything, so the
//   token alone, a file any local program can read, cannot send (order obf15, oWA S2).
// - No public tunnel, no CRM or cloud sync, no deploy: nothing in this server reaches beyond this PC.

export const BACKEND_MIN_PORT = 50000
const BODY_MAX = 256 * 1024
const TOKEN_FILE = 'token'
/** Order of5a0: the port this backend got, written once it listens and removed when it closes. */
export const PORT_FILE = 'port'
/** Order of5a0: which process runs the backend of this folder now. */
export const LOCK_FILE = 'backend.lock'
/** A lock names a live backend only if that process is node and started within this of the lock being written (a PID can be reused). */
const LOCK_IDENTITY_MS = 60_000

export interface BackendOptions {
  /** One port (a hand-run backend, the tests): 50000 or higher. */
  port?: number
  /** Order of5a0: the ports to try in order, the first free one taken (the hub's backend: WA_BACKEND_PORTS). */
  ports?: readonly number[]
  /** Its state folder: the token, the port, the lock, the login and WhatsApp's packages (<dir>\whatsapp). */
  dir: string
  log: Logger
  /** Order obf15: the key that tickets are checked with (64 hex), or none. The hub hands it over later with setSendKey (its private channel), never in a file or the environment. */
  sendKey?: string | null
  /** Tests: the WhatsApp part's options (script, ready, install, chrome...). */
  whatsapp?: Partial<WhatsAppOptions>
  /** F-312: how much memory is free on this Server now, in bytes (tests; default os.freemem). An extra number's Chrome opens only above WA_ACCOUNT_MIN_FREE_BYTES. */
  memory?: () => number
  /** Tests: what runs as a PID now (name and start), to tell a live backend from a PID reused by another program. */
  processOf?: (pid: number) => Promise<{ name: string; created: number } | null>
}

export interface Backend {
  port: number
  token: string
  server: Server
  /** The first number's WhatsApp (F-312: every other number is in `numbers`). */
  wa: WhatsApp
  /** F-312: every number's WhatsApp, by id (`main` first). */
  numbers(): ReadonlyMap<string, WhatsApp>
  /** Order obf15: sending ON hands it a key (every ticket made with an older one is worthless); sending OFF takes it away, and nothing can be sent until the next key. */
  setSendKey(key: string | null): void
  /** Whether it holds a key now (never the key itself). */
  sendKeyHeld(): boolean
  close(): Promise<void>
}

export function checkPort(port: number): number {
  if (!Number.isInteger(port) || port < BACKEND_MIN_PORT || port > 65535) throw new Error(`the WhatsApp backend's port must be ${BACKEND_MIN_PORT} or higher (got ${port})`)
  return port
}

/** The ports of a band, from..to, each checked. */
export function bandPorts(band: { from: number; to: number }): number[] {
  const from = checkPort(band.from)
  const to = checkPort(band.to)
  if (to < from || to - from >= 1000) throw new Error(`the WhatsApp backend's band must run upward and hold at most 1000 ports (got ${from}-${to})`)
  return Array.from({ length: to - from + 1 }, (_, i) => from + i)
}

/** The token for this backend: read from <dir>\token, or made (32 random bytes) on first start. */
export function backendToken(dir: string): string {
  const file = path.join(dir, TOKEN_FILE)
  if (existsSync(file)) {
    const t = readFileSync(file, 'utf8').trim()
    if (/^[0-9a-f]{64}$/.test(t)) return t
  }
  mkdirSync(dir, { recursive: true })
  const t = randomBytes(32).toString('hex')
  writeAtomic(file, `${t}\n`)
  return t
}

/** What a backend.lock says: the PID and when it was written (ms); null when there is none or it can't be read. */
export function readLock(dir: string): { pid: number; at: number } | null {
  try {
    const v = JSON.parse(readFileSync(path.join(dir, LOCK_FILE), 'utf8')) as { pid?: unknown; at?: unknown }
    return Number.isSafeInteger(v.pid) && (v.pid as number) > 0 && Number.isFinite(v.at) ? { pid: v.pid as number, at: v.at as number } : null
  } catch {
    return null
  }
}

async function processOfDefault(pid: number) {
  const p = (await listProcesses()).find(x => x.pid === pid)
  return p ? { name: p.name, created: p.created } : null
}

/**
 * Takes this folder's lock for this process, or refuses (code WA_BACKEND_BUSY) while another live backend holds it. A lock left by a backend that
 * ended without closing (a crash) is taken over: its PID is gone, or now runs another program (not node, or started at another time).
 */
async function takeLock(dir: string, processOf: NonNullable<BackendOptions['processOf']>): Promise<() => void> {
  const file = path.join(dir, LOCK_FILE)
  mkdirSync(dir, { recursive: true })
  for (let tries = 0; tries < 3; tries++) {
    try {
      writeFileSync(file, `${JSON.stringify({ pid: process.pid, at: Date.now() })}\n`, { flag: 'wx' })
      return () => {
        try {
          if (readLock(dir)?.pid === process.pid) rmSync(file, { force: true })
        } catch {
          // Left behind: the next start sees its PID gone and takes it over.
        }
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    }
    const held = readLock(dir)
    if (held && held.pid !== process.pid) {
      const p = await processOf(held.pid).catch(() => null)
      if (p && /^node(\.exe)?$/i.test(p.name) && Math.abs(held.at - p.created) <= LOCK_IDENTITY_MS) {
        throw Object.assign(new Error(`another WhatsApp backend is already running for this folder (pid ${held.pid}, since ${new Date(held.at).toISOString()})`), { code: 'WA_BACKEND_BUSY' })
      }
    }
    rmSync(file, { force: true })
  }
  throw Object.assign(new Error('the WhatsApp backend could not take its lock'), { code: 'WA_BACKEND_BUSY' })
}

/**
 * Listens on the first of `ports` that is free on 127.0.0.1 (EADDRINUSE, or EACCES for Windows' excluded ranges, moves on to the next; anything
 * else stops). Each try's handlers are removed when it ends (a try that failed must not answer for a later one: the pc-ssh fixture's bug, 8dd84be),
 * and the port is read back from the socket itself.
 */
async function listenFirstFree(server: Server, ports: readonly number[]): Promise<number> {
  let last: Error | null = null
  for (const port of ports) {
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (e: Error) => {
          server.off('listening', onListening)
          reject(e)
        }
        const onListening = () => {
          server.off('error', onError)
          resolve()
        }
        server.once('error', onError)
        server.once('listening', onListening)
        server.listen(port, '127.0.0.1')
      })
      return (server.address() as AddressInfo).port
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code !== 'EADDRINUSE' && code !== 'EACCES') throw e
      last = e as Error
    }
  }
  const span = ports.length === 1 ? `${ports[0]}` : `${ports[0]}-${ports[ports.length - 1]}`
  throw Object.assign(new Error(`no free port for the WhatsApp backend on 127.0.0.1 in ${span}${last ? ` (the last: ${(last as NodeJS.ErrnoException).code})` : ''}`), { code: 'WA_BACKEND_NO_PORT' })
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a, 'utf8')
  const y = Buffer.from(b, 'utf8')
  return x.length === y.length && timingSafeEqual(x, y)
}

function fail(res: ServerResponse, status: number, message: string, code?: string) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify({ error: message, ...(code ? { code } : {}) }))
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > BODY_MAX) throw Object.assign(new Error('the request is too large'), { status: 413 })
    chunks.push(c as Buffer)
  }
  if (chunks.length === 0) return undefined
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw Object.assign(new Error('the body is not JSON'), { status: 400 })
  }
}

/**
 * Order of5a0 (A2): the overlay Assistant's four WhatsApp tools on this backend's login, for the agent (agent/whatsapp-backend/assistant-tools.ts),
 * behind the same token as everything here. The page's proxy never passes these on: they are not among its routes.
 */
async function assistant(wa: WhatsApp, method: string, rest: string, q: URLSearchParams, body: unknown): Promise<unknown> {
  const t = wa.tools
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  if (method === 'GET' && rest === '/assistant/status') return t.status()
  if (method === 'GET' && rest === '/assistant/chats') return t.chats()
  if (method === 'GET' && rest === '/assistant/read') return t.read(q.get('chat') ?? '', Number(q.get('count')) || 10)
  if (method === 'POST' && rest === '/assistant/draft') {
    const b = (body ?? {}) as Record<string, unknown>
    return t.draft(str(b.chatId), str(b.text), str(b.why))
  }
  throw Object.assign(new Error('no such path'), { status: 404 })
}

export async function startBackend(o: BackendOptions): Promise<Backend> {
  if ((o.port === undefined) === (o.ports === undefined)) throw new Error('give the WhatsApp backend either one port or a band of ports')
  const ports = o.port !== undefined ? [checkPort(o.port)] : o.ports!.map(checkPort)
  if (ports.length === 0) throw new Error('the WhatsApp backend was given no ports')
  const unlock = await takeLock(o.dir, o.processOf ?? processOfDefault)
  let wa: WhatsApp | null = null
  /** F-312: every number's WhatsApp, the first first. Each is its own login, its own Chrome, its own settings and drafts. */
  const numbers = new Map<string, WhatsApp>()
  try {
    const token = backendToken(o.dir)
    const whatsappDir = path.join(o.dir, 'whatsapp')
    const accounts = createAccounts(o.dir, o.log, {
      folders: () => {
        try {
          return readdirSync(path.join(whatsappDir, 'accounts'))
        } catch {
          return []
        }
      },
    })
    const freeBytes = o.memory ?? (() => os.freemem())
    const tickets = createTicketVerifier()
    tickets.setKey(o.sendKey ?? null)
    /**
     * One number's WhatsApp. The first is made exactly as it always was (its folder is <dir>\whatsapp, its log is "whatsapp"); an extra one has its own folder under it, shares the installed packages,
     * and is refused its Chrome in plain words while the Server has less than WA_ACCOUNT_MIN_FREE_BYTES free. A send is this backend's only against the agent's ticket for exactly it, and since F-312 for
     * exactly that NUMBER (the same chat id is a different chat in each).
     */
    const make = (id: string): WhatsApp =>
      createWhatsApp({
        dir: accounts.dirOf(whatsappDir, id),
        ...(id === WA_MAIN_ACCOUNT
          ? { log: o.log.child('whatsapp') }
          : {
              log: o.log.child(`whatsapp-${id}`),
              lib: path.join(whatsappDir, 'lib'),
              // His rule: an extra number opens on use and closes after idle. "Stay open" is the first number's only.
              neverStayOpen: true,
              beforeOpen: () => {
                if (freeBytes() < WA_ACCOUNT_MIN_FREE_BYTES) throw Object.assign(new Error('There is not enough memory free on this Server to open another WhatsApp number right now. Close one, or try again in a few minutes.'), { status: 409, code: 'wa-low-memory' })
              },
            }),
        // Order o55b6: its Chrome may go out through the Z800 (tunnel.json, kept by Agent 6's tunnel; checked in agent/whatsapp/tunnel.ts).
        tunnel: { file: path.join(o.dir, 'tunnel.json') },
        human: (_kind, fields, _sig, r) => tickets.verify(r?.headers?.[SEND_TICKET_HEADER], { chatId: String(fields[0] ?? ''), textSha: String(fields[1] ?? ''), draft: String(fields[2] ?? ''), acct: id }),
        ...o.whatsapp,
      })
    wa = make(WA_MAIN_ACCOUNT)
    numbers.set(WA_MAIN_ACCOUNT, wa)
    for (const a of accounts.list()) if (a.id !== WA_MAIN_ACCOUNT) numbers.set(a.id, make(a.id))
    let hosts = new Set<string>()
    /** The numbers as the page's switcher shows them: who is linked, whose Chrome runs now. */
    const listing = (): WaAccount[] =>
      accounts.list().map(a => {
        const st = numbers.get(a.id)?.status()
        return { id: a.id, label: a.label, linked: st?.linked ?? false, open: st !== undefined && st.state !== 'off', name: st?.me?.name ?? null }
      })
    /** The numbers themselves: the list, a new one, a name. */
    function accountsRoute(method: string, rest: string, body: unknown): unknown {
      const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
      if (method === 'GET' && rest === '/accounts') return listing()
      if (method === 'POST' && rest === '/accounts') {
        const a = accounts.add(b.label as string)
        numbers.set(a.id, make(a.id))
        return { account: listing().find(x => x.id === a.id), accounts: listing() }
      }
      const one = /^\/accounts\/([^/]+)$/.exec(rest)
      if (method === 'PATCH' && one) {
        if (!WA_ACCOUNT_RE.test(one[1])) throw Object.assign(new Error('that is not a WhatsApp number of this app'), { status: 400, code: 'wa-bad-account' })
        accounts.rename(one[1], b.label as string)
        return { accounts: listing() }
      }
      throw Object.assign(new Error('no such path'), { status: 404 })
    }

    const server = createServer(async (req, res) => {
      try {
        if (req.headers.host === undefined || !hosts.has(req.headers.host)) return fail(res, 403, 'not this address')
        if (req.headers.origin !== undefined) return fail(res, 403, 'browser pages are not allowed here yet')
        const sent = req.headers['x-sad-token']
        if (typeof sent !== 'string' || !same(sent, token)) return fail(res, 401, 'the token is missing or wrong')
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (!url.pathname.startsWith(`${WA_PREFIX}/`) && url.pathname !== WA_PREFIX) return fail(res, 404, 'no such path')
        const rest = url.pathname.slice(WA_PREFIX.length) || '/'
        const method = (req.method ?? 'GET').toUpperCase()
        const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req)
        // F-312: the numbers themselves, then which number a request is for: ?acct= (left out: the first, so every older caller is unchanged).
        if (rest === '/accounts' || rest.startsWith('/accounts/')) {
          const answer = accountsRoute(method, rest, body)
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          return void res.end(JSON.stringify(answer))
        }
        const acct = url.searchParams.get('acct') ?? WA_MAIN_ACCOUNT
        if (!WA_ACCOUNT_RE.test(acct)) return fail(res, 400, 'that is not a WhatsApp number of this app', 'wa-bad-account')
        const live = numbers.get(acct)
        if (!live) return fail(res, 404, 'there is no such WhatsApp number', 'wa-no-such-account')
        // Order oWA S3: a message's file, as bytes (not JSON). Only the agent's proxy asks (behind the token); what a browser is told about its kind is the proxy's (agent/whatsapp/media.ts).
        if (method === 'GET' && rest === '/media') {
          const f = await live.media(url.searchParams.get('chat') ?? '', url.searchParams.get('msg') ?? '')
          res.writeHead(200, { 'content-type': cleanType(f.mimetype) ?? 'application/octet-stream', 'content-length': f.bytes.length, 'x-wa-media-name': encodeURIComponent(f.filename ?? ''), 'cache-control': 'no-store' })
          return void res.end(f.bytes)
        }
        // The overlay Assistant's tools are the first number's only (the other numbers are the page's, until he says otherwise).
        if (rest.startsWith('/assistant/') && acct !== WA_MAIN_ACCOUNT) return fail(res, 404, 'the Assistant uses the first number only', 'wa-no-such-account')
        const answer = rest.startsWith('/assistant/') ? await assistant(live, method, rest, url.searchParams, body) : await live.mount.http({ method, rest, query: url.searchParams, body, headers: req.headers })
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(answer ?? { ok: true }))
      } catch (e) {
        const status = typeof (e as { status?: unknown }).status === 'number' ? (e as { status: number }).status : 500
        // Order o714a: the log keeps WHY (it said only "Error"), cleaned of numbers, ids and images like every line this backend writes.
        if (status >= 500) o.log.error(`WhatsApp backend: ${(e as Error).name}: ${clean((e as Error).message ?? '')}`)
        const code = typeof (e as { code?: unknown }).code === 'string' && status < 500 ? (e as { code: string }).code : undefined
        fail(res, status, status >= 500 ? 'the backend could not answer' : (e as Error).message, code)
      }
    })

    const port = await listenFirstFree(server, ports)
    hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`])
    const portFile = path.join(o.dir, PORT_FILE)
    writeAtomic(portFile, `${port}\n`)
    o.log.info(`WhatsApp backend on 127.0.0.1:${port} (this Server only)`)
    let closed: Promise<void> | null = null
    return {
      port,
      token,
      server,
      wa,
      numbers: () => numbers,
      setSendKey: k => tickets.setKey(k),
      sendKeyHeld: () => tickets.hasKey(),
      close() {
        closed ??= (async () => {
          try {
            // F-312: every number closes its own Chrome AT THE SAME TIME (each gets the whole of its time, not what the one before left): one after the other, a slow one would be cut off and killed with the app.
            await Promise.all([...numbers.values()].map(w => w.close().catch(e => o.log.warn(`a WhatsApp number did not close cleanly: ${e instanceof Error ? e.message : String(e)}`))))
            await new Promise<void>(r => server.close(() => r()))
          } finally {
            try {
              if (readFileSync(portFile, 'utf8').trim() === String(port)) rmSync(portFile, { force: true })
            } catch {
              // Already gone.
            }
            unlock()
          }
        })()
        return closed
      },
    }
  } catch (e) {
    await Promise.all([...numbers.values()].map(w => w.close().catch(() => {})))
    unlock()
    throw e
  }
}
