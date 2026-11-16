import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs'
import type { Floor, FloorAgent } from '../../shared/agentic.ts'
import type { AssistantHistoryEntry, AssistantHistoryPage } from '../../shared/assistant-history.ts'
import { apiError } from '../api.ts'

export const keepsAssistantHistory = (a: FloorAgent) => a.duty === 'orchestrator' || a.duty === 'person-assistant'
/** The hub's duty, or THIS person's own Assistant; a shared chat never becomes someone's own history. */
export function assistantsForPerson(floors: Floor[], person: string): { floor: Floor; agent: FloorAgent }[] {
  return floors.flatMap(floor => floor.agents.filter(a => keepsAssistantHistory(a) && a.owner?.id === person).map(agent => ({ floor, agent })))
}
export function requireSavedAssistant(file: string | null, previouslyUsed: boolean): void {
  if (previouslyUsed && (!file || !existsSync(file) || statSync(file).size === 0)) {
    throw Object.assign(apiError(409, 'This Assistant has previous history, but its saved conversation is unavailable here. Nothing was replaced or started empty. Restore the JSONL or open it on its home PC; the History view still lists the earlier bindings.'), { code: 'assistant-history-unavailable' })
  }
}

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const words = (v: unknown): string => typeof v === 'string' ? v : Array.isArray(v) ? v.flatMap(p => object(p) && typeof p.text === 'string' ? [p.text] : []).join('\n\n') : ''
function entriesOf(row: Record<string, unknown>, off: number): AssistantHistoryEntry[] {
  const at = typeof row.timestamp === 'string' ? row.timestamp : null
  const id = String(off)
  const msg = object(row.message) ? row.message : null
  if ((row.type === 'user' || row.type === 'assistant') && msg) {
    const text = words(msg.content)
    return text ? [{ id, role: row.type, text, at, ...(row.cancelled ? { partial: true } : {}) }] : []
  }
  // Native Codex history (including the original pre-Claude Assistant), not just Claude's copy of its conversion summary.
  if (row.type === 'response_item' && object(row.payload)) {
    const p = row.payload
    if (p.type === 'message' && (p.role === 'user' || p.role === 'assistant')) {
      const text = words(p.content)
      return text ? [{ id, role: p.role, text, at }] : []
    }
    if (typeof p.name === 'string') return [{ id, role: 'tool', text: p.name, at }]
  }
  if (row.type === 'quick-note' && msg) return [{ id, role: 'notice', text: words(msg.content), at }]
  // Completed/cancelled answers have one full canonical assistant row. Their individual streamed fragments remain in full JSONL mode.
  if (row.type === 'quick-delta') return []
  if (typeof row.type === 'string' && row.type.startsWith('quick-') && typeof row.text === 'string') {
    return [{ id, role: row.type === 'quick-tool' ? 'tool' : 'notice', text: row.text, at }]
  }
  return []
}

/**
 * Forward byte paging, starting at 0, with no tail/400-message retention cap. Reads at most 512 KiB (or one row up to 8 MiB).
 * JSONL mode is a lossless view of EVERY record, including tool inputs/results, malformed/torn lines and huge-record continuations.
 * Large records in message mode also fall back to lossless JSONL chunks instead of silently discarding their text.
 */
export function readAssistantHistory(file: string, offset = 0, jsonl = false, cap = 512 * 1024): AssistantHistoryPage {
  if (!Number.isSafeInteger(offset) || offset < 0) throw apiError(400, 'Expected a non-negative byte cursor')
  if (!existsSync(file)) throw apiError(404, 'The saved conversation is unavailable on this PC; it has not been replaced by an empty one.')
  const fd = openSync(file, 'r')
  try {
    const size = statSync(file).size
    if (offset > size) throw apiError(409, 'The source changed since this page was read. Start from the first message again.')
    let length = Math.min(cap, size - offset), buf = Buffer.alloc(length)
    let n = readSync(fd, buf, 0, length, offset)
    while (!jsonl && n === length && buf.indexOf(10) < 0 && offset + n < size && length < 8 * 1024 * 1024) {
      length = Math.min(length * 2, 8 * 1024 * 1024, size - offset)
      buf = Buffer.alloc(length); n = readSync(fd, buf, 0, length, offset)
    }
    buf = buf.subarray(0, n)
    let end = buf.lastIndexOf(10) + 1
    let fragments = jsonl
    if (end === 0 && buf.length) { end = buf.length; fragments = true }
    // Never split a UTF-8 codepoint between pages, including raw huge-record continuations.
    if (offset + end < size && end === buf.length) {
      let lead = end - 1
      while (lead >= 0 && (buf[lead] & 0xc0) === 0x80) lead--
      if (lead >= 0) { const b = buf[lead], count = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1; if (end - lead < count) end = lead }
    }
    const entries: AssistantHistoryEntry[] = []
    const text = buf.subarray(0, end).toString('utf8')
    if (fragments) entries.push({ id: String(offset), role: 'jsonl', text, at: null })
    else {
      let at = offset
      for (const line of text.split('\n')) {
        if (line) {
          try { const row: unknown = JSON.parse(line); if (object(row)) entries.push(...entriesOf(row, at)) }
          catch { entries.push({ id: String(at), role: 'jsonl', text: line, at: null }) }
        }
        at += Buffer.byteLength(line) + 1
      }
    }
    return { entries, next: offset + end < size ? offset + end : null, bytes: size, offset }
  } finally { closeSync(fd) }
}
