import { readFileSync, rmSync } from 'node:fs'
import { writeAtomic } from '../config.ts'
import { API_KEY, CREDENTIAL_KINDS, CrmError, SETUP_TOKEN, call, isObject, refusal, text, trimUrl, type ClaudeKind, type Credential } from './crm.ts'

// F-351: THIS PC'S OWN KEY. The CRM gives a PC a secret (the owner taps "Give this PC a key" on the Subscriptions page; the Server mints it with the owner's session and hands it to this PC over the paired link) so that
// this PC can fetch the Claude token of the person it is ASSIGNED to (Usage for Server Agentic) and report its usage WITHOUT anybody signing in on it, and with no 7-day CRM session to run out.
//
// What the key is: "<this PC's device id>.<43 characters>", sent only as   Authorization: Device <key>   to the CRM's /v1/device/* routes (the CRM accepts it nowhere else; this file refuses to send it anywhere else).
// Where it lives: <state>/agent/pc-key.json, mode 0600, beside crm-session.json. It is read here and in the usage report's request, and NEVER shown, logged, put in a status answer, a page or an error.
// A key that is for another PC, or malformed, is not a key: it is not stored and not read back.
//
// The person-login way is untouched: with no key (or once the CRM says the key has ended or was taken away, which clears it here) everything runs as it did.

/** The key's shape (the CRM's: lib/agenticPcKey.js): the device id (letters, digits, _ . : -), a dot, 43 base64url characters. */
export const KEY_SHAPE = /^([A-Za-z0-9][A-Za-z0-9_.:-]{3,99})\.([A-Za-z0-9_-]{43})$/
/** The PC renews its key itself once it is this old (the CRM lets a key live 90 days). */
export const ROTATE_AFTER_MS = 30 * 24 * 60 * 60 * 1000
/** The only place the key is ever sent. */
const DEVICE_ROUTE = /^v1\/device\/(usage|credential|key\/rotate)$/
/** The CRM's own code for "this PC's key is not valid" (revoked, expired, wrong): the ONLY answer that makes this PC forget its key. */
export const KEY_INVALID_CODE = 'DEVICE_KEY_INVALID'
/**
 * The CRM's own codes for "it gives this PC no Claude subscription now" (nobody assigned, Claude off for them, their week used, theirs turned off, ...): the ONLY answers that take the placed token out.
 * A bare 401, 403, 404 or 409 (a layer in front of the CRM, a CRM rolled back to a build without these routes) carries none of them: it is an error, and the key and the token stay.
 */
export const NO_CREDENTIAL_CODES: ReadonlySet<string> = new Set(['NO_ASSIGNED_USER', 'NO_SUBSCRIPTION', 'NO_CLAUDE', 'CLAUDE_BLOCKED', 'WEEKLY_CAP_REACHED', 'SUBSCRIPTION_DISABLED', 'ASSIGNEE_NOT_MEMBER'])
/** The key is sent to https addresses and to this machine, never over plain http to another host. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export interface PcKeyStatus {
  given: boolean
  savedAt: string | null
  rotatedAt: string | null
  expiresAt: string | null
}

/** What the file holds. `key` is the secret: it goes to fetch() headers and nowhere else. */
export interface PcKeyHeld {
  key: string
  savedAt: string
  rotatedAt: string | null
  expiresAt: string | null
}

export interface PcKeyStore {
  /** The key, or null (none, an unreadable file, a key that is not for this PC). */
  read(): PcKeyHeld | null
  /** Keeps a key (replacing one). Throws a fixed sentence (never the key) for a key that is not this PC's or not a key. `rotated`: this replaces the one before (savedAt stays). */
  save(key: string, meta?: { expiresAt?: string | null; rotated?: boolean }): void
  /** Forgets it (the file goes). */
  clear(): void
  /** Whether there is one and since when. Never the key. */
  status(): PcKeyStatus
}

export interface PcKeyStoreOptions {
  file: string
  /** This PC's device id (a thunk: it is known when the agent starts). */
  deviceId: () => string
  now?: () => number
}

const iso = (v: unknown): string | null => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null)

export function openPcKeyStore(o: PcKeyStoreOptions): PcKeyStore {
  const now = o.now ?? Date.now
  let cache: PcKeyHeld | null | undefined
  const forThisPc = (key: unknown): key is string => typeof key === 'string' && KEY_SHAPE.exec(key)?.[1] === o.deviceId()

  function load(): PcKeyHeld | null {
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(o.file, 'utf8'))
    } catch {
      return null
    }
    if (!isObject(raw) || raw.version !== 1 || !forThisPc(raw.key)) return null
    const savedAt = iso(raw.savedAt)
    if (!savedAt) return null
    return { key: raw.key, savedAt, rotatedAt: iso(raw.rotatedAt), expiresAt: iso(raw.expiresAt) }
  }

  function read(): PcKeyHeld | null {
    if (cache === undefined) cache = load()
    // the PC's id can change (a re-installed identity): a key made for another one is not read
    if (cache && !forThisPc(cache.key)) return null
    return cache
  }
  function save(key: string, meta: { expiresAt?: string | null; rotated?: boolean } = {}) {
    if (!forThisPc(key)) throw new Error('That key is not a key for this PC')
    const before = read()
    const at = new Date(now()).toISOString()
    const next: PcKeyHeld = {
      key,
      savedAt: meta.rotated && before ? before.savedAt : at,
      rotatedAt: meta.rotated ? at : null,
      expiresAt: iso(meta.expiresAt ?? null),
    }
    writeAtomic(o.file, JSON.stringify({ version: 1, ...next }, null, 2) + '\n', 0o600)
    cache = next
  }
  function clear() {
    cache = null
    rmSync(o.file, { force: true })
  }
  function status(): PcKeyStatus {
    const held = read()
    return held ? { given: true, savedAt: held.savedAt, rotatedAt: held.rotatedAt, expiresAt: held.expiresAt } : { given: false, savedAt: null, rotatedAt: null, expiresAt: null }
  }
  return { read, save, clear, status }
}

/** Is this key due to be renewed? (30 days after it was given or last renewed.) */
export const rotateDue = (held: PcKeyHeld, at: number): boolean => at - Date.parse(held.rotatedAt ?? held.savedAt) >= ROTATE_AFTER_MS

/** One request to the CRM with this PC's key. The route is one of the three the CRM's /v1/device router has: the key is never sent to any other path (a refusal, not a request). */
export function keyedRequest(url: string, key: string, method: 'GET' | 'POST', route: string, init: { json?: unknown; headers?: Record<string, string> } = {}) {
  if (!DEVICE_ROUTE.test(route)) throw new Error('A PC key is only sent to the CRM\'s /v1/device routes')
  let u: URL
  try {
    u = new URL(trimUrl(url))
  } catch {
    throw new Error('A PC key is only sent to a CRM address')
  }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname))) throw new Error('A PC key is only sent over https (or to this machine)')
  return call(`${trimUrl(url)}/${route}`, {
    method,
    headers: { authorization: `Device ${key}`, accept: 'application/json', ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}), ...init.headers },
    ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
  })
}

/** The usage report's request as the usage module wants it: the status only. */
export async function keyedReport(url: string, key: string, body: unknown): Promise<{ status: number }> {
  const r = await keyedRequest(url, key, 'POST', 'v1/device/usage', { json: body })
  return { status: r.status }
}

/**
 * The token of the subscription of the person this PC is assigned to (GET /v1/device/credential). The same answer shapes as the person's own request (claude/crm.ts credential): 'ok'; 'none' (nobody assigned, Claude off for
 * them, their week used, theirs turned off, ...: the CRM's own sentence); 'expired' = the KEY is no longer good (401: revoked, expired, wrong). A 429 (one fetch in 20 seconds) or anything else is an error, so the token in place stays.
 */
export async function credentialByKey(url: string, key: string, build: string): Promise<Credential> {
  const r = await keyedRequest(url, key, 'GET', 'v1/device/credential', { headers: { 'x-christopher-build': build, 'x-credential-kinds': CREDENTIAL_KINDS } })
  if (r.status === 200) {
    const token = text(r.body.token)
    const sub = r.body.subscription
    const credKind: ClaudeKind = r.body.kind === 'api_key' ? 'api_key' : 'subscription'
    if (!token || !(credKind === 'api_key' ? API_KEY : SETUP_TOKEN).test(token) || !isObject(sub) || text(sub.id) === null) {
      throw new CrmError(credKind === 'api_key' ? "The CRM's answer had no Claude API key in the shape Anthropic's keys have" : "The CRM's answer had no Claude token in the shape `claude setup-token` prints", 200)
    }
    return { kind: 'ok', subscription: { id: String(sub.id), name: text(sub.name) ?? 'Claude' }, token, credKind }
  }
  const code = text(r.body.code)
  // ONLY the CRM's own words move anything: its code for a key that is not valid forgets the key; its codes for "no subscription" take the token out. Anything else is an error (the key and the token stay).
  if (r.status === 401 && code === KEY_INVALID_CODE) return { kind: 'expired' }
  if ((r.status === 404 || r.status === 403 || r.status === 409) && code !== null && NO_CREDENTIAL_CODES.has(code)) {
    return { kind: 'none', code, message: text(r.body.error) ?? `The CRM has no Claude subscription for this PC (it answered ${r.status})` }
  }
  throw refusal(r, "The CRM couldn't give this PC its Claude subscription")
}

/** A new key for this PC (POST /v1/device/key/rotate): the answer holds the new key and its expiry; the old one works for an hour more. 401: the key is no longer good. */
export async function rotateKey(url: string, key: string): Promise<{ key: string; expiresAt: string | null }> {
  const r = await keyedRequest(url, key, 'POST', 'v1/device/key/rotate', { json: {} })
  if (r.status === 401 && text(r.body.code) === KEY_INVALID_CODE) throw new CrmError("The CRM does not accept this PC's key", 401, KEY_INVALID_CODE)
  if (r.status !== 200 || !text(r.body.key) || !KEY_SHAPE.test(String(r.body.key))) throw refusal(r, "The CRM couldn't renew this PC's key")
  return { key: String(r.body.key), expiresAt: iso(r.body.expiresAt) }
}

/** What the claude module needs of the CRM for a keyed PC, injectable for tests. */
export interface KeyedApi {
  credentialByKey(url: string, key: string, build: string): Promise<Credential>
  rotateKey(url: string, key: string): Promise<{ key: string; expiresAt: string | null }>
}
export const keyedApi: KeyedApi = { credentialByKey, rotateKey }
