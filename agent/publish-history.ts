import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { BUILD_HISTORY_MAX_ROWS, buildHistoryOf, type PublishActor, type PublishChecks, type PublishRecord } from '../shared/build.ts'
import { cleanPublishActor } from './publish-policy.ts'

const goodId = (id: string) => /^[a-f0-9]{32}$/.test(id)
const fileOf = (dir: string, id: string) => {
  if (!goodId(id)) throw new Error('Invalid publish attempt id.')
  return path.join(dir, id + '.json')
}
export function readPublishRecord(dir: string, id: string): PublishRecord {
  const v = JSON.parse(readFileSync(fileOf(dir, id), 'utf8')) as PublishRecord
  if (v.id !== id || !v.audit || !['full', 'skip'].includes(v.audit.checks) || !['running', 'published', 'unchanged', 'failed'].includes(v.outcome) || !Number.isFinite(Date.parse(v.audit.at)) || !Number.isFinite(Date.parse(v.startedAt))) throw new Error('Invalid publish receipt.')
  cleanPublishActor(v.audit.by)
  return v
}
/** One record, written whole and renamed into place: a reader never sees half of one. */
function writeRecord(dir: string, record: PublishRecord): void {
  const temp = fileOf(dir, record.id) + '.' + randomBytes(8).toString('hex') + '.pending'
  writeFileSync(temp, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  renameSync(temp, fileOf(dir, record.id))
}
/** F-318: `gave` is the note written at Publish (already cleaned by shared parseBuildNote); none is stored when there is none. */
export function beginPublishRecord(dir: string, checks: PublishChecks, by: PublishActor, gave?: readonly string[]): PublishRecord {
  const record: PublishRecord = {
    id: randomBytes(16).toString('hex'),
    audit: { checks, by: cleanPublishActor(by), at: new Date().toISOString() },
    startedAt: new Date().toISOString(),
    endedAt: null,
    outcome: 'running',
    version: null,
    error: null,
    ...(gave?.length ? { gave: [...gave] } : {}),
  }
  mkdirSync(dir, { recursive: true })
  writeFileSync(fileOf(dir, record.id), JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  return record
}
/** F-318: `extra` is what the publish learned about the build it made (Dev's commit and the commit titles since the last build); the note written at the start stays as it was. */
export function finishPublishRecord(dir: string, id: string, outcome: Exclude<PublishRecord['outcome'], 'running'>, version: string | null, error: string | null, extra?: { commit?: string | null; changes?: readonly string[] | null; dirty?: boolean }): PublishRecord {
  const record: PublishRecord = {
    ...readPublishRecord(dir, id),
    endedAt: new Date().toISOString(),
    outcome,
    version,
    error,
    ...(extra?.commit ? { commit: extra.commit } : {}),
    ...(extra?.changes ? { changes: [...extra.changes] } : {}),
    // F-318 follow-up: Dev had changes that were not committed (published as they were); only ever recorded as true.
    ...(extra?.dirty ? { dirty: true as const } : {}),
  }
  writeRecord(dir, record)
  return record
}
export function publishHistory(dir: string): PublishRecord[] {
  return allRecords(dir).slice(0, 30)
}
function allRecords(dir: string): PublishRecord[] {
  let names: string[]
  try { names = readdirSync(dir) } catch { return [] }
  const records: PublishRecord[] = []
  for (const name of names) {
    if (!/^[a-f0-9]{32}\.json$/.test(name)) continue
    try { records.push(readPublishRecord(dir, name.slice(0, -5))) } catch { /* Corrupt entries aren't presented as a successful publish. */ }
  }
  return records.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}
/**
 * F-318: the PUBLISHED builds only, newest first, at most BUILD_HISTORY_MAX_ROWS: its own read, so failed and unchanged attempts can never push a published build out of the History tab
 * (publishHistory above keeps the newest 30 attempts of any outcome for the owner's attempts list, as it always did).
 */
export function publishedHistory(dir: string, max = BUILD_HISTORY_MAX_ROWS): PublishRecord[] {
  return allRecords(dir)
    .filter(r => r.outcome === 'published' && typeof r.version === 'string')
    .sort((a, b) => (b.endedAt ?? b.startedAt).localeCompare(a.endedAt ?? a.startedAt))
    .slice(0, max)
}

/** F-318: this id is not a published build's record (it does not exist, is not published yet, failed, or has no real version). The route answers 404 and never says which. */
export class NoSuchPublishedBuild extends Error {
  constructor() {
    super('No such published build.')
  }
}
/**
 * F-318: replaces a PUBLISHED build's note (`lines` already cleaned by shared parseBuildNote; none clears it). Whole record written and renamed into place, like finishPublishRecord; nothing else about it changes.
 * Throws NoSuchPublishedBuild for an id that is not a published record.
 */
export function setPublishNote(dir: string, id: string, lines: readonly string[]): PublishRecord {
  let record: PublishRecord
  try {
    record = readPublishRecord(dir, id)
  } catch {
    throw new NoSuchPublishedBuild()
  }
  if (buildHistoryOf([record], 'owner').rows.length !== 1) throw new NoSuchPublishedBuild()
  const next: PublishRecord = { ...record }
  if (lines.length) next.gave = [...lines]
  else delete next.gave
  writeRecord(dir, next)
  return next
}
/**
 * F-318 backfill: adds what a published record lacks (its commit, its commit titles, that Dev had changes not committed) and nothing it already has: a note, titles or a commit already there are never replaced. Returns whether it wrote anything.
 */
export function fillPublishRecord(dir: string, id: string, extra: { commit?: string | null; changes?: readonly string[] | null; dirty?: boolean }): boolean {
  const record = readPublishRecord(dir, id)
  if (record.outcome !== 'published') return false
  const next: PublishRecord = { ...record }
  let changed = false
  if (extra.dirty && !record.dirty) {
    next.dirty = true
    changed = true
  }
  if (extra.commit && !record.commit) {
    next.commit = extra.commit
    changed = true
  }
  if (extra.changes && !Array.isArray(record.changes)) {
    next.changes = [...extra.changes]
    changed = true
  }
  if (changed) writeRecord(dir, next)
  return changed
}
