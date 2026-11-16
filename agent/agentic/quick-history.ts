import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readSync, statSync, writeSync } from 'node:fs'
import path from 'node:path'
import { QUICK_HISTORY_NOTICE } from '../../shared/assistant-history.ts'
import type { BriefContext, FastFrame } from './fast-host.ts'

/** A stable logical conversation, independent of a disposable provider process. Nothing here ever truncates a file. */
export const quickSessionId = (person: string): string => {
  if (!/^[a-z0-9-]{8,64}$/i.test(person)) throw new Error('Invalid history owner')
  const h = createHash('sha256').update(`quick-history-v1:${person.toLowerCase()}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}
export const quickHistoryFile = (dir: string, person: string) => {
  quickSessionId(person)
  return path.join(dir, 'assistant-history', person.toLowerCase(), 'quick.jsonl')
}

export interface QuickHistory {
  file: string
  sessionId: string
  context(): BriefContext['history']
  process(nativeSession: string): void
  ask(r: { uuid: string; id: string; kind: 'user' | 'note'; text: string }): void
  frame(uuid: string, f: FastFrame): void
  native(session: string, row: Record<string, unknown>): void
  heard(text: string): void
}

/** Bounded context only; the journal itself and the reader have no turn/character retention limit. */
function tailRows(file: string): Record<string, unknown>[] {
  if (!existsSync(file)) return []
  const size = statSync(file).size, from = Math.max(0, size - 8 * 1024 * 1024)
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(size - from)
    const n = readSync(fd, buf, 0, buf.length, from)
    let text = buf.subarray(0, n).toString('utf8')
    if (from) text = text.slice(text.indexOf('\n') + 1)
    return text.split('\n').flatMap(l => {
      try { const r: unknown = JSON.parse(l); return r && typeof r === 'object' && !Array.isArray(r) ? [r as Record<string, unknown>] : [] } catch { return [] }
    })
  } finally { closeSync(fd) }
}

export function createQuickHistory(dir: string, person: string, now = Date.now): QuickHistory {
  const sessionId = quickSessionId(person), file = quickHistoryFile(dir, person)
  function append(row: Record<string, unknown>) {
    mkdirSync(path.dirname(file), { recursive: true })
    const fd = openSync(file, 'a', 0o600)
    try {
      // A power loss can leave a partial final record. Preserve those bytes, separate it from the next record, never overwrite it.
      const size = statSync(file).size
      if (size) {
        const read = openSync(file, 'r')
        try { const end = Buffer.alloc(1); readSync(read, end, 0, 1, size - 1); if (end[0] !== 10) writeSync(fd, '\n') } finally { closeSync(read) }
      }
      const data = Buffer.from(JSON.stringify({ v: 1, uuid: randomUUID(), sessionId, personId: person.toLowerCase(), timestamp: new Date(now()).toISOString(), ...row }) + '\n')
      let off = 0
      while (off < data.length) { const n = writeSync(fd, data, off, data.length - off); if (n <= 0) throw new Error('History write stopped'); off += n }
      // A question is durable BEFORE it goes to the process; a reply BEFORE it is shown. Disk failures refuse the operation.
      fsyncSync(fd)
    } finally { closeSync(fd) }
  }
  return {
    file, sessionId,
    context() {
      const rows = tailRows(file)
      const turns: BriefContext['history'] = []
      for (const r of rows) {
        const msg = r.message as { role?: string; content?: string } | undefined
        if ((r.type === 'user' || r.type === 'assistant') && msg && typeof msg.content === 'string') {
          turns.push({ role: r.type, text: msg.content, ...(r.cancelled ? { interrupted: true } : {}) })
        }
        if (r.type === 'quick-heard' && typeof r.text === 'string') {
          const last = turns.findLastIndex(t => t.role === 'assistant')
          if (last >= 0) turns[last] = { role: 'assistant', text: r.text, interrupted: true }
        }
      }
      return turns.slice(-12).map(r => ({ ...r, text: r.text.slice(0, 600) }))
    },
    process(nativeSession) {
      const rows = tailRows(file)
      const previous = rows.findLast(r => r.type === 'quick-process')?.nativeSessionId
      if (!existsSync(file) || statSync(file).size === 0) append({ type: 'quick-notice', text: QUICK_HISTORY_NOTICE })
      append({ type: 'quick-process', nativeSessionId: nativeSession, previousNativeSessionId: previous ?? null, text: 'Quick process started; continuing the same saved conversation. Unfinished work from an earlier app run is not automatically resent.' })
    },
    ask(r) { append({ type: r.kind === 'user' ? 'user' : 'quick-note', uuid: r.uuid, turnId: r.id, message: { role: 'user', content: r.text } }) },
    frame(uuid, f) {
      if (f.t === 'flush') return
      if (f.t === 'done') append({ type: 'assistant', turnUuid: uuid, turnId: f.id, cancelled: f.cancelled === true, message: { role: 'assistant', content: f.text } })
      else if (f.t === 'error') append({ type: 'quick-error', turnUuid: uuid, turnId: f.id, text: f.message })
      else if (f.t === 'delta') append({ type: 'quick-delta', turnUuid: uuid, turnId: f.id, text: f.text })
      else append({ type: 'quick-tool', turnUuid: uuid, turnId: f.id, text: f.name })
    },
    native(session, row) {
      if (row.type === 'assistant' || row.type === 'user' || row.type === 'result') append({ type: 'quick-native', nativeSessionId: session, row })
    },
    heard(text) { append({ type: 'quick-heard', text }) },
  }
}
