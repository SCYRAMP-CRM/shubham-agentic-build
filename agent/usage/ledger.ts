import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// Order ofedf (Shubham, 14 Nov 2026): every Claude chat's usage, per person, per PC, per hour, reported to the CRM the way the old app did
// (sam-crm-be POST /v1/org/christopher-usage). This is the ledger: it turns each Claude process's RUNNING cost into the cost of each
// UTC hour, for the person who started the chat. It never talks to the CRM (reporter.ts does) and never holds a token or a credential.
//
// Rules, as the old app had them:
// - A process reports its running cost. The FIRST value it reports is its base (on --resume Claude restores the total saved at the
//   last exit); only growth above the base, seen by this process, is this process's usage.
// - Each UTC hour is one row per (person, PC account, hour, subscription, BUILD). The CRM keeps one row per build and the LARGER value of
//   it (usageUpsertSql: GREATEST), and every sum adds the builds up. So we keep what we last sent per row and send only what changed, and
//   an hour that holds an Update restart puts only the cost that came after it under the new build (F-288): the earlier part stays under
//   the build that sent it. Without a build provider (old callers, tests) there is one bucket per hour, as before.
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
  /** The app build whose CRM row this bucket is. Absent in a ledger file written before F-288; '' when the build was not known yet. */
  build?: string
  costUsd: number
  sessionIds: string[]
  /** What the CRM last heard for this row (null: never sent). */
  sentCostUsd: number | null
  sentSessions: number | null
  /** The total a post is carrying right now (set and saved BEFORE the post, cleared by markSent or abortSend). A process killed mid-send leaves it: the CRM may have taken it. */
  inflightCostUsd?: number
}

export interface LedgerRow {
  userId: string
  orgId: string | null
  hour: string
  subscriptionKey: string
  /** The build this row belongs to (only when the ledger has a build provider). */
  build?: string
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
  /** About to post these rows: remember (and save) that they may arrive, so a crash before markSent cannot make a restart send them again under a new build. */
  beginSend(rows: readonly LedgerRow[]): void
  /** The post did not go through (nothing arrived, as far as we know): forget the in-flight mark. */
  abortSend(rows: readonly LedgerRow[]): void
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
const bucketKey = (userId: string, orgId: string | null, hour: string, sub: string, build?: string) =>
  build === undefined ? `${userId}|${orgId ?? ''}|${hour}|${sub}` : `${userId}|${orgId ?? ''}|${hour}|${sub}|${build}`

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
export function createLedger(o: { file: string; onError?: (message: string) => void; build?: () => string | null }): Ledger {
  let f: FileShape = emptyFile()
  try {
    f = parse(readFileSync(o.file, 'utf8'))
  } catch {
    f = emptyFile()
  }

  const unfiled = new Set<string>()

  /**
   * The build changed (an Update restarted the app, or the build became known): whatever a bucket of another build has NOT sent yet moves into
   * this build's bucket, which sends it; the old bucket stays frozen at what it had sent (dropped when that is nothing). The CRM then holds, per
   * hour, what each build sent and the rows add up to the hour. Buckets of an old ledger file (no build) are handled the same way.
   */
  let seen: string | null = null
  function adopt(cur: string) {
    let changed = false
    for (const [k, b] of Object.entries(f.buckets)) {
      if (b.build === cur) continue
      const sent = Math.max(b.sentCostUsd ?? 0, b.inflightCostUsd ?? 0) // a post that was in flight when the process died may have arrived: not sent again
      delete b.inflightCostUsd
      const rest = round6(b.costUsd - sent)
      if (rest <= 0) continue
      const key = bucketKey(b.userId, b.orgId, b.hour, b.subscriptionKey, cur)
      const t: Bucket = f.buckets[key] ?? { userId: b.userId, orgId: b.orgId, hour: b.hour, subscriptionKey: b.subscriptionKey, build: cur, costUsd: 0, sessionIds: [], sentCostUsd: null, sentSessions: null }
      t.costUsd = round6(t.costUsd + rest)
      for (const s of b.sessionIds) if (!t.sessionIds.includes(s) && t.sessionIds.length < MAX_SESSION_IDS) t.sessionIds.push(s)
      f.buckets[key] = t
      if (sent > 0) b.costUsd = sent
      else delete f.buckets[k]
      changed = true
    }
    if (changed) save()
  }
  /** The build id in force now (null: none known, or no provider). Adopts first when it has changed. */
  function current(): string | null {
    const b = o.build?.() ?? null
    if (b && b !== seen) {
      adopt(b)
      seen = b
    }
    return b
  }

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
    const build = o.build ? (current() ?? '') : undefined
    const key = bucketKey(r.userId, r.orgId, hour, sub, build)
    const b: Bucket = f.buckets[key] ?? { userId: r.userId, orgId: r.orgId, hour, subscriptionKey: sub, ...(build === undefined ? {} : { build }), costUsd: 0, sessionIds: [], sentCostUsd: null, sentSessions: null }
    b.costUsd = round6(b.costUsd + delta)
    if (!b.sessionIds.includes(r.sessionId) && b.sessionIds.length < MAX_SESSION_IDS) b.sessionIds.push(r.sessionId)
    f.buckets[key] = b
    return true
  }

  function pending(userIds?: ReadonlySet<string>): LedgerRow[] {
    const out: LedgerRow[] = []
    const cur = o.build ? current() : null
    if (o.build && !cur) return out
    for (const b of Object.values(f.buckets)) {
      if (userIds && !userIds.has(b.userId)) continue
      if (o.build && b.build !== cur) continue
      const sessions = b.sessionIds.length
      if (b.sentCostUsd === b.costUsd && b.sentSessions === sessions) continue
      out.push({ userId: b.userId, orgId: b.orgId, hour: b.hour, subscriptionKey: b.subscriptionKey, ...(o.build ? { build: b.build } : {}), costUsd: b.costUsd, sessions })
    }
    return out
  }

  function beginSend(rows: readonly LedgerRow[]) {
    let changed = false
    for (const r of rows) {
      const b = f.buckets[bucketKey(r.userId, r.orgId, r.hour, r.subscriptionKey, r.build)]
      if (!b) continue
      b.inflightCostUsd = r.costUsd
      changed = true
    }
    if (changed) save()
  }

  function abortSend(rows: readonly LedgerRow[]) {
    for (const r of rows) {
      const b = f.buckets[bucketKey(r.userId, r.orgId, r.hour, r.subscriptionKey, r.build)]
      if (b) delete b.inflightCostUsd
    }
  }

  function markSent(rows: readonly LedgerRow[]) {
    let changed = false
    for (const r of rows) {
      const key = bucketKey(r.userId, r.orgId, r.hour, r.subscriptionKey, r.build)
      const b = f.buckets[key]
      if (!b) continue
      b.sentCostUsd = r.costUsd
      b.sentSessions = r.sessions
      delete b.inflightCostUsd
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
    beginSend,
    abortSend,
    markSent,
    prune(t) {
      prune(t)
    },
    save,
    buckets: () => Object.values(f.buckets).map(b => ({ ...b, sessionIds: [...b.sessionIds] })),
    unfiledLaunches: () => unfiled.size,
  }
}
