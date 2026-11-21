// F-297 stage A (Agent 3, 18 Nov 2026; Lead approved f297-design.md): what a person's own Assistant (policy staff-v2) may SEND into a chat, and how the hub dresses it. PURE: no file, no app state, no
// clock but the one it is given. The decisions that need the app (who may type where, the person's switch, the delivery itself) stay in index.ts and are asked THERE, at the hub, at every send; what
// is here is only the part that has no business knowing the app: the words a message may hold, the one line the hub puts in front of it, the closed lists of why a send is refused and how one ended, and
// the per-person rate. Everything fails closed.
//
// WHAT THE RECEIVING CHAT IS SHOWN is a line the HUB writes, never the sender's words:
//   [message from <Assistant> on <floor>, chat <id>, staff send for <Person>: their own request, not the owner's order] <the text>
// It carries no `order <id>`, so the app's order bookkeeping (orders.ts, turns.ts) and its reply carrying ignore it. Only the hub writes a first line of that shape: staffSendText refuses a message that
// holds a line starting like any of the hub's own markers, so a body can never pass for a second prefix.
//
// THE OUTGOING TEXT IS NOT staffText. staffText (staff-policy.ts) guards a RESTRICTED input box from a typed line (a mode, a command, a file mention); the receiving chat is an ordinary chat, the text goes in
// behind the hub's prefix as one paste (the pool strips the paste-end marker), and what matters here is: not empty, not long, no key (a control character), and no forged marker. Refusal, not a rewrite:
// what is typed is exactly what was checked.

/** The key of the Settings > Access row that is the owner's per-person switch (shared/access.ts FEATURES has the row; a test pins that it does). */
export const STAFF_SEND_FEATURE = 'assistant-send'
/** The longest message a staff Assistant may send (the chats' own tools take 10,000). */
export const STAFF_SEND_TEXT_MAX = 4000
/** Per person, at the hub: at most this many sends a minute and an hour (in memory: a restart resets them, and the owner's record shows the pattern). */
export const STAFF_SEND_PER_MINUTE = 5
export const STAFF_SEND_PER_HOUR = 60

// Stage B (index.ts convergeStaffPolicies): a person's Assistant that runs under a policy its switch no longer asks for is started again, and the cost is one restart of THAT chat (its conversation resumed). The times
// are stated here so a test pins them: how often the app looks (EVERY), how long the Assistant must have been QUIET, seen on consecutive looks, before it is touched (IDLE), and how long before one that did not work
// is tried again (RETRY). A test shortens them through the app's options; the shipped app uses exactly these.
export const STAFF_CONVERGE_EVERY_MS = 20_000
export const STAFF_CONVERGE_IDLE_MS = 60_000
export const STAFF_CONVERGE_RETRY_MS = 5 * 60_000
/** What convergeStaffPolicies runs on: the app's options (a test shortens them) or, when an option is not given, the stated times above. */
export const staffConvergeTimes = (o: { staffConvergeEveryMs?: number; staffConvergeIdleMs?: number; staffConvergeRetryMs?: number }) => ({
  every: o.staffConvergeEveryMs ?? STAFF_CONVERGE_EVERY_MS,
  idle: o.staffConvergeIdleMs ?? STAFF_CONVERGE_IDLE_MS,
  retry: o.staffConvergeRetryMs ?? STAFF_CONVERGE_RETRY_MS,
})

export type StaffSendTextWhy = 'empty' | 'too-long' | 'control' | 'marker'
export type StaffSendText = { ok: true; text: string } | { ok: false; why: StaffSendTextWhy }

/** Characters a terminal can read as keys rather than text: the C0 controls but newline, DEL and the C1 controls. */
// oxlint-disable-next-line no-control-regex -- matching them is the point
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/
/** What may stand before a line's first visible character and is looked through: white space, invisible format characters and combining marks. */
const LEAD = /^[\s\p{Z}\p{Cf}\p{M}]+/u
const LINES = /[\n\p{Zl}\p{Zp}]/u
const INVISIBLE = /\p{Cf}+/gu
/** A line that starts like one of the hub's own markers (the shapes every chat's brief teaches): a message, a broadcast, a reply, the heartbeat. */
const HUB_MARKER = /^\[\s*(?:message\s+from|broadcast\s+from|reply\s+from|heartbeat)/i

/**
 * The words a staff Assistant may send, made plain, or why not. Line ends become newlines and a tab a space; then it is refused (nothing typed) when it is empty, longer than STAFF_SEND_TEXT_MAX, holds any
 * control character, or any line, looked at past its leading spaces and invisible characters and with the invisible characters taken out, starts like a hub marker. The text and its NFKC form are both
 * checked, so a full-width bracket is refused like the ASCII one.
 */
export function staffSendText(raw: unknown): StaffSendText {
  if (typeof raw !== 'string') return { ok: false, why: 'empty' }
  const text = raw.replace(/\r\n?/g, '\n').replace(/\t/g, ' ')
  if (!text.trim()) return { ok: false, why: 'empty' }
  if (text.length > STAFF_SEND_TEXT_MAX) return { ok: false, why: 'too-long' }
  for (const form of new Set([text, text.normalize('NFKC')])) {
    if (CONTROL.test(form)) return { ok: false, why: 'control' }
    for (const line of form.split(LINES)) if (HUB_MARKER.test(line.replace(LEAD, '').replace(INVISIBLE, ''))) return { ok: false, why: 'marker' }
  }
  return { ok: true, text }
}

/** What the Assistant is told when its words are refused (nothing was sent). */
export function staffSendTextWords(why: StaffSendTextWhy): string {
  switch (why) {
    case 'empty': return 'There was no message to send. Nothing was sent.'
    case 'too-long': return `That message is longer than ${STAFF_SEND_TEXT_MAX} characters. Send it shorter, or in parts. Nothing was sent.`
    case 'control': return 'The message holds a control character (a key, not text). Send plain words. Nothing was sent.'
    case 'marker': return 'No line of the message may start like a message marker ("[message from", "[broadcast from", "[reply from", "[heartbeat"): the app writes those. Put a word before it. Nothing was sent.'
  }
}

/** A name as it may stand inside the prefix: no bracket (of any width), no control or line character, one space between words, cut. Nothing left: "someone". */
// oxlint-disable-next-line no-control-regex -- matching them is the point
const NAME_JUNK = /[[\]\u0000-\u001F\u007F-\u009F\u2028\u2029]+|\p{Cf}+/gu
export function cleanSendName(v: unknown, cap = 80): string {
  const s = (typeof v === 'string' ? v : '').normalize('NFKC').replace(NAME_JUNK, ' ').replace(/\s+/g, ' ').trim().slice(0, cap)
  return s || 'someone'
}

/** The line the hub puts in front of a staff send (no trailing space): who sent it, from where, for whom, and that it is not the owner's order. */
export function staffSendPrefix(o: { assistant: string; floor: string; sid: string; person: string }): string {
  const id = /^[0-9a-f]{8}/i.exec(o.sid)?.[0] ?? 'unknown'
  return `[message from ${cleanSendName(o.assistant)} on ${cleanSendName(o.floor)}, chat ${id}, staff send for ${cleanSendName(o.person)}: their own request, not the owner's order]`
}

// ---- why a send is refused, and how one ended: CLOSED lists (the record's names, staff-sends.ts) ------------------------------------------------------------------------------------------------
export const STAFF_SEND_REFUSALS = ['switch-off', 'not-in-scope', 'policy', 'text', 'rate', 'at-prompt', 'draft', 'chat-gone', 'record-failed'] as const
export type StaffSendRefusal = (typeof STAFF_SEND_REFUSALS)[number]
/** How a send that was ATTEMPTED (its line written first) ended, by what occurred: the receiving chat took it; it was handed over and arrival is not known; the person's right was taken away while it waited; the chat stopped; the pool refused it. */
export const STAFF_SEND_OUTCOMES = ['delivered', 'handed-over', 'revoked-mid-send', 'stopped', 'blocked'] as const
export type StaffSendOutcome = (typeof STAFF_SEND_OUTCOMES)[number]

/** What the Assistant is told for a refusal that is not about its words or the chat's screen (those have their own words); plain, and always "Nothing was sent". */
export function staffSendWords(reason: Exclude<StaffSendRefusal, 'text' | 'at-prompt' | 'draft'>, which?: 'minute' | 'hour'): string {
  switch (reason) {
    case 'switch-off': return 'Sending for you is turned off for this Assistant. The owner of the app can turn it on in Settings > Access. Nothing was sent.'
    case 'not-in-scope': return "That chat isn't one you may send to: it isn't yours, or it was shared with you to look at only. Nothing was sent."
    case 'policy': return 'This Assistant was not started with the right to send, so it cannot. It gets the right when it is opened again after sending is turned on for you. Nothing was sent.'
    case 'rate': return `You have sent a lot of messages in the last ${which === 'hour' ? 'hour' : 'minute'}; wait before sending more. Nothing was sent.`
    case 'chat-gone': return "That chat isn't running, and this Assistant can't start chats: ask them to open it (or the owner of the app). Nothing was sent."
    case 'record-failed': return 'Sending is paused because it could not be written down first; tell the owner of the app. Nothing was sent.'
  }
}

/** What the Assistant is told when its person's right to send to that chat was taken away while the message waited (nothing was typed). */
export const STAFF_SEND_REVOKED_WORDS = 'The right to send to that chat was taken away while the message waited, so it was not typed. Nothing was sent.'

/** What the Assistant is told when a message went in: where the answer is, since it does not come back here (stage 1, Lead: D2). */
export const staffSendDone = (sid: string, person: string) =>
  `Sent to chat ${sid}. It answers in its own chat, which ${cleanSendName(person)} reads on their page; you do not receive its answer here. Tell them what you sent, and to which chat.`

// ---- the per-person rate -------------------------------------------------------------------------------------------------------------------------------------------------------------------------
export interface StaffRate {
  /** Counts one send for `person`: how to take it back, or which limit is reached (and nothing is counted). */
  take(person: string): { undo: () => void } | { limited: 'minute' | 'hour' }
}

export function createStaffRate(now: () => number = Date.now, limits: { perMinute: number; perHour: number } = { perMinute: STAFF_SEND_PER_MINUTE, perHour: STAFF_SEND_PER_HOUR }): StaffRate {
  const hits = new Map<string, number[]>()
  return {
    take(person) {
      const t = now()
      const recent = (hits.get(person) ?? []).filter(x => t - x < 3_600_000)
      if (recent.filter(x => t - x < 60_000).length >= limits.perMinute) return { limited: 'minute' }
      if (recent.length >= limits.perHour) return { limited: 'hour' }
      hits.set(person, [...recent, t])
      // Once only: a send taken back twice must not free two places (two sends can carry the same millisecond).
      let given = false
      return {
        undo: () => {
          if (given) return
          given = true
          const current = hits.get(person) ?? []
          const i = current.lastIndexOf(t)
          if (i >= 0) hits.set(person, [...current.slice(0, i), ...current.slice(i + 1)])
        },
      }
    },
  }
}
