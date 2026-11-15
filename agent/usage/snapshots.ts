import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import type { CostReading } from './ledger.ts'
import type { LimitsReading, Window } from './reporter.ts'

// Order ofedf: reads the snapshot files statusline.mjs writes for each Claude chat (sessions/ and limits/ in the usage folder) and
// feeds them to the ledger and the reporter. Idempotent: a file read twice gives the same totals. A file of a process we have
// not heard from for two days is removed (the ledger forgets it too).

const SESSION_FILE = /^([A-Za-z0-9-]{8,64})\.([A-Za-z0-9]{8,64})\.json$/
const LIMITS_FILE = /^([0-9a-f-]{36}|_local)\.json$/i
const KEEP_MS = 2 * 24 * 3600 * 1000

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function windowOf(w: unknown): Window | null {
  if (!w || typeof w !== 'object') return null
  const o = w as { percent?: unknown; resetsAt?: unknown }
  const percent = typeof o.percent === 'number' && Number.isFinite(o.percent) && o.percent >= 0 && o.percent <= 101 ? o.percent : null
  const resetsAt = typeof o.resetsAt === 'string' && Number.isFinite(Date.parse(o.resetsAt)) ? new Date(o.resetsAt).toISOString() : null
  return percent === null && resetsAt === null ? null : { percent, resetsAt }
}

/** One session snapshot as a reading, or null when the file is not one. */
export function sessionReading(j: unknown, nameLaunch: string): CostReading | null {
  if (!j || typeof j !== 'object') return null
  const o = j as Record<string, unknown>
  const at = typeof o.at === 'string' ? Date.parse(o.at) : NaN
  const cost = typeof o.costUsd === 'number' ? o.costUsd : NaN
  if (typeof o.sessionId !== 'string' || typeof o.launchId !== 'string' || o.launchId !== nameLaunch) return null
  if (!Number.isFinite(at) || !Number.isFinite(cost) || cost < 0) return null
  return {
    launchId: o.launchId,
    sessionId: o.sessionId,
    userId: typeof o.userId === 'string' && o.userId ? o.userId : null,
    orgId: typeof o.orgId === 'string' && o.orgId ? o.orgId : null,
    subscriptionKey: typeof o.subscriptionKey === 'string' ? o.subscriptionKey : '',
    at,
    totalCostUsd: cost,
  }
}

/** One limits snapshot as a reading for `subscriptionKey` ('' for the PC's own login), or null. */
export function limitsReading(j: unknown, subscriptionKey: string): LimitsReading | null {
  if (!j || typeof j !== 'object') return null
  const o = j as Record<string, unknown>
  const at = typeof o.at === 'string' ? Date.parse(o.at) : NaN
  if (!Number.isFinite(at)) return null
  const fiveHour = windowOf(o.fiveHour)
  const week = windowOf(o.week)
  if (!fiveHour && !week) return null
  return { subscriptionKey, observedAt: new Date(at).toISOString(), fiveHour, week }
}

export interface SnapshotSink {
  reading(r: CostReading): unknown
  limits(r: LimitsReading): void
}

/** Reads every snapshot under `dir` once and gives it to `sink`. Returns how many were read. */
export function readSnapshots(dir: string, sink: SnapshotSink, now: number = Date.now()): number {
  let n = 0
  const sessions = path.join(dir, 'sessions')
  for (const name of safeList(sessions)) {
    const m = SESSION_FILE.exec(name)
    if (!m) continue
    const file = path.join(sessions, name)
    if (now - mtime(file) > KEEP_MS) {
      rm(file)
      continue
    }
    const r = sessionReading(readJson(file), m[2])
    if (r) {
      sink.reading(r)
      n++
    }
  }
  const limits = path.join(dir, 'limits')
  for (const name of safeList(limits)) {
    const m = LIMITS_FILE.exec(name)
    if (!m) continue
    const file = path.join(limits, name)
    const key = m[1] === '_local' ? '' : m[1].toLowerCase()
    const r = limitsReading(readJson(file), key)
    if (r) {
      sink.limits(r)
      n++
    }
  }
  return n
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function mtime(file: string): number {
  try {
    return statSync(file).mtimeMs
  } catch {
    return 0
  }
}

function rm(file: string) {
  try {
    rmSync(file, { force: true })
  } catch {
    // Left for the next pass.
  }
}
