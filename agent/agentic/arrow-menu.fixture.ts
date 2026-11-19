// Order o5d4e: screens of claude's UNNUMBERED selects (the trust prompt for an added directory) and of the AskUserQuestion form's Review step, for the tests.
//
// STAMPED (Lead, 17 Nov 2026): every fixture says which Claude Code drew it, at what terminal size, and HOW the screen was got, because the recorded
// fixture this repo had (screen.fixture.ts) came from Claude Code 2.1.316 while 2.1.326 is installed, and nobody could tell which one a test was trusting.
// - source 'constructed': built by hand from the bundled source of the installed Claude Code (2.1.326: its select component drawn with hideIndexes
//   for the trust prompt, `yne` for the Review step), NOT recorded from a running claude. These shapes are the best reading of that code, not proof
//   of the pixels. The recording is owed after the publish (one throwaway chat on the Server floor, Chat 2, cancelled at the Review step, nothing
//   submitted); when it exists the recorded screens replace these, with source 'recorded', and the parser is widened only on what they show.
// - source 'recorded': taken from a running claude of that version.

export interface ScreenFixture {
  /** The Claude Code version that drew it (or that this was read from). */
  version: string
  source: 'recorded' | 'constructed'
  /** The terminal size it is drawn for (Lead's condition 6: a screen model is width-dependent, so a screen without its size is half a stamp). */
  size: { cols: number; rows: number }
  lines: string[]
}

/** The size the app's own chats are drawn at, and the size agent/scripts/record-screens.ts records at (record-screens.test.ts pins that they agree). */
export const SCREEN_SIZE = { cols: 120, rows: 32 }

const VERSION = '2.1.326'
const RULE = '─'.repeat(100)
const fixture = (source: ScreenFixture['source'], lines: string[]): ScreenFixture => ({ version: VERSION, source, size: { ...SCREEN_SIZE }, lines })
const pointer = (labels: string[], at: number) => labels.map((l, i) => (i === at ? ` ❯ ${l}` : `   ${l}`))

/** The trust prompt for an added directory: "No, exit" is first and the pointer's default (cancelFirst), "Yes, add it" second. `at`: the pointer's place. */
export const trustPrompt = (at = 0, o: { rule?: boolean; descriptions?: boolean; no?: string } = {}): ScreenFixture => {
  // `no`: the first option's words. The default is the recorded prompt's own "No, exit" (Esc there EXITS claude); a calm word makes a select whose Esc only cancels (CONSTRUCTED, stamped so by fixture()).
  const options = [o.no ?? 'No, exit', 'Yes, add it']
  const rows = pointer(options, at)
  if (o.descriptions) {
    rows.splice(1, 0, '     Leave it out and stop here.')
    rows.push('     Let claude read and edit files in it.')
  }
  return fixture('constructed', [
    ...(o.rule ? [RULE] : []),
    ' Adding a new directory',
    '',
    ' Claude Code will be able to read, edit, and execute files in C:\\Users\\x\\uploads.',
    ' Is this a directory you created or one you trust?',
    '',
    ...rows,
    '',
    ' Enter to confirm · Esc to cancel',
  ])
}

/** A select with any options, for the executor's tests: the pointer on `at`. */
export const selectScreen = (question: string, labels: string[], at: number): ScreenFixture =>
  fixture('constructed', [` ${question}`, '', ...pointer(labels, at), '', ' Enter to confirm · Esc to cancel'])

/**
 * The AskUserQuestion form's Review step after two answers: the confirm select with "Submit answers" first. By the installed claude's source its
 * select is drawn WITH numbers and the Review component draws no footer line of its own (`footer: false`); `numbered: false` and a footer are the
 * other shapes it might have, so the reader is tested against all of them until the real screen is recorded.
 */
export const reviewStep = (o: { numbered: boolean; at?: number; footer?: boolean }): ScreenFixture => {
  const at = o.at ?? 0
  const labels = ['Submit answers', 'Cancel']
  return fixture('constructed', [
    ' ← ✔ Color  ✔ Size  ✔ Submit →',
    '',
    ' Review your answers',
    '',
    '  Which color?',
    '    → Red',
    '  Which size?',
    '    → Large',
    '',
    ' Ready to submit your answers?',
    '',
    ...(o.numbered ? labels.map((l, i) => (i === at ? ` ❯ ${i + 1}. ${l}` : `   ${i + 1}. ${l}`)) : pointer(labels, at)),
    ...(o.footer === false ? [] : ['', ' Enter to select · Tab/Arrow keys to navigate · Esc to cancel']),
  ])
}
