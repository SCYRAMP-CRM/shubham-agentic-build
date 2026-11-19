import { createHash } from 'node:crypto'
import type { CrmLogin } from '../agentic/crmproxy.ts'
import type { Ledger, LedgerRow } from './ledger.ts'

// Order ofedf: the reporter sends the ledger's changed rows to the CRM, as the old app did: POST v1/org/christopher-usage (rows, each
// hour's running total) and POST v1/org/christopher-usage/limits (Claude's own 5-hour and week percentages, per subscription).
// Every call goes with the signed-in PERSON's own CRM session (the CRM files each row under that person); a person who is not
// signed in here keeps their rows until they are. The CRM refuses agents' calls, so this never uses a token. Nothing here logs a
// cookie or a body.

/** Rows per request (the CRM takes up to 2000; batches keep one bad row from holding the rest back). */
export const ROWS_PER_REPORT = 200
/** Readings per limits request (the CRM takes up to 20). */
export const READINGS_PER_REPORT = 20
/** When the CRM says it is not there yet (404, 503) the usage waits this long. */
export const CRM_PAUSE_MS = 30 * 60 * 1000
/** A limits reading the same as the last one sent is not sent again for this long. */
export const LIMITS_REPEAT_MS = 15 * 60 * 1000
/** The same diagnostic is not said again for this long. */
export const NOTE_EVERY_MS = 6 * 60 * 60 * 1000

export interface Window {
  /** 0-100 as Claude shows it; null when Claude did not say. */
  percent: number | null
  /** When the window resets (ISO), or null. */
  resetsAt: string | null
}

export interface LimitsReading {
  /** '' for the PC's own Claude login, else the CRM subscription's id. */
  subscriptionKey: string
  observedAt: string
  fiveHour: Window | null
  week: Window | null
}

export interface CrmAnswer {
  status: number
  body?: unknown
}

export interface Reporter {
  /** Sends what changed. Never throws: a failure is logged and tried again later. */
  flush(): Promise<void>
  /** Remembers the newest limits reading for a subscription (sent on the next flush). */
  limits(reading: LimitsReading): void
  /** Only for tests and the page's own status: the CRM pause, if any. */
  pausedUntil(): number | null
}

export interface ReporterOptions {
  ledger: Ledger
  /** The CRM login of a person who is signed in here, or null (their rows wait). */
  loginFor(userId: string): CrmLogin | null
  /** Any signed-in person's login, for the limits (the account is per subscription, not per person); null when nobody is. */
  anyLogin(): CrmLogin | null
  /** The build tag the CRM keeps with the rows (no dots: the CRM's own form). Null when the build is not known yet. */
  build(): { id: string; label: string } | null
  /** One call to the CRM with this login, by path under the CRM (e.g. 'v1/org/christopher-usage'). */
  post(login: CrmLogin, path: string, body: unknown): Promise<CrmAnswer>
  now?: () => number
  log?: { info(m: string): void; warn(m: string): void }
}

export function createReporter(o: ReporterOptions): Reporter {
  const now = o.now ?? Date.now
  let pauseUntil: number | null = null
  const latest = new Map<string, { reading: LimitsReading; hash: string; sentAt: number | null }>()

  const paused = () => pauseUntil !== null && now() < pauseUntil
  // A diagnostic is said once per key per six hours, never once per pass (the passes run every minute).
  const said = new Map<string, number>()
  const note = (key: string, message: string) => {
    const t = now()
    const last = said.get(key)
    if (last !== undefined && t - last < NOTE_EVERY_MS) return
    said.set(key, t)
    o.log?.warn(message)
  }
  const pause = (why: string) => {
    pauseUntil = now() + CRM_PAUSE_MS
    o.log?.warn(`claude usage: the CRM is not ready (${why}); trying again in 30 minutes`)
  }

  async function sendRows(rows: LedgerRow[]) {
    // One person's rows go with that person's login; the build tag is the same for all.
    const build = o.build()
    if (!build) return
    const byUser = new Map<string, LedgerRow[]>()
    for (const r of rows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r])
    for (const [userId, mine] of byUser) {
      const login = o.loginFor(userId)
      if (!login) {
        // Not said with the person's id: only how much is waiting, and that it waits for them to sign in here.
        note(`waiting:${userId}`, `claude usage: ${mine.length} hour row${mine.length === 1 ? '' : 's'} wait${mine.length === 1 ? 's' : ''} until that person signs in on this PC`)
        continue
      }
      for (let i = 0; i < mine.length; i += ROWS_PER_REPORT) {
        const part = mine.slice(i, i + ROWS_PER_REPORT)
        const body = {
          build,
          rows: part.map(r => ({ hour: r.hour, costUsd: r.costUsd, sessions: r.sessions, subscriptionKey: r.subscriptionKey })),
        }
        let answer: CrmAnswer
        o.ledger.beginSend(part) // saved before the post: a process killed after the CRM took the rows must not send them again under a new build (F-288)
        try {
          answer = await o.post(login, 'v1/org/christopher-usage', body)
        } catch (e) {
          o.ledger.abortSend(part)
          o.log?.warn(`claude usage: a report did not reach the CRM (${e instanceof Error ? e.message : String(e)})`)
          return
        }
        if (answer.status === 404 || answer.status === 503) {
          o.ledger.abortSend(part)
          return pause(`status ${answer.status}`)
        }
        if (answer.status < 200 || answer.status >= 300) {
          o.ledger.abortSend(part)
          o.log?.warn(`claude usage: the CRM refused a report (status ${answer.status}); it is tried again later`)
          return
        }
        o.ledger.markSent(part)
        o.log?.info(`claude usage: ${part.length} hour row${part.length === 1 ? '' : 's'} reported`)
      }
    }
  }

  async function sendLimits() {
    const build = o.build()
    if (!build) return
    const login = o.anyLogin()
    if (!login) return
    const all = [...latest.values()]
    if (all.length === 0) return
    // A reading not sent yet, or the same one as long ago as LIMITS_REPEAT_MS, goes now (a new reading is sent as soon as there is one).
    const due = all.filter(x => x.sentAt === null || now() - x.sentAt >= LIMITS_REPEAT_MS)
    if (due.length === 0) return
    const readings = due.slice(0, READINGS_PER_REPORT).map(x => x.reading)
    const hash = createHash('sha256').update(JSON.stringify(readings)).digest('hex')
    let answer: CrmAnswer
    try {
      answer = await o.post(login, 'v1/org/christopher-usage/limits', { build, readings })
    } catch (e) {
      o.log?.warn(`claude usage: the limits did not reach the CRM (${e instanceof Error ? e.message : String(e)})`)
      return
    }
    if (answer.status === 404 || answer.status === 503) return pause(`limits, status ${answer.status}`)
    if (answer.status === 400) {
      // An older CRM takes one reading in the single form (the newest one), the way the old app fell back.
      const newest = due.reduce((a, b) => (Date.parse(a.reading.observedAt) >= Date.parse(b.reading.observedAt) ? a : b)).reading
      const one = { build, observedAt: newest.observedAt, fiveHour: newest.fiveHour, week: newest.week, subscriptionKey: newest.subscriptionKey }
      try {
        const again = await o.post(login, 'v1/org/christopher-usage/limits', one)
        if (again.status < 200 || again.status >= 300) return o.log?.warn(`claude usage: the CRM refused the limits (status ${again.status})`)
      } catch {
        return
      }
    } else if (answer.status < 200 || answer.status >= 300) {
      o.log?.warn(`claude usage: the CRM refused the limits (status ${answer.status})`)
      return
    }
    for (const x of due) x.sentAt = now()
    o.log?.info(`claude usage: ${readings.length} limits reading${readings.length === 1 ? '' : 's'} reported (${hash.slice(0, 8)})`)
  }

  let running = false
  return {
    async flush() {
      if (running || paused()) return
      running = true
      try {
        o.ledger.prune(now())
        const rows = o.ledger.pending()
        if (rows.length > 0) await sendRows(rows)
        const unfiled = o.ledger.unfiledLaunches()
        if (unfiled > 0) note(`unfiled:${unfiled}`, `claude usage: ${unfiled} chat process${unfiled === 1 ? '' : 'es'} reported cost with no person, so it is not filed (sign-in or the chat's owner is missing)`)
        if (!paused()) await sendLimits()
      } finally {
        running = false
      }
    },
    limits(reading) {
      const hash = createHash('sha256').update(JSON.stringify(reading)).digest('hex')
      const prev = latest.get(reading.subscriptionKey)
      latest.set(reading.subscriptionKey, { reading, hash, sentAt: prev && prev.hash === hash ? prev.sentAt : null })
    },
    pausedUntil: () => (paused() ? pauseUntil : null),
  }
}
