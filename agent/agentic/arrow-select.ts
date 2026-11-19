import type { ChatMenu } from '../../shared/chat.ts'
import { apiError } from '../api.ts'
import { promptOf } from './approvals.ts'
import { findMenu } from './screen.ts'

// Order o5d4e (Shubham: "give ability to select on phone"): choosing an option of claude's UNNUMBERED select (the trust prompt's
// "❯ No, exit / Yes, add it") for a person who tapped it. There is no digit to type and no way to address an option: the pointer is moved with the
// arrow keys and Enter confirms what it stands on. So nothing here TRUSTS that the arrows moved it: after them the screen is read again, and
// Enter is pressed only when the pointer is seen on the chosen option (an effect check, not a cause check: a dropped or doubled key, or a prompt
// that changed in between, leaves nothing confirmed). On a trust prompt the difference is "No, exit" against "Yes".
//
// - The prompt must be the one the person saw (its id, which names the options and the words above them), drawn with no numbers, at every look.
// - Nothing is sent until the select is ARMED. Claude's own select (2.1.326: armAfterMs 500) draws its options dim and ignores every key for its first
//   half second, so a key sent earlier is swallowed and the tap looks as if it did nothing. "Armed" is read off the screen (the options are no longer
//   dim: the screen with its dim cells blanked shows their words), never a fixed sleep: a timer is a guess at another program's render and breaks the
//   day it is 300 ms or 800 ms; the un-dimming is the effect.
// - Any failure before Enter confirms nothing and puts the pointer back where it was found (best effort, said in the error when it could not).
// - `beforeEnter` is the caller's last word (the person's rights now, the grant, the once-only claim): it runs in the same turn as the Enter, with
//   no wait between, and is the only place the attempt is claimed (an arrow that moved nothing never costs the person their one answer).

export const KEY_UP = '\u001b[A'
export const KEY_DOWN = '\u001b[B'
export const KEY_ENTER = '\r'
/** The gap between arrow keys, so each is one key to claude, and how long the screen has to show the pointer where it should be. */
export const STEP_MS = 40
export const SETTLE_MS = 2500
/**
 * The longest it waits for the options to lose their dim. Claude's own delay is about half a second; this is only the bound for a screen that never
 * un-dims (a theme that draws them grey, a claude that changed): after it the pointer check below is still the guard, and the error says so.
 */
export const ARM_WAIT_MS = 3000

export interface ArrowDeps {
  /** The chat's screen now, line by line; null when it is not running. */
  screen(): string[] | null
  /**
   * The same screen with its dim cells blanked (Screen.typedLines), or null. Absent or null: whether the select is armed cannot be told, and nothing waits
   * (the pointer check still guards Enter).
   */
  typed?(): string[] | null
  /** Keys into the chat; false when it did not take them. */
  press(data: string): boolean
  sleep?(ms: number): Promise<void>
  now?(): number
}

export interface ArrowChosen {
  /** The option's place (1 is the first one drawn) and its words. */
  n: number
  label: string
}

const nothing = ' Nothing was confirmed.'

export async function chooseByArrows(d: ArrowDeps, want: { promptId: string; n: number }, hooks: { beforeEnter(): void }): Promise<ArrowChosen> {
  const sleep = d.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms)))
  const now = d.now ?? Date.now
  /** The prompt as the screen shows it now: this very prompt, unnumbered, or it has changed. */
  const look = (): ChatMenu => {
    const lines = d.screen()
    if (!lines) throw apiError(409, `That chat is not running any more.${nothing}`)
    const p = promptOf(lines.join('\n'))
    if (p.id !== want.promptId || p.menu?.keys !== 'arrows') throw apiError(409, `That prompt changed before the choice could be made.${nothing}`)
    return p.menu
  }
  const pointer = (m: ChatMenu) => m.options.findIndex(o => o.selected)
  /**
   * Whether claude's select is taking keys: its options are drawn at full strength. Until it is armed it draws them dim, and the screen with its dim cells
   * blanked has no words on the option rows. Only those rows are looked at: claude's footer ("Enter to confirm · Esc to cancel") is dim always. Null when
   * it cannot be told (no such screen).
   */
  const armed = (): boolean | null => {
    const lines = d.screen()
    const typed = d.typed?.()
    if (!lines || !typed) return null
    const at = findMenu(lines)
    if (!at || at.menu.keys !== 'arrows') return null
    const rows = typed.slice(at.first, at.footer).join('\n')
    return at.menu.options.every(o => rows.includes(o.label))
  }

  const first = look()
  const target = first.options.find(o => o.n === want.n)
  if (!target) throw apiError(400, `The prompt has no option ${want.n}`)
  const from = pointer(first)
  if (from < 0) throw apiError(409, `Where the pointer stands on that prompt cannot be told.${nothing}`)
  const to = target.n - 1

  // Wait for the select to be armed, and for nothing else: a tap that comes in its first moments is not lost, it just starts a moment later.
  let stillDim = false
  if (d.typed) {
    const until = now() + ARM_WAIT_MS
    while (armed() === false) {
      look()
      if (now() > until) {
        stillDim = true
        break
      }
      await sleep(30)
    }
    look()
  }
  const dim = stillDim ? ` The prompt still looked dim, as if it was not taking keys, after ${ARM_WAIT_MS / 1000} s.` : ''

  /** Puts the pointer back where it was found, when this is still the same prompt: best effort, never throws. */
  const restore = async (): Promise<boolean> => {
    try {
      const m = look()
      const at = pointer(m)
      if (at === from) return true
      const key = from > at ? KEY_DOWN : KEY_UP
      for (let i = 0; i < Math.abs(from - at); i++) {
        if (!d.press(key)) return false
        await sleep(STEP_MS)
      }
      return true
    } catch {
      return false
    }
  }
  const fail = async (message: string): Promise<never> => {
    const back = await restore()
    throw apiError(409, `${message}${dim}${nothing}${back ? '' : ' The pointer may have been left on another option.'}`)
  }

  const key = to > from ? KEY_DOWN : KEY_UP
  for (let i = 0; i < Math.abs(to - from); i++) {
    // Still this very prompt before each key (the first look was just made): another one drawn in between gets no more of them.
    if (i > 0) look()
    if (!d.press(key)) return fail('The chat did not take the arrow keys.')
    await sleep(STEP_MS)
  }

  // The check that matters: where the pointer ENDED UP, looked at (not counted).
  const deadline = now() + SETTLE_MS
  for (;;) {
    // A prompt that is gone or changed throws here: there is nothing to put back, and nothing to confirm.
    const m = look()
    const at = pointer(m)
    if (at === to && m.options[at]?.label === target.label) break
    if (now() > deadline) return fail(`The pointer did not stand on "${target.label}" (it is on "${m.options[at]?.label ?? 'none of them'}").`)
    await sleep(30)
  }

  // The last look, then the caller's last word and Enter in the same turn: nothing can change between them.
  const last = look()
  const at = pointer(last)
  if (at !== to || last.options[at]?.label !== target.label) return fail(`The pointer moved off "${target.label}" before Enter.`)
  try {
    hooks.beforeEnter()
  } catch (e) {
    // The caller's last word refused (rights gone, a changed grant): the pointer is put back, and when that could not be done the refusal says so too (F-294c, Agent 14's follow-up 3: the result was ignored).
    const back = await restore()
    if (!back && e instanceof Error) e.message += ' The pointer may have been left on another option.'
    throw e
  }
  if (!d.press(KEY_ENTER)) throw apiError(409, 'Native approval was not confirmed; do not retry automatically.')
  return { n: target.n, label: target.label }
}
