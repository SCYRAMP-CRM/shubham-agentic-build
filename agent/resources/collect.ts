import os from 'node:os'
import { PC_RESOURCES_PROTOCOL, PROCESS_GROUP_KEYS, TOP_PROCESSES, processGroupOf, type DiskNow, type GpuNow, type NetAdapterNow, type NetworkNow, type PcOs, type PcResourcesReport, type ProcessesNow, type ProcessRow } from '../../shared/pc-resources.ts'
import { cpuBetween, createLinuxGpu, readDisks, readNetwork, readProcesses, virtualLinuxNic, type LinuxGpuReader, type LinuxProc, type NicCount } from './linux.ts'
import type { Sampler } from './sampler.ts'
import type { WinNic, WinSample, WindowsSampler } from './windows.ts'

// Order odbd8: one PC's Resources report, put together from what it reads (sampler.ts for CPU and memory and their graphs; windows.ts or linux.ts for
// processes, drives, GPU and network). Each part that is missing says why in `notes`; nothing here changes anything on the PC.

const round1 = (n: number) => Math.round(n * 10) / 10

/** The top lists and the Claude and node lines, from every process (cpu null = not measured yet). */
export function summarizeProcesses(all: readonly ProcessRow[], top = TOP_PROCESSES): ProcessesNow {
  const rows = all.map(p => ({ ...p, cpu: p.cpu === null ? null : round1(p.cpu) }))
  const byMemory = [...rows].sort((a, b) => b.memory - a.memory || a.pid - b.pid).slice(0, top)
  const measured = rows.filter(p => p.cpu !== null)
  const byCpu = [...measured].sort((a, b) => (b.cpu as number) - (a.cpu as number) || b.memory - a.memory || a.pid - b.pid).slice(0, top)
  const groups = PROCESS_GROUP_KEYS.map(key => {
    const members = rows.filter(p => processGroupOf(p.name) === key)
    return {
      key,
      count: members.length,
      memory: members.reduce((sum, p) => sum + p.memory, 0),
      cpu: measured.length ? round1(Math.min(100, members.reduce((sum, p) => sum + (p.cpu ?? 0), 0))) : null,
    }
  })
  return { count: rows.length, byMemory, byCpu, groups }
}

/** Bytes a second in and out of each adapter between two looks, and the real adapters' totals; null when no time passed. */
export function networkBetween(before: { t: number; nics: readonly NicCount[] }, after: { t: number; nics: readonly NicCount[] }, isVirtual: (name: string) => boolean): NetworkNow | null {
  const seconds = (after.t - before.t) / 1000
  if (!(seconds > 0)) return null
  const old = new Map(before.nics.map(n => [n.name, n]))
  const adapters: NetAdapterNow[] = []
  for (const n of after.nics) {
    const o = old.get(n.name)
    if (!o) continue
    // A counter that went back (the adapter was reset) counts as no traffic, never as a negative rate.
    adapters.push({ name: n.name, inPerSec: Math.round(Math.max(0, n.rx - o.rx) / seconds), outPerSec: Math.round(Math.max(0, n.tx - o.tx) / seconds), virtual: isVirtual(n.name) })
  }
  adapters.sort((a, b) => Number(a.virtual) - Number(b.virtual) || b.inPerSec + b.outPerSec - (a.inPerSec + a.outPerSec) || a.name.localeCompare(b.name))
  const real = adapters.filter(a => !a.virtual)
  return { inPerSec: real.reduce((s, a) => s + a.inPerSec, 0), outPerSec: real.reduce((s, a) => s + a.outPerSec, 0), adapters: adapters.slice(0, 16) }
}

/** Windows: an adapter whose traffic also crosses a real one (Tailscale's Wintun is type 53, tunnels 131, and Hyper-V, VPN and VM adapters by name). */
export function virtualWindowsNic(n: Pick<WinNic, 'name' | 'description' | 'type'>): boolean {
  return n.type === 53 || n.type === 131 || /virtual|vpn|tap-|wintun|hyper-v|vethernet|tailscale|zerotier|wireguard|vmware|virtualbox|loopback/i.test(`${n.name} ${n.description}`)
}

/** Display adapters that are not a GPU of this PC (Windows' basic and remote-desktop drivers, virtual screens). */
const notAGpu = (name: string) => /^microsoft (basic|remote)|virtual|\bidd\b|parsec|spacedesk|rustdesk|dummy/i.test(name)

/** Windows: one line for the PC's GPU(s): the busiest engine (as Task Manager's GPU column), and the GPU memory in use (dedicated and shared). */
export function windowsGpus(s: Pick<WinSample, 'gpus' | 'gpuNames'>): GpuNow[] {
  const names = s.gpuNames.filter(n => n.trim() && !notAGpu(n))
  const engines = s.gpus ?? []
  if (!names.length && !engines.length) return []
  const busy = engines.map(g => g.busy).filter((b): b is number => b !== null)
  const used = engines.map(g => (g.dedicated ?? 0) + (g.shared ?? 0))
  return [{
    name: names.length ? names.join(' + ') : null,
    busy: busy.length ? round1(Math.min(100, Math.max(...busy))) : null,
    memoryUsed: engines.some(g => g.dedicated !== null || g.shared !== null) ? used.reduce((a, b) => a + b, 0) : null,
    memoryTotal: null,
  }]
}

export function osOf(platform: NodeJS.Platform): PcOs {
  return platform === 'win32' ? 'windows' : platform === 'linux' ? 'linux' : platform === 'darwin' ? 'mac' : 'other'
}

export interface ResourceReaderOptions {
  selfId: string
  sampler: Sampler
  platform?: NodeJS.Platform
  /** Windows' reader (windows.ts); null elsewhere. */
  windows?: WindowsSampler | null
  /** Linux's /proc (tests give their own folder) and GPU reader. */
  proc?: string
  linuxGpu?: LinuxGpuReader
  now?: () => number
  cores?: () => number
}

export interface ResourceReader {
  report(): Promise<PcResourcesReport>
}

export function createResourceReader(o: ResourceReaderOptions): ResourceReader {
  const platform = o.platform ?? process.platform
  const now = o.now ?? Date.now
  const cores = o.cores ?? (() => os.availableParallelism())
  const proc = o.proc ?? '/proc'
  const gpu = o.linuxGpu ?? createLinuxGpu()
  // Linux: the last look at the processes and the network (for CPU and rates), and the drives (asked again every 30 s).
  let procsBefore: { t: number; list: LinuxProc[] } | null = null
  let nicsBefore: { t: number; nics: NicCount[] } | null = null
  let lastLinux: { t: number; processes: ProcessesNow | null; network: NetworkNow | null; networkFailed: boolean } | null = null
  let disks: { t: number; list: DiskNow[] } | null = null

  async function linuxParts(notes: string[]) {
    const t = now()
    // Two asks at once (the page and the Server) share one look.
    if (lastLinux && t - lastLinux.t < 1000) return lastLinux
    let processes: ProcessesNow | null = null
    try {
      const list = await readProcesses(proc)
      const before = procsBefore && t - procsBefore.t <= 60_000 ? procsBefore : null
      const cpu = before ? cpuBetween(before.list, list, (t - before.t) / 1000, cores()) : new Map<number, number>()
      processes = summarizeProcesses(list.map(p => ({ pid: p.pid, name: p.name, memory: p.memory, cpu: cpu.get(p.pid) ?? null })))
      procsBefore = { t, list }
    } catch {
      notes.push('The processes could not be read on this PC.')
    }
    let network: NetworkNow | null = null
    let networkFailed = false
    try {
      const nics = await readNetwork(proc)
      network = nicsBefore && t - nicsBefore.t <= 60_000 ? networkBetween(nicsBefore, { t, nics }, virtualLinuxNic) : null
      nicsBefore = { t, nics }
    } catch {
      networkFailed = true
      notes.push('The network could not be read on this PC.')
    }
    lastLinux = { t, processes, network, networkFailed }
    return lastLinux
  }

  async function report(): Promise<PcResourcesReport> {
    const notes: string[] = []
    let networkFailed = false
    let latest = o.sampler.latest()
    if (!latest) {
      o.sampler.tick()
      latest = o.sampler.latest()
    }
    const base: PcResourcesReport = {
      protocol: PC_RESOURCES_PROTOCOL,
      pcId: o.selfId,
      connection: 'online',
      reason: null,
      at: new Date(now()).toISOString(),
      os: osOf(platform),
      cpu: latest?.cpu ?? null,
      memory: latest?.memory ?? null,
      disks: null,
      gpus: null,
      network: null,
      processes: null,
      history: o.sampler.history(),
      notes,
    }
    if (!base.cpu) notes.push('The CPU is being measured; it shows in a few seconds.')

    if (platform === 'win32' && o.windows) {
      o.windows.touch()
      const l = o.windows.latest()
      if (!l) {
        notes.push(o.windows.problem() ?? 'Reading the processes, drives, GPU and network: the first look takes a few seconds.')
        return base
      }
      const s = l.now
      if (s.procs) base.processes = summarizeProcesses(s.procs)
      else notes.push('The processes could not be read on this PC.')
      base.disks = s.disks ? s.disks.map(d => ({ name: d.name, label: d.label.trim() || null, total: d.total, free: d.free })) : null
      if (!s.disks) notes.push('The drives are being read.')
      base.gpus = windowsGpus(s)
      if (s.nics && l.before?.nics) {
        const names = new Map(s.nics.map(n => [n.name, n]))
        base.network = networkBetween({ t: l.before.t, nics: l.before.nics }, { t: s.t, nics: s.nics }, name => virtualWindowsNic(names.get(name) ?? { name, description: '', type: 0 }))
      }
    } else if (platform === 'linux') {
      const parts = await linuxParts(notes)
      base.processes = parts.processes
      base.network = parts.network
      networkFailed = parts.networkFailed
      try {
        if (!disks || now() - disks.t > 30_000) disks = { t: now(), list: await readDisks(proc) }
        base.disks = disks.list
      } catch {
        notes.push('The drives could not be read on this PC.')
      }
      try {
        base.gpus = await gpu.read()
      } catch {
        notes.push('The GPU could not be read on this PC.')
      }
    } else {
      notes.push('Processes, drives, the GPU and the network are read on Windows and Linux only.')
    }
    if (base.processes && !base.processes.byCpu.length && base.processes.count > 0) notes.push('CPU for each process shows from the next look, in a few seconds.')
    if (!base.network && !networkFailed && (platform === 'win32' || platform === 'linux')) notes.push('The network speed shows from the next look, in a few seconds.')
    return base
  }

  return { report }
}
