import { readFileSync } from 'node:fs'
import { DEFAULT_QUICK_SETTINGS, type QuickSettings, type QuickSettingsAnswer } from '../../shared/quick-settings.ts'
import { apiError } from '../api.ts'
import { writeAtomic } from '../config.ts'

// Hub-owned, separate from each browser's Use Quick / microphone preferences.
// Both desktop and APK use the same already-enabled host; no transport is kept
// artificially active and no page/phone is made the conversational owner here.
//
// Lead (16 Nov): this file and quick-forwarding.ts behave ALIKE on purpose; keep
// them so. A MISSING file means he never chose: the default (on). An UNREADABLE
// one (any other read error, not JSON, not the one boolean) means his choice is
// not known: the SAFE state, here the old way (warm while open, plus 10 minutes),
// said on the Settings page and in the hub log until a choice is saved again.
export function createQuickSettings(file: string) {
  let settings: QuickSettings = { ...DEFAULT_QUICK_SETTINGS }
  let unreadable = false
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'keepRunning' in raw && typeof raw.keepRunning === 'boolean') {
      settings = { keepRunning: raw.keepRunning }
    } else {
      unreadable = true
    }
  } catch (e) {
    // Only "there is no such file" is his not-yet-made choice; anything else is a choice we could not read.
    if (!(e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT')) unreadable = true
  }
  if (unreadable) settings = { keepRunning: false }
  return {
    get: (): QuickSettings => ({ ...settings }),
    /** True while the saved choice could not be read: the old way (open plus 10 minutes) until a choice is saved again. */
    unreadable: () => unreadable,
    /** The routes' answer. `available`: whether this Server has the Quick host at all (the preference never enables it). */
    answer: (available: boolean): QuickSettingsAnswer => ({ settings: { ...settings }, available, ...(unreadable ? { unreadable: true } : {}) }),
    set(raw: unknown): QuickSettings {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)
        || Object.keys(raw).length !== 1 || !('keepRunning' in raw) || typeof raw.keepRunning !== 'boolean') {
        throw apiError(400, 'Expected {keepRunning: true or false}')
      }
      const next = { keepRunning: raw.keepRunning }
      // After an unreadable file his choice is written even when it equals the safe value in force, so the file is whole again.
      if (unreadable || next.keepRunning !== settings.keepRunning) {
        // A failed save must not pretend that the new preference took effect (unreadable included).
        writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`)
        settings = next
        unreadable = false
      }
      return { ...settings }
    },
  }
}
