import path from 'node:path'
import type { Auth } from '../auth/index.ts'
import { crmLoginOf, type CrmProxy } from '../agentic/crmproxy.ts'
import { createLedger, type CostReading } from './ledger.ts'
import { createPcReporter, type PcAnswer, type PcReporter } from './pc-reporter.ts'
import { createReporter, type LimitsReading, type Reporter } from './reporter.ts'
import { readSnapshots } from './snapshots.ts'

// Order ofedf: the Claude usage of this app, reported to the CRM the way the old app did. Wired in once by the agent (agentic/index.ts):
// - the Claude chats write snapshot files (statusline.mjs) into <dir>/usage; this reads them every minute;
// - the Assistant's own headless turns (fast-host, memory, librarian) hand their cost over with reading();
// - the ledger (ledger.ts) turns running costs into hours per person; the reporter (reporter.ts) sends what changed, with each
//   person's own CRM session, and waits while a person is not signed in here.
// - F-352: the same ledger, summed per PC, goes to the CRM's tab "Usage for Server Agentic" (pc-reporter.ts), with THIS PC's own CRM session. Only when the agent gives it `pc`.

export const USAGE_SNAPSHOT_DIR = 'usage'
export const USAGE_LEDGER_FILE = 'claude-usage.json'
const TICK_MS = 60 * 1000

/** F-352: what the per-PC report needs from the agent (all of it read-only except post). Left out: no per-PC report. */
export interface UsagePcSource {
  /** This PC: its device id and name. */
  device(): { id: string; name: string }
  /** The Claude subscription placed on this PC now, or null. */
  placed(): { key: string; name: string | null } | null
  /** Whether this PC holds a CRM login now. */
  signedIn(): boolean
  /** One POST to the CRM with this PC's own session. */
  post(path: string, body: unknown): Promise<PcAnswer>
  /** The Server only: every PC it knows. */
  knownDevices?(): Array<{ id: string; name: string }>
}

export interface UsageOptions {
  /** The agent's state folder: the ledger file and the snapshot folder live in it. */
  dir: string
  auth: Auth
  proxy: CrmProxy
  /** The app's build, as the CRM keeps it: an id (letters, digits, '-' and '_') and a label. Null while not known. */
  build(): { id: string; label: string } | null
  log?: { info(m: string): void; warn(m: string): void }
  now?: () => number
  /** Tests: the timer (0 = none; start() is then a no-op). */
  intervalMs?: number
  onError?: (message: string) => void
  /** F-352: the per-PC report to the CRM's "Usage for Server Agentic" tab (pc-reporter.ts). */
  pc?: UsagePcSource
}

/** Claude's meter as the newest snapshots say it (F-359: the goals heartbeat reads it; nothing else does). Times in ms. */
export interface UsageMeter {
  weekPercent: number | null
  fiveHourPercent: number | null
  weekResetsAt: number | null
  /** The OLDEST of the readings it is made of (a stale one never passes as fresh). */
  at: number
}

/**
 * What the newest limits snapshots say, taking the worst case: the highest week percent, the highest 5-hour percent of the windows that have not reset since, the earliest week reset time. With `key` ('' is the PC's own
 * login) only that subscription's readings count (the goals heartbeat reads the subscription placed on this PC now); without it, every subscription's. A reading older than `maxAgeMs` (or from the future) is left out, as
 * is one with neither window; null when nothing is left.
 */
export function meterOf(readings: Iterable<LimitsReading>, now: number, maxAgeMs: number, key?: string): UsageMeter | null {
  let week: number | null = null
  let five: number | null = null
  let weekReset: number | null = null
  let at: number | null = null
  for (const r of readings) {
    if (key !== undefined && r.subscriptionKey !== key) continue
    const t = Date.parse(r.observedAt)
    if (!Number.isFinite(t) || now - t > maxAgeMs || t > now + 60_000) continue
    const wp = r.week?.percent ?? null
    const fp = r.fiveHour?.percent ?? null
    if (wp === null && fp === null) continue
    const wr = r.week?.resetsAt ? Date.parse(r.week.resetsAt) : NaN
    const fr = r.fiveHour?.resetsAt ? Date.parse(r.fiveHour.resetsAt) : NaN
    if (wp !== null) week = week === null ? wp : Math.max(week, wp)
    if (Number.isFinite(wr)) weekReset = weekReset === null ? wr : Math.min(weekReset, wr)
    // A 5-hour window that has reset since the reading started over: its old percentage is not counted.
    if (fp !== null && !(Number.isFinite(fr) && fr <= now)) five = five === null ? fp : Math.max(five, fp)
    at = at === null ? t : Math.min(at, t)
  }
  return at === null ? null : { weekPercent: week, fiveHourPercent: five, weekResetsAt: weekReset, at }
}

export interface Usage {
  /** F-359: the newest limits (see meterOf), or null when there is none fresh enough. */
  meter(maxAgeMs: number, key?: string): UsageMeter | null
  /** The folder the chats' status lines write their snapshots into (give it to chats as SAD_USAGE_DIR). */
  snapshotDir: string
  /** The Assistant's own headless turn: its process's running cost (Claude's total_cost_usd). Never throws. */
  reading(r: CostReading): void
  /** One pass: read the snapshots, then send what changed. Tests and the timer call it. */
  tick(): Promise<void>
  start(): void
  close(): Promise<void>
}

/** The app's build id as the CRM takes it: dots become dashes ("2026.11.14-2344" -> "2026-11-14-2344"). */
export function buildIdOf(version: string): string {
  return version.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
}

export function createUsage(o: UsageOptions): Usage {
  const now = o.now ?? Date.now
  const snapshotDir = path.join(o.dir, USAGE_SNAPSHOT_DIR)
  const ledger = createLedger({ file: path.join(o.dir, USAGE_LEDGER_FILE), onError: o.onError, build: () => o.build()?.id ?? null })
  const reporter: Reporter = createReporter({
    ledger,
    loginFor: userId => {
      const s = o.auth.viewerLoginFor(userId)
      return s ? crmLoginOf(s) : null
    },
    anyLogin: () => {
      const s = o.auth.anyViewer()
      return s ? crmLoginOf(s) : null
    },
    build: o.build,
    post: async (login, p, body) => {
      const r = await o.proxy.requestAs(login, 'POST', p, { json: body })
      await r.arrayBuffer().catch(() => undefined)
      return { status: r.status }
    },
    now,
    log: o.log,
  })
  // F-352: beside the old reporter, which stays exactly as it was: the same ledger, read only, summed per PC.
  const pcReporter: PcReporter | null = o.pc ? createPcReporter({ ledger, ...o.pc, now, log: o.log }) : null
  let timer: ReturnType<typeof setInterval> | null = null
  let busy: Promise<void> | null = null

  /** The newest limits reading per subscription (F-359 reads it; the reporter has its own copy and is not touched). */
  const newest = new Map<string, LimitsReading>()
  const sink = {
    reading: (r: CostReading) => ledger.reading(r),
    limits: (r: LimitsReading) => {
      const was = newest.get(r.subscriptionKey)
      if (!was || Date.parse(r.observedAt) >= Date.parse(was.observedAt)) newest.set(r.subscriptionKey, r)
      reporter.limits(r)
      pcReporter?.limits(r)
    },
  }

  async function tick(): Promise<void> {
    if (busy) return busy
    busy = (async () => {
      try {
        readSnapshots(snapshotDir, sink, now())
        ledger.save()
        await reporter.flush()
        // the per-PC report is its own pass: nothing it does can hold the per-person report back (it never throws, and it comes after)
        await pcReporter?.flush()
      } catch (e) {
        o.onError?.(`claude usage: a pass failed (${e instanceof Error ? e.message : String(e)})`)
      } finally {
        busy = null
      }
    })()
    return busy
  }

  return {
    snapshotDir,
    meter: (maxAgeMs, key) => meterOf(newest.values(), now(), maxAgeMs, key),
    reading(r) {
      try {
        if (ledger.reading(r)) ledger.save()
      } catch {
        // A reading that cannot be filed is lost, never a failed turn.
      }
    },
    tick,
    start() {
      const every = o.intervalMs ?? TICK_MS
      if (timer || every <= 0) return
      timer = setInterval(() => void tick(), every)
      timer.unref?.()
    },
    async close() {
      if (timer) clearInterval(timer)
      timer = null
      if (busy) await busy
      ledger.save()
    },
  }
}
