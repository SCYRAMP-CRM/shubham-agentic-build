// Order occ4c (16 Nov 2026, Shubham via the Assistant: "switch the Codex to pure Claude for Lead"): native Claude as a managed execution
// target, the mirror of execution-native.ts (native Codex). Until now the selection flow could carry a managed conversation only to Codex in
// Claude Code or native Codex, so an agent moved there (Lead, 14 Nov) could never come back: the floor edit rightly refuses an engine change on
// a managed agent, and every managed selection or open of native Claude answered 409 execution-capability-required.
// The selection (seal, fork, floor CAS) is the existing one: forkClaudeExecution carries the history into a fresh Claude conversation. This
// file starts that conversation with this PC's own Claude Code, at the exact executable it proved, and proves the run: the authenticated chat
// host's entry for it and the one OS child of that host running the proved executable on that exact session.
// A plain Claude chat (never managed: revision 0) is not admitted here; it keeps its legacy open.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { isDeepStrictEqual } from 'node:util'
import { assertExecutionCAS, CODEX_IN_CLAUDE_PROFILE, type ExecutionSnapshot } from '../../shared/chat-execution.ts'
import { executionHttpError } from '../../shared/chat-execution-http.ts'
import { assertPrivatePath, writePrivateAtomic } from '../codex-claude/storage.ts'
import type { ChatHostLink } from '../chathost/link.ts'
import type { ChatPool } from './chats.ts'
import type { ExecutionStartRequest, ExecutionRunObservation } from './execution-coordinator.ts'
import type { OpenIntent } from './execution-intents.ts'

export const NATIVE_CLAUDE_PROFILE = 'claude-native-v1' as const

export interface NativeClaudeProcess { pid: number; ppid: number; created: number; file: string; command: string }
interface NativeClaudeRecord {
  version: 1; engine: 'claude'; runId: string; binding: ExecutionStartRequest['binding']; scope: ExecutionStartRequest['scope'];
  startedAt?: string; process?: { pid: number; created: number }; binHash: string;
  host?: { hostPid: number; hostStartedAt: number };
  ended?: { at: number; hostPid: number; hostStartedAt: number };
}
export interface NativeClaudeOptions {
  directory: string; host: ChatHostLink; pool(): ChatPool;
  /** This PC's Claude Code, found the way the chat pool finds it (index.ts: o.claude ?? findClaude()). */
  bin(): string | null;
  open(request: ExecutionStartRequest, assertCurrent: () => void, executable: string): Promise<void>;
  guard(request: Pick<ExecutionStartRequest, 'scope' | 'binding'>): void;
  /** Current owner/actor/home authorization for observing an older run's end. Running proof still requires guard's complete current binding. */
  authorizeObservation?(request: Pick<ExecutionStartRequest, 'scope' | 'binding'>): void;
  /** The exact durable run must still own its one permitted start at dispatch. */
  dispatchGuard?(request: ExecutionStartRequest): void;
  /** Only a completed uncertain start with no pending/replayable dispatch may use absence recovery. */
  canConfirmAbsent?(intent: OpenIntent): boolean;
  processes?(hostPid: number): Promise<NativeClaudeProcess[]>;
  allProcesses?(): Promise<NativeClaudeProcess[]>;
}

/**
 * Which current conversations may select native Claude through the managed flow: one leaving native Codex (the same sources the native Codex
 * target admits) or Codex in Claude Code, or a managed native Claude one (revision 1 or more: it came from such a fork) opening again. A plain
 * Claude chat's computed claude-native-v1 at revision 0 is refused: it keeps its legacy open and is never turned into a managed one here.
 */
export function nativeClaudeSourceAllowed(source: ExecutionSnapshot): boolean {
  const profile = source.execution.profile
  return profile === 'codex-native-v1' || profile === CODEX_IN_CLAUDE_PROFILE || (profile === NATIVE_CLAUDE_PROFILE && source.executionRevision > 0)
}

const hashes = new Map<string, { identity: string; sha256: string }>()
/** sha256 of the file, read 1 MB at a time (Claude Code's executable is hundreds of MB); computed once per exact file identity. */
function contentHash(file: string, identity: string): string {
  const known = hashes.get(file)
  if (known?.identity === identity) return known.sha256
  const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(1 << 20), handle = fs.openSync(file, 'r')
  try {
    for (let read = fs.readSync(handle, buffer, 0, buffer.length, null); read > 0; read = fs.readSync(handle, buffer, 0, buffer.length, null)) hash.update(buffer.subarray(0, read))
  } finally { fs.closeSync(handle) }
  const sha256 = hash.digest('hex')
  hashes.set(file, { identity, sha256 })
  return sha256
}

/** Only a direct, absolute Claude Code executable (the native install's claude.exe). npm's claude.cmd runs node and a script: refused, never evaluated. */
export function nativeClaudeExecutable(file: string | null): { executable: string; fingerprint: string } {
  const refuse = (): never => { throw executionHttpError('execution-capability-required', 'capability') }
  if (!file || !path.isAbsolute(file) || !/\.exe$/i.test(file)) return refuse()
  let stat: fs.BigIntStats
  try { stat = fs.statSync(file, { bigint: true }) } catch { return refuse() }
  if (!stat.isFile()) return refuse()
  const identity = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`
  let sha256: string
  try { sha256 = contentHash(file, identity) } catch { return refuse() }
  return { executable: file, fingerprint: createHash('sha256').update(`${file}:${identity}:${sha256}`).digest('hex') }
}

const words = (command: string) => [...command.matchAll(/"([^"]*)"|([^\s"]+)/g)].map(part => part[1] ?? part[2])
/** Arguments that could put a Claude Code process on another conversation than the one it was started on. */
const SESSION_MOVERS = new Set(['--resume', '-r', '--session-id', '--continue', '-c', '--fork-session', '--from-pr'])

/**
 * The app's own native Claude launch (chats.ts): the proved executable, a child of this exact chat host started with the run, its session
 * first (--resume <id>, or --session-id <id> for a conversation not written yet) and nothing later that could move it. Exactly one such child.
 */
export function matchNativeClaudeProcess(rows: NativeClaudeProcess[], expected: {
  hostPid: number; hostStartedAt: number; reportedPid: number | undefined; startedAt: string; executable: string; sessionId: string;
}): NativeClaudeProcess | null {
  const started = Date.parse(expected.startedAt)
  const matches = rows.filter(row => {
    if (!Number.isSafeInteger(row.pid) || row.pid <= 0 || row.ppid !== expected.hostPid
      || !Number.isSafeInteger(row.created) || row.created < expected.hostStartedAt || !Number.isFinite(started)
      || Math.abs(row.created - started) > 10_000 || typeof row.file !== 'string'
      || path.resolve(row.file).toLowerCase() !== path.resolve(expected.executable).toLowerCase()
      || typeof row.command !== 'string') return false
    const w = words(row.command)
    return w.length >= 3 && (w[1] === '--resume' || w[1] === '--session-id') && w[2] === expected.sessionId && !w.slice(3).some(x => SESSION_MOVERS.has(x))
  })
  if (matches.length !== 1) return null
  if (expected.reportedPid !== undefined && expected.reportedPid !== 0 && expected.reportedPid !== matches[0].pid) return null
  return matches[0]
}

/** Uses the existing chat open with the proved executable. No credential reads, copies or refreshers. */
export function createNativeClaudeExecution(o: NativeClaudeOptions) {
  const recordFile = (runId: string) => {
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(runId)) throw executionHttpError('execution-invalid', 'runtime')
    return path.join(o.directory, `${runId}.native-claude.json`)
  }
  const capability = () => {
    if (process.platform !== 'win32' || process.arch !== 'x64' || !o.host.inspect || !o.host.current) throw executionHttpError('execution-capability-required', 'capability')
    const resolved = nativeClaudeExecutable(o.bin())
    return { bin: resolved.executable, binHash: resolved.fingerprint, host: { ...o.host.current() } }
  }
  /** A chat host entry of a plain native Claude run of this agent: never a bridge's, never a staff policy's. */
  const plainClaude = (meta: Record<string, unknown>, scope: ExecutionStartRequest['scope'], startedAt: string) => meta.engine === 'claude'
    && meta.floorId === scope.floorId && meta.agentId === scope.agentId && meta.startedAt === startedAt
    && !Object.hasOwn(meta, 'bridgeRunId') && !Object.hasOwn(meta, 'execution') && !Object.hasOwn(meta, 'policy')
  async function observe(intent: OpenIntent): Promise<ExecutionRunObservation> {
    const binding = intent.binding, scope = intent.scope
    const authorize = () => (o.authorizeObservation ?? o.guard)({ binding, scope })
    authorize()
    if (binding.execution.profile !== NATIVE_CLAUDE_PROFILE || !binding.sessionId || binding.codexThread || binding.opencodeSession) return { state: 'unknown' }
    const sid = binding.sessionId
    const file = recordFile(intent.runId)
    if (!fs.existsSync(file)) return { state: 'unknown' }
    assertPrivatePath(file)
    const record = JSON.parse(fs.readFileSync(file, 'utf8')) as NativeClaudeRecord
    assertExecutionCAS(binding, record.binding)
    if (record.version !== 1 || record.engine !== 'claude' || record.runId !== intent.runId || !isDeepStrictEqual(record.scope, scope)
      || typeof record.startedAt !== 'string' || !Number.isFinite(Date.parse(record.startedAt))) return { state: 'unknown' }
    if (record.ended && Number.isSafeInteger(record.ended.at) && record.ended.at >= Date.parse(record.startedAt)
      && Number.isSafeInteger(record.ended.hostPid) && record.ended.hostPid > 0 && Number.isSafeInteger(record.ended.hostStartedAt)
      && record.ended.hostStartedAt <= Date.parse(record.startedAt)) return { state: 'ended', dispatchFenced: true }
    if (record.ended) return { state: 'unknown' }
    const target = capability(), observation = await o.host.inspect!()
    const fence = () => {
      authorize()
      const current = capability()
      if (!isDeepStrictEqual(current.host, target.host) || current.binHash !== target.binHash || record.binHash !== target.binHash
        || record.host && (record.host.hostPid !== target.host.hostPid || record.host.hostStartedAt !== target.host.hostStartedAt)
        || observation.hostPid !== target.host.hostPid || observation.hostStartedAt !== target.host.hostStartedAt) throw executionHttpError('execution-runtime-mismatch', 'runtime')
    }
    fence()
    const chat = observation.chats.find(c => c.id === sid)
    const possible = (rows: NativeClaudeProcess[]) => rows.some(row => {
      if (record.process && row.pid === record.process.pid && row.created === record.process.created) return true
      if (typeof row.command !== 'string') return true
      return words(row.command).includes(sid)
    })
    const saveEnd = (extra?: () => void): ExecutionRunObservation => {
      record.ended = { at: Date.now(), hostPid: target.host.hostPid, hostStartedAt: target.host.hostStartedAt }
      writePrivateAtomic(file, JSON.stringify(record) + '\n', () => { fence(); extra?.() })
      return { state: 'ended', dispatchFenced: true }
    }
    if (!chat) {
      // The authenticated host removes entries only after exit. Unlike a bare missing PID, recovery additionally requires a completed managed
      // start, an exact durable no-dispatch fence and a machine-wide process scan.
      if (!o.canConfirmAbsent?.(intent) || Date.parse(record.startedAt) < target.host.hostStartedAt
        || record.host && (record.host.hostPid !== target.host.hostPid || record.host.hostStartedAt !== target.host.hostStartedAt)) return { state: 'unknown' }
      const rows = await (o.allProcesses ?? (() => nativeClaudeProcesses()))()
      fence()
      if (possible(rows) || !o.canConfirmAbsent(intent)) return { state: 'unknown' }
      return saveEnd(() => { if (!o.canConfirmAbsent?.(intent)) throw executionHttpError('execution-intent-uncertain', 'runtime') })
    }
    if (!plainClaude(chat.meta, scope, record.startedAt)) return { state: 'unknown' }
    const rows = await (o.processes ?? nativeClaudeProcesses)(target.host.hostPid)
    fence()
    if (chat.exited) {
      const started = Date.parse(record.startedAt)
      if (!Number.isFinite(started) || started < target.host.hostStartedAt || !Number.isFinite(chat.exited.at) || chat.exited.at < started) return { state: 'unknown' }
      const stillPossible = rows.some(row => {
        if (record.process && row.pid === record.process.pid && row.created === record.process.created) return true
        if (chat.pid && row.pid === chat.pid) return true
        if (row.ppid !== target.host.hostPid || typeof row.command !== 'string') return false
        return words(row.command).includes(sid)
      })
      // A positive exit from the same authenticated host incarnation and exact owned start fences delayed dispatch, even when the process
      // exited before the first OS-proof poll. Any possible survivor keeps it uncertain.
      if (stillPossible) return { state: 'unknown' }
      return saveEnd()
    }
    const actual = matchNativeClaudeProcess(rows, { hostPid: target.host.hostPid, hostStartedAt: target.host.hostStartedAt,
      reportedPid: chat.pid, startedAt: record.startedAt, executable: target.bin, sessionId: sid })
    const info = o.pool().info(sid)
    o.guard({ binding, scope })
    if (!actual || info?.engine !== 'claude' || info.startedAt !== record.startedAt || info.execution || info.bridgeRunId || info.policy) return { state: 'unknown' }
    if (record.process && (record.process.pid !== actual.pid || record.process.created !== actual.created)) return { state: 'unknown' }
    if (!record.process) {
      record.process = { pid: actual.pid, created: actual.created }
      writePrivateAtomic(file, JSON.stringify(record) + '\n', () => { fence(); o.guard({ binding, scope }) })
    }
    return { state: 'running', proof: { version: 1, runId: intent.runId, targetPcId: scope.targetPcId, verified: true, binding, execution: binding.execution } }
  }
  return { capability, observe,
    async start(request: ExecutionStartRequest) {
      o.guard(request)
      o.dispatchGuard?.(request)
      if (request.kind !== 'native' || request.binding.execution.profile !== NATIVE_CLAUDE_PROFILE || !request.binding.sessionId
        || request.binding.codexThread || request.binding.opencodeSession || request.signal.aborted) throw executionHttpError('execution-invalid', 'open')
      const sid = request.binding.sessionId, file = recordFile(request.runId), target = capability()
      if (fs.existsSync(file) || o.pool().info(sid)) throw executionHttpError('execution-intent-uncertain', 'open')
      const record: NativeClaudeRecord = { version: 1, engine: 'claude', runId: request.runId, scope: request.scope, binding: request.binding, binHash: target.binHash,
        host: { hostPid: target.host.hostPid, hostStartedAt: target.host.hostStartedAt } }
      writePrivateAtomic(file, JSON.stringify(record) + '\n')
      const assertCurrent = () => {
        o.guard(request)
        o.dispatchGuard?.(request)
        const current = capability()
        if (request.signal.aborted || current.binHash !== target.binHash || !isDeepStrictEqual(current.host, target.host)) throw executionHttpError('execution-runtime-mismatch', 'runtime')
      }
      assertCurrent()
      await o.open(request, assertCurrent, target.bin)
      assertCurrent()
      const info = o.pool().info(sid)
      if (request.signal.aborted || info?.engine !== 'claude' || info.execution || info.bridgeRunId || info.policy
        || !isDeepStrictEqual(capability().host, target.host)) throw executionHttpError('execution-runtime-mismatch', 'runtime')
      record.startedAt = info.startedAt
      writePrivateAtomic(file, JSON.stringify(record) + '\n')
    },
  }
}

function nativeClaudeProcesses(hostPid?: number): Promise<NativeClaudeProcess[]> {
  if (hostPid !== undefined && (!Number.isSafeInteger(hostPid) || hostPid <= 0)) return Promise.reject(Error('Invalid host identity'))
  const filter = hostPid === undefined ? '"Name=\'claude.exe\'"' : `'ParentProcessId=${hostPid}'`
  const script = `@(Get-CimInstance Win32_Process -Filter ${filter} -ErrorAction Stop | ForEach-Object {@{pid=[int]$_.ProcessId;ppid=[int]$_.ParentProcessId;created=([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds();file=$_.ExecutablePath;command=$_.CommandLine}}) | ConvertTo-Json -Depth 3 -Compress`
  return new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { encoding: 'utf8', timeout: 8000, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) return reject(Error('Native process ownership could not be observed'))
      try { const rows = JSON.parse(stdout || '[]'); if (!Array.isArray(rows) && (!rows || typeof rows !== 'object')) throw Error('Invalid process observation'); resolve(Array.isArray(rows) ? rows : [rows]) } catch { reject(Error('Native process ownership could not be observed')) }
    }))
}
