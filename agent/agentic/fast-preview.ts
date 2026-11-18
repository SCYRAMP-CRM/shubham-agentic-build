import type { FastFrame, FastHost, FastModel } from './fast-host.ts'

// Quick V2 preparation is disposable model work, NOT an ask, a tool origin or a
// conversation. All limits apply before the normal final-transcript path.
export const MAX_PREVIEW_TEXT = 4096
export const MAX_PREPARATION_CHARS = 1600
export const MAX_PREVIEW_EVENT_CHARS = 65_536
/** Entire process lifetime, including cold initialization. Enforced by the hard-preview host. */
export const PREVIEW_TIMEOUT_MS = 12_000
/** Age of a candidate since prepare(), not extra compute time. A completed draft has no running process. */
export const PREVIEW_TTL_MS = 20_000
export const MAX_PREVIEWS_PER_MIN = 8
/** Fixed diagnostic only: never include speech, drafts, ids or exception text. */
export const QUICK_PREVIEW_FAULT = 'Quick V2 preparation is disabled after an internal fault. Restart the app to retry preparation; final turns still use normal Quick.'
export type FastPreviewFault = 'prepare' | 'take' | 'clear' | 'tick' | 'stop' | 'open' | 'ask' | 'construct' | 'dispose-stop' | 'dispose-pid' | 'unknown'
// Private, module-constant allow-list: never constructed from a caller's input.
// A future bad call/cast must not put speech, ids, exceptions or non-strings
// into diagnostics even if a test did not anticipate that entry point.
const FAULT_LOCATIONS = new Set<FastPreviewFault>([
  'prepare', 'take', 'clear', 'tick', 'stop', 'open', 'ask', 'construct', 'dispose-stop', 'dispose-pid',
])
const SEALED_MS = 60_000
const MAX_SEALED = 128

// Fixed text only. Neither a transcript nor a draft is put in a prompt file.
// A cmd.exe inline line feed discards later sandbox flags. Keep this one line;
// fast-host's spawn-site guard also rejects CR/LF in EVERY launch argument.
export const PREVIEW_BRIEF = [
  'You prepare a short tentative answer for Quick while the user is still speaking.',
  'The input is incomplete, unconfirmed speech. It may be corrected or withdrawn.',
  'You have no tools. Do not perform actions, lookups, delegation or approvals.',
  'Never claim an action happened or that you checked current information.',
  'For requests needing an action or current information, briefly identify what the final answer must verify instead.',
  'Return only a concise tentative answer or preparation note, at most 120 words. Do not expose private reasoning.',
  'The ordinary assistant will separately receive the final transcript and verify this untrusted preparation.',
].join(' ')

export interface FastPreview {
  prepare(conn: string, id: string, text: string, model: FastModel): void
  /** Consumes a ready exact match, or nothing. Never waits; final asks never depend on preview availability. */
  take(conn: string, id: string, finalText: string, model: FastModel): string | undefined
  clear(conn: string): void
  tick(): void
  stop(): Promise<void>
}

export interface FastPreviewDeps {
  /** Must construct a NEW hard-preview host, pinned to this same model, in its own directory. */
  createHost(model: FastModel): FastHost
  now(): number
  /** Opaque revision of authoritative context, never a transcript. A change invalidates a draft. */
  context?(): string
  /** First permanent fault only; the closed-set location is NOT an error/argument. */
  onFault?(where: FastPreviewFault): void
}

interface Generation {
  conn: string
  id: string
  text: string
  model: FastModel
  context: string
  at: number
  host: FastHost
  owner: string
  turn: string
  draft?: string
  chars: number
  disposed: boolean
  ticking: boolean
  timer: ReturnType<typeof setTimeout> | null
}

/** One in-flight generation globally, no queue, no fallback provider and no output to clients/history. */
export function createFastPreview(deps: FastPreviewDeps): FastPreview {
  let current: Generation | null = null
  let stopped = false
  let disposalFailed = false
  let seq = 0
  let starts: number[] = []
  const draining = new Set<Promise<void>>()
  // Final-before-partial and late partials are rejected too. Bounded, fail closed
  // while full. Transport must additionally use a new connection epoch on restart.
  const sealed = new Map<string, number>()
  const key = (conn: string, id: string) => JSON.stringify([conn, id])
  const sweep = () => {
    const now = deps.now()
    starts = starts.filter(at => now - at < 60_000)
    for (const [k, until] of sealed) if (now >= until) sealed.delete(k)
  }
  const seal = (conn: string, id: string) => {
    sweep()
    const k = key(conn, id)
    if (sealed.has(k) || sealed.size < MAX_SEALED) sealed.set(k, deps.now() + SEALED_MS)
  }
  const context = (): string | null => {
    try { return deps.context?.() ?? '' } catch { return null }
  }
  const validIdentity = (conn: string, id: string) => !!conn && conn.length <= 128 && !!id && id.length <= 128 && !id.startsWith('o:')

  function latch(where: FastPreviewFault) {
    if (disposalFailed) return
    disposalFailed = true
    const location = FAULT_LOCATIONS.has(where) ? where : 'unknown'
    // Log once per coordinator, including disposal failures. A faulty logger
    // cannot escape into a websocket, timer or provider callback either.
    try { deps.onFault?.(location) } catch { /* Diagnostics cannot break containment. */ }
  }

  function dispose(g: Generation) {
    if (g.disposed) return
    g.disposed = true
    // Stop immediately, including while open() is awaiting its memory sample.
    // No next process is allowed until this stop has settled and the PID is gone.
    let stopping: Promise<void>
    try { stopping = g.host.stop('Quick preview disposed') } catch { latch('dispose-stop'); return }
    const done = Promise.resolve(stopping).then(() => {
      try { if (g.host.status().pid !== null) latch('dispose-pid') } catch { latch('dispose-pid') }
    }).catch(() => { latch('dispose-stop') }).finally(() => { draining.delete(done) })
    draining.add(done)
  }

  function drop(g: Generation) {
    if (current === g) current = null
    if (g.timer) clearTimeout(g.timer)
    g.timer = null
    g.draft = undefined
    dispose(g)
  }

  // This optional computation is called from V1 websocket/timer paths too.
  // A broken dependency must disable speculation, never escape into the app's
  // uncaughtException shutdown or leave a draft available after uncertain disposal.
  function failClosed(where: FastPreviewFault, g: Generation | null = current) {
    latch(where)
    const live = current
    current = null
    for (const dead of new Set([live, g])) {
      if (!dead) continue
      dead.draft = undefined
      try { if (dead.timer) clearTimeout(dead.timer) } catch { /* Disposal still has to be attempted. */ }
      dead.timer = null
      try { dispose(dead) } catch { /* Already disabled; never throw from the fault boundary. */ }
    }
  }

  function receive(g: Generation, frame: FastFrame) {
    if (stopped || current !== g || g.disposed || frame.id !== g.turn) return
    if (deps.now() - g.at >= PREVIEW_TTL_MS || context() !== g.context) return drop(g)
    if (frame.t === 'error' || frame.t === 'tool') return drop(g)
    if (frame.t === 'delta') {
      g.chars += frame.text.length
      if (g.chars > MAX_PREPARATION_CHARS) drop(g)
      return
    }
    if (frame.t !== 'done') return
    if (frame.cancelled || !frame.text.trim() || frame.text.length > MAX_PREPARATION_CHARS) return drop(g)
    g.draft = frame.text
    // Keep only bounded text, never a warm speculative conversation.
    dispose(g)
  }

  const operations: FastPreview = {
    prepare(conn, id, text, model) {
      if (stopped || disposalFailed || !validIdentity(conn, id) || (model !== 'haiku' && model !== 'sonnet')) return
      sweep()
      if (!text.trim() || text.length > MAX_PREVIEW_TEXT || sealed.has(key(conn, id)) || sealed.size >= MAX_SEALED) return
      const ctx = context()
      if (ctx === null) { if (current) drop(current); return }
      if (current) {
        const g = current
        if (g.conn === conn && g.id === id && g.model === model && g.context === ctx && deps.now() - g.at < PREVIEW_TTL_MS) {
          if (g.text === text || !g.disposed) return // While busy, skip revisions; never queue them.
        }
        drop(g)
      }
      if (draining.size || starts.length >= MAX_PREVIEWS_PER_MIN || (starts.length && deps.now() - starts[starts.length - 1] < 1000)) return
      const at = deps.now()
      starts.push(at)
      let host: FastHost
      try { host = deps.createHost(model) } catch { failClosed('construct'); return }
      const token = `preview-${++seq}`
      const g: Generation = { conn, id, text, model, context: ctx, at, host, owner: token, turn: token, chars: 0, disposed: false, ticking: false, timer: null }
      current = g
      g.timer = setTimeout(() => {
        try { if (current === g) drop(g) } catch { failClosed('tick', g) }
      }, PREVIEW_TTL_MS)
      g.timer.unref?.()
      void (async () => {
        let phase: 'open' | 'ask' = 'open'
        try {
          const opened = await host.open(g.owner)
          if (stopped || current !== g || g.disposed) { dispose(g); return }
          if (!opened.ok || context() !== g.context || deps.now() - g.at >= PREVIEW_TTL_MS) return drop(g)
          phase = 'ask'
          const asked = host.ask({ id: g.turn, text: g.text, model: g.model }, f => {
            try { receive(g, f) } catch { failClosed('ask', g) }
          })
          if (!asked.ok) drop(g)
        } catch { failClosed(phase, g) }
      })()
    },
    take(conn, id, finalText, model) {
      if (!validIdentity(conn, id)) return undefined
      seal(conn, id)
      const g = current
      if (!g || g.conn !== conn || g.id !== id) return undefined
      const draft = !stopped && !disposalFailed && g.text === finalText && g.model === model && context() === g.context && deps.now() - g.at < PREVIEW_TTL_MS ? g.draft : undefined
      drop(g)
      return draft
    },
    clear(conn) {
      if (current?.conn !== conn) return
      seal(conn, current.id)
      drop(current)
    },
    tick() {
      if (stopped) return
      sweep()
      const g = current
      if (!g) return
      if (deps.now() - g.at >= PREVIEW_TTL_MS || context() !== g.context) return drop(g)
      if (g.disposed || g.ticking) return
      g.ticking = true
      void Promise.resolve().then(() => {
        if (!stopped && current === g && !g.disposed) return g.host.tick()
      }).catch(() => { failClosed('tick') }).finally(() => { g.ticking = false })
    },
    async stop() {
      stopped = true
      if (current) drop(current)
      sealed.clear()
      await Promise.all([...draining])
    },
  }

  // Each public entry has its own boundary: callers do not have to remember
  // which preview methods currently read a clock, context or host dependency.
  return {
    prepare(conn, id, text, model) {
      try { operations.prepare(conn, id, text, model) } catch { failClosed('prepare') }
    },
    take(conn, id, text, model) {
      try { return operations.take(conn, id, text, model) } catch { failClosed('take'); return undefined }
    },
    clear(conn) {
      try { operations.clear(conn) } catch { failClosed('clear') }
    },
    tick() {
      try { operations.tick() } catch { failClosed('tick') }
    },
    async stop() {
      try { await operations.stop() } catch { failClosed('stop') }
    },
  }
}
