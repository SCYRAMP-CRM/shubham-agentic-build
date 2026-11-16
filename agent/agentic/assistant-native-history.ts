import { closeSync, fsyncSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, writeSync } from 'node:fs'
import path from 'node:path'
import { apiError } from '../api.ts'

// oc65c: the owner's Assistant can go on in a NEW native Claude session inside the same run (/clear, /resume). The chat pool follows it only
// while the process lives, so after a stop, a crash, a restart or an Update the app reopened the OLD session and the newer conversation was
// left behind. These receipts keep that lineage on disk; the open path (index.ts followNativeSuccessor) continues in the newest one.
// Metadata only: who, which agent and app binding, which native session and when. Never a prompt, tool input or result, chat key, cookie,
// file path from a client or provider setting. The native JSONLs themselves are never written, moved or concatenated here.

export interface AssistantNativeBinding {
  ownerId: string
  floorId: string
  agentId: string
  appSessionId: string
}
export interface AssistantNativeReceipt extends AssistantNativeBinding {
  v: 1
  type: 'assistant-native-session'
  nativeSessionId: string
  observedAt: string
  reportedBy: 'native-hook'
}
export interface AssistantNativeSnapshot {
  file: string
  bytes: number
  receipts: AssistantNativeReceipt[]
  /** Torn or unreadable lines: the complete receipts are still used, and the page says some may be missing. */
  problem: string | null
}
const ID = /^[0-9a-z-]{8,64}$/i
const NATIVE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const RECEIPTS_INCOMPLETE = 'Some saved native-session receipts are incomplete. The complete ones are still followed and listed, and every native conversation file is kept as it is; a newer session may be missing from this list.'
const bindingOk = (b: AssistantNativeBinding) => [b.ownerId, b.floorId, b.agentId, b.appSessionId].every(s => typeof s === 'string' && ID.test(s))
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
// A floor is provenance, not identity: moving the SAME owned agent to another floor keeps its receipts.
const sameBinding = (r: AssistantNativeBinding, b: AssistantNativeBinding) => r.ownerId === b.ownerId && r.agentId === b.agentId && same(r.appSessionId, b.appSessionId)
const KEYS = 9

export function assistantNativeHistoryFile(dir: string, person: string): string {
  if (!ID.test(person)) throw apiError(400, 'Invalid history owner')
  return path.join(dir, 'assistant-history', person.toLowerCase(), 'claude-sessions.jsonl')
}

export function createAssistantNativeHistory(dir: string, now = Date.now) {
  function snapshot(person: string): AssistantNativeSnapshot {
    const file = assistantNativeHistoryFile(dir, person)
    const receipts: AssistantNativeReceipt[] = []
    let bytes = 0, problem: string | null = null
    try {
      const buf = readFileSync(file)
      bytes = buf.length
      for (const line of buf.toString('utf8').split('\n')) {
        if (!line.trim()) continue
        try {
          const r = JSON.parse(line) as Partial<AssistantNativeReceipt>
          if (!r || typeof r !== 'object' || Object.keys(r).length !== KEYS || r.v !== 1 || r.type !== 'assistant-native-session'
            || !bindingOk(r as AssistantNativeBinding) || r.ownerId !== person || typeof r.nativeSessionId !== 'string' || !NATIVE.test(r.nativeSessionId)
            || r.reportedBy !== 'native-hook' || typeof r.observedAt !== 'string' || !Number.isFinite(Date.parse(r.observedAt))) { problem = RECEIPTS_INCOMPLETE; continue }
          receipts.push(r as AssistantNativeReceipt)
        } catch { problem = RECEIPTS_INCOMPLETE }
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') problem = RECEIPTS_INCOMPLETE
    }
    return { file, bytes, receipts, problem }
  }

  const latest = (b: AssistantNativeBinding) => snapshot(b.ownerId).receipts.findLast(r => sameBinding(r, b))?.nativeSessionId ?? null

  /**
   * Appends one receipt for the first prompt of a binding (proof that it has a conversation to keep) and whenever its native session changes.
   * A repeat of the last one adds nothing. Throws on a write that did not land.
   */
  function observe(b: AssistantNativeBinding, nativeSessionId: string): boolean {
    if (!bindingOk(b) || !NATIVE.test(nativeSessionId)) throw apiError(400, 'Invalid native history receipt')
    const last = latest(b)
    if (last !== null && same(last, nativeSessionId)) return false
    const file = assistantNativeHistoryFile(dir, b.ownerId)
    const record: AssistantNativeReceipt = { ownerId: b.ownerId, floorId: b.floorId, agentId: b.agentId, appSessionId: b.appSessionId,
      v: 1, type: 'assistant-native-session', nativeSessionId: nativeSessionId.toLowerCase(), observedAt: new Date(now()).toISOString(), reportedBy: 'native-hook' }
    mkdirSync(path.dirname(file), { recursive: true })
    const fd = openSync(file, 'a+', 0o600)
    try {
      // A power loss can leave a partial last line: its bytes are kept, and the next receipt starts on a line of its own.
      const size = fstatSync(fd).size
      let sep = ''
      if (size) {
        const end = Buffer.alloc(1)
        readSync(fd, end, 0, 1, size - 1)
        if (end[0] !== 10) sep = '\n'
      }
      const data = Buffer.from(`${sep}${JSON.stringify(record)}\n`)
      for (let at = 0; at < data.length;) {
        const n = writeSync(fd, data, at, data.length - at)
        if (n <= 0) throw new Error('the receipt write stopped')
        at += n
      }
      fsyncSync(fd)
    } finally { closeSync(fd) }
    return true
  }

  /** The native session this app binding went on in after its last /clear or /resume, or null when it is still its own. */
  function successor(b: AssistantNativeBinding): string | null {
    const next = latest(b)
    return next === null || same(next, b.appSessionId) ? null : next
  }

  /** Whether this person's Assistant hook ever reported a prompt in that native session: it had a conversation, so a missing file is a loss. */
  const hadPrompt = (ownerId: string, sessionId: string) => snapshot(ownerId).receipts.some(r => same(r.nativeSessionId, sessionId))

  return { snapshot, observe, successor, hadPrompt, forBinding: (b: AssistantNativeBinding) => snapshot(b.ownerId).receipts.filter(r => sameBinding(r, b)) }
}
