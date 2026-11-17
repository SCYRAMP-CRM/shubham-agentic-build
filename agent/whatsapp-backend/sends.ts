import { apiError, type MountRequest } from '../api.ts'
import type { SendsOptions } from './proxy.ts'
import type { SendSwitch } from './send-switch.ts'
import type { BackendSupervisor } from './supervisor.ts'

// Order obf15 (oWA S2): what the agent hands the proxy to gate a send (proxy.ts SendsOptions): the switch, the person, the ticket, and the ORDER in which ON and OFF happen.
// - ON: the setting is written first. An ON that cannot be written down does not count, and the backend is never given a key for it.
// - OFF: it is in force first (the switch, then the backend's key is taken away), whether or not the setting can be written down; when it cannot, he is told so, because
//   a switch left saying ON would come back ON after a restart. A capability that has been asked to stop never waits on a file.
// - At start: a switch he left ON gives the backend its key now (or the moment it says it is ready); a missing, unreadable or OFF one gives nothing.

const why = (e: unknown) => {
  const code = (e as NodeJS.ErrnoException | undefined)?.code
  return typeof code === 'string' ? code : 'an error'
}

export interface SendsParts {
  sw: SendSwitch
  backend: Pick<BackendSupervisor, 'sending' | 'ticket'>
  /** The signed-in administrator behind this request, or it throws (agentic.humanProof('wa-send', ...)). */
  human(req: MountRequest): string
}

export function createSends(o: SendsParts): SendsOptions {
  const { sw, backend } = o
  if (sw.on()) void backend.sending(true)
  return {
    on: () => sw.on(),
    human: req => o.human(req),
    ticket: (f, by) => backend.ticket(f, by),
    async set(on, by) {
      if (on) {
        try {
          sw.set(true, by)
        } catch (e) {
          throw apiError(500, `Sending was not switched on: the setting could not be saved (${why(e)}).`)
        }
        return backend.sending(true)
      }
      let unsaved: unknown = null
      try {
        sw.set(false, by)
      } catch (e) {
        unsaved = e
      }
      const confirmed = await backend.sending(false)
      if (unsaved !== null) throw apiError(500, `Sending is OFF now, but that could not be saved (${why(unsaved)}): it may come back ON after a restart. Switch it off again once that is fixed.`)
      return confirmed
    },
  }
}
