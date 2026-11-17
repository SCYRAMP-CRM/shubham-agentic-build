import { apiError } from '../api.ts'
import type { CrmCall, CrmContact, CrmLead, CrmLeadDetail, CrmLeadRef, CrmMember, CrmService } from '../../shared/whatsapp-crm.ts'

// Order oWA S5: the CRM's rows as the WhatsApp page wants them, and the page's words as the CRM's own request bodies (agent/whatsapp-crm/crm.ts).
// Every body is BUILT from named fields, each checked: a key the page did not name never reaches the CRM (so a stray `is_disabled`, which the CRM takes as "delete this lead",
// cannot ride along), and what is wrong is said in plain words before anything is sent.

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined)

export const ID_RE = /^[0-9a-fA-F-]{8,64}$/
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/

/**
 * A WhatsApp id (…@c.us) or a typed number, as its digits. An id that is not a phone number's (a privacy id, …@lid, or a group's, …@g.us) has none: its digits are not a number
 * and must never be looked up as one.
 */
export function toPhone(v: unknown): string {
  const [user, domain] = String(v ?? '').split('@')
  if (domain !== undefined && domain !== 'c.us' && domain !== 's.whatsapp.net') return ''
  return user.replace(/\D/g, '')
}

// ---- the CRM's rows -------------------------------------------------------------------------------------------------------------------------------

export function toContact(c: unknown, fallbackFirst?: string, fallbackPhone?: string): CrmContact {
  const r = isObject(c) ? c : {}
  const first = str(r.firstName)
  const name = [first, str(r.lastName)].filter(Boolean).join(' ').trim()
  return {
    id: String(r.id ?? ''),
    name: name || fallbackFirst || '',
    firstName: first ?? fallbackFirst ?? '',
    lastName: str(r.lastName),
    phone: str(r.phone) ?? fallbackPhone,
    email: str(r.email),
    type: str(r.type),
    street: str(r.street),
    city: str(r.city),
    state: str(r.state),
    pincode: str(r.pincode),
    country: str(r.country),
    description: str(r.description),
    createdByName: str(r.createdByName),
    updatedByName: str(r.updatedByName),
  }
}

/** A lead as the list gives it. A lead that was taken out of use (the CRM's "delete" only marks it) is flagged, so the page can leave it out. */
export function toLead(l: unknown): CrmLead & { isDisabled: boolean } {
  const r = isObject(l) ? l : {}
  return {
    id: String(r.id ?? ''),
    leadNumber: str(r.leadNumber),
    name: str(r.name),
    status: String(r.status ?? 'new'),
    customerId: str(r.customerId),
    customerName: str(String(r.customerName ?? '').trim()),
    customerPhone: str(r.customerPhone),
    serviceName: str(r.serviceName),
    paymentStatus: str(r.paymentStatus),
    totalPayment: r.totalPayment != null ? String(r.totalPayment) : undefined,
    hotWarmCold: str(r.hotWarmCold),
    assignedUsers: Array.isArray(r.assignedUsers) ? r.assignedUsers.map(a => ({ userId: String(isObject(a) ? (a.userId ?? '') : ''), userName: isObject(a) ? str(a.userName) : undefined })) : [],
    createdAt: str(r.createdAt),
    callbackOn: str(r.callbackOn),
    callCount: Number(r.callCount ?? 0) || 0,
    createdByName: str(r.creatorName),
    updatedByName: str(r.updaterName),
    isDisabled: r.isDisabled === true,
  }
}

export function toCall(c: unknown, fallbackId = ''): CrmCall {
  const r = isObject(c) ? c : {}
  return { id: String(r.id ?? fallbackId), callDate: str(r.callDate), description: str(r.description), createdAt: str(r.createdAt), createdByName: str(r.createdByName) }
}

/** The lead in full, without its payments, messages and checks (money and the CRM's own bookkeeping are not this page's). */
export function toLeadDetail(d: unknown): CrmLeadDetail {
  const r: Record<string, unknown> = { ...(isObject(d) ? d : {}) }
  for (const k of ['payments', 'messages', 'checks']) delete r[k]
  // `calls` only when the CRM sent them: a lead the CRM answers after a change has none, and the page merges what it gets over what it has.
  if (Array.isArray(r.calls)) r.calls = r.calls.map(c => toCall(c))
  return r
}

export function toLeadRef(l: unknown): CrmLeadRef {
  const r = isObject(l) ? l : {}
  return { id: String(r.id ?? ''), leadNumber: str(r.leadNumber), name: str(r.name), status: str(r.status), customerName: str(String(r.customerName ?? '').trim()), customerPhone: str(r.customerPhone) }
}

export function toMember(m: unknown): CrmMember | null {
  const r = isObject(m) ? m : {}
  const userId = String(r.userId ?? r.id ?? '')
  const email = String(r.email ?? '').trim()
  if (!userId && !email) return null
  return { userId, name: String(r.fullName ?? r.username ?? '').trim() || email || '(unnamed)', email, role: str(r.role) }
}

export function toService(s: unknown): CrmService | null {
  const r = isObject(s) ? s : {}
  const id = String(r.id ?? '')
  return id ? { id, name: String(r.name ?? '').trim() || '(unnamed service)' } : null
}

// ---- the page's words, as the CRM's request bodies ------------------------------------------------------------------------------------------------------

const bad = (message: string) => apiError(400, message)

function asObject(input: unknown): Record<string, unknown> {
  if (!isObject(input)) throw bad('Expected an object of the fields to set.')
  return input
}

/** Optional text, at most `max` long; `undefined` when not given. Not text, or too long, is refused. */
function text(b: Record<string, unknown>, key: string, max: number): string | undefined {
  const v = b[key]
  if (v === undefined) return undefined
  if (typeof v !== 'string') throw bad(`"${key}" must be text.`)
  const t = v.trim()
  if (t.length > max) throw bad(`"${key}" is too long (at most ${max} characters).`)
  return t
}

function day(b: Record<string, unknown>, key: string): string | undefined {
  const v = text(b, key, 10)
  if (v === undefined || v === '') return v
  if (!DAY_RE.test(v) || Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())) throw bad(`"${key}" must be a date as yyyy-mm-dd.`)
  return v
}

function id(b: Record<string, unknown>, key: string): string | undefined {
  const v = text(b, key, 64)
  if (v === undefined || v === '') return undefined
  if (!ID_RE.test(v)) throw bad(`"${key}" must be an id.`)
  return v
}

function money(b: Record<string, unknown>, key: string): string | undefined {
  const raw = b[key]
  const v = typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : text(b, key, 20)
  if (v === undefined || v === '') return undefined
  if (!MONEY_RE.test(v)) throw bad(`"${key}" must be an amount (digits, at most two decimals).`)
  return v
}

/** Digits of a number the page gave (a WhatsApp id or typed); `undefined` when not given; '' when cleared (only where the caller allows it). */
function phone(b: Record<string, unknown>, key: string, o: { min: number; allowClear?: boolean }): string | undefined {
  const raw = text(b, key, 60)
  if (raw === undefined) return undefined
  const digits = toPhone(raw)
  if (digits === '') {
    if (o.allowClear) return ''
    throw bad('That phone number has no digits.')
  }
  if (digits.length < o.min || digits.length > 20) throw bad('That phone number looks incomplete.')
  return digits
}

const set = (body: Record<string, unknown>, key: string, v: unknown) => {
  if (v !== undefined) body[key] = v
}

/** A new CRM contact: a first name is required, the rest is as given. */
export function newContactBody(input: unknown): Record<string, unknown> {
  const b = asObject(input)
  const first = text(b, 'firstName', 100)
  if (!first) throw bad('A first name is required.')
  const body: Record<string, unknown> = { first_name: first }
  const last = text(b, 'lastName', 100)
  if (last) body.last_name = last
  const p = phone(b, 'phone', { min: 7 })
  if (p) body.phone = p
  const description = text(b, 'description', 2000)
  if (description) body.description = description
  return body
}

/** The changes to a contact: only the fields given; an empty text clears it, a phone may be cleared. */
export function contactEditBody(input: unknown): Record<string, unknown> {
  const b = asObject(input)
  const body: Record<string, unknown> = {}
  set(body, 'first_name', text(b, 'firstName', 100))
  if (body.first_name === '') throw bad('A first name is required.')
  set(body, 'last_name', text(b, 'lastName', 100))
  set(body, 'phone', phone(b, 'phone', { min: 7, allowClear: true }))
  const email = text(b, 'email', 254)
  if (email !== undefined && email !== '' && !EMAIL_RE.test(email)) throw bad('That e-mail address looks wrong.')
  set(body, 'email', email)
  set(body, 'type', text(b, 'type', 40))
  set(body, 'street', text(b, 'street', 300))
  set(body, 'city', text(b, 'city', 100))
  set(body, 'state', text(b, 'state', 100))
  set(body, 'pincode', text(b, 'pincode', 20))
  set(body, 'country', text(b, 'country', 100))
  set(body, 'description', text(b, 'description', 2000))
  if (Object.keys(body).length === 0) throw bad('Nothing to change.')
  return body
}

/** The lead fields both a new lead and a change may carry. */
function leadFields(b: Record<string, unknown>, creating: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  // On a new lead an empty text is "not given"; on a change it clears the field.
  const put = (key: string, v: string | undefined) => {
    if (v === undefined || (creating && v === '')) return
    body[key] = v
  }
  const status = text(b, 'status', 40)
  // The CRM turns an empty status into "new": clearing it is a mistake, not a wish.
  if (status === '' && !creating) throw bad('A lead needs a status.')
  put('status', status)
  put('name', text(b, 'name', 200))
  put('source', text(b, 'source', 100))
  put('hot_warm_cold', text(b, 'hotWarmCold', 20))
  put('payment_status', text(b, 'paymentStatus', 30))
  // An empty amount is left as it is: the CRM keeps these as numbers, and "" is not one.
  put('total_payment', money(b, 'totalPayment'))
  put('payment_left', money(b, 'paymentLeft'))
  put('callback_on', day(b, 'callbackOn'))
  put('description', text(b, 'description', 5000))
  put('notes', text(b, 'notes', 5000))
  const people = b.assignedUserIds
  if (people !== undefined) {
    if (!Array.isArray(people) || people.length > 200 || !people.every(p => typeof p === 'string' && ID_RE.test(p))) throw bad('"assignedUserIds" must be a list of people (ids).')
    body.assigned_user_ids = people
  }
  return body
}

/** A new lead. The product/service is required; the phone is the customer's, or given here (then the CRM finds or makes the contact). */
export function newLeadBody(input: unknown): Record<string, unknown> {
  const b = asObject(input)
  const serviceId = id(b, 'serviceId')
  if (!serviceId) throw bad('Choose the product/service this lead is for.')
  const customerId = id(b, 'customerId')
  const p = phone(b, 'phone', { min: 10 })
  if (!customerId && !p) throw bad("Enter the lead's phone number.")
  const body: Record<string, unknown> = { service_id: serviceId, ...leadFields(b, true) }
  if (customerId) body.customer_id = customerId
  if (p) body.phone = p
  return body
}

/** The changes to a lead. Its product, customer and anything taking it out of use are not here: they are not named, so they never go. */
export function leadEditBody(input: unknown): Record<string, unknown> {
  const body = leadFields(asObject(input), false)
  if (Object.keys(body).length === 0) throw bad('Nothing to change.')
  return body
}

/** A call / update record: what happened (required) and, optionally, its date. */
export function newCallBody(input: unknown): Record<string, unknown> {
  const b = asObject(input)
  const description = text(b, 'description', 5000)
  if (!description) throw bad('Say what happened on the call.')
  const body: Record<string, unknown> = { description }
  const callDate = day(b, 'callDate')
  if (callDate) body.call_date = callDate
  return body
}

/** A change to a call record: its words and/or its date. */
export function callEditBody(input: unknown): Record<string, unknown> {
  const b = asObject(input)
  const body: Record<string, unknown> = {}
  set(body, 'description', text(b, 'description', 5000))
  const callDate = day(b, 'callDate')
  if (callDate) body.call_date = callDate
  if (Object.keys(body).length === 0) throw bad('Nothing to change.')
  return body
}

/** An update record with its callback date, both required: it is what the page always asks for. */
export function recordBodies(input: unknown): { call: Record<string, unknown>; callbackOn: string } {
  const b = asObject(input)
  const description = text(b, 'description', 5000)
  if (!description) throw bad('Say what happened on the call.')
  const callbackOn = day(b, 'callbackOn')
  if (!callbackOn) throw bad('Choose the callback date: every update schedules the next follow-up.')
  return { call: { description }, callbackOn }
}
