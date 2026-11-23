// Order obf7c: the Description (platform accounts) and Note (email accounts) fields of Accounts: ONE place for the rules of that free text. Pure: no network, no database.
// A description is PLAIN TEXT, so a password, key or token must never be saved in it by accident. A text that looks like a secret is REFUSED, the refusal NAMES what it matched ("This looks like an AWS access key") so the
// person can reword it, and there is NO "save anyway": a guard with an override is a decoration. The shapes come from the ONE veto in shared/codebase-accounts.ts (SECRET_RULES, the table the Env masking reads too);
// the bare WORD "password" is not a shape (a sentence may talk about a password without holding one), so the hint next to the field is the other half: the block is a heuristic, the hint is not.

import { whichSecret } from './codebase-accounts.ts'

/** Shown NEXT TO the field (not in help text). */
export const DESCRIPTION_HINT = 'Never put passwords, keys or tokens here'

/** The most a description may hold: the platform account's `note` column has a 2000 check in the database (0011); an email account's note has 5000. */
export const DESCRIPTION_LIMITS = { platform: 2000, email: 5000 } as const

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string }

/** The refusal for a text that looks like a secret: it says WHAT it looked like and where the secret belongs instead. Null when the text is fine. */
export function descriptionRefusal(text: string): string | null {
  const hit = whichSecret(text)
  if (hit === null) return null
  return `This looks like ${hit.what}, so it can't be saved here. Never put a password, key or token in a description: keep it in a sealed field instead (a password on the Email tab, a value on a codebase's Env tab).`
}

/** True when the text may not be saved: the forms disable their Save button on it (and the Enter key sends nothing). */
export const descriptionBlocked = (text: string): boolean => whichSecret(text) !== null

/** A description to save: trimmed; null when empty; refused when too long or when it looks like a secret. `what` names the field in the words of the page ("description", "note"). */
export function checkDescription(raw: unknown, max: number, what = 'description'): Checked<string | null> {
  const t = typeof raw === 'string' ? raw.trim() : ''
  if (!t) return { ok: true, value: null }
  if (t.length > max) return { ok: false, message: `The ${what} is longer than ${max} characters.` }
  const refusal = descriptionRefusal(t)
  if (refusal !== null) return { ok: false, message: refusal }
  return { ok: true, value: t }
}

/**
 * A STORED description as it may be shown: null when empty; `hidden` when it looks like a secret (the page then says so and never shows it; the stored text is kept as it is). The same rule as the one that refused it
 * on the way in, so a text a person was allowed to save is a text he can see.
 */
export function safeDescription(raw: unknown, max: number = DESCRIPTION_LIMITS.platform): { text: string | null; hidden: boolean } {
  if (typeof raw !== 'string') return { text: null, hidden: false }
  const t = raw.trim()
  if (!t) return { text: null, hidden: false }
  if (whichSecret(t) !== null) return { text: null, hidden: true }
  return { text: t.length > max ? t.slice(0, max) : t, hidden: false }
}
