import os from 'node:os'
import { readFileSync } from 'node:fs'
import { HISTORY_MS, HISTORY_STEP_MS, type CpuNow, type MemoryNow, type ResourceHistory } from '../../shared/pc-resources.ts'

// Order odbd8: the Resources tab's CPU and memory, and their last 15 minutes for its graphs. Every PC notes them every 3 seconds from the moment its
// agent starts (os.cpus() and the memory counters: no program is started, it costs well under a millisecond), so the graphs are already full when
// the tab opens. Only the last 15 minutes are kept, in memory.

export interface CoreTimes {
  idle: number
  total: number
}

/** Each logical core's idle and total time so far (ms), from os.cpus(). */
export function coreTimes(cpus: readonly os.CpuInfo[]): CoreTimes[] {
  return cpus.map(c => {
    const t = c.times
    return { idle: t.idle, total: t.user + t.nice + t.sys + t.irq + t.idle }
  })
}

const round1 = (n: number) => Math.round(n * 10) / 10
const clamp = (n: number) => Math.min(100, Math.max(0, n))

/** How busy the CPU was between two readings, in total and per core (0-100); null when they do not match (a core came or went) or no time passed. */
export function busyBetween(a: readonly CoreTimes[], b: readonly CoreTimes[]): Omit<CpuNow, 'model'> | null {
  if (!a.length || a.length !== b.length) return null
  let idle = 0
  let total = 0
  const cores: number[] = []
  for (let i = 0; i < a.length; i++) {
    const di = b[i].idle - a[i].idle
    const dt = b[i].total - a[i].total
    if (dt < 0 || di < 0) return null
    idle += di
    total += dt
    cores.push(dt > 0 ? round1(clamp(100 * (1 - di / dt))) : 0)
  }
  if (total <= 0) return null
  return { total: round1(clamp(100 * (1 - idle / total))), cores }
}

/** Linux: MemAvailable and MemTotal from /proc/meminfo (bytes); null when it cannot be read. */
export function parseMeminfo(text: string): MemoryNow | null {
  const kb = (key: string) => {
    const m = new RegExp(`^${key}:\\s+(\\d+)\\s*kB`, 'm').exec(text)
    return m ? Number(m[1]) * 1024 : null
  }
  const total = kb('MemTotal')
  const available = kb('MemAvailable')
  if (!total || available === null || available > total) return null
  return { total, available }
}

/** This PC's memory now: Linux reads MemAvailable itself; Windows' os.freemem() is its "Available" already. */
export function memoryNow(platform: NodeJS.Platform = process.platform): MemoryNow {
  if (platform === 'linux') {
    try {
      const m = parseMeminfo(readFileSync('/proc/meminfo', 'utf8'))
      if (m) return m
    } catch {
      // Falls back to Node's own numbers below.
    }
  }
  const total = os.totalmem()
  return { total, available: Math.min(total, os.freemem()) }
}

export interface SamplerOptions {
  stepMs?: number
  keepMs?: number
  now?: () => number
  cpus?: () => readonly os.CpuInfo[]
  memory?: () => MemoryNow
}

export interface Latest {
  at: number
  cpu: CpuNow | null
  memory: MemoryNow
}

export interface Sampler {
  start(): void
  stop(): void
  /** One look now (the timer's job; tests call it). */
  tick(): void
  latest(): Latest | null
  history(): ResourceHistory
}

export function createSampler(o: SamplerOptions = {}): Sampler {
  const stepMs = o.stepMs ?? HISTORY_STEP_MS
  const keepMs = o.keepMs ?? HISTORY_MS
  const now = o.now ?? Date.now
  const cpus = o.cpus ?? os.cpus
  const memory = o.memory ?? (() => memoryNow())
  let timer: NodeJS.Timeout | null = null
  let before: CoreTimes[] | null = null
  let last: Latest | null = null
  const points: { t: number; cpu: number; used: number }[] = []

  function tick() {
    const at = now()
    let info: readonly os.CpuInfo[] = []
    try {
      info = cpus()
    } catch {
      // No CPU numbers this time; memory is still noted.
    }
    const times = coreTimes(info)
    const busy = before ? busyBetween(before, times) : null
    before = times
    let mem: MemoryNow
    try {
      mem = memory()
    } catch {
      return
    }
    const model = info[0]?.model?.trim() || null
    last = { at, cpu: busy ? { model, ...busy } : null, memory: mem }
    if (busy) {
      // Time only goes forward in the graph (a clock set back starts it afresh).
      if (points.length && at <= points[points.length - 1].t) points.length = 0
      points.push({ t: Math.round(at), cpu: busy.total, used: Math.max(0, mem.total - mem.available) })
    }
    while (points.length && points[0].t < at - keepMs) points.shift()
  }

  return {
    start() {
      if (timer) return
      tick()
      timer = setInterval(tick, stepMs)
      timer.unref()
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
    },
    tick,
    latest: () => last,
    history: () => ({ t: points.map(p => p.t), cpu: points.map(p => p.cpu), used: points.map(p => p.used) }),
  }
}
