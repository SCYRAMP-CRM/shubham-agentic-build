import type { Logger } from './log.ts'

// 23 Nov 2026 (Lead's brief hub-crash-timeout-20261123): the hub stopped itself 39 times in a day on
// "TimeoutError: The operation was aborted due to timeout". The error is a DOMException made by AbortSignal.timeout(), so its own stack is only Node's timer ("at new DOMException",
// "at Timeout._onTimeout"): it says nothing about who asked for the timeout, which is why nobody could find the origin from the log. Two parts, both here:
//   1. trackAbortTimeouts(): remembers, for each AbortSignal.timeout(ms), the call that made it and when it is due, so a stray TimeoutError can be logged WITH its origin.
//   2. createStrayAbortGuard(): what the app's top-level error handlers ask first. A stray TimeoutError or AbortError is an abort that arrived where nobody listened (a stream
//      whose 'error' event had no listener, a callback that threw it): it is the cancelling of ONE piece of work, never a broken app, so it is logged (once a minute, with its
//      origin) and the app goes on; the same stray abort more than a few times a minute is a loop, and then the app stops as it always did. Every other error is not touched.

/** Where AbortSignal.timeout was called, and when its signal is due. */
interface Made {
  at: number
  ms: number
  site: string
}

/** Most recent first matters: a stray abort is looked up by the time it arrives. Long timers (a download's hours) stay until their time, but never more than this many. */
const KEEP = 2000
/** A timeout arrives a few ms after its due time (the timer, then the event loop): this much either way still names it. */
const SLACK_MS = 250

export interface AbortSites {
  /** The calls whose timeout was due about `at` (up to 3, nearest first), as text; empty when none was made through the wrapper. */
  whoMade(at: number): string[]
  restore(): void
}

let current: AbortSites | null = null

/**
 * Wraps AbortSignal.timeout so each call is remembered (its stack, its length, its due time). It keeps NO reference to any signal and adds no listener, so a signal is
 * collected exactly as before and nothing about the timer changes. Safe to call twice (the second call returns the first's handle).
 */
export function trackAbortTimeouts(now: () => number = Date.now): AbortSites {
  if (current) return current
  const original = AbortSignal.timeout
  const made: Made[] = []
  const wrapped = function timeout(this: unknown, ms: number): AbortSignal {
    try {
      const t = now()
      // Frame 0 is this wrapper; the rest is the caller.
      const site = (new Error().stack ?? '').split('\n').slice(2, 7).map(l => l.trim()).join(' | ')
      made.push({ at: t, ms, site })
      if (made.length > KEEP) made.splice(0, made.length - KEEP)
    } catch {
      // Remembering is a courtesy: it never changes what the caller gets.
    }
    return original.call(AbortSignal, ms)
  }
  AbortSignal.timeout = wrapped as typeof AbortSignal.timeout
  current = {
    whoMade(at) {
      return made
        .filter(m => Math.abs(m.at + m.ms - at) <= SLACK_MS)
        .sort((a, b) => Math.abs(a.at + a.ms - at) - Math.abs(b.at + b.ms - at))
        .slice(0, 3)
        .map(m => `${m.ms} ms, ${m.site}`)
    },
    restore() {
      if (AbortSignal.timeout === wrapped) AbortSignal.timeout = original
      current = null
    },
  }
  return current
}

/** A TimeoutError or an AbortError: an abort that was never anybody's failure. Nothing else counts (a TypeError, a RangeError, a string). */
export function isStrayAbort(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false
  const name = (e as { name?: unknown }).name
  if (name !== 'TimeoutError' && name !== 'AbortError') return false
  // The DOMException AbortSignal makes, or Node's own AbortError (code ABORT_ERR). A look-alike thrown by our own code is not one.
  return (typeof DOMException !== 'undefined' && e instanceof DOMException) || (e as { code?: unknown }).code === 'ABORT_ERR'
}

export interface StrayAbortGuard {
  /**
   * Said by the 'uncaughtException' handler: 'go-on' for a stray abort that is not a loop (logged), 'stop' for anything else, and for a stray abort that repeats more than
   * the limit in a minute (logged as the reason).
   */
  uncaught(e: unknown): 'go-on' | 'stop'
  /** Said by the 'unhandledRejection' handler: true when it was a stray abort and has been logged here (so the caller does not log it a second time). */
  rejected(e: unknown): boolean
}

export interface StrayAbortOptions {
  log: Pick<Logger, 'warn' | 'error'>
  sites?: Pick<AbortSites, 'whoMade'>
  now?: () => number
  /** More than this many in `windowMs` is a loop: stop (default 10). */
  limit?: number
  windowMs?: number
  /** How often the same kind of line may be written (default a minute). */
  logEveryMs?: number
}

export function createStrayAbortGuard(o: StrayAbortOptions): StrayAbortGuard {
  const now = o.now ?? Date.now
  const limit = o.limit ?? 10
  const windowMs = o.windowMs ?? 60_000
  const logEveryMs = o.logEveryMs ?? 60_000
  const times: number[] = []
  const lastLogged = { uncaught: -Infinity, rejected: -Infinity }
  const quiet = { uncaught: 0, rejected: 0 }

  const origin = (t: number) => {
    const found = o.sites?.whoMade(t) ?? []
    return found.length ? `made by: ${found.join(' || ')}` : 'made by: not known (no call through the tracker is due at this moment)'
  }
  const say = (kind: 'uncaught' | 'rejected', e: unknown, t: number, inWindow: number) => {
    if (t - lastLogged[kind] < logEveryMs) {
      quiet[kind]++
      return
    }
    const more = quiet[kind] ? ` (${quiet[kind]} more since the last line)` : ''
    quiet[kind] = 0
    lastLogged[kind] = t
    const name = (e as { name?: string }).name
    o.log.warn(`a stray ${name} (${kind === 'uncaught' ? 'thrown where nobody listened' : 'a rejected promise nobody awaited'}) was logged and the app went on${more}; ${inWindow} in the last minute; ${origin(t)}`)
  }

  return {
    uncaught(e) {
      if (!isStrayAbort(e)) return 'stop'
      const t = now()
      times.push(t)
      while (times.length && t - times[0] > windowMs) times.shift()
      if (times.length > limit) {
        o.log.error(`the same stray ${(e as { name?: string }).name} came ${times.length} times in a minute: that is a loop, not a stray, so the app stops; ${origin(t)}`)
        return 'stop'
      }
      say('uncaught', e, t, times.length)
      return 'go-on'
    },
    rejected(e) {
      if (!isStrayAbort(e)) return false
      const t = now()
      say('rejected', e, t, times.filter(x => t - x <= windowMs).length)
      return true
    },
  }
}
