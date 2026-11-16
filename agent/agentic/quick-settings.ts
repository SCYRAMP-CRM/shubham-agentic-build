import { readFileSync } from 'node:fs'
import { DEFAULT_QUICK_SETTINGS, type QuickSettings } from '../../shared/quick-settings.ts'
import { apiError } from '../api.ts'
import { writeAtomic } from '../config.ts'

// Hub-owned, separate from each browser's Use Quick / microphone preferences.
// Both desktop and APK use the same already-enabled host; no transport is kept
// artificially active and no page/phone is made the conversational owner here.
export function createQuickSettings(file: string) {
  let settings: QuickSettings = { ...DEFAULT_QUICK_SETTINGS }
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'keepRunning' in raw && typeof raw.keepRunning === 'boolean') {
      settings = { keepRunning: raw.keepRunning }
    }
  } catch {
    // Nothing saved (or an invalid file): the owner's default is on.
  }
  return {
    get: (): QuickSettings => ({ ...settings }),
    set(raw: unknown): QuickSettings {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)
        || Object.keys(raw).length !== 1 || !('keepRunning' in raw) || typeof raw.keepRunning !== 'boolean') {
        throw apiError(400, 'Expected {keepRunning: true or false}')
      }
      const next = { keepRunning: raw.keepRunning }
      if (next.keepRunning !== settings.keepRunning) {
        // A failed save must not pretend that the new preference took effect.
        writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`)
        settings = next
      }
      return { ...settings }
    },
  }
}
