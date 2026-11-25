// F-366 (Shubham: "now i need a refresh button in alt+G because you said you start but i dont see maybe i need refresh but no refresh button"): the words of the Refresh button in the goals curtain's header. The curtain reads the CRM's
// goals, the app's links and its order ONCE when it opens (and again after a goal is added or "Try again"); the agents' reports and the goals that wait for him come live (the events socket's poke). A goal an agent made after the curtain was
// opened therefore is not there until the curtain reads again: this button is that read, with no need to close and open it. Pure: no page, no request, no clock of its own (the page hands in the time and how to write it).

/** The button's name and tooltip. */
export const REFRESH_LABEL = 'Refresh goals'
/** How long "Refreshed" stays on screen after a read that was asked for by the button. */
export const REFRESH_FLASH_MS = 3000

/** The time the list was last read, written the way the page writes a clock ("14:32"). */
export const updatedWords = (at: number, clock: (ms: number) => string): string => `Updated ${clock(at)}`
/** The brief line after a read the button asked for. */
export const refreshedWords = (at: number, clock: (ms: number) => string): string => `Refreshed · ${clock(at)}`
