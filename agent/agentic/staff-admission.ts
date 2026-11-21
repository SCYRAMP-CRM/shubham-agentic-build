// F-300 slice S0 (his order oc60d; Lead's rulings D1 "Server as today" and D2 "the person waits, his chats win"; Agent 14's review, adopted): the START of a person's own Assistant on the Server is admitted here, once, before
// anything is spawned. A person's Assistant starts a chat (about 400 MB, to be measured over the whole process family: Agent 19's F-290 measurement) on the Server's own memory, and nothing asked "is there room?" before.
//
// Two things, both on the Server and both refused with the SAME plain words (never a number, never which of the two it was):
//  1. the memory gate: the SHARED start admission (F-290 / Agent 19, start-admission.ts), which reads the free memory and reserves in ONE synchronous step, so two starts at once cannot both see the same free megabytes.
//     This file does not read memory itself and keeps no memory number: it is handed that function (AgenticOptions.startAdmission). Until it is wired this gate is OFF and a start is as it was.
//     IN THE BUILD THIS FIRST RELEASE RIDES IN (Agent 14's N1, 19 Nov): this half is NOT wired. main.ts passes no startAdmission and start-admission.ts (F-290's) is not in the tree, so ONLY the rate below is live: the Server's memory is protected by
//     that rate (6 starts in 10 minutes per person) and by nothing else until F-290 lands and wires it.
//  2. a per-person start rate: one person cannot make the Server start their Assistant over and over (a page that retries, a script, a bounced chat that is restarted), whatever the memory. A start counts when it is admitted.
//
// The owner's chats are never stopped to make room (D2): a refusal is "wait", and the person's draft is kept by the page. Pure apart from the clock it is given.

/** What the shared start admission answers (start-admission.ts, Agent 19's): admitted with a reservation to release when the start is over, or a code. */
export type StartAdmit = (req: { kind: 'staff'; who: string; sessionId: string }) => { ok: true; release: () => void } | { ok: false; code: 'memory-low' | 'held' }

/** What a person is told: plain, no numbers, no route or file names, the same for every cause. */
export const STAFF_RESTING_WORDS = 'Your Assistant is resting. Try again in a few minutes.'
export const STAFF_RESTING_CODE = 'staff-resting'

/** How many starts one person gets in a window (the Server's own limit: a person's Assistant is started by a first open, an idle restart or the owner's restart, a handful in ten minutes at most). */
export const STAFF_STARTS_PER_WINDOW = 6
export const STAFF_START_WINDOW_MS = 10 * 60_000

export type StaffAdmitted = { ok: true; release: () => void }
export type StaffRefused = { ok: false; code: typeof STAFF_RESTING_CODE; words: string; cause: 'memory-low' | 'held' | 'rate' }

export interface StaffAdmissionOptions {
  /** The shared start admission. Left out: no memory gate (the start is as it was before this slice). */
  startAdmit?: StartAdmit
  now?: () => number
  maxStarts?: number
  windowMs?: number
}

export interface StaffAdmission {
  /** Asked once, synchronously, right before a person's Assistant is started. `person` is the owner's id. A success holds the reservation until `release()` (call it when the start is over, whether it worked or threw). */
  admit(person: string, sessionId: string): StaffAdmitted | StaffRefused
}

export function createStaffAdmission(o: StaffAdmissionOptions = {}): StaffAdmission {
  const now = o.now ?? Date.now
  const max = o.maxStarts ?? STAFF_STARTS_PER_WINDOW
  const windowMs = o.windowMs ?? STAFF_START_WINDOW_MS
  const starts = new Map<string, number[]>()
  const refused = (cause: StaffRefused['cause']): StaffRefused => ({ ok: false, code: STAFF_RESTING_CODE, words: STAFF_RESTING_WORDS, cause })

  return {
    admit(person, sessionId) {
      const key = person.toLowerCase()
      const t = now()
      const recent = (starts.get(key) ?? []).filter(at => t - at < windowMs)
      // The rate first: it costs nothing and must not reserve memory it will not use.
      if (recent.length >= max) {
        starts.set(key, recent)
        return refused('rate')
      }
      let release = () => {}
      if (o.startAdmit) {
        const a = o.startAdmit({ kind: 'staff', who: key, sessionId })
        if (!a.ok) {
          starts.set(key, recent)
          return refused(a.code)
        }
        release = a.release
      }
      // Counted only now that the start is admitted: a refusal never uses up the person's starts.
      recent.push(t)
      starts.set(key, recent)
      let released = false
      return { ok: true, release: () => { if (!released) { released = true; release() } } }
    },
  }
}
