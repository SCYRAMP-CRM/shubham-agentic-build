import { composer, menuOnScreen, ownedComposerTail } from './screen.ts'
import { asciiStandIns, splitForConsole, win32Keys, type ConsoleInput } from './console-keys.ts'
import type { DeliveryBlockReason, DeliveryCause, DeliveryMark } from '../../shared/delivery-reason.ts'

const PASTE_START = '\u001b[200~'
const PASTE_END = '\u001b[201~'
/** Diagnostics only: which branch ended a send and when each step happened (ms since it began). Never any text. */
export interface DeliveryReport { result: SendResult; cause: DeliveryCause; marks: [DeliveryMark, number][] }
export interface SenderIO {
  write(data: string): boolean
  lines(): string[]
  /** A non-Codex TUI adapter has already proved its own box/menu boundaries. */
  frame?(lines: string[]): { menu: boolean; composer: { text: string; collapsed: boolean } | null }
  sleep(ms: number): Promise<void>
  /** External keystrokes invalidate paste ownership, even if they empty the composer. */
  interrupted?(): boolean
  /** Which of the two things made interrupted() true (default: a terminal input frame). Diagnostics only. */
  interruptCause?(): 'terminal-input' | 'guard-revoked'
  gone?(): boolean
  /** Fresh authorization for this input only; denial never causes a repaste/retry. */
  beforeInput?(phase: 'paste' | 'submit'): Promise<boolean>
  /** A pre-paste refusal only. Once input starts, failure is uncertain, never retry-safe. */
  onBlocked?(reason: DeliveryBlockReason): void
  /** Called once when the send ends, for sent/unconfirmed/gone and for a refusal that had to be relabelled. Diagnostics only. */
  report?(report: DeliveryReport): void
  /**
   * o655f (Stage 1): true once claude itself said it TOOK this exact text (its UserPromptSubmit hook, 10-110 ms after Enter). That is proof of
   * submission by whoever pressed the Enter, so it ends the send as sent at once, before and instead of any screen reading or input check.
   */
  confirmed?(): boolean
}
export type SendResult = 'sent' | 'blocked' | 'unconfirmed' | 'gone'
export interface SendOptions {
  settleMs?: number
  checkMs?: number
  tries?: number
  maxSettleMs?: number
  /** Entire native transaction budget. Tool callers independently bound their confirmation wait. */
  timeoutMs?: number
  /**
   * F-193: the words are already in the box, typed there by the live mirror (or by him in the terminal): nothing is pasted, the box must
   * hold exactly them, and only the settle, Enter and read-back steps run. A box holding anything else is refused as a draft.
   */
  preTyped?: boolean
  /**
   * oeee2: how the text goes into a Windows console (console-keys.ts). 'win32-input': each character past plain ASCII as a key press of its
   * own, between pastes (it arrives exactly); 'ascii': the common symbols as plain-text stand-ins (the box then holds the stand-ins). Absent:
   * as it is (Linux, macOS, and every adapter that is not a native Codex console).
   */
  console?: ConsoleInput
  /**
   * oeee2: a message that did not go in is taken back out of the box (Backspace only) when nothing but this send typed into the chat since
   * its paste and no question is on the screen; a box that then reads empty ends the send 'blocked' with 'withdrawn' (nothing submitted,
   * safe to send again). Off: such a send ends 'unconfirmed' with the text left in the box, as before.
   */
  withdraw?: boolean
}
const normalized = (s: string) => s.replace(/\s+/g, '')
/** oeee2: Backspace as a terminal sends it; never Esc (it interrupts a working Codex) and never Ctrl+C. */
const BACKSPACE = '\x7f'
/** oeee2: how long taking a message back out may take, past the send's own budget; and the Backspaces per round. */
const WITHDRAW_MS = 20_000
const WITHDRAW_ROUND = 128

/** Working output alone never proves acceptance. Only submit the owned composer. */
export async function sendToCodex(io: SenderIO, text: string, o: SendOptions = {}): Promise<SendResult> {
  const settleMs = Math.max(1, o.settleMs ?? 2000)
  const checkMs = Math.max(1, o.checkMs ?? 1500)
  const tries = Math.max(1, Math.min(3, o.tries ?? 3))
  const maxSettleMs = o.maxSettleMs ?? Math.min(300_000, Math.max(90_000, Buffer.byteLength(text) * 50))
  const timeoutMs = Math.min(300_000, o.timeoutMs ?? maxSettleMs + 6000)
  const started = Date.now()
  const deadline = started + timeoutMs
  let slept = 0
  const expired = () => Date.now() >= deadline || slept >= timeoutMs
  const sleep = async (ms: number) => { const wait = Math.max(0, Math.min(ms, timeoutMs - slept, deadline - Date.now())); await io.sleep(wait); slept += wait }
  const marks: [DeliveryMark, number][] = []
  const mark = (name: DeliveryMark) => { if (marks.length < 16) marks.push([name, Date.now() - started]) }
  const finish = (result: SendResult, cause: DeliveryCause): SendResult => { mark('end'); try { io.report?.({ result, cause, marks }) } catch { /* diagnostics never change a delivery */ } return result }
  const interrupted = () => io.interrupted?.() === true
  const why = (): DeliveryCause => io.interruptCause?.() ?? 'terminal-input'
  const read = () => { try { return io.lines() } catch { return null } }
  const menu = (lines: string[]) => io.frame ? io.frame(lines).menu : menuOnScreen(lines)
  const input = (lines: string[]) => io.frame ? io.frame(lines).composer : composer(lines)
  const blocked = (reason: DeliveryBlockReason): SendResult => { io.onBlocked?.(reason); return 'blocked' }
  // Nothing of the message was typed: a refusal, safe to send again. (Used for the cases that used to be called unconfirmed.)
  const blockedWith = (reason: DeliveryBlockReason, cause: DeliveryCause): SendResult => { io.onBlocked?.(reason); return finish('blocked', cause) }
  const before = read()
  if (!before) return io.gone?.() ? 'gone' : blocked('screen-unavailable')
  if (menu(before)) return blocked('menu')
  if (io.interrupted?.()) return blocked('input-changed')
  const initial = input(before)
  if (!initial) return blocked('composer-unavailable')
  // oeee2: on a Windows console that cannot take them as key presses the common symbols go in as plain-text stand-ins; the box then holds those.
  const pasted = o.console === 'ascii' && !o.preTyped ? asciiStandIns(text.split(PASTE_END).join('')) : text.split(PASTE_END).join('')
  if (o.preTyped) {
    if (!pasted.trim()) return blocked('empty-message')
    if (!initial.text || initial.collapsed || normalized(initial.text) !== normalized(pasted)) return blocked('draft')
    if (expired()) return blockedWith('preflight-failed', 'deadline')
    if (interrupted()) return blockedWith('input-changed', why())
    mark('pasted')
    return submitOwned()
  }
  if (initial.text) return blocked('draft')
  if (!pasted.trim()) return blocked('empty-message')
  if (expired()) return blockedWith('preflight-failed', 'deadline')
  if (io.beforeInput && !(await io.beforeInput('paste').catch(() => false))) return blocked('authorization-revoked')
  if (interrupted()) return blockedWith('input-changed', why())
  if (expired()) return blockedWith('preflight-failed', 'deadline')
  if (io.beforeInput) {
    const ready = read(), c = ready && input(ready)
    if (!ready) return blocked('screen-unavailable')
    if (menu(ready)) return blocked('menu')
    if (!c) return blocked('composer-unavailable')
    if (c.text) return blocked('draft')
  }
  mark('paste')
  if (!io.write(PASTE_START)) return finish('gone', 'write-refused')
  // oeee2: in win32 input mode a run of characters past plain ASCII goes in as key presses of their own, outside the paste brackets (a
  // console that keeps a paste literal would otherwise type the key sequences as text); the paste opens again for the plain text after it.
  let open = true
  const type = (chunk: string): boolean => {
    if (o.console !== 'win32-input') return io.write(chunk)
    for (const part of splitForConsole(chunk)) {
      if (part.plain) {
        if (!open && !io.write(PASTE_START)) return false
        open = true
        if (!io.write(part.text)) return false
      } else {
        if (open && !io.write(PASTE_END)) return false
        open = false
        if (!io.write(win32Keys(part.text))) return false
      }
    }
    return true
  }
  for (let offset = 0; offset < pasted.length;) {
    // Before the first chunk only the paste brackets were written: nothing of the message is in the terminal, so a stop here is a safe refusal.
    const stop = (reason: DeliveryBlockReason, cause: DeliveryCause): SendResult => { io.write(PASTE_END); return offset === 0 ? blockedWith(reason, cause) : finish('unconfirmed', cause) }
    if (interrupted()) return stop('input-changed', why())
    if (expired()) return stop('preflight-failed', 'deadline')
    if (io.beforeInput && !(await io.beforeInput('paste').catch(() => false))) return stop('authorization-revoked', 'authorization-denied')
    if (interrupted()) return stop('input-changed', why())
    if (expired()) return stop('preflight-failed', 'deadline')
    if (io.beforeInput) { const current = read(); if (!current || menu(current)) return stop(!current ? 'screen-unavailable' : 'menu', !current ? 'screen-unreadable' : 'menu-appeared') }
    let end = Math.min(offset + 1024, pasted.length)
    if (end < pasted.length && /[\uD800-\uDBFF]/.test(pasted[end - 1])) end--
    if (!type(pasted.slice(offset, end))) return finish('gone', 'write-refused')
    offset = end
    if (offset < pasted.length) await sleep(10)
  }
  if (open && !io.write(PASTE_END)) return finish('gone', 'write-refused')
  mark('pasted')
  return submitOwned()

  /** From the words in the box (pasted above, or already typed: preTyped) to a confirmed submit: settle, Enter, read back. */
  async function submitOwned(): Promise<SendResult> {
  const expected = normalized(pasted)
  const currentOwned = (lines: string[]) => {
    const full = input(lines)
    if (full && (full.collapsed || normalized(full.text) === expected)) return full
    // Tail recognition requires external-input ownership tracking, never just a footer.
    return !io.frame && io.interrupted ? ownedComposerTail(lines, pasted) : null
  }
  let previous: string | undefined
  let ownedText: string | undefined
  let settled = false
  let attemptedEnter = false
  // oeee2: the box's text when it is NOT the message, and how many looks in a row it stayed so.
  let other: string | undefined
  let otherLooks = 0
  for (let poll = 0; poll <= Math.ceil(maxSettleMs / settleMs); poll++) {
    await sleep(settleMs)
    if (io.confirmed?.()) return finish('sent', 'confirmed')
    if (interrupted()) return finish('unconfirmed', why())
    if (expired()) return withdraw('deadline')
    const lines = read()
    if (!lines) return io.gone?.() ? finish('gone', 'terminal-gone') : finish('unconfirmed', 'screen-unreadable')
    if (menu(lines)) return finish('unconfirmed', 'menu-appeared')
    const c = currentOwned(lines)
    if (c && previous === c.text) { settled = true; ownedText = c.text; mark('settled'); break }
    previous = c?.text
    // oeee2: a box that holds something other than a piece of the message (characters lost or changed on the way in: 14 Nov, the console
    // had dropped the message's arrows) and stays the same for three looks in a row will not become it. It is taken back out now, while
    // the caller still waits for the outcome, not after the whole budget (96 s: the tool had long said "still in progress" and the text sat
    // in the box). A box that holds a piece of it (the start of a long paste still coming in, a clipped view) is waited for as before.
    const box = c ? undefined : input(lines)?.text
    if (box && box === other) otherLooks++
    else { other = box; otherLooks = box ? 1 : 0 }
    if (o.withdraw && otherLooks >= 3 && other !== undefined && !expected.includes(normalized(other))) return withdraw('not-settled')
  }
  if (!settled) return withdraw('not-settled')
  for (let attempt = 0; attempt < tries; attempt++) {
    if (io.confirmed?.()) return finish('sent', 'confirmed')
    if (interrupted()) return finish('unconfirmed', why())
    if (expired()) return attemptedEnter ? finish('unconfirmed', 'deadline') : withdraw('deadline')
    const lines = read()
    if (!lines) return attemptedEnter ? finish('unconfirmed', 'screen-unreadable') : io.gone?.() ? finish('gone', 'terminal-gone') : finish('unconfirmed', 'screen-unreadable')
    if (menu(lines)) return finish('unconfirmed', 'menu-appeared')
    const c = currentOwned(lines)
    // After an Enter a box that changed may be the message going in late: never taken out then.
    if (!c || c.text !== ownedText) return attemptedEnter ? finish('unconfirmed', 'composer-changed') : withdraw('composer-changed')
    if (io.beforeInput && !(await io.beforeInput('submit').catch(() => false))) return finish('unconfirmed', 'authorization-denied')
    // Network authorization may have yielded while a person typed or a prompt changed.
    if (interrupted()) return finish('unconfirmed', why())
    if (expired()) return attemptedEnter ? finish('unconfirmed', 'deadline') : withdraw('deadline')
    const fresh = read()
    if (!fresh) return finish('unconfirmed', 'screen-unreadable')
    if (menu(fresh)) return finish('unconfirmed', 'menu-appeared')
    if (currentOwned(fresh)?.text !== ownedText) return attemptedEnter ? finish('unconfirmed', 'composer-changed') : withdraw('composer-changed')
    attemptedEnter = true
    mark(`enter-${attempt + 1}` as DeliveryMark)
    if (!io.write('\r')) return finish('unconfirmed', 'write-refused')
    // Submit redraws can temporarily erase the whole input box. Observe for a
    // bounded window; missing input or running output alone is never acceptance.
    let unchangedOwned = false
    for (let waited = 0; waited < 3000;) {
      const interval = Math.min(checkMs, 3000 - waited)
      // With claude's own word available it is looked for every 100 ms (the hook lands within about 110 ms), the box only every checkMs.
      if (io.confirmed) for (let left = interval; left > 0; left -= 100) { await sleep(Math.min(100, left)); if (io.confirmed()) return finish('sent', 'confirmed') }
      else await sleep(interval)
      waited += interval
      if (io.confirmed?.()) return finish('sent', 'confirmed')
      if (interrupted()) return finish('unconfirmed', why())
      if (expired()) return finish('unconfirmed', 'deadline')
      if (io.gone?.()) return finish('unconfirmed', 'terminal-gone')
      const after = read()
      if (!after) continue
      if (menu(after)) return finish('unconfirmed', 'menu-appeared')
      const next = input(after)
      if (!next) continue
      if (!next.text) { mark(`readback-${attempt + 1}` as DeliveryMark); return finish('sent', 'confirmed') }
      if ((!next.collapsed && normalized(next.text) !== expected) || next.text !== ownedText) return finish('unconfirmed', 'text-changed-after-enter')
      unchangedOwned = true
      mark(`readback-${attempt + 1}` as DeliveryMark)
      break
    }
    // Retry Enter only with the same readable owned text, exactly as before.
    // An absent/clipped/unreadable box never authorizes another Enter.
    if (!unchangedOwned) return finish('unconfirmed', 'box-unreadable-after-enter')
  }
  // Three Enters and the box still holds exactly the message (read back after each): it did not go in. Taken out only while it still does.
  return withdraw('enter-attempts-exhausted', ownedText)

  /**
   * oeee2 (14 Nov 2026, Shubham: "This happened before also."): a message that did not go in never stays in the box blocking the chat. It is
   * taken back out when nothing but this send typed into the chat since its paste (no terminal input: interrupted() is false, the chat's
   * input epoch never moved) and no question is on the screen: Backspace only (never Esc, never Ctrl+C), at most as many as were typed (plus
   * a few), in rounds, each followed by a look at the box. A box that reads empty ends the send 'blocked' with 'withdrawn': nothing was
   * submitted, safe to send again (the page keeps his draft; a tool caller gets the words). Anything else (someone typed, a menu, the box
   * unreadable, `holds` no longer in it, a box that does not empty within WITHDRAW_MS) ends it 'unconfirmed' as before, with what is left.
   * Never for words typed by someone else (preTyped), and never after a changed box following an Enter (the message may be going in).
   */
  async function withdraw(cause: DeliveryCause, holds?: string): Promise<SendResult> {
    if (!o.withdraw || o.preTyped) return finish('unconfirmed', cause)
    mark('withdraw')
    const until = Date.now() + WITHDRAW_MS
    let left = [...pasted].length + 4
    for (let round = 0; round < 200; round++) {
      if (io.confirmed?.()) return finish('sent', 'confirmed')
      if (interrupted()) return finish('unconfirmed', why())
      if (io.gone?.()) return finish('unconfirmed', 'terminal-gone')
      const lines = read()
      if (!lines) return finish('unconfirmed', cause)
      if (menu(lines)) return finish('unconfirmed', 'menu-appeared')
      const box = input(lines)
      if (!box) return finish('unconfirmed', cause)
      if (round === 0 && holds !== undefined && currentOwned(lines)?.text !== holds) return finish('unconfirmed', cause)
      if (!box.text) {
        // Empty before a single Backspace: the message is not in the box, and where it went is not known. Nothing to take out.
        if (round === 0) return finish('unconfirmed', cause)
        mark('withdrawn')
        io.onBlocked?.('withdrawn')
        return finish('blocked', cause)
      }
      if (Date.now() >= until) break
      if (left > 0) {
        const n = Math.min(left, WITHDRAW_ROUND)
        if (!io.write(BACKSPACE.repeat(n))) return finish('unconfirmed', cause)
        left -= n
      }
      // Its own short waits (never longer than a look after Enter): the send's budget may be spent already (a 'deadline' is taken out after it).
      await io.sleep(Math.min(left > 0 ? 150 : 300, checkMs))
    }
    return finish('unconfirmed', cause)
  }
  }
}
