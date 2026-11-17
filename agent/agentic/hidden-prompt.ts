import { createInterface, type Interface } from 'node:readline'

// The terminal prompts of the Accounts command (agent/scripts/accounts.ts), with a HIDDEN question that is really hidden.
// THE FAULT THIS REPAIRS (found 17 Nov 2026, order oe631 / the migration runner's password prompt): the command made ONE readline interface for its questions and, for a password, only PAUSED it and read the keys raw
// by itself. A paused readline interface still listens to the keys once the stream is resumed, and in terminal mode it ECHOES every character it hears: so a password typed at a prompt that promised "no echo" came
// back out on the screen, in clear. Proved with a throwaway string in a pseudo-terminal: 18 of 18 characters were echoed; with the interface closed first, 0 of 18. The repair: nothing else may listen while a hidden
// answer is typed, so the interface is CLOSED before the hidden read and made again for the next question. The typed text is held in memory only and is never written anywhere.

export interface TtyInput extends NodeJS.ReadableStream {
  isTTY?: boolean
  setRawMode?(mode: boolean): unknown
}

export interface Prompter {
  ask(question: string): Promise<string>
  /** Reads one line with no echo (a password). Rejects when the input is not a terminal. */
  askHidden(question: string): Promise<string>
  close(): void
}

export function createPrompter(o: { input: TtyInput; output: NodeJS.WritableStream; exit?: (code: number) => void }): Prompter {
  let rl: Interface | null = null
  const exit = o.exit ?? ((code: number) => process.exit(code))
  const ensure = (): Interface => (rl ??= createInterface({ input: o.input, output: o.output, terminal: Boolean(o.input.isTTY) }))
  return {
    ask: question => new Promise<string>(resolve => ensure().question(question, answer => resolve(answer))),

    askHidden: question =>
      new Promise<string>((resolve, reject) => {
        const input = o.input
        if (!input.isTTY || typeof input.setRawMode !== 'function') return reject(new Error('A password is typed in a terminal (no echo). Run this command in one.'))
        // Nothing else may listen to the keys while a password is typed: in terminal mode readline echoes everything it hears.
        rl?.close()
        rl = null
        o.output.write(question)
        let typed = ''
        input.setRawMode(true)
        input.resume()
        input.setEncoding('utf8')
        const onData = (chunk: string | Buffer) => {
          for (const c of String(chunk)) {
            if (c === '\r' || c === '\n' || c === '\u0004') {
              input.setRawMode?.(false)
              input.off('data', onData)
              input.pause()
              o.output.write('\n')
              return resolve(typed)
            }
            if (c === '\u0003') {
              input.setRawMode?.(false)
              input.off('data', onData)
              exit(130)
              return
            }
            if (c === '\u007f' || c === '\b') typed = typed.slice(0, -1)
            else typed += c
          }
        }
        input.on('data', onData)
      }),

    close() {
      rl?.close()
      rl = null
    },
  }
}
