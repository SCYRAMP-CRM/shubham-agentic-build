import { readFileSync } from 'node:fs'
import { DEFAULT_CHAT_SETTINGS, type ChatSettings, type ChatSettingsAnswer } from '../../shared/chat-settings.ts'
import { apiError } from '../api.ts'
import { writeAtomic } from '../config.ts'

// F-345: the hub's choice "Chats put tasks in Goals", one small file in the app's state folder. It behaves like quick-settings.ts on purpose:
// a MISSING file means he never chose (the default: on); an UNREADABLE one (any other read error, not JSON, not the one boolean) means his choice is
// not known, so the SAFE state is the OLD way (off: the brief is exactly what it was) until he chooses again, said on the Settings page and in the hub log.
export function createChatSettings(file: string) {
  let settings: ChatSettings = { ...DEFAULT_CHAT_SETTINGS }
  let unreadable = false
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'tasksToGoals' in raw && typeof raw.tasksToGoals === 'boolean') {
      settings = { tasksToGoals: raw.tasksToGoals }
    } else {
      unreadable = true
    }
  } catch (e) {
    // Only "there is no such file" is his not-yet-made choice; anything else is a choice we could not read.
    if (!(e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT')) unreadable = true
  }
  if (unreadable) settings = { tasksToGoals: false }
  return {
    get: (): ChatSettings => ({ ...settings }),
    /** True while the saved choice could not be read: the old way until a choice is saved again. */
    unreadable: () => unreadable,
    answer: (): ChatSettingsAnswer => ({ settings: { ...settings }, ...(unreadable ? { unreadable: true as const } : {}) }),
    set(raw: unknown): ChatSettings {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)
        || Object.keys(raw).length !== 1 || !('tasksToGoals' in raw) || typeof raw.tasksToGoals !== 'boolean') {
        throw apiError(400, 'Expected {tasksToGoals: true or false}')
      }
      const next = { tasksToGoals: raw.tasksToGoals }
      // After an unreadable file his choice is written even when it equals the safe value in force, so the file is whole again.
      if (unreadable || next.tasksToGoals !== settings.tasksToGoals) {
        // A failed save must not pretend that the new choice took effect.
        writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`)
        settings = next
        unreadable = false
      }
      return { ...settings }
    },
  }
}
