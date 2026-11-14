/**
 * oeee2 (14 Nov 2026, Shubham: "This happened before also."): orders to a Codex chat on Windows sat typed in its input box, never submitted,
 * and blocked the chat. Codex reads its keys from the Windows console (crossterm). The console turns every character that is not on the
 * keyboard and is not a letter (the arrow every order of the Assistant starts with, a dash, an ellipsis, curly quotes, a rupee sign...) into
 * an Alt+numpad key sequence whose character comes with the Alt key's RELEASE, or drops it when the console's code page has no byte for it;
 * Codex takes key presses only. So the character never reached the box: Lead's Codex record had all five stuck messages of 14 Nov arriving
 * later (someone pressed Enter by hand) with exactly their arrows missing and nothing else changed. The box never matched what was pasted,
 * so the sender never pressed Enter, and the text stayed in the box.
 *
 * Two ways in, chosen by the agent for its PC (chats.ts):
 * - 'win32-input': a console on this PC asked the terminal for its "win32 input mode" when its chat started (ESC [ ? 9001 h, the first
 *   thing it prints). A console that asks for it reads one key per ESC [ Vk ; Sc ; Uc ; Kd ; Cs ; Rc _ sequence, so each such character goes in as a
 *   key press carrying exactly it, and arrives as typed. Only the press: Codex ignores releases, and a release of one half of a surrogate
 *   pair would break the pair (crossterm pairs the halves it is given in order).
 * - 'ascii': a Windows console that never asked for it (its start no longer in the replay, or an older Windows): the common symbols become
 *   plain-text stand-ins ("->" for the arrow). Letters of any script stay as they are: the console sends them as key presses.
 * Linux and macOS read UTF-8 straight from the terminal: nothing is changed there (no mode).
 */

export type ConsoleInput = 'win32-input' | 'ascii'

/** What the Windows console prints first when it wants the terminal to send win32 input mode keys. */
export const WIN32_INPUT_REQUEST = '\x1b[?9001h'

/** One key press (no release) carrying one UTF-16 unit, in win32 input mode: no virtual key, no scan code, key down, no modifiers, once. */
export const win32KeyDown = (unit: number) => `\x1b[0;0;${unit};1;0;1_`

/** Every UTF-16 unit of `text` as a key press of its own. */
export function win32Keys(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) out += win32KeyDown(text.charCodeAt(i))
  return out
}

/** Printable ASCII, tab and line breaks: what the console passes on as typed on any keyboard layout. */
// oxlint-disable-next-line no-control-regex -- the console's own plain range.
const PLAIN = /^[\t\n\r\x20-\x7e]$/

/**
 * The text split into what is typed as it is (`plain`) and what goes in as key presses (`keys`), in order. Only for 'win32-input'.
 * A surrogate pair stays whole in one `keys` part.
 */
export function splitForConsole(text: string): { plain: boolean; text: string }[] {
  const parts: { plain: boolean; text: string }[] = []
  for (const ch of text) {
    const plain = PLAIN.test(ch)
    const last = parts.at(-1)
    if (last && last.plain === plain) last.text += ch
    else parts.push({ plain, text: ch })
  }
  return parts
}

/** Plain-text stand-ins for the symbols people write most, for a console that cannot take them as key presses ('ascii'). */
const STAND_INS: Record<string, string> = {
  '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '⇐': '<=', '⇔': '<=>', '⟶': '-->', '⟵': '<--',
  '↑': '^', '↓': 'v', '↳': '->', '‣': '>', '▸': '>', '▶': '>', '❯': '>', '›': '>', '‹': '<',
  '—': '--', '–': '-', '‒': '-', '―': '--', '−': '-', '‐': '-', '‑': '-',
  '“': '"', '”': '"', '„': '"', '‟': '"', '«': '"', '»': '"', '‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'", '″': '"',
  '…': '...', '•': '*', '●': '*', '◦': 'o', '·': '-', '∙': '*', '‧': '-',
  '✓': 'v', '✔': 'v', '✅': '[x]', '✗': 'x', '✘': 'x', '❌': '[ ]',
  '×': 'x', '÷': '/', '≤': '<=', '≥': '>=', '≠': '!=', '≈': '~=', '±': '+/-', '∞': 'inf', '°': ' deg', '‰': ' per mille',
  '₹': 'Rs ', '€': 'EUR ', '£': 'GBP ', '¥': 'JPY ', '¢': 'c', '©': '(c)', '®': '(R)', '™': '(TM)', '§': 'S.', '¶': 'P.',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '　': ' ',
  '​': '', '﻿': '', '⁠': '', '⁄': '/',
}

/**
 * For 'ascii': each symbol the console would lose becomes its stand-in, or its compatibility form when that is plain text ("½" is "1/2",
 * "²" is "2"); letters, marks and digits of any script stay (composed first, so an accent travels with its letter). A symbol with neither
 * stays as it is: if the console loses it, the box does not match and the sender takes the message back out (sender.ts).
 */
export function asciiStandIns(text: string): string {
  let out = ''
  for (const ch of text.normalize('NFC')) {
    if (PLAIN.test(ch) || /[\p{L}\p{M}\p{Nd}]/u.test(ch)) { out += ch; continue }
    const known = STAND_INS[ch]
    if (known !== undefined) { out += known; continue }
    const compat = [...ch.normalize('NFKC')].map(c => STAND_INS[c] ?? c).join('')
    out += /^[\x20-\x7e]+$/.test(compat) ? compat : ch
  }
  return out
}
