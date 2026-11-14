import { execFile } from 'node:child_process'
import { readdir, readFile, statfs } from 'node:fs/promises'
import type { DiskNow, GpuNow } from '../../shared/pc-resources.ts'

// Order odbd8: on Linux (the Z800), the Resources tab's processes, drives, GPU and network are read straight from /proc and /sys by the agent itself,
// only when somebody asks (no program runs for them, except nvidia-smi and lspci for the GPU, if the PC has them). Read only.

/** USER_HZ: the kernel's clock ticks a second in /proc/<pid>/stat (100 on every mainstream Linux). */
export const CLOCK_TICKS = 100

export interface LinuxProc {
  pid: number
  name: string
  /** CPU time so far, in clock ticks (user + system). */
  ticks: number
  /** Resident memory, bytes. */
  memory: number
}

/** One /proc/<pid>/stat line: its name (between the first "(" and the last ")"), CPU ticks and resident pages; null when it is not one. */
export function parsePidStat(text: string, pageSize: number): Omit<LinuxProc, 'pid'> | null {
  const open = text.indexOf('(')
  const close = text.lastIndexOf(')')
  if (open < 0 || close < open) return null
  const name = text.slice(open + 1, close)
  const rest = text.slice(close + 2).trim().split(/\s+/)
  // After the name: state (field 3) ... utime (14), stime (15) ... rss (24).
  const utime = Number(rest[11])
  const stime = Number(rest[12])
  const rss = Number(rest[21])
  if (![utime, stime, rss].every(n => Number.isFinite(n) && n >= 0)) return null
  return { name, ticks: utime + stime, memory: rss * pageSize }
}

/** The memory page size, from this process's own numbers (resident bytes / resident pages): 4 KiB on almost every PC. */
export function pageSizeOf(rssBytes: number, rssPages: number): number {
  if (!(rssPages > 0) || !(rssBytes > 0)) return 4096
  const guess = rssBytes / rssPages
  return [4096, 16384, 65536].reduce((best, size) => (Math.abs(size - guess) < Math.abs(best - guess) ? size : best), 4096)
}

let pageSize: number | null = null
async function ownPageSize(proc: string): Promise<number> {
  if (pageSize) return pageSize
  try {
    const own = await readFile(`${proc}/self/stat`, 'utf8')
    const close = own.lastIndexOf(')')
    const pages = Number(own.slice(close + 2).trim().split(/\s+/)[21])
    pageSize = pageSizeOf(process.memoryUsage().rss, pages)
  } catch {
    pageSize = 4096
  }
  return pageSize
}

/**
 * The kernel keeps only 15 characters of a name ("Isolated Web Co", "next-server (v1"), and some programs call their main thread "MainThread" (seen on
 * the Z800, 14 Nov 2026). For those the name is the program's own file name instead: the last part of the first word of /proc/<pid>/cmdline, never
 * its arguments. null when that says nothing (a kernel thread).
 */
export const needsFullName = (name: string) => name.length >= 15 || name === 'MainThread'
export function programName(cmdline: string): string | null {
  const first = cmdline.split('\0')[0]?.trim().split(/\s+/)[0] ?? ''
  const base = first.split('/').filter(Boolean).at(-1)?.replace(/:$/, '') ?? ''
  return base ? base.slice(0, 64) : null
}

/** Every process now (those that end while being read are skipped). */
export async function readProcesses(proc = '/proc'): Promise<LinuxProc[]> {
  const size = await ownPageSize(proc)
  const names = (await readdir(proc)).filter(n => /^\d+$/.test(n))
  const out = await Promise.all(names.map(async n => {
    try {
      const p = parsePidStat(await readFile(`${proc}/${n}/stat`, 'utf8'), size)
      if (!p) return null
      if (needsFullName(p.name)) {
        const full = programName(await readFile(`${proc}/${n}/cmdline`, 'utf8').catch(() => ''))
        if (full) p.name = full
      }
      return { pid: Number(n), ...p }
    } catch {
      return null
    }
  }))
  return out.filter((p): p is LinuxProc => p !== null)
}

/** Each process's share of the whole PC's CPU between two looks (0-100), for the ones in both with the same name; others are absent. */
export function cpuBetween(before: readonly LinuxProc[], after: readonly LinuxProc[], seconds: number, cores: number, hz = CLOCK_TICKS): Map<number, number> {
  const out = new Map<number, number>()
  if (!(seconds > 0) || !(cores > 0)) return out
  const old = new Map(before.map(p => [p.pid, p]))
  for (const p of after) {
    const o = old.get(p.pid)
    if (!o || o.name !== p.name || p.ticks < o.ticks) continue
    out.set(p.pid, Math.min(100, Math.round(((p.ticks - o.ticks) / hz / seconds / cores) * 10000) / 100))
  }
  return out
}

// ---- network: /proc/net/dev

export interface NicCount {
  name: string
  rx: number
  tx: number
}

/** /proc/net/dev: each interface's bytes received and sent so far (the loopback left out). */
export function parseNetDev(text: string): NicCount[] {
  const out: NicCount[] = []
  for (const line of text.split('\n').slice(2)) {
    const i = line.indexOf(':')
    if (i < 0) continue
    const name = line.slice(0, i).trim()
    const f = line.slice(i + 1).trim().split(/\s+/).map(Number)
    if (!name || name === 'lo' || f.length < 9 || !Number.isFinite(f[0]) || !Number.isFinite(f[8])) continue
    out.push({ name, rx: f[0], tx: f[8] })
  }
  return out
}

/** A Linux interface whose traffic also crosses a real one (Tailscale, VPNs, containers, bridges). */
export const virtualLinuxNic = (name: string) => /^(lo|tailscale|tun|tap|docker|br-|veth|virbr|vnet|wg|zt|lxc|lxd|flannel|cni|kube|podman|vboxnet|vmnet|cali|weave)/.test(name)

export async function readNetwork(proc = '/proc'): Promise<NicCount[]> {
  return parseNetDev(await readFile(`${proc}/net/dev`, 'utf8'))
}

// ---- drives: /proc/mounts + statfs

const REAL_FS = new Set(['ext2', 'ext3', 'ext4', 'xfs', 'btrfs', 'f2fs', 'jfs', 'reiserfs', 'zfs', 'vfat', 'exfat', 'ntfs', 'ntfs3', 'fuseblk', 'hfsplus', 'bcachefs', 'nilfs2'])

export interface Mount {
  device: string
  mount: string
  type: string
}

/** /proc/mounts: the mounts of real disks, one per device (the first, usually the shortest path), without snaps and system places. */
export function parseMounts(text: string): Mount[] {
  const seen = new Set<string>()
  const out: Mount[] = []
  const unescape = (s: string) => s.replace(/\\([0-7]{3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8)))
  for (const line of text.split('\n')) {
    const [device, mount, type] = line.trim().split(/\s+/)
    if (!device || !mount || !REAL_FS.has(type)) continue
    if (type !== 'zfs' && !device.startsWith('/dev/')) continue
    const where = unescape(mount)
    if (/^\/(snap|var\/snap|run|proc|sys|dev)(\/|$)/.test(where) || where.startsWith('/var/lib/docker')) continue
    if (seen.has(device)) continue
    seen.add(device)
    out.push({ device, mount: where, type })
  }
  return out
}

type StatFs = (path: string) => Promise<{ bsize: number; blocks: number; bavail: number }>

/** Each real drive's size and the space free for the user (what df calls Avail). A drive that does not answer within 2 s is left out. */
export async function readDisks(proc = '/proc', stat: StatFs = p => statfs(p)): Promise<DiskNow[]> {
  const mounts = parseMounts(await readFile(`${proc}/mounts`, 'utf8')).slice(0, 24)
  const one = async (m: Mount): Promise<DiskNow | null> => {
    let timer: NodeJS.Timeout | undefined
    try {
      const s = await Promise.race([stat(m.mount), new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 2000) })])
      if (!s || !(s.blocks > 0)) return null
      return { name: m.mount, label: null, total: s.blocks * s.bsize, free: Math.min(s.blocks, s.bavail) * s.bsize }
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }
  return (await Promise.all(mounts.map(one))).filter((d): d is DiskNow => d !== null)
}

// ---- GPU: nvidia-smi, the amdgpu driver's own files, or only the names (lspci)

/** nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits (MiB). "[N/A]" is unknown. */
export function parseNvidiaSmi(text: string): GpuNow[] {
  const num = (s: string | undefined) => {
    const n = Number((s ?? '').trim())
    return s !== undefined && /^\s*\d+(\.\d+)?\s*$/.test(s) && Number.isFinite(n) ? n : null
  }
  const out: GpuNow[] = []
  for (const line of text.split('\n')) {
    const f = line.split(',')
    if (f.length < 4) continue
    const [busy, used, total] = f.slice(-3).map(num)
    const name = f.slice(0, -3).join(',').trim() || null
    out.push({ name, busy: busy !== null ? Math.min(100, busy) : null, memoryUsed: used === null ? null : used * 1048576, memoryTotal: total === null ? null : total * 1048576 })
  }
  return out
}

/** lspci -mm: the display devices' names ("NVIDIA Corporation GK106GL [Quadro K4000]" becomes "NVIDIA GK106GL [Quadro K4000]"). */
export function parseLspci(text: string): string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    const q = [...line.matchAll(/"([^"]*)"/g)].map(m => m[1])
    if (q.length < 3 || !/^(VGA compatible controller|3D controller|Display controller)$/.test(q[0])) continue
    out.push(`${q[1].replace(/\s*(Corporation|Corp\.|, Inc\.|Inc\.)\s*/g, ' ').trim()} ${q[2]}`.replace(/\s+/g, ' ').trim())
  }
  return out
}

const VENDORS: Readonly<Record<string, string>> = { '0x10de': 'NVIDIA GPU', '0x1002': 'AMD GPU', '0x8086': 'Intel GPU' }

/** /sys/class/drm/card<N>/device/vendor for each card (not its outputs, "card0-HDMI-A-1"): "NVIDIA GPU", "AMD GPU", "Intel GPU" or "GPU". */
export async function sysCardNames(list: (dir: string) => Promise<string[]>, read: (path: string) => Promise<string>): Promise<string[]> {
  let cards: string[] = []
  try {
    cards = (await list('/sys/class/drm')).filter(n => /^card\d+$/.test(n)).sort()
  } catch {
    return []
  }
  const out: string[] = []
  for (const card of cards) {
    try {
      out.push(VENDORS[(await read(`/sys/class/drm/${card}/device/vendor`)).trim().toLowerCase()] ?? 'GPU')
    } catch {
      // Not a PCI card.
    }
  }
  return out
}

const run = (file: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => execFile(file, args, { timeout: 5000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout)))))

export interface LinuxGpuReader {
  read(): Promise<GpuNow[]>
}

/** The GPUs: nvidia-smi when the PC has it (asked at most every 5 s), else amdgpu's busy and VRAM files, else only their names. */
export function createLinuxGpu(o: { exec?: (file: string, args: string[]) => Promise<string>; read?: (path: string) => Promise<string>; list?: (dir: string) => Promise<string[]>; now?: () => number } = {}): LinuxGpuReader {
  const exec = o.exec ?? run
  const read = o.read ?? (p => readFile(p, 'utf8'))
  const list = o.list ?? (d => readdir(d))
  const now = o.now ?? Date.now
  let nvidiaMissingUntil = 0
  let cache: { at: number; gpus: GpuNow[] } | null = null
  let names: string[] | null = null

  async function amd(): Promise<GpuNow[]> {
    const out: GpuNow[] = []
    let cards: string[] = []
    try {
      cards = (await list('/sys/class/drm')).filter(n => /^card\d+$/.test(n))
    } catch {
      return out
    }
    for (const card of cards) {
      const dir = `/sys/class/drm/${card}/device`
      try {
        const busy = Number((await read(`${dir}/gpu_busy_percent`)).trim())
        const used = Number((await read(`${dir}/mem_info_vram_used`).catch(() => '')).trim())
        const total = Number((await read(`${dir}/mem_info_vram_total`).catch(() => '')).trim())
        if (!Number.isFinite(busy)) continue
        out.push({ name: null, busy: Math.min(100, Math.max(0, busy)), memoryUsed: used > 0 ? used : null, memoryTotal: total > 0 ? total : null })
      } catch {
        // Not an amdgpu card.
      }
    }
    return out
  }

  return {
    async read() {
      if (cache && now() - cache.at < 5000) return cache.gpus
      let gpus: GpuNow[] = []
      if (now() >= nvidiaMissingUntil) {
        try {
          gpus = parseNvidiaSmi(await exec('nvidia-smi', ['--query-gpu=name,utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits']))
        } catch {
          // No NVIDIA driver (or it failed): look again in 10 minutes.
          nvidiaMissingUntil = now() + 600_000
        }
      }
      if (!gpus.length) gpus = await amd()
      if (names === null) {
        try {
          names = parseLspci(await exec('lspci', ['-mm']))
        } catch {
          names = []
        }
        // No lspci: each display card's maker, from its own vendor ID.
        if (!names.length) names = await sysCardNames(list, read)
      }
      // Names for the cards that came without one, in order; any other card by its name alone.
      let n = 0
      gpus = gpus.map(g => (g.name ? g : { ...g, name: names?.[n++] ?? null }))
      if (!gpus.length) gpus = names.map(name => ({ name, busy: null, memoryUsed: null, memoryTotal: null }))
      cache = { at: now(), gpus }
      return gpus
    },
  }
}
