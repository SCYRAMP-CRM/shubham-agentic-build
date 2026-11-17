import { randomUUID } from 'node:crypto'
import { WA_EVENTS_KEEP, WA_EVENTS_WAIT_MAX_MS, type WaEvent, type WaEvents } from '../../shared/whatsapp.ts'

// Order oWA S7: what happens on WhatsApp (a message comes, a tick changes), kept in a ring in this backend's MEMORY so the page can follow it live over plain HTTP: it asks "what is new since N?" and, when
// there is nothing, the ask waits a few seconds for the next event (a long poll). It is a ring, not a log: the newest WA_EVENTS_KEEP only, never written to disk, never logged (nothing about a message,
// a chat or a number is). A page that was away longer than the ring remembers, or that last asked a backend that has since restarted, is told so (`reset`): it reads its lists again and carries on.

export interface EventRing {
  /** This run of the backend (new on every start): a position from another run means events may have been missed. */
  readonly run: string
  /** Something happened: number it, keep it, and answer whoever is waiting. */
  add(ev: WaEvent): void
  /** The number of the last event (0: none yet). */
  seq(): number
  /**
   * What is new since `since` (null: this is the first ask: answer at once with where the ring is, replaying nothing, so the page can read its lists AFTER this and miss nothing). With nothing
   * new and `waitMs` > 0 it waits for the next event, at most the cap.
   */
  read(o: { since: number | null; run: string | null; waitMs: number }): Promise<WaEvents>
  /** Answer everyone who is waiting now (the backend is shutting down). */
  close(): void
}

export function createEventRing(o: { keep?: number; run?: string; maxWaitMs?: number } = {}): EventRing {
  const keep = o.keep ?? WA_EVENTS_KEEP
  const run = o.run ?? randomUUID()
  const maxWait = o.maxWaitMs ?? WA_EVENTS_WAIT_MAX_MS
  let seq = 0
  const kept: { seq: number; ev: WaEvent }[] = []
  const waiters = new Set<() => void>()

  const answer = (since: number | null, askedRun: string | null): WaEvents => {
    if (since === null) return { run, seq, events: [] }
    // Nothing missed means every event after `since` is still kept: the oldest kept is `since + 1` or older. An empty ring has missed nothing for a position that is not in the future.
    const oldest = kept.length ? kept[0].seq : seq + 1
    if (askedRun !== run || since > seq || since < oldest - 1) return { run, seq, events: [], reset: true }
    return { run, seq, events: kept.filter(k => k.seq > since).map(k => k.ev) }
  }

  return {
    run,
    add(ev) {
      seq += 1
      kept.push({ seq, ev })
      if (kept.length > keep) kept.splice(0, kept.length - keep)
      for (const w of [...waiters]) w()
    },
    seq: () => seq,
    async read({ since, run: askedRun, waitMs }) {
      const now = answer(since, askedRun)
      if (since === null || now.reset || now.events.length > 0 || !(waitMs > 0)) return now
      await new Promise<void>(resolve => {
        const done = () => {
          clearTimeout(timer)
          waiters.delete(done)
          resolve()
        }
        const timer = setTimeout(done, Math.min(waitMs, maxWait))
        waiters.add(done)
      })
      return answer(since, askedRun)
    },
    close() {
      for (const w of [...waiters]) w()
    },
  }
}
