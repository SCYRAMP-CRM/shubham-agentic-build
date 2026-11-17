import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { connect } from 'node:net'
import path from 'node:path'

// Order o55b6 (16-17 Nov 2026, his yes to option 3): WhatsApp's Chrome may go out through the Z800, around the office FortiGate that re-signs
// web.whatsapp.com, over an SSH SOCKS tunnel. Agent 6 OWNS the tunnel (the Server's key, the ssh, its supervision, outside this code) and
// writes where it is in tunnel.json beside the backend's state: {"socks":"socks5://127.0.0.1:<port>","pid":<the ssh that listens there>,
// "since","via"}, or {"up":false,"why"} while it is down. This file decides, right before Chrome is told to use it, whether it is REALLY
// that tunnel, now (effect checks, not the file alone):
// 1. the file names a socks5 address on 127.0.0.1 and the PID of its listener;
// 2. that PID owns EVERY listener reachable at 127.0.0.1:<port> (netstat). If the tunnel died and something else took the port, a greeting
//    would still answer and Chrome would proxy through a stranger: so a different PID is refused, whatever it answers (Lead's rule here);
// 3. a SOCKS5 greeting answers there ("no authentication", the way Chrome asks).
// Any step that fails refuses WhatsApp, saying which. Nothing ever falls back to going out directly (Lead's condition 2): a silent fallback
// would work in testing and hit the FortiGate in use.

export type TunnelCheck = { ok: true; proxy: string; port: number; pid: number; via: string } | { ok: false; why: string }

export interface TunnelDeps {
  /** The PIDs listening where a connection to 127.0.0.1:<port> lands (127.0.0.1, 0.0.0.0, or a dual-stack [::]). */
  listeners?: (port: number) => Promise<number[]>
  /** A SOCKS5 greeting answers on 127.0.0.1:<port>. */
  greets?: (port: number) => Promise<boolean>
}

/** `netstat -ano` → the PIDs of the TCP listeners a connection to 127.0.0.1:<port> could reach. */
export function listenersIn(netstat: string, port: number): number[] {
  const pids = new Set<number>()
  for (const line of netstat.split(/\r?\n/)) {
    const m = /^\s*TCP\s+(\[[^\]]*\]|[\d.]+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/.exec(line)
    if (!m || Number(m[2]) !== port) continue
    if (m[1] === '127.0.0.1' || m[1] === '0.0.0.0' || m[1] === '[::]') pids.add(Number(m[3]))
  }
  return [...pids]
}

/** Windows' own netstat by its full path (never a netstat found first on PATH). */
async function netstatListeners(port: number): Promise<number[]> {
  const exe = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'NETSTAT.EXE')
  const text = await new Promise<string>((resolve, reject) =>
    execFile(exe, ['-ano'], { encoding: 'utf8', windowsHide: true, timeout: 15_000, maxBuffer: 16 * 1024 * 1024 }, (e, out) => (e ? reject(e) : resolve(out))),
  )
  return listenersIn(text, port)
}

/** One SOCKS5 greeting (version 5, one method: no authentication); the answer must be 5, 0. Read only: nothing is asked of the proxy beyond it. */
export function socksGreets(port: number, ms = 3000): Promise<boolean> {
  return new Promise(resolve => {
    const s = connect({ host: '127.0.0.1', port })
    let got = Buffer.alloc(0)
    const done = (ok: boolean) => {
      clearTimeout(timer)
      s.destroy()
      resolve(ok)
    }
    const timer = setTimeout(() => done(false), ms)
    s.once('connect', () => s.write(Buffer.from([5, 1, 0])))
    s.on('data', d => {
      got = Buffer.concat([got, d])
      if (got.length >= 2) done(got[0] === 5 && got[1] === 0)
    })
    s.once('error', () => done(false))
    s.once('close', () => done(false))
  })
}

const SOCKS = /^socks5:\/\/127\.0\.0\.1:(\d{5})$/

/** Whether the tunnel named in `file` is up and really the tunnel, now; else why not. Read fresh on every call. */
export async function checkTunnel(file: string, d: TunnelDeps = {}): Promise<TunnelCheck> {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    const missing = (e as NodeJS.ErrnoException).code === 'ENOENT'
    return { ok: false, why: missing ? 'the tunnel to the Z800 is not running (it has not said where it is)' : 'the tunnel\'s note (tunnel.json) cannot be read' }
  }
  const t = (raw ?? {}) as { socks?: unknown; pid?: unknown; via?: unknown; up?: unknown; why?: unknown }
  if (t.up === false) return { ok: false, why: `the tunnel to the Z800 is down${typeof t.why === 'string' && t.why ? `: ${t.why.slice(0, 300)}` : ''}` }
  const m = typeof t.socks === 'string' ? SOCKS.exec(t.socks) : null
  const port = m ? Number(m[1]) : NaN
  if (!m || port < 50000 || port > 65535) return { ok: false, why: 'the tunnel\'s note does not name a SOCKS5 address on 127.0.0.1 (port 50000 or higher)' }
  if (!Number.isSafeInteger(t.pid) || (t.pid as number) <= 0) return { ok: false, why: 'the tunnel\'s note does not name the PID of its listener' }
  const pid = t.pid as number
  let pids: number[]
  try {
    pids = await (d.listeners ?? netstatListeners)(port)
  } catch (e) {
    return { ok: false, why: `who listens on 127.0.0.1:${port} could not be read (${e instanceof Error ? e.message : String(e)})` }
  }
  if (pids.length === 0) return { ok: false, why: `nothing listens on 127.0.0.1:${port}, where the tunnel's note says it is` }
  const other = pids.find(p => p !== pid)
  if (other !== undefined) return { ok: false, why: `127.0.0.1:${port} is held by PID ${other}, not by the tunnel's ssh (PID ${pid}): not used, whatever it answers` }
  if (!(await (d.greets ?? socksGreets)(port))) return { ok: false, why: `127.0.0.1:${port} (PID ${pid}) does not answer as a SOCKS5 proxy` }
  return { ok: true, proxy: `socks5://127.0.0.1:${port}`, port, pid, via: typeof t.via === 'string' && t.via ? t.via.slice(0, 60) : 'the Z800' }
}
