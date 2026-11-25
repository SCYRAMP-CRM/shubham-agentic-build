import type { LiveKind } from './goal-progress.ts'

// F-361 fix (Shubham: "and when i open the alt+G it show lead working on everything and takes time before finally showing what is actually being worked on"): what the curtain may say about WHO IS WORKING on a goal, and when it
// may say it. Two rules, both pure so a test pins them:
//   1. Only a goal an agent REPORTED on wears the agent's chip with the state of its chat (working, asking you, idle, stopped): a line it wrote, what the app wrote after the agent changed the goal, or his answer to it. A goal an
//      agent only MADE says "Made by <agent>" in quiet words with no chip and no state: whoever made a goal is not thereby working on it (the Lead made them all).
//   2. The first paint is ONE picture: the list waits for the agents' reports as well as for the goals (one loading state), for at most PROGRESS_WAIT_MS. A read of the reports that fails, or that does not come in time, is said in
//      one fixed line; the page never fills the gap by showing the makers as if they were the workers.

/** The one fixed line when the reports of the agents could not be read (or did not come in time). */
export const PROGRESS_FAILED = 'Live progress could not be read.'
/** The loading line while the goals are in but the agents' reports are not. */
export const CHECKING_WORDS = 'Checking who is working…'
/** The most the list waits for the reports of the agents after it opens: then it shows the goals and says PROGRESS_FAILED until they arrive. */
export const PROGRESS_WAIT_MS = 10_000

/** Whether a goal's live line wears the agent's chip (and the state of its chat): only for what the agent said or did, never for "made by" alone. */
export const wearsChip = (kind: LiveKind): boolean => kind !== 'made'

export interface LiveGate {
  /** The goals are in but the reports are not yet: ONE loading state (no chip, no maker, no half picture). */
  checking: boolean
  /** The fixed line is due: the last read of the reports failed, or none came in time and none has since. */
  trouble: boolean
}

/**
 * `goals` is the phase of the goals' own read; `progress` what the page knows of the reports (`answered`: a good answer has come, even an older one; `failed`: the last read failed); `gaveUp`: PROGRESS_WAIT_MS has
 * passed since the curtain opened. While the goals read or failed there is nothing to hold back (their own loading line or their own Try again says it).
 */
export function liveGate(goals: 'loading' | 'failed' | 'ready', progress: { answered: boolean; failed: boolean }, gaveUp: boolean): LiveGate {
  const settled = progress.answered || progress.failed || gaveUp
  return { checking: goals === 'ready' && !settled, trouble: progress.failed || (gaveUp && !progress.answered) }
}
