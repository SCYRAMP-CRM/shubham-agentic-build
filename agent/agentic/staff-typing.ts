import { readFileSync } from 'node:fs'
import { DEFAULT_STAFF_TYPING, OLD_STAFF_TYPING, staffTypingOf, type StaffTyping, type StaffTypingAnswer } from '../../shared/staff-typing.ts'
import { apiError } from '../api.ts'
import { writeAtomic } from '../config.ts'

// Orders of95c / o9ccb / ocf0e: which chats a non-owner may type into (shared/staff-typing.ts). The owner's choice, kept on the Server.
//
// Lead's call (ocf0e), the same shape as the Quick forwarding setting (quick-forwarding.ts): a MISSING file is no choice made yet, so it is
// what he chose, A with the scope of o2f56, not on the Server (DEFAULT_STAFF_TYPING); a file that is there but can't be used (any other read error, not JSON, not a known rule and
// scope) is a FAILURE, so it falls to the restrictive side, the 15 Nov rule (own Assistant only), and says so until a choice is saved again.
// The two are never one case. A failed save changes nothing in memory.

export interface StaffTypingStore {
  get(): StaffTyping
  unreadable(): boolean
  answer(): StaffTypingAnswer
  /** The page's body is the choice and nothing else: who chose is the caller (the route asks requireCrmHuman), never a field here. */
  set(raw: unknown): StaffTypingAnswer
}

export function createStaffTyping(file: string): StaffTypingStore {
  let settings: StaffTyping = { ...DEFAULT_STAFF_TYPING }
  let unreadable = false
  try {
    const saved = staffTypingOf(JSON.parse(readFileSync(file, 'utf8')))
    if (saved) settings = saved
    else unreadable = true
  } catch (e) {
    // Only "there is no such file" is no choice made yet; anything else is a choice we could not read.
    if (!(e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT')) unreadable = true
  }
  if (unreadable) settings = { ...OLD_STAFF_TYPING }
  const answer = (): StaffTypingAnswer => ({ settings: { ...settings }, ...(unreadable ? { unreadable: true } : {}) })
  return {
    get: () => ({ ...settings }),
    unreadable: () => unreadable,
    answer,
    set(raw) {
      const next = staffTypingOf(raw)
      // Only the two words: a body that also names a person (who chose, for whom) is refused, so nothing can look as if it had been used.
      if (!next || Object.keys(raw as object).some(k => k !== 'rule' && k !== 'scope')) {
        throw apiError(400, 'Expected {rule: "owned-and-type-shares" or "own-assistant-only", scope: "every-pc" or "not-on-server"} and nothing else')
      }
      if (unreadable || next.rule !== settings.rule || next.scope !== settings.scope) {
        writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`)
        settings = next
        unreadable = false
      }
      return answer()
    },
  }
}
