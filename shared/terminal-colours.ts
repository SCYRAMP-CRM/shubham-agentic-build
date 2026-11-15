// o747c (14 Nov 2026, Shubham: "I hate the theming. Can you see the bottom highlight and message highlight? I want that."): the chats' CLIs in
// their own colours. The app's terminals draw on the dark background Windows Terminal uses by default (its Campbell scheme), in every theme,
// and a CLI that asks the terminal for its colours (OSC 10 / 11: Codex does, to draw the bands behind his message and its input box) is told
// these, by the agent on the chat's PC. Codex draws those bands only once it knows the background. Pure; tested in terminal-colours.test.ts.

/** Windows Terminal's default colours (Campbell): the background and text a CLI is told, and what the page draws behind it. */
export const CLI_BACKGROUND = '#0c0c0c'
export const CLI_FOREGROUND = '#cccccc'

/** The sixteen ANSI colours of the same scheme, in xterm's order. */
export const CLI_PALETTE = {
  black: '#0c0c0c', red: '#c50f1f', green: '#13a10e', yellow: '#c19c00', blue: '#0037da', magenta: '#881798', cyan: '#3a96dd', white: '#cccccc',
  brightBlack: '#767676', brightRed: '#e74856', brightGreen: '#16c60c', brightYellow: '#f9f1a5', brightBlue: '#3b78ff', brightMagenta: '#b4009e', brightCyan: '#61d6d6', brightWhite: '#f2f2f2',
} as const

/** "#0c0c0c" -> "rgb:0c0c/0c0c/0c0c", the form xterm answers in. */
const xrgb = (hex: string) => {
  const h = hex.replace('#', '')
  return `rgb:${[0, 2, 4].map(i => h.slice(i, i + 2).repeat(2)).join('/')}`
}

/** A CLI asking for the terminal's text (10) or background (11) colour, ended by BEL or ST. */
// oxlint-disable-next-line no-control-regex
export const COLOUR_QUERY_RE = /\x1b\](1[01]);\?(\x07|\x1b\\)/g

/** The answer to one query: the same number and the same ending as it was asked with. */
export function colourReply(which: '10' | '11', end: string): string {
  return `\x1b]${which};${xrgb(which === '10' ? CLI_FOREGROUND : CLI_BACKGROUND)}${end}`
}

/** The answers to the colour queries in a piece of terminal output, in order, and the output without them (no page answers them again). */
export function answerColourQueries(data: string): { replies: string[]; output: string } {
  const replies: string[] = []
  const output = data.replace(COLOUR_QUERY_RE, (_q, which: '10' | '11', end: string) => {
    replies.push(colourReply(which, end))
    return ''
  })
  return { replies, output }
}

/** xterm's own answers to colour queries (OSC 10/11/12 with a colour), taken out of what a page types: the agent answers them itself. */
// oxlint-disable-next-line no-control-regex
const COLOUR_REPLY_RE = /\x1b\]1[0-2];rgb:[0-9a-f]{1,4}\/[0-9a-f]{1,4}\/[0-9a-f]{1,4}(?:\x07|\x1b\\)/gi
export const stripColourReplies = (input: string) => input.replace(COLOUR_REPLY_RE, '')
