/**
 * Order odbd8 (Shubham, 14 Nov 2026: "Please tell someone to also include tab resource monitoring."): the Resources tab of PC control. What one PC
 * is using now, as its own agent sees it, READ ONLY: CPU (total and each core), memory (total, used, available), free space on each drive, the GPU,
 * network in and out, the top processes by memory and by CPU (with a line for the Claude and node processes), and CPU and memory over the last 15 minutes.
 *
 * - The page asks its own agent: GET /agent-api/pc-resources/pcs/<id> (owner only, like every core route), every few seconds while the tab is open.
 *   The Server answers for itself, and asks a member over their link (stream 'pc-resources-v1': one request line, one answer line), the same way as
 *   the Ports tab (shared/pc-ports.ts). A PC that is off, or runs a build without this stream, is said so.
 * - Nothing is stopped, ended or changed from here: there is no button that touches a process.
 * - What a member says is checked strictly by the Server (cleanResources) and again by the page: only numbers in range and short plain words.
 */

export const PC_RESOURCES_STREAM = 'pc-resources-v1'
export const PC_RESOURCES_PROTOCOL = 1 as const
/** The page's route on its own agent (under /agent-api). */
export const PC_RESOURCES_PREFIX = '/pc-resources'

/** How often the open tab asks again. */
export const RESOURCES_REFRESH_MS = 3000
/** How often each PC notes its CPU and memory for the graphs, and how far back the graphs go. */
export const HISTORY_STEP_MS = 3000
export const HISTORY_MS = 15 * 60_000
/** The most history points one report may carry (15 minutes every 3 seconds, and some slack). */
export const HISTORY_MAX_POINTS = 360
/** How many processes each top list has. */
export const TOP_PROCESSES = 15

const MB = 1024 * 1024
/** Available memory under this is low (amber): the merge queue's floor until 14 Nov (3 GB). */
export const MEMORY_LOW_BYTES = 3072 * MB
/** Available memory under this is critical (red): the merge queue's floor now (0.8 GB; wt.mjs DEFAULT_MIN_FREE_RAM_MB, order od066). */
export const MEMORY_CRITICAL_BYTES = 800 * MB

export type PcOs = 'windows' | 'linux' | 'mac' | 'other'

export interface CpuNow {
  /** The processor's name, e.g. "13th Gen Intel(R) Core(TM) i7-1355U"; null when unknown. */
  model: string | null
  /** How busy the whole CPU was over the last few seconds, 0-100. */
  total: number
  /** The same for each logical core, in order. */
  cores: number[]
}

export interface MemoryNow {
  /** Bytes in the PC. */
  total: number
  /** Bytes free for programs now (Windows "Available", Linux MemAvailable). Used = total - available. */
  available: number
}

export interface DiskNow {
  /** "C:" on Windows, the mount point ("/", "/home") on Linux. */
  name: string
  /** The drive's own label ("OS"), or null. */
  label: string | null
  total: number
  /** Bytes free for the user. */
  free: number
}

export interface GpuNow {
  name: string | null
  /** How busy, 0-100 (on Windows the busiest engine, as Task Manager says); null when this PC cannot tell. */
  busy: number | null
  /** Bytes of GPU memory in use, and in all; null when unknown. */
  memoryUsed: number | null
  memoryTotal: number | null
}

export interface NetAdapterNow {
  name: string
  /** Bytes a second, in (received) and out (sent), over the last few seconds. */
  inPerSec: number
  outPerSec: number
  /** A virtual adapter (Tailscale, a VPN, a container bridge): its traffic also crosses a real one, so it is not added to the totals. */
  virtual: boolean
}

export interface NetworkNow {
  /** All the real adapters together. */
  inPerSec: number
  outPerSec: number
  adapters: NetAdapterNow[]
}

export interface ProcessRow {
  pid: number
  name: string
  /** Bytes: Windows' private working set (Task Manager's Memory column), Linux's resident memory. */
  memory: number
  /** Share of the whole PC's CPU over the last few seconds, 0-100; null until a second look. */
  cpu: number | null
}

export type ProcessGroupKey = 'claude' | 'node'

export interface ProcessGroup {
  key: ProcessGroupKey
  /** How many processes, their memory together, and their CPU together (null until a second look). */
  count: number
  memory: number
  cpu: number | null
}

export interface ProcessesNow {
  /** Every process on the PC. */
  count: number
  byMemory: ProcessRow[]
  byCpu: ProcessRow[]
  /** The Claude and node processes, so the chats' share shows (the 'claude' line counts the chats' Claude processes). */
  groups: ProcessGroup[]
}

/** CPU and memory over the last 15 minutes, oldest first: when (ms since the epoch), CPU busy (0-100) and memory used (bytes). */
export interface ResourceHistory {
  t: number[]
  cpu: number[]
  used: number[]
}

export interface PcResourcesReport {
  protocol: 1
  pcId: string
  /** 'online': the PC answered now. 'offline': it is off or not connected. 'unsupported': its build cannot say (it needs an update). */
  connection: 'online' | 'offline' | 'unsupported'
  /** One plain sentence when the PC did not answer, or null. */
  reason: string | null
  /** When the PC looked (ISO time), or null. */
  at: string | null
  os: PcOs | null
  cpu: CpuNow | null
  memory: MemoryNow | null
  /** null: not known (yet); [] for none. */
  disks: DiskNow[] | null
  gpus: GpuNow[] | null
  network: NetworkNow | null
  processes: ProcessesNow | null
  history: ResourceHistory
  /** A plain sentence for each part that is missing or still being read ("Reading the processes…"). */
  notes: string[]
}

/** The request line the Server sends a member (one per stream). */
export interface PcResourcesRequest {
  protocol: 1
  targetId: string
}

export const PROCESS_GROUP_KEYS: readonly ProcessGroupKey[] = ['claude', 'node']

/**
 * Which line a process belongs to, by its name: 'claude' for Claude Code ("claude", "claude.exe", the bridge's own "claude-2.1.319.exe"),
 * 'node' for node; null for anything else.
 */
export function processGroupOf(name: string): ProcessGroupKey | null {
  const n = name.trim().toLowerCase().replace(/\.exe$/, '')
  if (/^claude(?:[-_ ]?\d+(?:\.\d+)*)?$/.test(n)) return 'claude'
  if (n === 'node') return 'node'
  return null
}

/** 'critical' under 0.8 GB available, 'low' under 3 GB, else 'ok'. */
export type MemoryLevel = 'ok' | 'low' | 'critical'
export function memoryLevel(available: number): MemoryLevel {
  if (available < MEMORY_CRITICAL_BYTES) return 'critical'
  if (available < MEMORY_LOW_BYTES) return 'low'
  return 'ok'
}

/** The report for a PC whose own answer is missing: why, and nothing else. */
export function unknownResources(pcId: string, connection: 'offline' | 'unsupported', reason: string): PcResourcesReport {
  return { protocol: PC_RESOURCES_PROTOCOL, pcId, connection, reason, at: null, os: null, cpu: null, memory: null, disks: null, gpus: null, network: null, processes: null, history: emptyHistory(), notes: [] }
}

export const emptyHistory = (): ResourceHistory => ({ t: [], cpu: [], used: [] })

// ---- strict checks: what a member says, before the Server passes it on, and what the page reads ----

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const PC_ID = /^[a-z0-9]{16}$/
/** The most bytes any amount here may be (1 PiB): a number past that is nonsense. */
const MAX_BYTES = 2 ** 50
const isNum = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const pct = (v: unknown): v is number => isNum(v, 0, 100)
const bytes = (v: unknown): v is number => isNum(v, 0, MAX_BYTES)
const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * Words a PC said, made plain: no control or direction characters, single spaces, at most `max` characters, and any e-mail address left out
 * (a drive's label can carry one). null when nothing is left.
 */
export function plainWords(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, ' ')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '…')
    .replace(/\s+/g, ' ')
    .trim()
  if (!s) return null
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

function cleanCpu(v: unknown): CpuNow | null {
  if (!obj(v) || !pct(v.total) || !Array.isArray(v.cores) || v.cores.length > 1024 || !v.cores.every(pct)) return null
  return { model: plainWords(v.model, 120), total: round1(v.total), cores: (v.cores as number[]).map(round1) }
}

function cleanMemory(v: unknown): MemoryNow | null {
  if (!obj(v) || !isNum(v.total, 1, MAX_BYTES) || !bytes(v.available) || v.available > v.total) return null
  return { total: v.total, available: v.available }
}

function cleanList<T>(v: unknown, max: number, one: (x: unknown) => T | null): T[] | null {
  if (v === null || v === undefined || !Array.isArray(v)) return null
  return v.slice(0, max).map(one).filter((x): x is T => x !== null)
}

const cleanDisk = (v: unknown): DiskNow | null => {
  if (!obj(v) || !bytes(v.total) || !bytes(v.free) || v.free > v.total) return null
  const name = plainWords(v.name, 64)
  return name ? { name, label: plainWords(v.label, 64), total: v.total, free: v.free } : null
}

const cleanGpu = (v: unknown): GpuNow | null => {
  if (!obj(v)) return null
  const n = (x: unknown, ok: (y: unknown) => boolean) => (x === null || x === undefined ? null : ok(x) ? (x as number) : undefined)
  const busy = n(v.busy, pct)
  const used = n(v.memoryUsed, bytes)
  const total = n(v.memoryTotal, bytes)
  if (busy === undefined || used === undefined || total === undefined) return null
  return { name: plainWords(v.name, 120), busy: busy === null ? null : round1(busy), memoryUsed: used, memoryTotal: total }
}

const rate = (v: unknown): v is number => isNum(v, 0, 1e13)

const cleanAdapter = (v: unknown): NetAdapterNow | null => {
  if (!obj(v) || !rate(v.inPerSec) || !rate(v.outPerSec) || typeof v.virtual !== 'boolean') return null
  const name = plainWords(v.name, 64)
  return name ? { name, inPerSec: v.inPerSec, outPerSec: v.outPerSec, virtual: v.virtual } : null
}

function cleanNetwork(v: unknown): NetworkNow | null {
  if (!obj(v) || !rate(v.inPerSec) || !rate(v.outPerSec)) return null
  return { inPerSec: v.inPerSec, outPerSec: v.outPerSec, adapters: cleanList(v.adapters, 16, cleanAdapter) ?? [] }
}

const cleanRow = (v: unknown): ProcessRow | null => {
  if (!obj(v) || !Number.isInteger(v.pid) || !isNum(v.pid, 0, 2 ** 32) || !bytes(v.memory) || !(v.cpu === null || pct(v.cpu))) return null
  return { pid: v.pid as number, name: plainWords(v.name, 64) ?? '(no name)', memory: v.memory, cpu: v.cpu === null ? null : round1(v.cpu as number) }
}

const cleanGroup = (v: unknown): ProcessGroup | null => {
  if (!obj(v) || !PROCESS_GROUP_KEYS.includes(v.key as ProcessGroupKey) || !Number.isInteger(v.count) || !isNum(v.count, 0, 1e6) || !bytes(v.memory) || !(v.cpu === null || pct(v.cpu))) return null
  return { key: v.key as ProcessGroupKey, count: v.count as number, memory: v.memory, cpu: v.cpu === null ? null : round1(v.cpu as number) }
}

function cleanProcesses(v: unknown): ProcessesNow | null {
  if (!obj(v) || !Number.isInteger(v.count) || !isNum(v.count, 0, 1e6)) return null
  const groups = cleanList(v.groups, PROCESS_GROUP_KEYS.length, cleanGroup) ?? []
  return {
    count: v.count as number,
    byMemory: cleanList(v.byMemory, TOP_PROCESSES, cleanRow) ?? [],
    byCpu: cleanList(v.byCpu, TOP_PROCESSES, cleanRow) ?? [],
    // One line per kind, in the usual order.
    groups: PROCESS_GROUP_KEYS.map(k => groups.find(g => g.key === k)).filter((g): g is ProcessGroup => !!g),
  }
}

/** The history, kept only when every point is whole and in time order; else empty. */
function cleanHistory(v: unknown): ResourceHistory {
  if (!obj(v) || !Array.isArray(v.t) || !Array.isArray(v.cpu) || !Array.isArray(v.used)) return emptyHistory()
  const n = v.t.length
  if (n > HISTORY_MAX_POINTS || v.cpu.length !== n || v.used.length !== n) return emptyHistory()
  for (let i = 0; i < n; i++) {
    const t = v.t[i]
    if (!Number.isInteger(t) || !isNum(t, 0, 8.64e15) || (i > 0 && t <= (v.t[i - 1] as number)) || !pct(v.cpu[i]) || !bytes(v.used[i])) return emptyHistory()
  }
  return { t: [...(v.t as number[])], cpu: (v.cpu as number[]).map(round1), used: [...(v.used as number[])] }
}

/** One PC's resources, as a member (or the page's own agent) said them, checked: throws only when it is not that PC's report at all. */
export function cleanResources(raw: unknown, pcId: string): PcResourcesReport {
  if (!obj(raw) || raw.protocol !== PC_RESOURCES_PROTOCOL || raw.pcId !== pcId || !PC_ID.test(pcId)) throw new Error('This is not that PC’s resources report.')
  if (!['online', 'offline', 'unsupported'].includes(String(raw.connection))) throw new Error('The resources report is incomplete.')
  const at = typeof raw.at === 'string' && Number.isFinite(Date.parse(raw.at)) ? raw.at : null
  return {
    protocol: PC_RESOURCES_PROTOCOL,
    pcId,
    connection: raw.connection as PcResourcesReport['connection'],
    reason: plainWords(raw.reason, 300),
    at,
    os: (['windows', 'linux', 'mac', 'other'] as const).find(o => o === raw.os) ?? null,
    cpu: cleanCpu(raw.cpu),
    memory: cleanMemory(raw.memory),
    disks: cleanList(raw.disks, 32, cleanDisk),
    gpus: cleanList(raw.gpus, 8, cleanGpu),
    network: cleanNetwork(raw.network),
    processes: cleanProcesses(raw.processes),
    history: cleanHistory(raw.history),
    notes: (cleanList(raw.notes, 8, x => plainWords(x, 200)) ?? []),
  }
}
