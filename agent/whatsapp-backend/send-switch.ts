import { readFileSync } from 'node:fs'
import { writeAtomic } from '../config.ts'
import type { Logger } from '../log.ts'

// Order obf15 (oWA S2): the switch for sending through the WhatsApp backend. A file beside the backend's state (<dir>/sending.json), OFF unless it says exactly
// {"on": true}: missing, unreadable, or anything else is OFF (a switch that fails must fail safe). It is set only by a signed-in person's request (proxy.ts), and
// setting it is not enough to send: the key and the ticket (send-ticket.ts) are what the backend checks.

export interface SendSwitch {
  on(): boolean
  /** Records who switched it, and when. Throws when the file cannot be written: ON is then not on (the caller does not hand the backend a key), but OFF is off all the same. */
  set(on: boolean, by: string): void
  /** Whether a file was there and could not be read as the switch (so it counts as OFF and says so). */
  unreadable(): boolean
}

export function createSendSwitch(file: string, log: Pick<Logger, 'warn'>, now: () => number = Date.now): SendSwitch {
  let on = false
  let broken = false
  try {
    const v = JSON.parse(readFileSync(file, 'utf8')) as { on?: unknown }
    on = v !== null && typeof v === 'object' && v.on === true
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      broken = true
      log.warn(`WhatsApp sending: the switch (${file}) could not be read, so sending stays OFF until a person chooses`)
    }
  }
  return {
    on: () => on,
    unreadable: () => broken,
    set(next, by) {
      // OFF is in force the moment it is asked for, even if it cannot be written down (a switch that cannot say "off" must not stay on); ON counts only once it is written.
      if (!next) on = false
      writeAtomic(file, `${JSON.stringify({ on: next, at: new Date(now()).toISOString(), by: by.replace(/[\r\n]/g, ' ').slice(0, 200) }, null, 2)}\n`)
      on = next
      broken = false
    },
  }
}
