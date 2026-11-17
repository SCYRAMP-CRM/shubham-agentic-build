import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { apiError } from '../api.ts'

// Order obf15 / oWA S2 (17 Nov 2026, Lead's design approval): how the WhatsApp backend knows that a send was a PERSON'S.
//
// The backend is a separate process on 127.0.0.1 and its token sits in a file any local program of this Windows account can read. Until now it refused every send, so
// "nothing can send, not even through the token" was true. To let a send through without losing that, the agent makes a TICKET after it has seen the signed-in person's own
// request (requireCrmHuman: a CRM cookie session, never a chat's key), and the backend sends only against a ticket:
// - bound to exactly this chat, exactly these words (their sha256), this draft (or none), and who tapped;
// - it lives 30 s and is good ONCE (a nonce), so it cannot be replayed, reused for other words or another chat, or kept;
// - made and checked with a 32-byte key that lives in the memory of the agent and of the backend, handed over their private channel (never a file, never a log,
//   never an environment); with NO key the backend refuses every send, which is what sending OFF is, and a NEW key makes every ticket of the old one worthless.
// Format: base64url(payload JSON) "." base64url(HMAC-SHA256(key, that first part)).

export const SEND_TICKET_HEADER = 'x-sad-send-ticket'
/** How long a ticket lives. */
export const TICKET_MS = 30_000

export interface SendFields {
  chatId: string
  /** sha256 (hex) of the exact text. */
  textSha: string
  /** The Assistant's draft id, or '' for his own typing. */
  draft: string
}

interface Payload {
  v: 1
  c: string
  h: string
  d: string
  by: string
  exp: number
  n: string
}

const b64 = (b: Buffer) => b.toString('base64url')
const KEY_RE = /^[0-9a-f]{64}$/

/** The agent's side: a ticket for this send, by `by`, made at `now`. (`ttl` is for the tests that make a ticket that lives too long.) */
export function issueSendTicket(key: string, f: SendFields, by: string, now: number, ttl = TICKET_MS): string {
  const payload: Payload = { v: 1, c: f.chatId, h: f.textSha, d: f.draft, by: by.replace(/[\r\n]/g, ' ').slice(0, 200), exp: now + ttl, n: randomBytes(12).toString('hex') }
  const first = b64(Buffer.from(JSON.stringify(payload), 'utf8'))
  return `${first}.${b64(createHmac('sha256', key).update(first).digest())}`
}

const FORBIDDEN = 'This send is not approved: it did not come with a valid ticket from a signed-in person.'

export interface TicketVerifier {
  /** A key to check tickets with (the one the agent holds), or null: no key is sending OFF. Anything that is not a 64-hex key is no key. A new key forgets every nonce. */
  setKey(key: string | null | undefined): void
  hasKey(): boolean
  /** Who tapped (the ticket's `by`), or a 403: no key, a ticket that is not the agent's, not for exactly this, late, too long-lived, or used before. */
  verify(header: unknown, f: SendFields): string
}

export function createTicketVerifier(now: () => number = Date.now): TicketVerifier {
  let key: string | null = null
  /** The nonces of tickets used, with their expiry: a ticket is good once. */
  const used = new Map<string, number>()
  const refuse = (message = FORBIDDEN): never => {
    throw apiError(403, message)
  }
  return {
    setKey(k) {
      key = typeof k === 'string' && KEY_RE.test(k) ? k : null
      used.clear()
    },
    hasKey: () => key !== null,
    verify(header, f) {
      if (key === null) return refuse('sending is not open on this backend')
      if (typeof header !== 'string' || header.length === 0 || header.length > 2000) return refuse()
      const parts = header.split('.')
      if (parts.length !== 2 || !parts[0] || !parts[1]) return refuse()
      const want = createHmac('sha256', key).update(parts[0]).digest()
      let got: Buffer
      try {
        got = Buffer.from(parts[1], 'base64url')
      } catch {
        return refuse()
      }
      if (got.length !== want.length || !timingSafeEqual(got, want)) return refuse()
      let p: Partial<Payload>
      try {
        p = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as Partial<Payload>
      } catch {
        return refuse()
      }
      const t = now()
      if (p.v !== 1 || typeof p.c !== 'string' || typeof p.h !== 'string' || typeof p.d !== 'string' || typeof p.by !== 'string' || typeof p.n !== 'string' || !Number.isSafeInteger(p.exp)) return refuse()
      const exp = p.exp as number
      if (exp < t || exp - t > TICKET_MS) return refuse()
      if (p.c !== f.chatId || p.h !== f.textSha || p.d !== f.draft) return refuse()
      for (const [n, until] of used) if (until < t) used.delete(n)
      if (used.has(p.n) || used.size >= 10_000) return refuse()
      used.set(p.n, exp)
      return p.by
    },
  }
}
