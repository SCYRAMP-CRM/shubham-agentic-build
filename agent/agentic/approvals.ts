import { createHash } from 'node:crypto'
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readSync, statSync } from 'node:fs'
import path from 'node:path'
import type { ApprovalLogEntry } from '../../shared/approvals.ts'
import type { ChatMenu } from '../../shared/chat.ts'
import { findMenu } from './screen.ts'

// F-076: reading what a waiting chat asks, from its screen text, and the log of what was answered and sent.

const BOX = /[│┃╭╮╰╯┌┐└┘├┤┬┴┼]/g
const RULES = /[─━═]{3,}/g
const ESC_FOOTER_RE = /\besc to cancel\b/i
/**
 * A menu option that LEAVES claude: "No, exit", "Exit Claude Code", "Quit". On a prompt that has one, Esc is that option (claude's confirm select starts on its
 * "no" and Esc takes it), so a generic "Cancel" there would be an exit under another name. A second signal only, on prompts whose menu was read; see promptOf.
 */
const EXIT_LABEL_RE = /^(?:no,?\s+)?(?:exit|quit)\b/i
/** How many lines above the options are kept as what the prompt is about. */
const CONTEXT_LINES = 28

/**
 * What a chat's screen asks: its numbered menu (screen.ts), the lines above it (the command, the file, the
 * tool), and an id made of both. The id is what an answer names: if the prompt has changed by then (the same
 * "Do you want to proceed?" for another command), the id differs and the answer is refused.
 */
export function promptOf(screen: string): { menu: ChatMenu | null; context: string; id: string; cancellable: boolean } {
  const lines = screen.split(/\r?\n/)
  // A footer that says "Esc to cancel" among the last lines drawn: Esc closes this prompt (on a permission prompt that means No).
  const escFooter = lines
    .filter(l => l.trim() !== '')
    .slice(-4)
    .some(l => ESC_FOOTER_RE.test(l))
  const found = findMenu(lines)
  const menu = found?.menu ?? null
  // SAFETY FIX (17 Nov 2026): the generic "Cancel (Esc)" is offered ONLY for a prompt whose menu was READ. A prompt we cannot read is a prompt whose keys we do not
  // know, and on claude 2.1.326's "Adding a new directory" prompt (an unnumbered select that starts on "No, exit") Esc IS "No, exit": it ends the chat's claude. That
  // prompt's menu was not read, so the card offered "Cancel (Esc)" and nothing else, and the only button on the card ended the chat. An unread prompt now offers no
  // button at all ("answer it in the chat itself"); it needs no list of words to maintain, so a reworded exit option cannot slip through. On a prompt that IS read,
  // an option that leaves claude ("No, exit", "Quit") is a second signal: Esc is that option, so no Cancel there either.
  const cancellable = escFooter && menu !== null && !menu.options.some(o => EXIT_LABEL_RE.test(o.label))
  const tidy = (rows: string[]) =>
    rows
      .map(l => l.replace(BOX, ' ').replace(RULES, ' ').replace(/\s+$/, '').replace(/^\s{0,2}/, ''))
      .filter(l => l.trim() !== '')
  // The context is what comes before the menu's first option (or the whole screen when there is no menu to press).
  const clean = tidy(found ? lines.slice(0, found.first) : lines)
  const context = clean.slice(Math.max(0, clean.length - CONTEXT_LINES)).join('\n').trim()
  const basis = JSON.stringify({ context, q: menu?.question ?? '', h: menu?.hint ?? '', o: menu?.options.map(o => [o.n, o.label]) ?? [] })
  return { menu, context, id: createHash('sha1').update(basis).digest('hex').slice(0, 16), cancellable }
}

/** An answer's option is one the prompt has, and the prompt is one buttons can answer. */
export const answerable = (menu: ChatMenu | null) => menu !== null && !menu.multi && menu.options.length > 0

export interface ApprovalLog {
  add(e: Omit<ApprovalLogEntry, 'at'>): ApprovalLogEntry
  /** Newest first. */
  list(limit?: number): ApprovalLogEntry[]
}

const TAIL = 512 * 1024

/** The log: one JSON line per answer or send, in one file, kept (never rewritten); a read looks at its end. */
export function createApprovalLog(file: string, now = () => new Date()): ApprovalLog {
  mkdirSync(path.dirname(file), { recursive: true })
  return {
    add(e) {
      const entry: ApprovalLogEntry = { at: now().toISOString(), ...e, detail: e.detail.slice(0, 2000) }
      appendFileSync(file, `${JSON.stringify(entry)}\n`)
      return entry
    },
    list(limit = 100) {
      if (!existsSync(file)) return []
      const size = statSync(file).size
      const from = Math.max(0, size - TAIL)
      const buf = Buffer.alloc(size - from)
      const fd = openSync(file, 'r')
      try {
        readSync(fd, buf, 0, buf.length, from)
      } finally {
        closeSync(fd)
      }
      const rows = buf.toString('utf8').split('\n')
      // A read that starts in the middle of a row drops that row.
      if (from > 0) rows.shift()
      const out: ApprovalLogEntry[] = []
      for (let i = rows.length - 1; i >= 0 && out.length < limit; i--) {
        if (!rows[i]) continue
        try {
          out.push(JSON.parse(rows[i]) as ApprovalLogEntry)
        } catch {
          // A torn row.
        }
      }
      return out
    },
  }
}
