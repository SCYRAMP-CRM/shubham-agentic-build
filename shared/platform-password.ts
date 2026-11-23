// F-293 (his decision "A", 18 Nov 2026, quoted in the commit and in db/accounts/0017_platform_password.sql): a platform account's password that HE types himself, stored SEALED in the app's own database exactly as
// the email passwords are. This file is the pure part: what the page sends and the agent checks, the four honest states of a row, and the plain words. No network, no database, no key.
// The rules it pins: the password is checked for LENGTH only (never trimmed, never shown); an empty box keeps the stored one; a password typed into any OTHER box of the form is refused, and so is a text that
// has the shape of a secret (the same veto as the Description and the Env masking). No refusal sentence repeats the text it refused.

import { whichSecret } from './codebase-accounts.ts'
import type { Checked } from './platform-edit.ts'

/** The longest password accepted (the same as an email account's). */
export const PLATFORM_PASSWORD_LIMIT = 500

/** The password of a form: null for "no new password" (a missing, null or empty box keeps the stored one), else the text as typed. Only its length is checked. */
export function checkPlatformPassword(raw: unknown): Checked<string | null> {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null }
  if (typeof raw !== 'string') return { ok: false, message: 'The password is text.' }
  if (raw.length > PLATFORM_PASSWORD_LIMIT) return { ok: false, message: `The password is longer than ${PLATFORM_PASSWORD_LIMIT} characters.` }
  return { ok: true, value: raw }
}

/**
 * True when the typed password also sits in another text box of the same form: a password of 6 or more characters that a box CONTAINS, or a shorter one that a box IS (a short password would sit inside
 * ordinary words). Boxes are compared as typed and trimmed. The caller refuses the save; nothing is stored and no sentence repeats the text.
 */
export function passwordRepeatedIn(password: string, texts: readonly (string | null | undefined)[]): boolean {
  if (password === '') return false
  for (const t of texts) {
    if (typeof t !== 'string' || t === '') continue
    if (password.length >= 6 ? t.includes(password) : t.trim() === password || t === password) return true
  }
  return false
}

export const PASSWORD_REPEATED_WORDS = 'The password you typed also appears in another box of this form. A password goes only in the password box. Nothing was saved.'

/** The refusal for a free-text box whose text has the shape of a secret (an access key, a token, "password: value" ...): it names WHAT it looked like, never repeats the text. Null when the text is fine. */
export function fieldRefusal(what: string, text: string | null | undefined): string | null {
  if (typeof text !== 'string' || text.trim() === '') return null
  const hit = whichSecret(text)
  if (hit === null) return null
  return `The ${what} looks like ${hit.what}, so it can't be saved. A password goes only in the password box, never in another box.`
}

/** What a row says about its password. `crm-only`: the CRM says one exists, the app holds none (nothing is imported from the CRM: he types it, or it stays there). */
export type PasswordState = 'stored' | 'disabled' | 'crm-only' | 'none'

export function passwordStateOf(a: { hasAppPassword: boolean; passwordDisabled: boolean; hasPassword: boolean }): PasswordState {
  if (a.hasAppPassword) return a.passwordDisabled ? 'disabled' : 'stored'
  return a.hasPassword ? 'crm-only' : 'none'
}

export const PASSWORD_STATE_WORDS: Record<PasswordState, string> = {
  stored: 'Password stored here',
  disabled: 'Password disabled',
  'crm-only': 'Stored on the CRM, not here',
  none: 'No password',
}

/** The sentences of the page and the agent (one place, so they cannot drift). None of them holds a password. */
export const PASSWORD_WORDS = {
  box: 'Password (write only)',
  boxHelp: 'The password is sent once, stored encrypted, and never shown again. Leave the box empty to keep the stored one. There is no remove: use Disable password, and Enable password brings it back.',
  /** The help under the box in the Add form: nothing is stored yet, so no "keep the stored one" and no Disable. */
  boxHelpNew: 'The password is sent once, stored encrypted, and never shown again. Leave the box empty to add the account without one.',
  placeholderStored: 'A password is stored (not shown). Type a new one to replace it.',
  placeholderNone: 'Type the password',
  placeholderCrmOnly: 'The CRM has one, this app has none. Type it to keep it here.',
  disabledReveal: 'This password is disabled. Enable it first.',
  noPassword: 'No password is stored for this account.',
  needsUpdate: 'The database needs an update before a password can be stored: db/accounts/0017_platform_password.sql has not been run yet. Nothing was saved.',
  keyMissing: 'The key file for the Accounts passwords is not on this PC, so a password cannot be saved. Nothing was changed.',
  cannotOpen: 'That password could not be opened with the key on this PC.',
} as const
