import { spawn, type ChildProcess } from 'node:child_process'

// Order odbd8: on Windows, the Resources tab's processes, drives, GPU and network come from one hidden PowerShell that runs only while somebody
// looks: it starts at the first ask and ends a minute after the last one. It reads Windows' own performance counters (the same numbers Task Manager
// shows): every process's CPU time and private memory, the GPU engines and GPU memory, each real drive's free space (every 30 seconds) and each
// network adapter's byte counts, and prints them as one JSON line every 3 seconds. It reads; it never stops, starts or changes anything.
//  - Get-Process cannot see the CPU time of about a third of the processes without admin rights; the counters can, at ~70 ms a look (the first
//    look takes a few seconds while Windows loads their names).
//  - It ends by itself when this agent ends (it checks this agent's PID every look, and a write to a closed pipe ends it).
//  - Every value it prints is cast to a plain .NET type first: the JSON writer fails on PowerShell's wrapped objects (a circular reference).
//  - Drives: only those on a real disk partition (Win32_LogicalDiskToPartition), so virtual drives (the CRM drive, Google Drive) are left out and
//    never asked anything.

export const SAMPLER_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  'Add-Type -AssemblyName System.Web.Extensions',
  '$ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer',
  '$ser.MaxJsonLength = 16777216',
  '$parentId = [int]$env:SAD_RES_PARENT',
  '$period = [int]$env:SAD_RES_PERIOD',
  '$cores = [Environment]::ProcessorCount',
  '$out = [Console]::Out',
  'function Num($v) { $d = [double]$v; if ([double]::IsNaN($d) -or [double]::IsInfinity($d)) { return -1 }; return [math]::Round($d, 2) }',
  "$procCat = New-Object Diagnostics.PerformanceCounterCategory('Process')",
  "$gpuCat = $null; try { $gpuCat = New-Object Diagnostics.PerformanceCounterCategory('GPU Engine'); $null = $gpuCat.ReadCategory() } catch { $gpuCat = $null }",
  "$gpuMemCat = $null; try { $gpuMemCat = New-Object Diagnostics.PerformanceCounterCategory('GPU Adapter Memory'); $null = $gpuMemCat.ReadCategory() } catch { $gpuMemCat = $null }",
  '$gpuNames = @(); try { $gpuNames = @(Get-CimInstance Win32_VideoController | ForEach-Object { [string]$_.Name }) } catch { }',
  '$prevCpu = @{}; $prevGpu = @{}; $disks = $null; $disksAt = [DateTime]::MinValue',
  'while ($true) {',
  '  try { $null = [Diagnostics.Process]::GetProcessById($parentId) } catch { exit 0 }',
  '  $o = @{ t = [long][DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); cores = [int]$cores; gpuNames = [string[]]$gpuNames }',
  '  try {',
  '    $d = $procCat.ReadCategory()',
  "    $ids = $d['ID Process']; $cpu = $d['% Processor Time']; $wsp = $d['Working Set - Private']; $ws = $d['Working Set']",
  '    $list = New-Object Collections.ArrayList; $nextCpu = @{}',
  '    foreach ($inst in $ids.Keys) {',
  "      if ($inst -eq '_Total' -or $inst -eq 'Idle') { continue }",
  '      $pidv = [long]$ids[$inst].RawValue',
  "      $name = $inst -replace '#\\d+$', ''",
  '      $mem = 0',
  '      if ($null -ne $wsp -and $wsp.Contains($inst)) { $mem = [long]$wsp[$inst].RawValue } elseif ($null -ne $ws -and $ws.Contains($inst)) { $mem = [long]$ws[$inst].RawValue }',
  '      $pct = -1',
  '      if ($null -ne $cpu -and $cpu.Contains($inst)) {',
  '        $s = $cpu[$inst].Sample; $key = "$pidv|$name"; $nextCpu[$key] = $s; $old = $prevCpu[$key]',
  '        if ($null -ne $old) { $pct = Num ([Diagnostics.CounterSample]::Calculate($old, $s) / $cores) }',
  '      }',
  '      [void]$list.Add(@([long]$pidv, [string]$name, [double]$pct, [long]$mem))',
  '    }',
  '    $prevCpu = $nextCpu; $o.procs = $list.ToArray()',
  '  } catch { $o.procErr = [string]$_.Exception.Message }',
  '  if ($null -ne $gpuCat) {',
  '    try {',
  "      $g = $gpuCat.ReadCategory()['Utilization Percentage']; $nextGpu = @{}; $sum = @{}",
  '      foreach ($inst in $g.Keys) {',
  '        $s = $g[$inst].Sample; $nextGpu[$inst] = $s; $old = $prevGpu[$inst]',
  "        if ($null -ne $old -and $inst -match 'luid_(0x[0-9a-f]+_0x[0-9a-f]+)_phys_\\d+.*engtype_(.*)$') {",
  "          $k = $Matches[1].ToLower() + '|' + $Matches[2]; $sum[$k] = [double]$sum[$k] + [Diagnostics.CounterSample]::Calculate($old, $s)",
  '        }',
  '      }',
  '      $prevGpu = $nextGpu; $busy = @{}',
  "      foreach ($k in $sum.Keys) { $l = $k.Split('|')[0]; if ($null -eq $busy[$l] -or $sum[$k] -gt $busy[$l]) { $busy[$l] = $sum[$k] } }",
  '      $mem = @{}',
  '      if ($null -ne $gpuMemCat) {',
  "        $m = $gpuMemCat.ReadCategory(); $ded = $m['Dedicated Usage']; $sh = $m['Shared Usage']",
  '        foreach ($inst in $ded.Keys) {',
  "          if ($inst -match 'luid_(0x[0-9a-f]+_0x[0-9a-f]+)_phys') { $l = $Matches[1].ToLower(); $shared = 0; if ($null -ne $sh -and $sh.Contains($inst)) { $shared = [long]$sh[$inst].RawValue }; $mem[$l] = @([long]$ded[$inst].RawValue, $shared) }",
  '        }',
  '      }',
  '      $gl = New-Object Collections.ArrayList',
  '      foreach ($l in (@($busy.Keys) + @($mem.Keys) | Sort-Object -Unique)) {',
  '        $b = -1; if ($null -ne $busy[$l]) { $b = Num $busy[$l] }',
  '        $dd = -1; $ss = -1; if ($null -ne $mem[$l]) { $dd = $mem[$l][0]; $ss = $mem[$l][1] }',
  '        [void]$gl.Add(@([string]$l, [double]$b, [long]$dd, [long]$ss))',
  '      }',
  '      $o.gpus = $gl.ToArray()',
  '    } catch { $o.gpuErr = [string]$_.Exception.Message }',
  '  }',
  '  if (([DateTime]::UtcNow - $disksAt).TotalSeconds -ge 30) {',
  '    $disksAt = [DateTime]::UtcNow',
  '    try {',
  '      $dl = New-Object Collections.ArrayList',
  '      foreach ($L in (@(Get-CimInstance Win32_LogicalDiskToPartition | ForEach-Object { [string]$_.Dependent.DeviceID }) | Sort-Object -Unique)) {',
  '        try { $di = New-Object IO.DriveInfo($L); if ($di.IsReady) { [void]$dl.Add(@([string]$L, [string]$di.VolumeLabel, [long]$di.TotalSize, [long]$di.AvailableFreeSpace)) } } catch { }',
  '      }',
  '      $disks = $dl.ToArray()',
  '    } catch { $o.diskErr = [string]$_.Exception.Message }',
  '  }',
  '  if ($null -ne $disks) { $o.disks = $disks }',
  '  try {',
  '    $nl = New-Object Collections.ArrayList',
  '    foreach ($n in [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {',
  "      if ([string]$n.OperationalStatus -ne 'Up' -or [string]$n.NetworkInterfaceType -eq 'Loopback') { continue }",
  '      try { $st = $n.GetIPStatistics(); [void]$nl.Add(@([string]$n.Name, [string]$n.Description, [int]$n.NetworkInterfaceType, [long]$st.BytesReceived, [long]$st.BytesSent)) } catch { }',
  '    }',
  '    $o.nics = $nl.ToArray()',
  '  } catch { $o.nicErr = [string]$_.Exception.Message }',
  '  try { $out.WriteLine($ser.Serialize($o)); $out.Flush() } catch { exit 0 }',
  '  Start-Sleep -Milliseconds $period',
  '}',
].join('\n')

export interface WinProc {
  pid: number
  name: string
  /** Share of the whole PC's CPU since the last look (0-100), or null on the first look. */
  cpu: number | null
  /** Private working set, bytes. */
  memory: number
}

export interface WinGpu {
  luid: string
  busy: number | null
  dedicated: number | null
  shared: number | null
}

export interface WinNic {
  name: string
  description: string
  /** .NET NetworkInterfaceType: 53 (IF_TYPE_PROP_VIRTUAL, Tailscale's Wintun) and 131 (Tunnel) are virtual. */
  type: number
  rx: number
  tx: number
}

export interface WinDisk {
  name: string
  label: string
  total: number
  free: number
}

export interface WinSample {
  t: number
  cores: number
  procs: WinProc[] | null
  gpus: WinGpu[] | null
  gpuNames: string[]
  disks: WinDisk[] | null
  nics: WinNic[] | null
}

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const str = (v: unknown, max = 260): v is string => typeof v === 'string' && v.length <= max
const orNull = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) => (fin(v) && v >= min && v <= max ? v : null)

function rows<T>(v: unknown, max: number, one: (x: unknown[]) => T | null): T[] | null {
  if (!Array.isArray(v)) return null
  return v.slice(0, max).map(x => (Array.isArray(x) ? one(x) : null)).filter((x): x is T => x !== null)
}

/** One line the sampler printed, checked; null when it is not one. */
export function parseSampleLine(line: string): WinSample | null {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return null
  }
  if (!obj(raw) || !fin(raw.t) || !fin(raw.cores) || raw.cores < 1) return null
  const procs = rows<WinProc>(raw.procs, 20_000, ([pid, name, cpu, memory]) =>
    Number.isInteger(pid) && (pid as number) >= 0 && str(name) && fin(memory) && memory >= 0 ? { pid: pid as number, name: name as string, cpu: orNull(cpu, 0, 100), memory: memory as number } : null)
  const gpus = rows<WinGpu>(raw.gpus, 16, ([luid, busy, dedicated, shared]) =>
    str(luid, 64) ? { luid: luid as string, busy: orNull(busy, 0, 100), dedicated: orNull(dedicated), shared: orNull(shared) } : null)
  const disks = rows<WinDisk>(raw.disks, 32, ([name, label, total, free]) =>
    str(name, 8) && str(label) && fin(total) && fin(free) && total >= 0 && free >= 0 && free <= total ? { name: name as string, label: label as string, total: total as number, free: free as number } : null)
  const nics = rows<WinNic>(raw.nics, 64, ([name, description, type, rx, tx]) =>
    str(name) && str(description) && Number.isInteger(type) && fin(rx) && fin(tx) && rx >= 0 && tx >= 0 ? { name: name as string, description: description as string, type: type as number, rx: rx as number, tx: tx as number } : null)
  const gpuNames = Array.isArray(raw.gpuNames) ? raw.gpuNames.filter((n): n is string => str(n)).slice(0, 8) : []
  return { t: raw.t, cores: raw.cores, procs, gpus, gpuNames, disks, nics }
}

export interface WindowsSamplerOptions {
  /** How long it keeps running after the last ask. */
  leaseMs?: number
  periodMs?: number
  now?: () => number
  /** Starts the PowerShell (tests give a fake). */
  start?: (env: Record<string, string>) => ChildProcess
  log?: (message: string) => void
}

export interface WindowsSampler {
  /** Somebody looks: starts it when it is not running and keeps it running for the lease. */
  touch(): void
  /** The newest look and the one before it (for rates), while fresh. */
  latest(): { now: WinSample; before: WinSample | null } | null
  /** Why there is nothing, in one sentence, or null. */
  problem(): string | null
  running(): boolean
  stop(): void
}

const startPowerShell = (env: Record<string, string>) =>
  spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(SAMPLER_SCRIPT, 'utf16le').toString('base64')], {
    env: { ...process.env, ...env },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

export function createWindowsSampler(o: WindowsSamplerOptions = {}): WindowsSampler {
  const leaseMs = o.leaseMs ?? 60_000
  const periodMs = o.periodMs ?? 3000
  const now = o.now ?? Date.now
  const start = o.start ?? startPowerShell
  let child: ChildProcess | null = null
  let askedAt = 0
  let startedAt = 0
  let newest: { at: number; sample: WinSample } | null = null
  let previous: WinSample | null = null
  let failures = 0
  let restBefore = 0
  let problem: string | null = null
  let timer: NodeJS.Timeout | null = null

  function end() {
    const c = child
    child = null
    if (timer) clearInterval(timer)
    timer = null
    // Our own child, by its own PID (ChildProcess.kill): nothing else is touched.
    if (c && c.exitCode === null && c.signalCode === null) c.kill()
  }

  function launch() {
    startedAt = now()
    newest = null
    previous = null
    let c: ChildProcess
    try {
      c = start({ SAD_RES_PARENT: String(process.pid), SAD_RES_PERIOD: String(periodMs) })
    } catch (e) {
      problem = `Windows did not start the reader: ${e instanceof Error ? e.message : String(e)}`
      failures++
      restBefore = now() + 60_000
      return
    }
    child = c
    let buffer = ''
    c.stdout?.setEncoding('utf8')
    c.stdout?.on('data', (chunk: string) => {
      buffer += chunk
      if (buffer.length > 8 * 1024 * 1024) buffer = ''
      let i: number
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i).trim()
        buffer = buffer.slice(i + 1)
        const sample = line ? parseSampleLine(line) : null
        if (!sample) continue
        if (newest) previous = newest.sample
        newest = { at: now(), sample }
        failures = 0
        problem = null
      }
    })
    c.stderr?.resume()
    c.on('error', e => {
      problem = `The reader could not run: ${e.message}`
    })
    c.on('exit', code => {
      if (child === c) child = null
      // Ended early (not by us): try again on a later ask, then rest a minute after three failures in a row.
      if (now() - startedAt < 20_000 && newest === null) {
        failures++
        problem ??= `The reader stopped (code ${code ?? 'none'}) before its first look.`
        if (failures >= 3) restBefore = now() + 60_000
      }
      o.log?.(`resources reader ended (code ${code ?? 'none'})`)
    })
    timer = setInterval(() => {
      if (now() - askedAt > leaseMs) end()
    }, Math.min(10_000, leaseMs))
    timer.unref()
  }

  return {
    touch() {
      askedAt = now()
      if (child || now() < restBefore) return
      launch()
    },
    latest() {
      if (!newest || now() - newest.at > Math.max(15_000, periodMs * 5)) return null
      return { now: newest.sample, before: previous }
    },
    problem: () => problem,
    running: () => child !== null,
    stop: end,
  }
}
