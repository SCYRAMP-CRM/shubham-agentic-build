// Accounts › Accounts, "Add account" (order oc35dc): what the page sends and the agent checks to add a platform account. Pure: no network.
// The fields of an edit (platform, type, name, sign-in email, phone, switched off) are checked by checkPlatformEdit (shared/platform-edit.ts); this adds the contact name,
// the codebases it is connected to and a note. F-293 (his decision "A", 18 Nov 2026): the form also takes a password, which he types himself (checked inside checkPlatformEdit; sealed by the agent, never shown again).
// A password typed into the contact name or the note is refused like one typed into any other box.

import { checkPlatformEdit, type PlatformEditInput, type Checked } from './platform-edit.ts'
import { checkDescription, DESCRIPTION_LIMITS } from './account-description.ts'
import { fieldRefusal, passwordRepeatedIn, PASSWORD_REPEATED_WORDS } from './platform-password.ts'

/** The platforms offered in the Add form. "Other" lets the person name one (the text is the platform's name). */
export const PLATFORM_CHOICES = ['Vercel', 'Supabase', 'GitHub', 'AWS', 'Oracle Cloud', 'Other'] as const

// `note` is the account's Description (order obf7c): the same 2000 as the database's check, and the same refusal of a text that looks like a secret as the Edit form and the Email note.
export const PLATFORM_ADD_LIMITS = { contactName: 200, note: DESCRIPTION_LIMITS.platform, codebases: 50 } as const

export interface PlatformAddInput extends PlatformEditInput {
  contactName: string | null
  note: string | null
  /** The ids of the codebases it is connected to (the owner's own codebases). */
  codebases: string[]
}

const UUID = /^[0-9a-f-]{36}$/i

export function checkPlatformAdd(raw: unknown): Checked<PlatformAddInput> {
  const base = checkPlatformEdit(raw)
  if (!base.ok) return base
  const r = raw as Record<string, unknown>
  const contact = typeof r.contactName === 'string' ? r.contactName.trim() : ''
  if (contact.length > PLATFORM_ADD_LIMITS.contactName) return { ok: false, message: `The contact name is longer than ${PLATFORM_ADD_LIMITS.contactName} characters.` }
  const contactRefused = fieldRefusal('contact name', contact)
  if (contactRefused !== null) return { ok: false, message: contactRefused }
  const note = checkDescription(r.note, PLATFORM_ADD_LIMITS.note, 'description')
  if (!note.ok) return note
  if (base.value.password !== null && passwordRepeatedIn(base.value.password, [contact, note.value])) return { ok: false, message: PASSWORD_REPEATED_WORDS }
  if (r.codebases !== undefined && !Array.isArray(r.codebases)) return { ok: false, message: 'The codebases are a list of codebase ids.' }
  const codebases = Array.isArray(r.codebases) ? r.codebases : []
  if (codebases.length > PLATFORM_ADD_LIMITS.codebases) return { ok: false, message: `At most ${PLATFORM_ADD_LIMITS.codebases} codebases.` }
  const ids: string[] = []
  for (const c of codebases) {
    if (typeof c !== 'string' || !UUID.test(c)) return { ok: false, message: 'A codebase id is not valid.' }
    if (!ids.includes(c)) ids.push(c)
  }
  return {
    ok: true,
    value: { ...base.value, contactName: contact || null, note: note.value, codebases: ids },
  }
}
