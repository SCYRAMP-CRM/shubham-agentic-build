import { createScreen, type Screen } from './agentic/screen.ts'

// Order o68f0: what an SSH terminal shows, as lines of text, for the Assistant's ssh_read (and the safety checks of ssh_type). It is the chats'
// own screen model (agentic/screen.ts: cursor moves, erases, wrapping), with two things a shell needs on top:
//   - the lines that scroll off the top are kept (the last HISTORY_MAX), so a long command's output can be read back;
//   - full-screen programs (top, less, vim, htop) draw on the terminal's ALTERNATE screen (CSI ?1049h / ?1047h / ?47h): they get a screen of
//     their own, and when they leave (…l) the shell's screen is back as it was, as in a real terminal.
// Raw bytes for a page that attaches later are kept by the session (pc-ssh-term.ts), not here.

const HISTORY_MAX = 2000
// The alternate screen's switches. A switch can be cut in two by the stream's chunks: the tail that may be the start of one is kept for the next.
// oxlint-disable-next-line no-control-regex
const ALT = /\x1b\[\?(?:1049|1047|47)([hl])/g
// oxlint-disable-next-line no-control-regex
const PARTIAL = /\x1b(?:\[(?:\?(?:1(?:0(?:4(?:[79])?)?)?|4(?:7)?)?)?)?$/

export interface SshText {
  write(data: string): void
  resize(cols: number, rows: number): void
  /** The last `n` lines: the scrolled-off history and the screen (its trailing blank lines left out); a full-screen program: its screen only. */
  lines(n: number): string[]
  /** What the screen shows now, top to bottom (trailing blank lines left out). */
  screen(): string[]
  /** Whether a full-screen program has the terminal (the alternate screen). */
  alt(): boolean
  readonly cols: number
  readonly rows: number
}

const trimEnd = (ls: string[]) => {
  let end = ls.length
  while (end > 0 && !ls[end - 1]) end--
  return ls.slice(0, end)
}

export function createSshText(cols = 100, rows = 30): SshText {
  const history: string[] = []
  const main: Screen = createScreen(cols, rows, {
    onScrollOff: line => {
      history.push(line)
      if (history.length > HISTORY_MAX) history.splice(0, history.length - HISTORY_MAX)
    },
  })
  let alt: Screen | null = null
  let carry = ''

  const target = () => alt ?? main
  function feed(chunk: string) {
    let at = 0
    ALT.lastIndex = 0
    for (let m = ALT.exec(chunk); m; m = ALT.exec(chunk)) {
      if (m.index > at) target().write(chunk.slice(at, m.index))
      if (m[1] === 'h') {
        if (!alt) alt = createScreen(main.cols, main.rows)
      } else alt = null
      at = m.index + m[0].length
    }
    if (at < chunk.length) target().write(chunk.slice(at))
  }

  return {
    get cols() {
      return main.cols
    },
    get rows() {
      return main.rows
    },
    write(data) {
      let text = carry + data
      carry = ''
      const tail = PARTIAL.exec(text)
      if (tail && tail[0].length > 0) {
        carry = tail[0]
        text = text.slice(0, tail.index)
      }
      if (text) feed(text)
    },
    resize(c, r) {
      main.resize(c, r)
      alt?.resize(c, r)
    },
    lines(n) {
      const cap = Math.max(1, Math.min(Math.floor(n) || 1, HISTORY_MAX))
      if (alt) return trimEnd(alt.lines()).slice(-cap)
      return [...history, ...trimEnd(main.lines())].slice(-cap)
    },
    screen() {
      return trimEnd(target().lines())
    },
    alt: () => alt !== null,
  }
}
