import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { PublishActor, PublishChecks, PublishRecord } from '../shared/build.ts'
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
export function beginPublishRecord(dir: string, checks: PublishChecks, by: PublishActor): PublishRecord {
  const record: PublishRecord = { id: randomBytes(16).toString('hex'), audit: { checks, by: cleanPublishActor(by), at: new Date().toISOString() }, startedAt: new Date().toISOString(), endedAt: null, outcome: 'running', version: null, error: null }
  mkdirSync(dir, { recursive: true })
  writeFileSync(fileOf(dir, record.id), JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  return record
}
export function finishPublishRecord(dir: string, id: string, outcome: Exclude<PublishRecord['outcome'], 'running'>, version: string | null, error: string | null): PublishRecord {
  const record = { ...readPublishRecord(dir, id), endedAt: new Date().toISOString(), outcome, version, error }
  const temp = fileOf(dir, id) + '.' + randomBytes(8).toString('hex') + '.pending'
  writeFileSync(temp, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  renameSync(temp, fileOf(dir, id))
  return record
}
export function publishHistory(dir: string): PublishRecord[] {
  let names: string[]
  try { names = readdirSync(dir) } catch { return [] }
  const records: PublishRecord[] = []
  for (const name of names) {
    if (!/^[a-f0-9]{32}\.json$/.test(name)) continue
    try { records.push(readPublishRecord(dir, name.slice(0, -5))) } catch { /* Corrupt entries aren't presented as a successful publish. */ }
  }
  return records.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 30)
}
