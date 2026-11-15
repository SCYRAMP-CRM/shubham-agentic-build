import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// Order ofedf (Shubham, 14 Nov 2026): every Claude chat's usage, per person, per PC, per hour, reported to the CRM the way the old app did
// (sam-crm-be POST /v1/org/christopher-usage). This is the ledger: it turns each Claude process's RUNNING cost into the cost of each
// UTC hour, for the person who started the chat. It never talks to the CRM (reporter.ts does) and never holds a token or a credential.
//
// Rules, as the old app had them:
// - A process reports its running cost. The FIRST value it reports is its base (on --resume Claude restores the total saved at the
//   last exit); only growth above the base, seen by this process, is this process's usage.
// - Each UTC hour is one row per (person, PC account, hour, subscription). The CRM SETS a row to the total we send, so we keep
//   what we last sent and send only what changed.
// - A usage with no person is not filed (nobody to file it under).

export const HOUR = 3600 * 1000
const DAY = 24 * HOUR
/** The CRM refuses an hour older than 45 days (christopherUsageController REPORT_MAX_AGE). */
export const REPORT_MAX_AGE_MS = 45 * DAY
/** A process we have not heard from for this long is forgotten (its base and last value). */
const LAUNCH_KEEP_MS = 2 * DAY
const MAX_SESSION_IDS = 200

export interface CostReading {
  /** One process's id: fresh for every spawn, so two processes on one chat never share a base. */
  launchId: string
  /** The chat's Claude session id (what the CRM counts as "sessions"). */
  sessionId: string
  /** The person who started the chat; null when nobody did (not filed). */
  userId: string | null
  orgId: string | null
  /** The CRM subscription this chat runs on, or '' for the PC's own Claude login. */
  subscriptionKey: string
  /** When the reading was taken (epoch ms). */
  at: number
  /** The process's running API-equivalent cost in dollars (Claude's own total_cost_usd). */
  totalCostUsd: number
}

export interface Bucket {
  userId: string
  orgId: string | null
  /** Start of the UTC hour, ISO. */
  hour: string
  subscriptionKey: string
  costUsd: number
  sessionIds: string[]
  /** What the CRM last heard for this row (null: never sent). */
  sentCostUsd: number | null
  sentSessions: number | null
}

export interface LedgerRow {
  userId: string
  orgId: string | null
  hour: string
  subscriptionKey: string
  costUsd: number
  sessions: number
}

interface Launch {
  base: number
  last: number
  userId: string
  orgId: string | null
  subscriptionKey: string
  sessionId: string
  at: number
}

interface FileShape {
  version: 1
  launches: Record<string, Launch>
  buckets: Record<string, Bucket>
}

export interface Ledger {
  /** Takes one reading. Returns true when a row changed (so the reporter should look). */
  reading(r: CostReading): boolean
  /** The rows whose total differs from what the CRM last heard, for the people in `userIds` (or all of them). */
  pending(userIds?: ReadonlySet<string>): LedgerRow[]
  /** The CRM accepted these rows: remember them as sent. */
  markSent(rows: readonly LedgerRow[]): void
  /** Drops what is too old to report and launches we no longer hear from. */
  prune(now: number): void
  /** Writes the ledger to its file (atomic). A failed write is reported, not thrown: the ledger is in memory. */
  save(): void
  /** Everything filed, for tests and the page's own check (no tokens). */
  buckets(): Bucket[]
  /** How many distinct processes reported cost with no person to file it under (in memory: the number since the agent started). */
  unfiledLaunches(): number
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6
const hourOf = (at: number) => Math.floor(at / HOUR) * HOUR
const bucketKey = (userId: string, orgId: string | null, hour: string, sub: string) => `${userId}|${orgId ?? ''}|${hour}|${sub}`

function emptyFile(): FileShape {
  return { version: 1, launches: {}, buckets: {} }
}

function parse(text: string): FileShape {
  try {
    const j = JSON.parse(text) as Partial<FileShape>
    if (j.version !== 1 || typeof j.launches !== 'object' || typeof j.buckets !== 'object' || j.launches === null || j.buckets === null) return emptyFile()
    return { version: 1, launches: j.launches, buckets: j.buckets }
  } catch {
    return emptyFile()
  }
}

/**
 * The ledger in memory, kept in `file` (the state folder's claude-usage.json). `onError` hears a failed save.
 */
export function createLedger(o: { file: string; onError?: (message: string) => void }): Ledger {
  let f: FileShape = emptyFile()
  try {
    f = parse(readFileSync(o.file, 'utf8'))
  } catch {
    f = emptyFile()
  }

  const unfiled = new Set<string>()

  function reading(r: CostReading): boolean {
    if (!Number.isFinite(r.totalCostUsd) || r.totalCostUsd < 0 || !Number.isFinite(r.at)) return false
    if (!r.userId) {
      // Counted per process, not per reading: a snapshot is read again on every pass.
      if (unfiled.size < 500) unfiled.add(r.launchId)
      return false
    }
    const sub = r.subscriptionKey ?? ''
    const launch = f.launches[r.launchId]
    let delta = 0
    if (!launch) {
      // The first value is the base: nothing is this process's yet.
      f.launches[r.launchId] = { base: r.totalCostUsd, last: r.totalCostUsd, userId: r.userId, orgId: r.orgId, subscriptionKey: sub, sessionId: r.sessionId, at: r.at }
    } else {
      if (r.totalCostUsd > launch.last) delta = round6(r.totalCostUsd - launch.last)
      launch.last = Math.max(launch.last, r.totalCostUsd)
      launch.at = r.at
    }
    if (delta <= 0) return false
    const hour = new Date(hourOf(r.at)).toISOString()
    const key = bucketKey(r.userId, r.orgId, hour, sub)
    const b: Bucket = f.buckets[key] ?? { userId: r.userId, orgId: r.orgId, hour, subscriptionKey: sub, costUsd: 0, sessionIds: [], sentCostUsd: null, sentSessions: null }
    b.costUsd = round6(b.costUsd + delta)
    if (!b.sessionIds.includes(r.sessionId) && b.sessionIds.length < MAX_SESSION_IDS) b.sessionIds.push(r.sessionId)
    f.buckets[key] = b
    return true
  }

  function pending(userIds?: ReadonlySet<string>): LedgerRow[] {
    const out: LedgerRow[] = []
    for (const b of Object.values(f.buckets)) {
      if (userIds && !userIds.has(b.userId)) continue
      const sessions = b.sessionIds.length
      if (b.sentCostUsd === b.costUsd && b.sentSessions === sessions) continue
      out.push({ userId: b.userId, orgId: b.orgId, hour: b.hour, subscriptionKey: b.subscriptionKey, costUsd: b.costUsd, sessions })
    }
    return out
  }

  function markSent(rows: readonly LedgerRow[]) {
    let changed = false
    for (const r of rows) {
      const key = bucketKey(r.userId, r.orgId, r.hour, r.subscriptionKey)
      const b = f.buckets[key]
      if (!b) continue
      b.sentCostUsd = r.costUsd
      b.sentSessions = r.sessions
      changed = true
    }
    if (changed) save()
  }

  function prune(t: number) {
    for (const [k, b] of Object.entries(f.buckets)) if (t - Date.parse(b.hour) > REPORT_MAX_AGE_MS) delete f.buckets[k]
    for (const [k, l] of Object.entries(f.launches)) if (t - l.at > LAUNCH_KEEP_MS) delete f.launches[k]
  }

  function save() {
    try {
      mkdirSync(path.dirname(o.file), { recursive: true })
      const tmp = `${o.file}.${process.pid}.tmp`
      writeFileSync(tmp, `${JSON.stringify(f)}\n`, { mode: 0o600 })
      renameSync(tmp, o.file)
    } catch (e) {
      o.onError?.(`claude usage could not be saved (${e instanceof Error ? e.message : String(e)})`)
    }
  }

  return {
    reading,
    pending,
    markSent,
    prune(t) {
      prune(t)
    },
    save,
    buckets: () => Object.values(f.buckets).map(b => ({ ...b, sessionIds: [...b.sessionIds] })),
    unfiledLaunches: () => unfiled.size,
  }
}
