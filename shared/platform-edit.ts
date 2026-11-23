// Accounts edit slice: the platform account's editable fields (what the agent checks and the page sends). Pure: no network.

import { checkDescription, DESCRIPTION_LIMITS } from './account-description.ts'
import { checkPlatformPassword, fieldRefusal, passwordRepeatedIn, PASSWORD_REPEATED_WORDS } from './platform-password.ts'

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string }

// `note` is the Description of the account (order obf7c): 2000 characters, the same as the database's check on that column (0011).
export const PLATFORM_EDIT_LIMITS = { platform: 80, accountType: 80, name: 200, signInEmail: 200, phone: 60, note: DESCRIPTION_LIMITS.platform } as const

export interface PlatformEditInput {
  platform: string
  accountType: string | null
  name: string | null
  signInEmail: string | null
  phone: string | null
  disabled: boolean
  /** The Description (order obf7c). ABSENT when the form did not send one: the stored one is kept (so an edit that does not touch it never needs the database's right to change it). null = cleared; text = the new one, already refused if it looks like a secret. */
  note?: string | null
  /** F-293 (his decision "A"): the password he typed, or null when the box was empty (the stored one is KEPT). Checked for length only; never trimmed, never shown, never returned by any answer. */
  password: string | null
}

const SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const opt = (v: unknown, max: number, what: string): Checked<string | null> => {
  const t = typeof v === 'string' ? v.trim() : ''
  if (!t) return { ok: true, value: null }
  if (t.length > max) return { ok: false, message: `The ${what} is longer than ${max} characters.` }
  return { ok: true, value: t }
}

export function checkPlatformEdit(raw: unknown): Checked<PlatformEditInput> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, message: 'The account is missing.' }
  const r = raw as Record<string, unknown>
  const platform = typeof r.platform === 'string' ? r.platform.trim() : ''
  if (!platform) return { ok: false, message: 'An account needs a platform (for example Vercel or GitHub).' }
  if (platform.length > PLATFORM_EDIT_LIMITS.platform) return { ok: false, message: `The platform is longer than ${PLATFORM_EDIT_LIMITS.platform} characters.` }
  const accountType = opt(r.accountType, PLATFORM_EDIT_LIMITS.accountType, 'account type')
  if (!accountType.ok) return accountType
  const name = opt(r.name, PLATFORM_EDIT_LIMITS.name, 'name')
  if (!name.ok) return name
  const email = opt(r.signInEmail, PLATFORM_EDIT_LIMITS.signInEmail, 'sign-in email')
  if (!email.ok) return email
  if (email.value !== null && !SHAPE.test(email.value)) return { ok: false, message: 'The sign-in email looks like name@example.com.' }
  const phone = opt(r.phone, PLATFORM_EDIT_LIMITS.phone, 'phone')
  if (!phone.ok) return phone
  if (r.disabled !== undefined && typeof r.disabled !== 'boolean') return { ok: false, message: 'Switched off is yes or no.' }
  // The Description is checked only when the form sent one (the key is absent from the answer otherwise, so "keep the stored one" is visible in the value).
  const note = r.note === undefined ? undefined : checkDescription(r.note, PLATFORM_EDIT_LIMITS.note, 'description')
  if (note !== undefined && !note.ok) return note
  // F-293 condition (c): the secret-shape veto covers EVERY free-text box of the form, not only the Description: a password pasted into the platform, type, name or phone box is refused, not stored.
  for (const [what, text] of [['platform', platform], ['account type', accountType.value], ['name', name.value], ['phone', phone.value]] as const) {
    const refused = fieldRefusal(what, text)
    if (refused !== null) return { ok: false, message: refused }
  }
  const password = checkPlatformPassword(r.password)
  if (!password.ok) return password
  // F-293 slice 3 (Agent 14's finding 2): the authenticator boxes (note, email, app) are in the same list as every other box of the form: the typed password may not sit in any of them.
  const asText = (v: unknown): string | null => (typeof v === 'string' ? v : null)
  if (password.value !== null && passwordRepeatedIn(password.value, [platform, accountType.value, name.value, email.value, phone.value, asText(r.note), asText(r.authenticatorNote), asText(r.authenticatorEmail), asText(r.authenticatorApp)])) return { ok: false, message: PASSWORD_REPEATED_WORDS }
  return {
    ok: true,
    value: { platform, accountType: accountType.value, name: name.value, signInEmail: email.value, phone: phone.value, disabled: r.disabled === true, ...(note !== undefined && note.ok ? { note: note.value } : {}), password: password.value },
  }
}
