import { createHash } from 'node:crypto'
import { apiError, type ApiMount, type MountRequest } from '../api.ts'
import { judge } from '../agentic/crm-catalog.ts'
import { crmLoginOf, type CrmLogin, type CrmProxy } from '../agentic/crmproxy.ts'
import { describeHuman, requireCrmHuman } from '../agentic/human-session.ts'
import type { Auth } from '../auth/index.ts'
import type { Logger } from '../log.ts'
import {
  crmPhoneKey,
  WA_CRM_PREFIX,
  type CrmCode,
  type CrmContact,
  type CrmContactResult,
  type CrmLead,
  type CrmLeadResult,
  type CrmMember,
  type CrmRecordResult,
  type CrmService,
  type CrmStatus,
} from '../../shared/whatsapp-crm.ts'
import {
  callEditBody,
  contactEditBody,
  ID_RE,
  leadEditBody,
  newCallBody,
  newContactBody,
  newLeadBody,
  recordBodies,
  toCall,
  toContact,
  toLead,
  toLeadDetail,
  toLeadRef,
  toMember,
  toPhone,
  toService,
} from './map.ts'

// Order oWA S5 (Shubham, 17 Nov 2026: "ability to add leads directly into the crm"; Lead's rules): the WhatsApp page's CRM, the reference whatsapp-frontend's /crm/* API, made of the
// SAM CRM's own /v1/org routes. The rules, each enforced here and tested:
// - It is the signed-in PERSON's own CRM session (auth.viewerCrm: the sign-in they made to this app), never a key of this app's or this PC's: the CRM itself decides what they may do.
//   Every route needs a person (requireCrmHuman: a CRM-derived session; a chat's key is refused), and the mount is the owner's (it is not `scoped`).
// - ORDER o0612 (Shubham, 17 Nov 2026: "C now, A later"): that person must be the OWNER or an ADMINISTRATOR of this app (auth.isAdmin), for every route, read or change. The CRM scopes leads and
//   contacts by nothing beyond the organisation (sam-crm-be: listLeads, getLead, updateLead... check no per-person rule, and its per-person "Leads" switch only hides a sidebar entry), so a person who
//   is signed in to the CRM can read and edit every lead through the API; "C" keeps this app from being the thing that puts them on a screen for anyone else. IT IS ENFORCED HERE, AT THE BRIDGE,
//   AND NOT IN THE PAGE: a filter in a page over an API that returns everything is a curtain, not access control; the data would already be on the person's machine, and the page would LOOK
//   correct, so nobody would go and fix the real hole. The pages (the Leads list, the Dashboard, the contact panel) draw what they are given and filter nothing. It protects THIS APP only: the
//   rows stay reachable through the CRM itself by any member's own session until "A" (an assignee or hierarchy scope in sam-crm-be's lead and contact routes) is done, and nothing is pushed to
//   the live CRM without his yes.
// - A change is made only on a request of theirs, to one record, from named fields (map.ts): anything else in a body never reaches the CRM.
// - Nothing is deleted. There is no delete route here, and every request out is judged by the same rule the crm_ tools keep (crm-catalog.ts: no delete, no money, no people's access).
// - A lookup never says "not found" when the CRM could not be asked: it fails with the reason. A list is never cached half-read.
// - Nothing about a person, a number or a chat is logged: only who did what kind of thing, and how it came out.

const PAGE = 200
const CONTACT_PAGES = 100
const LEAD_PAGES = 50
const LIST_PAGES = 50
const DUPLICATE_MS = 30_000

type Method = 'GET' | 'POST' | 'PATCH'
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const coded = (status: number, code: CrmCode, message: string) => Object.assign(apiError(status, message), { code })

/**
 * The rule every request out is judged by before it is sent: the crm_ tools' own (crm-catalog.ts): no delete, no money, no person's access, nothing the CRM does not have. No route of this
 * module builds such a path, so this is the guard against a change that would: it throws a 403 with the rule's own words.
 */
export function assertAllowed(method: string, path: string): void {
  const verdict = judge(method, path.split('?')[0])
  if (!verdict.ok) throw apiError(403, verdict.reason)
}

export interface WhatsAppCrmOptions {
  auth: Auth | undefined
  /** The CRM proxy (agentic/crmproxy.ts): the call is made on the person's session by `requestAs`, with the CRM's CSRF pair. */
  proxy: Pick<CrmProxy, 'requestAs'>
  log: Pick<Logger, 'info' | 'warn'>
  now?: () => number
  /** How long a read list is kept (tests shorten them). */
  contactsMs?: number
  leadsMs?: number
  listsMs?: number
}

interface Person {
  /** The CRM user id (lower case): what a cache belongs to. */
  id: string
  login: CrmLogin
  /** Who, for the log: a username and a short id, never a name or a number from a chat. */
  who: string
}

interface ContactBook {
  at: number
  /** Last ten digits -> contact (the first one wins, as in the CRM's own list order). */
  byPhone: Map<string, CrmContact>
  all: CrmContact[]
}

export function createWhatsAppCrm(o: WhatsAppCrmOptions): ApiMount {
  const now = o.now ?? Date.now
  const contactsMs = o.contactsMs ?? 5 * 60_000
  const leadsMs = o.leadsMs ?? 30_000
  const listsMs = o.listsMs ?? 5 * 60_000

  const books = new Map<string, ContactBook>()
  const leadLists = new Map<string, { at: number; leads: CrmLead[] }>()
  const lists = new Map<string, { at: number; value: unknown }>()
  const flights = new Map<string, Promise<unknown>>()
  const recent = new Map<string, { at: number; result: unknown }>()

  /** One read at a time per key: a second asker waits for the first one's answer. */
  function once<T>(key: string, work: () => Promise<T>): Promise<T> {
    const going = flights.get(key)
    if (going) return going as Promise<T>
    const p = work().finally(() => flights.delete(key))
    flights.set(key, p)
    return p
  }

  function person(req: MountRequest): Person {
    // The owner or an administrator (order o0612): the same rule as the door in http() below, kept here as well so that a route which asked for its person could never go without it.
    const caller = requireCrmHuman(o.auth, req, true)
    const s = o.auth?.viewerCrm(req.headers)
    if (!s) throw coded(401, 'crm-not-signed-in', "You are signed in here, but not to the CRM: sign in through the CRM to look up or add leads. Nothing was changed.")
    return { id: s.user.id.toLowerCase(), login: crmLoginOf(s), who: describeHuman(caller) }
  }

  const forget = (p: Person) => {
    books.delete(p.id)
    leadLists.delete(p.id)
    for (const k of [...lists.keys()]) if (k.endsWith(`:${p.id}`)) lists.delete(k)
  }

  /** The CRM said no, or something other than OK: what the person is told, and (the CRM's own `error` kept) what the caller may act on. */
  function failure(p: Person, method: Method, status: number, data: unknown): Error {
    const said = isObject(data) && typeof data.error === 'string' ? data.error : null
    let e: Error
    if (status === 401) {
      forget(p)
      e = coded(401, 'crm-session-ended', 'Your CRM sign-in has ended: sign in again. Nothing was changed.')
    } else if (status === 403) e = coded(403, 'crm-refused', `The CRM refused: ${said ?? 'you may not do that there'}.`)
    else if (status === 404) e = coded(404, 'crm-refused', said ?? 'The CRM does not have that.')
    else if (status === 400 || status === 409 || status === 422) e = coded(status === 409 ? 409 : 400, 'crm-refused', `The CRM refused: ${said ?? 'it did not accept that'}`)
    else e = coded(502, 'crm-no-answer', `The CRM answered ${status}${said ? `: ${said}` : ''}.${method === 'GET' ? '' : ' Look in the CRM before trying again: it may have gone through.'}`)
    return Object.assign(e, { crm: { status, data } })
  }

  /** One call to the CRM's /v1/org, as this person. Every path out is judged first: it can never be a delete, money, or a person's access. */
  async function up(p: Person, method: Method, path: string, body?: unknown): Promise<unknown> {
    assertAllowed(method, path)
    let res: Response
    try {
      res = await o.proxy.requestAs(p.login, method, `v1/org${path}`, body === undefined ? {} : { json: body })
    } catch {
      throw coded(502, 'crm-unreachable', method === 'GET' ? "The CRM can't be reached right now." : 'The CRM did not answer. Look in the CRM before trying again: it may have gone through.')
    }
    const data: unknown = await res.json().catch(() => null)
    if (!res.ok) throw failure(p, method, res.status, data)
    return data
  }

  /** Every page of a list, or a failure: a half-read list is never kept (a missing contact would read as "not in the CRM", and a duplicate would be made). */
  async function pages(p: Person, path: string, key: string, maxPages: number): Promise<unknown[]> {
    const out: unknown[] = []
    for (let page = 1; page <= maxPages; page++) {
      const data = await up(p, 'GET', `${path}?page=${page}&limit=${PAGE}`)
      const rows = isObject(data) && Array.isArray(data[key]) ? (data[key] as unknown[]) : Array.isArray(data) ? data : []
      out.push(...rows)
      const total = isObject(data) && isObject(data.pagination) && typeof data.pagination.totalPages === 'number' ? data.pagination.totalPages : null
      if (rows.length < PAGE || (total !== null && page >= total)) return out
    }
    throw coded(502, 'crm-no-answer', `The CRM has more ${key} than can be read here (${maxPages * PAGE}).`)
  }

  // ---- reads ---------------------------------------------------------------------------------------------------------------------------------------

  async function book(p: Person): Promise<ContactBook> {
    const kept = books.get(p.id)
    if (kept && now() - kept.at < contactsMs) return kept
    return once(`contacts:${p.id}`, async () => {
      // The CRM's list holds contacts it has taken out of use (disabled, or merged into another): those do not own a number, and the CRM's own duplicate check ignores them.
      const rows = (await pages(p, '/contacts', 'contacts', CONTACT_PAGES)).filter(r => !(isObject(r) && (r.isDisabled === true || (typeof r.mergedIntoId === 'string' && r.mergedIntoId !== ''))))
      const all = rows.map(c => toContact(c))
      const byPhone = new Map<string, CrmContact>()
      for (const c of all) {
        const k = crmPhoneKey(c.phone)
        if (k && !byPhone.has(k)) byPhone.set(k, c)
      }
      const fresh = { at: now(), byPhone, all }
      books.set(p.id, fresh)
      return fresh
    })
  }

  /** A contact the CRM just gave (made, changed, or got a number): in the list as it is now, and under its number only. */
  function applyContact(p: Person, c: CrmContact) {
    const kept = books.get(p.id)
    if (!kept || !c.id) return
    const at = kept.all.findIndex(x => x.id === c.id)
    if (at >= 0) kept.all[at] = c
    else kept.all.push(c)
    for (const [k, v] of kept.byPhone) if (v.id === c.id) kept.byPhone.delete(k)
    const k = crmPhoneKey(c.phone)
    if (k) kept.byPhone.set(k, c)
  }

  async function leadList(p: Person): Promise<CrmLead[]> {
    const kept = leadLists.get(p.id)
    if (kept && now() - kept.at < leadsMs) return kept.leads
    return once(`leads:${p.id}`, async () => {
      const leads = (await pages(p, '/leads', 'leads', LEAD_PAGES)).map(l => toLead(l)).filter(l => !l.isDisabled).map(({ isDisabled: _gone, ...l }) => l)
      leadLists.set(p.id, { at: now(), leads })
      return leads
    })
  }

  /** A short list the CRM keeps (the services, the members), read whole. */
  async function list<T>(p: Person, name: string, path: string, key: string, map: (row: unknown) => T | null, sort: (a: T, b: T) => number): Promise<T[]> {
    const k = `${name}:${p.id}`
    const kept = lists.get(k)
    if (kept && now() - kept.at < listsMs) return kept.value as T[]
    return once(k, async () => {
      const rows = (await pages(p, path, key, LIST_PAGES)).map(map).filter((x): x is T => x !== null).sort(sort)
      lists.set(k, { at: now(), value: rows })
      return rows
    })
  }

  // ---- changes ---------------------------------------------------------------------------------------------------------------------------------

  /** A change goes to the CRM once: the same one made again within 30 s (a double tap, a retry while the first is out) gets the first answer back, marked repeated. */
  async function once30<T extends object>(p: Person, method: string, path: string, body: unknown, send: () => Promise<T>): Promise<T & { repeated?: true }> {
    const t = now()
    for (const [k, v] of recent) if (t - v.at > DUPLICATE_MS) recent.delete(k)
    const key = createHash('sha256').update(JSON.stringify([p.id, method, path, body])).digest('hex')
    const same = recent.get(key)
    if (same) return { ...(same.result as T), repeated: true }
    const going = flights.get(`change:${key}`)
    if (going) return { ...((await going) as T), repeated: true }
    const result = await once(`change:${key}`, send)
    recent.set(key, { at: now(), result })
    return result
  }

  /** The log: who did what kind of thing and how it came out. No name, number, chat or id of anything. */
  const did = (p: Person, what: string, ok: boolean, why?: string) => (ok ? o.log.info(`WhatsApp CRM: ${p.who}: ${what}`) : o.log.warn(`WhatsApp CRM: ${p.who}: ${what} did not go through${why ? ` (${why})` : ''}`))
  const attempt = async <T>(p: Person, what: string, work: () => Promise<T>): Promise<T> => {
    try {
      const r = await work()
      did(p, what, true)
      return r
    } catch (e) {
      did(p, what, false, String((e as { code?: unknown }).code ?? (e as { status?: unknown }).status ?? 'error'))
      throw e
    }
  }

  const idOf = (v: string | undefined, what: string): string => {
    if (!v || !ID_RE.test(v)) throw apiError(400, `That is not ${what}.`)
    return v
  }

  async function createContact(p: Person, input: unknown) {
    const body = newContactBody(input)
    return attempt(p, 'contact created', () =>
      once30(p, 'POST', '/contacts', body, async (): Promise<CrmContactResult> => {
        let row: unknown
        try {
          row = await up(p, 'POST', '/contacts', body)
        } catch (e) {
          const crm = (e as { crm?: { status?: number; data?: unknown } }).crm
          // The CRM keeps one contact per number and says which one has it: that is an answer to act on (open that contact), not an error.
          if (crm?.status === 409 && isObject(crm.data) && isObject(crm.data.duplicateOf)) {
            const d = crm.data.duplicateOf
            return {
              ok: false,
              reason: 'duplicate',
              message: typeof crm.data.error === 'string' ? crm.data.error : 'That number is already on a contact.',
              duplicate: { id: String(d.id ?? ''), name: String(d.name ?? ''), ...(typeof d.phone === 'string' ? { phone: d.phone } : {}) },
            }
          }
          throw e
        }
        const made = toContact(row, String(body.first_name), typeof body.phone === 'string' ? body.phone : undefined)
        applyContact(p, made)
        return { ok: true, found: true, contact: made }
      }),
    )
  }

  async function editContact(p: Person, id: string, input: unknown) {
    const body = contactEditBody(input)
    return attempt(p, 'contact changed', async () => {
      const contact = toContact(await up(p, 'PATCH', `/contacts/${idOf(id, 'a contact')}`, body))
      applyContact(p, contact)
      return { contact }
    })
  }

  async function attachContact(p: Person, id: string, input: unknown) {
    const b = isObject(input) ? input : {}
    const phone = toPhone(b.phone)
    if (phone.length < 7 || phone.length > 20) throw apiError(400, 'A phone number is required.')
    const from = typeof b.detachFromId === 'string' && b.detachFromId !== '' ? idOf(b.detachFromId, 'a contact') : undefined
    const to = idOf(id, 'a contact')
    return attempt(p, 'number attached to a contact', async () => {
      let detachFailed = false
      if (from && from !== to) {
        // The number leaves the contact it was on first, so it is not left on two. If that cannot be done the attach still goes ahead, and the answer says so.
        try {
          applyContact(p, toContact(await up(p, 'PATCH', `/contacts/${from}`, { phone: '' })))
        } catch {
          detachFailed = true
        }
      }
      const contact = toContact(await up(p, 'PATCH', `/contacts/${to}`, { phone }), undefined, phone)
      applyContact(p, contact)
      return { found: true as const, contact, ...(detachFailed ? { detachFailed: true as const } : {}) }
    })
  }

  async function createLead(p: Person, input: unknown) {
    const body = newLeadBody(input)
    return attempt(p, 'lead created', () =>
      once30(p, 'POST', '/leads', body, async (): Promise<CrmLeadResult> => {
        let made: unknown
        try {
          made = await up(p, 'POST', '/leads', body)
        } catch (e) {
          const crm = (e as { crm?: { status?: number; data?: unknown } }).crm
          // The CRM refuses a second lead for the same customer or number on one service, and hands back the one that is there: that is an answer to act on, not an error.
          if (crm?.status === 409 && isObject(crm.data) && isObject(crm.data.duplicate)) {
            return { ok: false, reason: 'duplicate', message: typeof crm.data.error === 'string' ? crm.data.error : 'This customer already has a lead for this product/service.', duplicate: toLeadRef(crm.data.duplicate) }
          }
          throw e
        }
        leadLists.delete(p.id)
        const contactCreated = isObject(made) && made.contactCreated === true
        if (contactCreated) books.delete(p.id)
        return { ok: true, lead: toLeadDetail(made), contactCreated }
      }),
    )
  }

  async function editLead(p: Person, id: string, input: unknown) {
    const body = leadEditBody(input)
    return attempt(p, 'lead changed', async () => {
      const lead = toLeadDetail(await up(p, 'PATCH', `/leads/${idOf(id, 'a lead')}`, body))
      leadLists.delete(p.id)
      return lead
    })
  }

  async function addCall(p: Person, id: string, input: unknown) {
    const body = newCallBody(input)
    const lead = idOf(id, 'a lead')
    return attempt(p, 'call logged', () =>
      once30(p, 'POST', `/leads/${lead}/calls`, body, async () => {
        const call = toCall(await up(p, 'POST', `/leads/${lead}/calls`, body))
        leadLists.delete(p.id)
        return call
      }),
    )
  }

  /** The update record and the callback date, in that order. If the date does not go through, the record has: the answer says so, with the record. */
  async function addRecord(p: Person, id: string, input: unknown) {
    const { call: callBody, callbackOn } = recordBodies(input)
    const lead = idOf(id, 'a lead')
    return attempt(p, 'update record logged', () =>
      once30(p, 'POST', `/leads/${lead}/records`, { callBody, callbackOn }, async (): Promise<CrmRecordResult> => {
        const call = toCall(await up(p, 'POST', `/leads/${lead}/calls`, callBody))
        leadLists.delete(p.id)
        try {
          await up(p, 'PATCH', `/leads/${lead}`, { callback_on: callbackOn })
        } catch (e) {
          return {
            ok: false,
            reason: 'partial',
            message: `The update was saved in the CRM, but its callback date was not (${e instanceof Error ? e.message.replace(/\.$/, '') : 'it failed'}). Set the callback date on the lead again; do not write the update again.`,
            call,
          }
        }
        return { ok: true, call, callbackOn }
      }),
    )
  }

  async function editCall(p: Person, leadId: string, callId: string, input: unknown) {
    const body = callEditBody(input)
    return attempt(p, 'call changed', async () => {
      const call = toCall(await up(p, 'PATCH', `/leads/${idOf(leadId, 'a lead')}/calls/${idOf(callId, 'a call')}`, body), callId)
      leadLists.delete(p.id)
      return call
    })
  }

  // ---- the routes ------------------------------------------------------------------------------------------------------------------------------------

  return {
    prefix: WA_CRM_PREFIX,
    async http(req: MountRequest): Promise<unknown> {
      const method = req.method.toUpperCase()
      const rest = req.rest.replace(/\/+$/, '') || '/'
      if (method === 'DELETE') throw apiError(405, 'Nothing is deleted from the CRM here.')
      // THE DOOR (order o0612): before any route is looked at, and so before any path that does not exist yet could be: a signed-in person who is the owner or an administrator of this app, or nothing
      // (403 "admin-only", and nothing is asked of the CRM). A route added later is behind it without having to remember it.
      requireCrmHuman(o.auth, req, true)
      let m: RegExpExecArray | null

      if (method === 'GET' && rest === '/status') {
        const s = o.auth?.viewerCrm(req.headers)
        return { signedIn: !!s, name: s ? (s.user.name ?? s.user.username ?? null) : null } satisfies CrmStatus
      }

      if (method === 'GET' && rest === '/contact') {
        const p = person(req)
        const key = crmPhoneKey(toPhone(req.query.get('phone') ?? ''))
        if (!key) return { found: false, contact: null }
        const contact = (await book(p)).byPhone.get(key) ?? null
        return { found: contact !== null, contact }
      }
      if (method === 'POST' && rest === '/contacts/lookup') {
        const p = person(req)
        const phones = isObject(req.body) && Array.isArray(req.body.phones) ? req.body.phones.slice(0, 500).map(v => crmPhoneKey(toPhone(v))).filter(Boolean) : []
        if (phones.length === 0) return {}
        const { byPhone } = await book(p)
        return Object.fromEntries(phones.map(k => [k, byPhone.get(k) ?? null]))
      }
      if (method === 'GET' && rest === '/contacts') {
        const { all } = await book(person(req))
        return [...all].sort((a, b) => a.name.localeCompare(b.name))
      }
      if (method === 'GET' && rest === '/contacts/search') {
        const { all } = await book(person(req))
        const needle = (req.query.get('q') ?? '').trim().toLowerCase().slice(0, 100)
        const digits = needle.replace(/\D/g, '')
        const found = needle ? all.filter(c => c.name.toLowerCase().includes(needle) || (digits.length >= 3 && (c.phone ?? '').replace(/\D/g, '').includes(digits))) : all
        const limit = Math.min(Math.max(Number(req.query.get('limit')) || 20, 1), 50)
        return found.slice(0, limit)
      }
      if (method === 'GET' && rest === '/leads') return leadList(person(req))
      if ((m = /^\/lead\/([^/]+)$/.exec(rest)) && method === 'GET') {
        const p = person(req)
        return toLeadDetail(await up(p, 'GET', `/leads/${idOf(decodeURIComponent(m[1]), 'a lead')}`))
      }
      if (method === 'GET' && rest === '/services') return list<CrmService>(person(req), 'services', '/services', 'services', toService, (a, b) => a.name.localeCompare(b.name))
      if (method === 'GET' && rest === '/members') return list<CrmMember>(person(req), 'members', '/members', 'members', toMember, (a, b) => a.name.localeCompare(b.name))

      if (method === 'POST' && rest === '/contact') return createContact(person(req), req.body)
      if ((m = /^\/contact\/([^/]+)$/.exec(rest)) && method === 'PATCH') return editContact(person(req), decodeURIComponent(m[1]), req.body)
      if ((m = /^\/contact\/([^/]+)\/attach$/.exec(rest)) && method === 'POST') return attachContact(person(req), decodeURIComponent(m[1]), req.body)
      if (method === 'POST' && rest === '/lead') return createLead(person(req), req.body)
      if ((m = /^\/lead\/([^/]+)$/.exec(rest)) && method === 'PATCH') return editLead(person(req), decodeURIComponent(m[1]), req.body)
      if ((m = /^\/lead\/([^/]+)\/calls$/.exec(rest)) && method === 'POST') return addCall(person(req), decodeURIComponent(m[1]), req.body)
      if ((m = /^\/lead\/([^/]+)\/records$/.exec(rest)) && method === 'POST') return addRecord(person(req), decodeURIComponent(m[1]), req.body)
      if ((m = /^\/lead\/([^/]+)\/calls\/([^/]+)$/.exec(rest)) && method === 'PATCH') return editCall(person(req), decodeURIComponent(m[1]), decodeURIComponent(m[2]), req.body)

      throw apiError(404, `No such WhatsApp CRM path: ${method} ${rest}`)
    },
  }
}
