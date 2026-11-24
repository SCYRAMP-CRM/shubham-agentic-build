import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { scopesOf } from '../../shared/brain-view.ts'
import { DOOR_CODES, isDoorScope, type NewMemoryBrain, type NewMemoryStatus, type NotConnectedWhy } from '../../shared/new-memory.ts'
import { apiError } from '../api.ts'
import type { Logger } from '../log.ts'
import { adminsAreOnlyTheOwner } from './memory-people.ts'

// F-332 step 1 (Shubham's order o4d57: "Yes" to reading, and later fixing, the new memory from his phone): the app's ONLY client of the NEW standalone memory (F-331: its own service and store,
// C:/saw/memory-standalone-20261123/service, which this app never imports and never edits). Its door is loopback HTTP; its owner token is a FILE. This module is the one place that knows either.
//   - READ ONLY, by construction: the door has thirty-one methods (erase, grant, createPrincipal, revoke, write, correct, retract ...). This module can send exactly TWO requests, written below as two
//     literals: GET /v1/health and POST /v1/brain. There is no function that takes a method name, so nothing a browser sends can reach another one. The scope of a brain is the only value that goes
//     from a caller into a request, and it is checked (isDoorScope) before anything is sent.
//   - FAIL CLOSED: the config (<state>/agent/agentic/memory-door.json = { "url", "tokenFile" }: a PATH, never the token) is checked on every call; a missing, unreadable or odd file, an address that is
//     not this machine's own (127.0.0.1 or [::1], http, an explicit port, no user, no query), or a key file that cannot be read gives "not connected", never an error page and never a request.
//   - NO LEAKS: the key is read fresh for each call, held in one local variable for the one header and never put in an object that is logged or thrown. An error carries a fixed sentence and a code,
//     never the door's text, the request, the address, the path of the key file or the key. One log line per call: the route, the status or the failure, the milliseconds.
//   - The F-051 guard keeps its meaning (adminsAreOnlyTheOwner): while another administrator exists this memory is off for everybody (409 memory-admins), asked before the config is read. WHO may ask
//     (a signed-in human, the first owner by id) is the route's job (index.ts memoryDoorOwner), before this module is called.

export const MEMORY_DOOR_FILE = 'memory-door.json'

const CONFIG_MAX_BYTES = 2048
const TOKEN_FILE_MAX_BYTES = 512
const TOKEN_SHAPE = /^[A-Za-z0-9._~+/=-]{16,200}$/
const BODY_MAX = 5 * 1024 * 1024
const TIMEOUT_MS = 8000
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]'])

export interface DoorConfig {
  /** `http://127.0.0.1:57311`: scheme, loopback host, explicit port; nothing else. */
  origin: string
  /** Where the owner's key is (an absolute path). */
  tokenFile: string
}

/**
 * What a config file's text is: the config, or why this app is not connected (a fixed word, never a path or an address). Pure.
 * The address must be http, the loopback IP of this machine, with a port and nothing more: https, a LAN host, `localhost`, `file:`, a user, a query, a path and a bad port are all refused.
 */
export function parseDoorConfig(text: string): { ok: true; config: DoorConfig } | { ok: false; why: NotConnectedWhy } {
  let raw: unknown
  try {
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  } catch {
    return { ok: false, why: 'bad-config' }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, why: 'bad-config' }
  const { url, tokenFile } = raw as Record<string, unknown>
  if (typeof url !== 'string' || typeof tokenFile !== 'string') return { ok: false, why: 'bad-config' }
  // F-332-1 (Agent 14): a network path (\\host\share\file, //host/share/file) is refused: opening it would make this Server reach out to another machine
  if (!tokenFile || tokenFile.length > 500 || tokenFile.includes('\u0000') || !path.isAbsolute(tokenFile) || /^[\\/]{2}/.test(tokenFile)) return { ok: false, why: 'bad-config' }
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return { ok: false, why: 'bad-config' }
  }
  const port = Number(u.port)
  const ok =
    u.protocol === 'http:' &&
    LOOPBACK_HOSTS.has(u.hostname) &&
    u.username === '' &&
    u.password === '' &&
    u.search === '' &&
    u.hash === '' &&
    u.pathname === '/' &&
    u.port !== '' &&
    Number.isInteger(port) &&
    port >= 1 &&
    port <= 65535
  if (!ok) return { ok: false, why: 'address-not-allowed' }
  return { ok: true, config: { origin: `http://${u.hostname}:${u.port}`, tokenFile } }
}

/** What went wrong with the door, in one of five ways. A message is only this word: no text of the door's, no address, no key. */
class DoorFail extends Error {
  readonly kind: 'denied' | 'down' | 'slow' | 'bad'
  constructor(kind: 'denied' | 'down' | 'slow' | 'bad') {
    super(kind)
    this.kind = kind
  }
}

const REFUSAL: Record<'denied' | 'down' | 'slow' | 'bad', { status: number; code: string; words: string }> = {
  denied: { status: 502, code: DOOR_CODES.denied, words: 'The new memory refused this app’s key.' },
  down: { status: 502, code: DOOR_CODES.down, words: 'The new memory is not answering.' },
  slow: { status: 504, code: DOOR_CODES.slow, words: 'The new memory took too long to answer.' },
  bad: { status: 502, code: DOOR_CODES.bad, words: 'The new memory gave an answer this app could not read.' },
}
const refusal = (kind: keyof typeof REFUSAL) => Object.assign(apiError(REFUSAL[kind].status, REFUSAL[kind].words), { code: REFUSAL[kind].code })
const notConnected = () => Object.assign(apiError(409, 'The new memory is not connected to this app.'), { code: DOOR_CODES.off })
const guardOff = () => Object.assign(apiError(409, 'The memory is off while another administrator exists.'), { code: DOOR_CODES.guard })

/** The two requests this module can make. A closed set: a third one cannot be written without changing this type. */
type DoorCall = { method: 'GET'; path: '/v1/health' } | { method: 'POST'; path: '/v1/brain'; body: { args: [{ scope?: string }] } }

export interface MemoryDoorOptions {
  /** <state>/agent/agentic: memory-door.json is read from here. */
  dir: string
  /** The administrators now (the auth file's and the second-owner list's): the F-051 guard reads them at every call. */
  admins: () => readonly string[]
  /** The app owner's person id (the first owner). */
  ownerId: string
  log?: Logger
  /** Tests only: index.ts never sets it. A stand-in for the network and for the two small files, and a short timeout. */
  test?: { fetch?: typeof fetch; readText?: (file: string, maxBytes: number) => string | null; timeoutMs?: number }
}

export interface MemoryDoor {
  /** Whether the door can be reached from here (config, key file, health). Reads no memory. */
  status(): Promise<NewMemoryStatus>
  /** The brain (all, or one scope): the readable markdown and its etag. */
  brain(scope?: unknown): Promise<NewMemoryBrain>
}

function readSmall(file: string, maxBytes: number): string | null {
  try {
    const st = statSync(file)
    if (!st.isFile() || st.size > maxBytes) return null
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

export function createMemoryDoor(o: MemoryDoorOptions): MemoryDoor {
  const fetchFn = o.test?.fetch ?? fetch
  const readText = o.test?.readText ?? readSmall
  const timeoutMs = o.test?.timeoutMs ?? TIMEOUT_MS
  const configFile = path.join(o.dir, MEMORY_DOOR_FILE)

  // The guard: asked first, before the config file and the key file are looked at.
  const guard = () => {
    if (!adminsAreOnlyTheOwner(o.admins(), o.ownerId)) throw guardOff()
  }

  function loadConfig(): { ok: true; config: DoorConfig } | { ok: false; why: NotConnectedWhy } {
    const text = readText(configFile, CONFIG_MAX_BYTES)
    if (text === null) return { ok: false, why: 'no-config' }
    return parseDoorConfig(text)
  }

  /** The key, fresh from its file; null when it cannot be read or is not a key's shape. */
  function readToken(cfg: DoorConfig): string | null {
    const text = readText(cfg.tokenFile, TOKEN_FILE_MAX_BYTES)
    const t = text === null ? '' : text.trim()
    return TOKEN_SHAPE.test(t) ? t : null
  }

  async function readCapped(res: Response): Promise<string> {
    const declared = Number(res.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > BODY_MAX) {
      void res.body?.cancel().catch(() => {})
      throw new DoorFail('bad')
    }
    const reader = res.body?.getReader()
    if (!reader) return ''
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > BODY_MAX) {
        await reader.cancel().catch(() => {})
        throw new DoorFail('bad')
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString('utf8')
  }

  /** What an error from the network or the stream means. Only its kind is used: its text is never read out. */
  function failOf(e: unknown): DoorFail {
    if (e instanceof DoorFail) return e
    const name = (e as { name?: unknown } | null)?.name
    if (name === 'TimeoutError' || name === 'AbortError') return new DoorFail('slow')
    const why = `${(e as { message?: unknown } | null)?.message ?? ''} ${((e as { cause?: { message?: unknown } } | null)?.cause?.message as string | undefined) ?? ''}`
    // a redirect (the fetch is told to refuse them) is an answer this app cannot use, not a door that is down
    if (/redirect/i.test(why)) return new DoorFail('bad')
    return new DoorFail('down')
  }

  /** One request to the door; the parsed JSON of a 200, or a DoorFail. One log line, whatever happens: the route, how it ended, the milliseconds. */
  async function send(call: DoorCall, token: string | null, cfg: DoorConfig): Promise<unknown> {
    const started = Date.now()
    let status: number | string = '-'
    let outcome = 'down'
    try {
      const res = await fetchFn(cfg.origin + call.path, {
        method: call.method,
        headers: call.method === 'POST' && token ? { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' } : { accept: 'application/json' },
        ...(call.method === 'POST' ? { body: JSON.stringify(call.body) } : {}),
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      })
      status = res.status
      if (res.status === 401 || res.status === 403) {
        void res.body?.cancel().catch(() => {})
        throw new DoorFail('denied')
      }
      if (res.status !== 200) {
        void res.body?.cancel().catch(() => {})
        throw new DoorFail('bad')
      }
      const text = await readCapped(res)
      try {
        const parsed = JSON.parse(text) as unknown
        outcome = 'ok'
        return parsed
      } catch {
        throw new DoorFail('bad')
      }
    } catch (e) {
      const f = failOf(e)
      outcome = f.kind
      throw f
    } finally {
      o.log?.info(`memory door: ${call.method} ${call.path} ${status} ${outcome} ${Date.now() - started}ms`)
    }
  }

  return {
    async status(): Promise<NewMemoryStatus> {
      guard()
      const cfg = loadConfig()
      if (!cfg.ok) return { state: 'not-connected', why: cfg.why }
      if (readToken(cfg.config) === null) return { state: 'not-connected', why: 'token-unreadable' }
      try {
        const out = (await send({ method: 'GET', path: '/v1/health' }, null, cfg.config)) as { ok?: unknown } | null
        return out && typeof out === 'object' && out.ok === true ? { state: 'ready' } : { state: 'bad' }
      } catch (e) {
        const kind = e instanceof DoorFail ? e.kind : 'down'
        return { state: kind === 'denied' ? 'bad' : kind }
      }
    },

    async brain(scope?: unknown): Promise<NewMemoryBrain> {
      guard()
      const wanted = scope === undefined || scope === null || scope === '' ? null : scope
      if (wanted !== null && !isDoorScope(wanted)) throw Object.assign(apiError(400, 'That scope cannot be asked for.'), { code: DOOR_CODES.scope })
      const cfg = loadConfig()
      if (!cfg.ok) throw notConnected()
      const token = readToken(cfg.config)
      if (token === null) throw notConnected()
      let out: unknown
      try {
        out = await send({ method: 'POST', path: '/v1/brain', body: { args: [wanted === null ? {} : { scope: wanted }] } }, token, cfg.config)
      } catch (e) {
        throw refusal(e instanceof DoorFail ? e.kind : 'down')
      }
      const result = (out as { ok?: unknown; result?: { markdown?: unknown; etag?: unknown } } | null)?.result
      if (!result || typeof result.markdown !== 'string' || typeof result.etag !== 'string' || !/^[0-9a-f]{16}$/.test(result.etag)) throw refusal('bad')
      return { markdown: result.markdown, etag: result.etag, scopes: scopesOf(result.markdown) }
    },
  }
}
