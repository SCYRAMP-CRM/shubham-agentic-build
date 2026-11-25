import { createHash } from 'node:crypto'
import type { Ledger } from './ledger.ts'
import type { LimitsReading } from './reporter.ts'

// F-352 (step 2): this PC's Claude usage, reported to the CRM BY PC, for the tab "Usage for Server Agentic" (sam-crm-be POST v1/org/agentic-pc-usage). It sits BESIDE the old reporter (reporter.ts), which is not
// touched and goes on sending the same cost per person to the old Usage tab: the PC's report is made from the same ledger (ledger.buckets(), read only), summed over every person and build, so the
// two cannot disagree and nothing is counted twice anywhere.
//
// What a report holds: this PC (its device id and name), the Claude subscription placed on it, Claude's own latest 5-hour and weekly readings for it, and per UTC hour and subscription the cost and the NUMBER of chats
// that were active. NEVER a person's id, a build, a session id, a chat's text, a token or a cookie. The CRM files it under the device, whoever was signed in.
//
// Which CRM login sends it: this PC's own session (crm-session.json) today; the device key of F-351 will replace the login and nothing else here changes (the route and the body are the same).
//
// What the CRM can answer, and what this does about it: 2xx the rows are remembered as sent (a total is SET by the CRM and only grows, so a retry or a restart never double-counts); 404/503 the CRM is not
// ready (its tables are not made yet): wait 30 minutes; 409 the CRM says this PC reports as another person: a fixed sentence once ("ask the owner to assign this PC to you"), and wait an hour (no storm);
// any other refusal: its status in the log and wait 30 minutes. A request that did not arrive waits 5 minutes.

/** Rows per request (the CRM takes up to 200). */
export const PC_ROWS_PER_REPORT = 200
/** When the CRM is not ready (404, 503) or refuses, the report waits this long. */
export const PC_PAUSE_MS = 30 * 60 * 1000
/** The CRM said this PC reports as another person (409): it asks again only this long after. */
export const PC_CONFLICT_PAUSE_MS = 60 * 60 * 1000
/** A request that did not arrive: tried again after this. */
export const PC_RETRY_MS = 5 * 60 * 1000
/** The PC's subscription and readings are sent again at least this often, even when no cost changed (so the tab shows the PC is alive). */
export const PC_HEARTBEAT_MS = 15 * 60 * 1000
/** A change in Claude's readings (a percent moved) is sent at most this often (the status line writes one every few seconds). */
export const PC_LIMITS_MIN_MS = 5 * 60 * 1000
/** The Server's list of the office's PCs is sent at most this often. */
export const PC_KNOWN_EVERY_MS = 60 * 60 * 1000
/** The same diagnostic is said at most this often. */
export const PC_NOTE_EVERY_MS = 6 * 60 * 60 * 1000
/** What the CRM takes as a PC's id (lib/agenticPcUsage.js): 4 to 100 letters, digits or _ . : - , starting with a letter or digit. ONE id it does not take refuses the WHOLE list of PCs, so such an entry is left out of the list. */
export const PC_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{3,99}$/
/** The sentence for a 409: fixed, so no body or name of the CRM's is ever repeated. */
export const PC_ASSIGN_SENTENCE = 'claude usage (per PC): the CRM says this PC reports as another person: ask the owner to assign this PC to you in the CRM'

export interface PcAnswer {
  status: number
}

export interface PcReporterOptions {
  /** The ledger, read only (buckets()). */
  ledger: Pick<Ledger, 'buckets'>
  /** This PC: its device id and name. */
  device(): { id: string; name: string }
  /** The Claude subscription placed on this PC now (its CRM id and name), or null: the PC's own login. */
  placed(): { key: string; name: string | null } | null
  /** Whether this PC holds a CRM login now (the report waits while it does not). */
  signedIn(): boolean
  /** One POST to the CRM with this PC's own session, by path under the CRM (the one route, PATH below). */
  post(path: string, body: unknown): Promise<PcAnswer>
  /** The Server only: every PC it knows (so a PC that never reported can still be assigned a user). Left out on every other PC. */
  knownDevices?(): Array<{ id: string; name: string }>
  now?: () => number
  log?: { info(m: string): void; warn(m: string): void }
}

export interface PcReporter {
  /** Remembers the newest limits reading for a subscription (sent with the next report). */
  limits(reading: LimitsReading): void
  /** Sends what changed. Never throws: a failure is logged and tried again later. */
  flush(): Promise<void>
  /** Only for tests and the page's own status: the pause, if any. */
  pausedUntil(): number | null
}

export interface PcRow {
  hour: string
  subscriptionKey: string
  costUsd: number
  chats: number
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6
const PATH = 'v1/org/agentic-pc-usage'
const DAY = 24 * 60 * 60 * 1000

/** A name as the CRM takes it: one line (a run of control characters or line separators is one space), 1 to 120 characters; null when nothing is left. */
export function oneLine(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null
  let out = ''
  let inRun = false
  for (const ch of v) {
    const c = ch.codePointAt(0)!
    const control = c < 0x20 || c === 0x7f || c === 0x2028 || c === 0x2029
    if (control) {
      if (!inRun) out += ' '
      inRun = true
    } else {
      out += ch
      inRun = false
    }
  }
  out = out.trim().slice(0, 120)
  return out.length > 0 ? out : null
}

/** The ledger's buckets summed over every person and build, per (hour, subscription): the cost, and how many DIFFERENT chats were active (a chat in two builds' rows counts once). Pure. */
export function pcRowsOf(buckets: ReadonlyArray<{ hour: string; subscriptionKey: string; costUsd: number; sessionIds: readonly string[] }>): PcRow[] {
  const by = new Map<string, { hour: string; subscriptionKey: string; cost: number; chats: Set<string> }>()
  for (const b of buckets) {
    const k = `${b.hour}|${b.subscriptionKey}`
    const e = by.get(k) ?? { hour: b.hour, subscriptionKey: b.subscriptionKey, cost: 0, chats: new Set<string>() }
    e.cost += b.costUsd
    for (const s of b.sessionIds) e.chats.add(s)
    by.set(k, e)
  }
  return [...by.values()]
    .map(e => ({ hour: e.hour, subscriptionKey: e.subscriptionKey, costUsd: round6(e.cost), chats: Math.min(e.chats.size, 10_000) }))
    .sort((a, b) => a.hour.localeCompare(b.hour) || a.subscriptionKey.localeCompare(b.subscriptionKey))
}

export function createPcReporter(o: PcReporterOptions): PcReporter {
  const now = o.now ?? Date.now
  let pauseUntil: number | null = null
  let running = false
  const latest = new Map<string, LimitsReading>()
  /** What the CRM last accepted for each (hour, subscription): cost and chats. */
  const sent = new Map<string, { costUsd: number; chats: number }>()
  /** The hashes of who this PC is + what it runs on (id) and of the readings' numbers (lim) last accepted, and when. */
  let metaSent: { id: string; lim: string; at: number } | null = null
  let knownSent: { hash: string; at: number } | null = null
  /** The Server's list of PCs has waits of its own (it never pauses the usage report, bar the CRM not being ready at all): until when it is not asked again. */
  let knownWaitUntil: number | null = null
  const said = new Map<string, number>()

  const paused = () => {
    // the clock was set back: no wait is longer than the 409 one, so a pause further off than that is a clock's doing and ends now
    if (pauseUntil !== null && pauseUntil - now() > PC_CONFLICT_PAUSE_MS) pauseUntil = null
    return pauseUntil !== null && now() < pauseUntil
  }
  const knownWaiting = () => {
    // the clock was set back: no wait of the list is longer than six hours
    if (knownWaitUntil !== null && knownWaitUntil - now() > PC_NOTE_EVERY_MS) knownWaitUntil = null
    return knownWaitUntil !== null && now() < knownWaitUntil
  }
  const note = (key: string, message: string) => {
    const t = now()
    const last = said.get(key)
    if (last !== undefined && t - last < PC_NOTE_EVERY_MS) return
    said.set(key, t)
    o.log?.warn(message)
  }
  const pause = (ms: number) => {
    pauseUntil = now() + ms
  }

  /** The reading of the account this PC runs on now: the placed subscription's, or (nothing placed) the PC's own login's. Never another account's: a percent of a subscription this PC no longer runs on would be shown as this PC's. No reading: null ("not read"). */
  function readingNow(placedKey: string): LimitsReading | null {
    return latest.get(placedKey) ?? null
  }

  /** A window as the CRM takes it: a reset time that is not a date, or is more than 29 days from now (the CRM refuses the WHOLE report for one beyond 30), is left out; a percent outside 0-101 is the CRM's to drop. */
  const windowOf = (w: LimitsReading['fiveHour']) => {
    if (!w) return null
    const at = w.resetsAt === null ? Number.NaN : Date.parse(w.resetsAt)
    return { percent: w.percent, resetsAt: Number.isFinite(at) && Math.abs(at - now()) <= 29 * DAY ? w.resetsAt : null }
  }
  /** A reading as the CRM takes it: one whose time is not a date is left out, and a time ahead of this PC's own clock is this PC's clock now (the CRM refuses a reading from the future). */
  function limitsOf(r: LimitsReading | null) {
    if (!r) return null
    const at = Date.parse(r.observedAt)
    if (!Number.isFinite(at)) return null
    return { observedAt: at > now() ? new Date(now()).toISOString() : r.observedAt, fiveHour: windowOf(r.fiveHour), week: windowOf(r.week) }
  }

  function bodyOf(rows: PcRow[]) {
    const dev = o.device()
    const placed = o.placed()
    return {
      device: { id: dev.id, name: oneLine(dev.name) ?? dev.id },
      subscription: placed ? { key: placed.key, name: oneLine(placed.name) } : null,
      limits: limitsOf(readingNow(placed?.key ?? '')),
      rows,
    }
  }
  const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
  /** Who this PC is and what it runs on: a change is sent at once. */
  const idHash = (b: ReturnType<typeof bodyOf>) => sha([b.device, b.subscription])
  /** The readings' numbers (NOT the time they were taken, which moves with every status line): a change is sent after PC_LIMITS_MIN_MS at the soonest. */
  const limitsHash = (b: ReturnType<typeof bodyOf>) => sha(b.limits ? [b.limits.fiveHour, b.limits.week] : null)

  /** Posts one body. true: the CRM took it. false: it did not, and what to do about it is done (a pause, a note). */
  async function post(body: unknown, what: string): Promise<boolean> {
    let answer: PcAnswer
    try {
      answer = await o.post(PATH, body)
    } catch (e) {
      // a request that did not arrive: the error text is not repeated (it can hold an address)
      o.log?.warn(`claude usage (per PC): ${what} did not reach the CRM${e instanceof Error && e.name ? ` (${e.name})` : ''}`)
      pause(PC_RETRY_MS)
      return false
    }
    const s = answer.status
    if (s >= 200 && s < 300) return true
    if (s === 404 || s === 503) {
      pause(PC_PAUSE_MS)
      o.log?.warn(`claude usage (per PC): the CRM is not ready (status ${s}); trying again in 30 minutes`)
    } else if (s === 409) {
      pause(PC_CONFLICT_PAUSE_MS)
      note('conflict', PC_ASSIGN_SENTENCE)
    } else {
      pause(PC_PAUSE_MS)
      o.log?.warn(`claude usage (per PC): the CRM refused ${what} (status ${s}); trying again in 30 minutes`)
    }
    return false
  }

  async function sendKnown() {
    if (!o.knownDevices) return
    if (knownWaiting()) return
    // the CRM refuses the WHOLE list for one id it does not take: such an entry is left out, and the rest goes
    let known: Array<{ id: string; name: string }>
    try {
      known = o.knownDevices()
    } catch {
      // the app's own list failed to read: that is the list's trouble, never the usage report's
      knownWaitUntil = now() + PC_RETRY_MS
      return
    }
    const list = known.filter(d => typeof d.id === 'string' && PC_ID_RE.test(d.id)).slice(0, 64)
    if (list.length === 0) return
    const dev = o.device()
    const hash = createHash('sha256').update(JSON.stringify(list)).digest('hex')
    if (knownSent && knownSent.hash === hash && now() - knownSent.at < PC_KNOWN_EVERY_MS) return
    // its own request: only the super admin may list PCs, so a refusal here must never hold the usage report back
    let answer: PcAnswer
    try {
      answer = await o.post(PATH, { device: { id: dev.id, name: oneLine(dev.name) ?? dev.id }, rows: [], knownDevices: list.map(d => ({ id: d.id, name: oneLine(d.name) ?? d.id })) })
    } catch {
      // did not arrive: again in 5 minutes, not every pass (its error text is not logged: it can hold an address)
      knownWaitUntil = now() + PC_RETRY_MS
      return
    }
    if (answer.status >= 200 && answer.status < 300) {
      knownSent = { hash, at: now() }
      return
    }
    if (answer.status === 403) {
      knownWaitUntil = now() + PC_NOTE_EVERY_MS
      note('known', 'claude usage (per PC): the CRM does not let this sign-in list the office\'s PCs (the super admin only): the PC list is not sent from here')
    } else if (answer.status === 404 || answer.status === 503) pause(PC_PAUSE_MS)
    else {
      // 400 (an entry the CRM would not take), 401, 429, 500...: its status only, and 30 minutes, never every pass
      knownWaitUntil = now() + PC_PAUSE_MS
      note('known-status', `claude usage (per PC): the CRM refused the list of the office's PCs (status ${answer.status}); asking again in 30 minutes`)
    }
  }

  async function sendReport() {
    if (!o.signedIn()) {
      note('signed-out', 'claude usage (per PC): waiting for a CRM sign-in on this PC; nothing is sent until then')
      return
    }
    const all = pcRowsOf(o.ledger.buckets())
    const changed = all.filter(r => {
      const was = sent.get(`${r.hour}|${r.subscriptionKey}`)
      return !was || was.costUsd !== r.costUsd || was.chats !== r.chats
    })
    const probe = bodyOf([])
    const id = idHash(probe)
    const lim = limitsHash(probe)
    const t = now()
    const heartbeatDue = metaSent === null || metaSent.id !== id || (metaSent.lim !== lim && t - metaSent.at >= PC_LIMITS_MIN_MS) || t - metaSent.at >= PC_HEARTBEAT_MS
    if (changed.length === 0 && !heartbeatDue) return
    const parts: PcRow[][] = []
    for (let i = 0; i < changed.length; i += PC_ROWS_PER_REPORT) parts.push(changed.slice(i, i + PC_ROWS_PER_REPORT))
    if (parts.length === 0) parts.push([])
    for (const part of parts) {
      if (paused()) return
      if (!(await post(bodyOf(part), part.length > 0 ? 'a report' : 'the PC\'s state'))) return
      for (const r of part) sent.set(`${r.hour}|${r.subscriptionKey}`, { costUsd: r.costUsd, chats: r.chats })
      metaSent = { id, lim, at: now() }
      if (part.length > 0) o.log?.info(`claude usage (per PC): ${part.length} hour row${part.length === 1 ? '' : 's'} reported`)
    }
  }

  return {
    limits(reading) {
      latest.set(reading.subscriptionKey, reading)
    },
    async flush() {
      if (running || paused()) return
      running = true
      try {
        await sendReport()
        if (!paused()) await sendKnown()
      } catch (e) {
        o.log?.warn(`claude usage (per PC): a pass failed (${e instanceof Error ? e.name : 'error'})`)
        pause(PC_RETRY_MS)
      } finally {
        running = false
      }
    },
    pausedUntil: () => (paused() ? pauseUntil : null),
  }
}
