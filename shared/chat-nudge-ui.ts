// F-365 (Shubham via the Lead, 25 Nov 2026: "make nudge button so i can manually nudge the lead to check on this"): the words and the one rule of the Nudge button in a chat window's title bar (src/agentic/ChatNudge.tsx).
// The route is the agent's (Agent 12): POST /floors/:floorId/agents/:agentId/beat/nudge, no body; 200 { nudge: { at, how: 'sent' | 'uncertain' } }; a refusal is a 409 (busy, stopped, waiting for you, ...) or a 429 (too soon: one a minute
// for each chat), each with its own plain sentence. The page shows that sentence as it is, and a fixed one for anything else. Pure: no page, no request, no clock of its own.

/** After a tap the button waits this long before it can be tapped again (the agent allows one nudge a minute for each chat; this keeps the page from asking sooner). */
export const NUDGE_LOCK_MS = 60_000
/** The tooltip, and the word of the button. */
export const NUDGE_TITLE = 'Nudge'
export const NUDGE_SENT = 'Nudged.'
/** The route says it may have been typed but could not confirm it: it is never typed again by itself, so he looks before he nudges again. */
export const NUDGE_UNCERTAIN = 'Nudged, but the app could not confirm that it was typed. Look at the chat before you nudge again.'
/** Anything that is not the route's own refusal (no answer, an old agent without the route, a server error). */
export const NUDGE_FAILED = 'The nudge could not be sent.'
/** A refusal's sentence is short by design; this only keeps a wrong answer from filling the screen. */
export const NUDGE_SENTENCE_MAX = 300

/** One sentence of the route's, as text: line breaks and runs of spaces are one space, and no more than NUDGE_SENTENCE_MAX characters. Empty when there is none. */
const sentenceOf = (s: string): string => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > NUDGE_SENTENCE_MAX ? `${t.slice(0, NUDGE_SENTENCE_MAX - 1)}…` : t
}

/** The confirmation of a nudge that went through: the route's own `words` ("Nudged.", or its warning that the nudge may have been typed), else the page's own for how it went. */
export function nudgeDoneWords(r: unknown): string {
  const n = typeof r === 'object' && r !== null ? (r as { nudge?: { how?: unknown; words?: unknown } | null }).nudge : undefined
  const words = typeof n?.words === 'string' ? sentenceOf(n.words) : ''
  if (words !== '') return words
  return n?.how === 'uncertain' ? NUDGE_UNCERTAIN : NUDGE_SENT
}

const statusOf = (e: unknown): unknown => (typeof e === 'object' && e !== null ? (e as { status?: unknown }).status : undefined)

/** A refusal of the route (409: it cannot be nudged now; 429: too soon): its sentence is the one to show. */
export const isNudgeRefusal = (e: unknown): boolean => statusOf(e) === 409 || statusOf(e) === 429

/** What to say for a nudge that did not go: the route's own sentence for a refusal (as text, never more than NUDGE_SENTENCE_MAX characters), a fixed sentence for anything else. */
export function nudgeErrorWords(e: unknown): string {
  if (!isNudgeRefusal(e) || !(e instanceof Error)) return NUDGE_FAILED
  const s = sentenceOf(e.message)
  return s === '' ? NUDGE_FAILED : s
}
