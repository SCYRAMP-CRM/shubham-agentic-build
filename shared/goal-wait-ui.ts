import { newRequestId } from './goal-add.ts'
import { agoWords } from './goal-progress.ts'
import { WAIT_KIND_WORDS, type WaitKind } from './goal-wait.ts'

// F-362 (Shubham: "we also need a feasuter in tht egoals fllor wiating for you. this need not be a quesiton necesarrily. lets im learning somehting and its waiting for me to say yes ive understood lets move to to next step."):
// the words and the one request body of the "Waiting for you" part of a goal's row in the goals curtain. Pure, so the sentences and the body a test pins are the ones the page shows and sends. Everything the AGENT said (its
// one line, its name) is passed in and only ever put into a sentence as a TEXT NODE by the page; the labels of every button come from shared/goal-wait.ts (ANSWER_BUTTONS, DISMISS_LABEL) by KIND only, never from a goal's
// title or an agent's line.

export const WAITING_WORDS = 'Waiting for you'
/** "Waiting for you · Question" (Approval, Learning). */
export const waitChipWords = (kind: WaitKind): string => `${WAITING_WORDS} · ${WAIT_KIND_WORDS[kind]}`
/** "Asked by Lead · 3 min ago": who said it, a claim and never a fact. */
export const waitByline = (agent: string, at: string, now: number): string => {
  const ago = agoWords(at, now)
  return `Asked by ${agent}${ago ? ` · ${ago}` : ''}`
}
/** Said BEFORE a tap when the app sees the agent's chat as stopped (the server still decides). */
export const waitStoppedWords = (agent: string): string => `${agent}'s chat is stopped: open it, then answer.`
/** The curtain's count of open goals that wait for him. */
export const waitingHeaderWords = (n: number): string => `${n} waiting for you`
/** Under a goal whose sub-goals are folded away: how many of them wait for him. */
export const waitInsideWords = (n: number): string => `${n} sub-goal${n === 1 ? '' : 's'} waiting for you`
/** What a screen reader hears after a tap. */
export const answeredNote = (agent: string): string => `Answer sent to ${agent}.`
export const DISMISSED_NOTE = 'The wait was ended. Nothing was sent to the chat.'
export const REPLY_LABEL = 'Your reply'
export const REPLY_PLACEHOLDER = 'Type your reply'
/** Only if a refusal came with no sentence of its own (the route always sends one). */
export const ANSWER_FAILED = 'The answer could not be sent just now. Nothing was changed.'

/** The EXACT body of the answer route: a choice, a request id (new for a new press, kept while the same press is tried again), the `at` of the wait he looked at, and for a question his reply. Nothing else. */
export interface AnswerBody {
  choice: string
  requestId: string
  waitAt: string
  text?: string
}
export function answerBody(kind: WaitKind, choice: string, text: string | undefined, requestId: string, waitAt: string): AnswerBody {
  return { choice, requestId, waitAt, ...(kind === 'question' && text !== undefined ? { text } : {}) }
}

/**
 * The request id of a press. A second tap of the SAME press (same goal, same wait, same choice, same words: the first answer is not confirmed, or the chat could not take it just now) keeps the id, so the chat is never
 * told twice; any other press gets a new one. `kept` is what the page remembered from the last press; returns the id to send and what to remember.
 */
export function pressIdFor(kept: { key: string; id: string } | null, goalId: string, waitAt: string, choice: string, text: string): { key: string; id: string } {
  const key = `${goalId}|${waitAt}|${choice}|${text}`
  return kept !== null && kept.key === key ? kept : { key, id: newRequestId() }
}

/** The server's own sentence for a refusal (the route always sends one: "That wait was changed while you looked at it...", the delivery refusals), never a generic one made up here. */
export function answerErrorWords(e: unknown): string {
  return e instanceof Error && e.message.trim() !== '' ? e.message : ANSWER_FAILED
}
/** A 409 (changed, no longer waiting, being answered): the page reads the waits again, so what he sees is what is there now. */
export const isConflict = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { status?: unknown }).status === 409
