import { fork, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { WA_BACKEND_PORTS } from '../../shared/whatsapp.ts'
import type { Logger } from '../log.ts'
import { workerEnv } from '../whatsapp/host.ts'
import { issueSendTicket, type SendFields } from './send-ticket.ts'

// Order of5a0 (16 Nov 2026, Lead's GO with four conditions): the hub starts WhatsApp's backend (run.ts) and keeps it running, so the WhatsApp page
// works on this Server without anyone starting it by hand.
// 1. Bounded restarts: after maxFailures failures within windowMs (5 in 5 minutes) it stays STOPPED and says why; it never spins.
// 2. Every failure is visible: each one is an error line in the hub's log with its reason, and the state (view()) carries them, which the proxy
//    turns into the page's message. A seam reports trouble; it never reports clear.
// 3. Not-ready stays truthful: only a backend that said it is ready (its own ready word, with the port it got) is "running"; starting, starting
//    again after a failure, stopped and off are each said as they are.
// 4. Exact PID only: the backend is ended by its own process handle (child.kill(): that one PID), never by name, port or tree. Asked first: it
//    closes WhatsApp properly (Chrome, the login kept) on {t:'quit'}; past quitMs it is ended. It is NOT detached, so it sits in the agent's
//    kill-on-exit job and can't outlive the agent; if the agent dies first, its channel closes and it closes WhatsApp itself.

export type BackendState = 'off' | 'starting' | 'running' | 'stopped'

export interface BackendFailure {
  at: string
  why: string
}

export interface BackendView {
  state: BackendState
  /** When this state began. */
  since: string
  /** The port it got (running only). */
  port: number | null
  pid: number | null
  /** Starting again: the failure it starts again after. Stopped: why it stopped, with the last failure. */
  why: string | null
  /** The failures within the window, oldest first. */
  failures: BackendFailure[]
}

export interface SupervisorOptions {
  /** Its state folder (WA_BACKEND_DIR). */
  dir: string
  log: Logger
  /** run.ts; tests give a stand-in. */
  script?: string
  /** The band it takes its first free port from (WA_BACKEND_PORTS). */
  ports?: { from: number; to: number }
  /** Extra environment for it (tests). Nothing of the agent's own is passed (workerEnv). */
  env?: Record<string, string>
  maxFailures?: number
  windowMs?: number
  /** How long it may take to say it is ready. */
  readyMs?: number
  /** How long it has to close WhatsApp and end when asked. */
  quitMs?: number
  /** The waits before each start again (the last one repeats). */
  delaysMs?: readonly number[]
  /** Order obf15: how long the backend has to confirm it holds a send key (ON) or has let it go (OFF) (default 5 s). */
  sendAckMs?: number
  now?: () => number
}

export interface BackendSupervisor {
  /** Starts it (off or stopped: a start by hand clears the failures). Starting or running: nothing. */
  start(): void
  /** Asks it to stop, then ends its exact PID past quitMs. Resolves once it has ended. */
  stop(): Promise<void>
  view(): BackendView
  /**
   * Order obf15 (oWA S2, Lead: "make OFF as real as ON"). ON: a NEW random key (a rotation: tickets of an older one are worthless), handed to the backend over its private
   * channel, now if it is running and the moment it says it is ready otherwise (and again after a restart); resolves whether the backend confirmed it holds it.
   * OFF: the key is forgotten here first (no ticket can be made from that moment) and the backend is told to let it go; a backend that does not confirm it did is ended by
   * its exact PID, so the capability cannot outlive the switch (it starts again without the key). The key is never in view(), a file, the environment or a log.
   */
  sending(on: boolean): Promise<boolean>
  sendingOn(): boolean
  /** A ticket for this send by this person (send-ticket.ts), or null when there is no key: sending is off. */
  ticket(f: SendFields, by: string): string | null
}

const DEFAULT_SCRIPT = fileURLToPath(new URL('./run.ts', import.meta.url))
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function createBackendSupervisor(o: SupervisorOptions): BackendSupervisor {
  const now = o.now ?? Date.now
  const maxFailures = o.maxFailures ?? 5
  const windowMs = o.windowMs ?? 5 * 60_000
  const readyMs = o.readyMs ?? 60_000
  const quitMs = o.quitMs ?? 25_000
  const delays = o.delaysMs ?? [2_000, 5_000, 15_000, 30_000, 60_000]
  const band = o.ports ?? WA_BACKEND_PORTS
  const log = o.log

  let state: BackendState = 'off'
  let since = now()
  let port: number | null = null
  let why: string | null = null
  let failures: { at: number; why: string }[] = []
  let child: ChildProcess | null = null
  let restartTimer: ReturnType<typeof setTimeout> | null = null
  let readyTimer: ReturnType<typeof setTimeout> | null = null
  let stopping: Promise<void> | null = null
  const sendAckMs = o.sendAckMs ?? 5_000
  /** The send key: in memory only. Null is sending OFF. */
  let sendKey: string | null = null
  /** Who waits for the backend's word about its key (it says what it holds: on = it holds one). */
  const keyWaiters = new Set<{ on: boolean; resolve(v: boolean): void }>()

  /** Tells this backend its key (or null) over its channel and waits for it to say what it holds. */
  function tellKey(c: ChildProcess, key: string | null): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      const w = {
        on: key !== null,
        resolve: (v: boolean) => {
          clearTimeout(timer)
          resolve(v)
        },
      }
      const timer = setTimeout(() => {
        keyWaiters.delete(w)
        resolve(false)
      }, sendAckMs)
      keyWaiters.add(w)
      try {
        if (!c.connected) throw new Error('the channel is closed')
        c.send({ t: 'send-key', key })
      } catch {
        keyWaiters.delete(w)
        clearTimeout(timer)
        resolve(false)
      }
    })
  }

  const set = (next: BackendState, w: string | null) => {
    if (next !== state) since = now()
    state = next
    why = w
    if (next !== 'running') port = null
  }
  const clearTimers = () => {
    if (restartTimer) clearTimeout(restartTimer)
    if (readyTimer) clearTimeout(readyTimer)
    restartTimer = null
    readyTimer = null
  }

  /** One failure of the current run: written down, logged, then a start again after a wait, or STOPPED once there are too many. */
  function failed(reason: string) {
    const t = now()
    failures = [...failures.filter(f => t - f.at < windowMs), { at: t, why: reason }]
    log.error(`WhatsApp backend: ${reason}`)
    if (failures.length >= maxFailures) {
      clearTimers()
      const minutes = Math.round(windowMs / 60_000)
      set('stopped', `it failed ${failures.length} times within ${minutes} minute${minutes === 1 ? '' : 's'}, so it is not started again until the app restarts (the last failure: ${reason})`)
      log.error(`WhatsApp backend: STOPPED: ${why}`)
      return
    }
    const wait = delays[Math.min(failures.length - 1, delays.length - 1)]
    set('starting', reason)
    log.warn(`WhatsApp backend: starting again in ${Math.round(wait / 1000)} s`)
    restartTimer = setTimeout(() => {
      restartTimer = null
      launch()
    }, wait)
  }

  function launch() {
    if (stopping || child) return
    set('starting', why)
    let c: ChildProcess
    try {
      c = fork(o.script ?? DEFAULT_SCRIPT, [], {
        env: workerEnv({ WA_BACKEND_DIR: o.dir, WA_BACKEND_PORTS: `${band.from}-${band.to}`, ...o.env }),
        // Plain Node running a .ts file: none of the agent's own switches (or a test runner's).
        execArgv: [],
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        serialization: 'json',
        windowsHide: true,
      })
    } catch (e) {
      failed(`it could not be started: ${message(e)}`)
      return
    }
    child = c
    let settled = false
    let last: string | null = null
    /** This run's end, said once (an 'error' can come with or without an 'exit'). */
    const end = (reason: string | null) => {
      if (settled) return
      settled = true
      if (child === c) child = null
      clearTimers()
      if (stopping) return
      failed(reason ?? 'it ended')
    }
    const lines = (stream: NodeJS.ReadableStream | null, warn: boolean) => {
      let buf = ''
      stream?.setEncoding('utf8')
      stream?.on('data', (d: string) => {
        buf += d
        let i: number
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim()
          buf = buf.slice(i + 1)
          if (!line) continue
          if (warn) last = line.slice(0, 300)
          if (warn) log.warn(`WhatsApp backend: ${line}`)
          else log.info(`WhatsApp backend: ${line}`)
        }
        if (buf.length > 8000) buf = ''
      })
    }
    lines(c.stdout, false)
    lines(c.stderr, true)
    c.on('message', (m: unknown) => {
      if (child !== c || m === null || typeof m !== 'object') return
      const w = m as { t?: unknown; port?: unknown; why?: unknown; on?: unknown }
      if (w.t === 'ready' && Number.isInteger(w.port)) {
        if (readyTimer) clearTimeout(readyTimer)
        readyTimer = null
        set('running', null)
        port = w.port as number
        log.info(`WhatsApp backend: running on 127.0.0.1:${port} (pid ${c.pid})`)
        // Sending is ON: this backend (a first start, or after a crash) gets the key now. (OFF: it never had one, and starts without.)
        if (sendKey !== null) void tellKey(c, sendKey).then(ok => ok || log.warn('WhatsApp backend: it did not confirm that it holds the send key'))
      } else if (w.t === 'send-key' && typeof w.on === 'boolean') {
        for (const x of [...keyWaiters]) {
          if (x.on === w.on) {
            keyWaiters.delete(x)
            x.resolve(true)
          }
        }
      } else if (w.t === 'failed' && typeof w.why === 'string') last = w.why.slice(0, 300)
    })
    c.on('error', e => {
      // Spawning failed, or the channel broke: its exact PID is ended if it is still there.
      if (c.exitCode === null && c.signalCode === null) c.kill()
      end(`it could not be started or reached: ${message(e)}`)
    })
    c.on('exit', (code, signal) => {
      const how = code !== null ? `code ${code}` : `signal ${signal}`
      end(`it ended (${how})${last ? `: ${last}` : ''}`)
    })
    readyTimer = setTimeout(() => {
      readyTimer = null
      if (child !== c || state === 'running') return
      last = `it did not say it was ready within ${Math.round(readyMs / 1000)} s`
      // Its exact PID, nothing else: the exit that follows counts the failure.
      c.kill()
    }, readyMs)
  }

  return {
    start() {
      if (stopping || child || restartTimer) return
      if (state === 'stopped') failures = []
      set('starting', null)
      launch()
    },
    async sending(on) {
      if (on) {
        sendKey = randomBytes(32).toString('hex')
        const c = child
        // Not running yet: it is handed over when it says it is ready.
        if (!c || state !== 'running') return false
        return tellKey(c, sendKey)
      }
      sendKey = null
      const c = child
      if (!c) return true
      if (await tellKey(c, null)) return true
      // It did not say it let go. Its exact PID is ended (never by name or port): it starts again, and without a key.
      if (child === c && c.exitCode === null && c.signalCode === null) {
        log.warn(`WhatsApp backend: it did not confirm that it let the send key go; ending its process (pid ${c.pid}) so sending is really off`)
        c.kill()
      }
      return false
    },
    sendingOn: () => sendKey !== null,
    ticket: (f, by) => (sendKey === null ? null : issueSendTicket(sendKey, f, by, now())),
    stop() {
      stopping ??= (async () => {
        sendKey = null
        clearTimers()
        const c = child
        if (c && c.exitCode === null && c.signalCode === null) {
          const ended = new Promise<void>(resolve => c.once('exit', () => resolve()))
          try {
            if (c.connected) c.send({ t: 'quit' })
          } catch {
            // The channel is gone: it ends on its own (or below).
          }
          let timer: ReturnType<typeof setTimeout> | null = null
          const late = new Promise<'late'>(resolve => (timer = setTimeout(() => resolve('late'), quitMs)))
          if ((await Promise.race([ended.then(() => 'ended' as const), late])) === 'late') {
            log.warn(`WhatsApp backend: it did not end within ${Math.round(quitMs / 1000)} s of being asked; ending its process (pid ${c.pid})`)
            c.kill()
            await ended
          }
          if (timer) clearTimeout(timer)
        }
        child = null
        set('off', null)
      })()
      return stopping
    },
    view() {
      const t = now()
      return {
        state,
        since: new Date(since).toISOString(),
        port: state === 'running' ? port : null,
        pid: state === 'running' || state === 'starting' ? (child?.pid ?? null) : null,
        why,
        failures: failures.filter(f => state === 'stopped' || t - f.at < windowMs).map(f => ({ at: new Date(f.at).toISOString(), why: f.why })),
      }
    },
  }
}
