import { readFileSync } from 'node:fs'
import { DEFAULT_QUICK_FORWARDING, type QuickForwardingAnswer, type QuickForwardingSettings } from '../../shared/quick-forwarding.ts'
import { apiError } from '../api.ts'
import { writeAtomic } from '../config.ts'

// One owner-only hub choice for Quick on desktop and APK. It does not change
// Access, any human-session proof, the spoken latch, or any native tool policy.
//
// oc58f follow-up (Lead, 16 Nov): a MISSING file means he never chose, so the
// default (on) applies. An UNREADABLE one (any other read error, not JSON, or
// not the one boolean) means his choice is not known: it may have been off.
// It fails to the safe old way, the card until his tap, and says so (the
// Settings page shows it, the hub logs it) until a choice is saved again. The
// same shape as Quick's history: a failed store wins over an optimistic default.
// Lead (16 Nov): this file and quick-settings.ts behave ALIKE on purpose; keep
// them so (each fails to its own safe state: here the card, there the old way).
export function createQuickForwarding(file: string) {
  let settings: QuickForwardingSettings = { ...DEFAULT_QUICK_FORWARDING }
  let unreadable = false
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'sendsWithoutAsking' in raw && typeof raw.sendsWithoutAsking === 'boolean') {
      settings = { sendsWithoutAsking: raw.sendsWithoutAsking }
    } else {
      unreadable = true
    }
  } catch (e) {
    // Only "there is no such file" is his not-yet-made choice; anything else is a choice we could not read.
    if (!(e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT')) unreadable = true
  }
  if (unreadable) settings = { sendsWithoutAsking: false }
  const answer = (): QuickForwardingAnswer => ({ settings: { ...settings }, ...(unreadable ? { unreadable: true } : {}) })
  return {
    get: (): QuickForwardingSettings => ({ ...settings }),
    /** True while the saved choice could not be read: Quick asks first (the card) until a choice is saved again. */
    unreadable: () => unreadable,
    answer,
    set(raw: unknown): QuickForwardingAnswer {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== 1
        || !('sendsWithoutAsking' in raw) || typeof raw.sendsWithoutAsking !== 'boolean') {
        throw apiError(400, 'Expected {sendsWithoutAsking: true or false}')
      }
      const next = { sendsWithoutAsking: raw.sendsWithoutAsking }
      // After an unreadable file his choice is written even when it equals the safe value in force, so the file is whole again.
      if (unreadable || next.sendsWithoutAsking !== settings.sendsWithoutAsking) {
        // A failed save changes nothing here: the error goes to the page, and the old state (unreadable included) stays.
        writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`)
        settings = next
        unreadable = false
      }
      return answer()
    },
  }
}
