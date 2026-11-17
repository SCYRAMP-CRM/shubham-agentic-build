// Order oWA S5 (Shubham, 17 Nov 2026: "Everything the same including ability to add leads directly into the crm"): the WhatsApp page's bridge to the CRM, shared by the agent
// (agent/whatsapp-crm/) and the page (src/whatsapp/crm-api.ts). It is the reference whatsapp-frontend's /crm/* API, made of the SAM CRM's own /v1/org routes, called with
// the signed-in person's OWN CRM session (never a key of its own), a write only on that person's request, and never a delete: nothing here removes anything from the CRM.

export const WA_CRM_PREFIX = '/whatsapp-crm'

/** Whether the person has a CRM session in this app (from the sign-in itself: nothing is asked of the CRM). */
export interface CrmStatus {
  signedIn: boolean
  name: string | null
}

/** A CRM contact, matched to a WhatsApp number by its last ten digits. */
export interface CrmContact {
  id: string
  name: string
  firstName: string
  lastName?: string
  phone?: string
  email?: string
  type?: string
  street?: string
  city?: string
  state?: string
  pincode?: string
  country?: string
  description?: string
  createdByName?: string
  updatedByName?: string
}

export type CrmContactEdit = Partial<Pick<CrmContact, 'firstName' | 'lastName' | 'phone' | 'email' | 'type' | 'street' | 'city' | 'state' | 'pincode' | 'country' | 'description'>>

/** A CRM lead as the Leads tab lists it. */
export interface CrmLead {
  id: string
  leadNumber?: string
  name?: string
  status: string
  customerId?: string
  customerName?: string
  customerPhone?: string
  serviceName?: string
  paymentStatus?: string
  totalPayment?: string
  hotWarmCold?: string
  assignedUsers: { userId: string; userName?: string }[]
  createdAt?: string
  /** When to follow up (callback_on). */
  callbackOn?: string
  /** How many call / update records are logged on it. */
  callCount?: number
  createdByName?: string
  updatedByName?: string
}

/** A call / update record on a lead. */
export interface CrmCall {
  id: string
  callDate?: string
  description?: string
  createdAt?: string
  createdByName?: string
}

/** One lead in full: the fields the CRM has for it, its call records and who it is assigned to. (Its payments, messages and checks are not carried: money is not this page's.) */
export type CrmLeadDetail = Record<string, unknown> & {
  calls?: CrmCall[]
  assignedUsers?: { userId?: string; userName?: string }[]
}

export interface CrmService {
  id: string
  name: string
}

export interface CrmMember {
  userId: string
  name: string
  email: string
  role?: string
}

/** The fields of a lead a person may change here. `assignedUserIds` is the WHOLE set of people it is assigned to (the CRM replaces, it does not add). */
export interface CrmLeadEdit {
  status?: string
  name?: string
  source?: string
  hotWarmCold?: string
  paymentStatus?: string
  totalPayment?: string
  paymentLeft?: string
  /** yyyy-mm-dd; an empty string clears it. */
  callbackOn?: string
  description?: string
  notes?: string
  assignedUserIds?: string[]
}

/**
 * A new lead. The CRM wants the product/service, and a phone number: either a customer (contact) that has one, or the number itself (then it finds the contact with that
 * number or makes one from the lead's name).
 */
export interface CrmNewLead extends CrmLeadEdit {
  serviceId: string
  customerId?: string
  phone?: string
}

/** The contact that already has a number (the CRM keeps one contact per number). */
export interface CrmContactRef {
  id: string
  name: string
  phone?: string
}

/** What adding a contact came to: made, or refused because the number is already on a contact (open that one instead). */
export type CrmContactResult =
  | { ok: true; found: true; contact: CrmContact; repeated?: true }
  | { ok: false; reason: 'duplicate'; message: string; duplicate: CrmContactRef }

/** The lead that is already there for the same customer or number on that service (the CRM refuses a second one). */
export interface CrmLeadRef {
  id: string
  leadNumber?: string
  name?: string
  status?: string
  customerName?: string
  customerPhone?: string
}

/** What adding a lead came to: made, or refused because the same person is already a lead on that service (open that one instead). */
export type CrmLeadResult =
  | { ok: true; lead: CrmLeadDetail; contactCreated: boolean; repeated?: true }
  | { ok: false; reason: 'duplicate'; message: string; duplicate: CrmLeadRef }

/** A new update record: what happened, and the callback date (yyyy-mm-dd), which the page always asks for. */
export interface CrmNewRecord {
  description: string
  callbackOn: string
}

/**
 * What adding an update record came to. It is two changes in the CRM, in order: the record, then the lead's callback date. When the second does not go through, the first
 * has: `partial` says so, with the record that was saved (so it is not written twice) and what to do.
 */
export type CrmRecordResult =
  | { ok: true; call: CrmCall; callbackOn: string; repeated?: true }
  | { ok: false; reason: 'partial'; message: string; call: CrmCall }

/** Reasons the CRM could not be used, as the `code` of an error answer. */
export type CrmCode = 'crm-not-signed-in' | 'crm-session-ended' | 'crm-unreachable' | 'crm-refused' | 'crm-no-answer'

/** Phones compare by their last ten digits ("+91 98202 82994" is 9820282994); fewer than ten digits match nothing. */
export function crmPhoneKey(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : ''
}
