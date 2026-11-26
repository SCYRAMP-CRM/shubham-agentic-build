import { AGENT_EFFORTS, type AgentEffort, type AgentModel, type OrgDefaultView } from '../../shared/agentic.ts'
import type { Logger } from '../log.ts'
import { CrmNotSignedIn, type CrmProxy } from './crmproxy.ts'

// F-284 (Shubham, order o3177, 18 Nov 2026: "also one more thign to wokrin ont is in teh usage int eh crm please add a defautl tab called defautl for stting deult modle and defautlt effor tand that shit"): the app READS the office's
// default model and effort from the CRM, only when the office has saved one, and only for what a chat can be started with. This file is the read and its cache; where it is used is index.ts (the spawn lines, F-284 commit b).
//
// What it reads: `GET /v1/org/model-settings/default` (sam-crm-be userModelSettingsController.js getDefaultModel: any signed-in member may read it) through the app's existing CRM proxy (crmproxy.ts request), as THIS PC's CRM login, so it
// is under F-371's cooldown, makes no sign-in of its own and NEVER writes: one GET, no CSRF, no body. The answer is { defaultModel, defaultEffort, defaultUltracode, defaultSubscriptionId, saved }.
//
// What it applies: only when `saved` is true (an office that never saved a default answers the CRM's BUILTIN "opus" with saved:false: that is a placeholder, never a setting), and only a model this app can name (opus, sonnet, haiku: the
// CRM also has opus-1m, fable and version pins, which are not applied and never reach `claude --model`) and an effort `claude --effort` takes. ULTRACODE IS NEVER APPLIED here (the Lead's ruling of 18 Nov 2026: not until a throwaway chat shows
// `/effort ultracode` leaves ~/.claude/settings.json alone); it is kept in the read so the page can say "set, not yet honoured".
//
// A start NEVER waits for the CRM and NEVER sends a request of its own: `get()` answers from the cache and asks nothing. Only a timer (start()) and an explicit refresh() read the CRM: the first read soon after the app starts, then when the
// last answer is due again, or the wait a failure left is over. No answer, an old CRM (404), a refusal, nobody signed in, an odd answer, or an answer older than 24 hours all mean "nothing": the chat starts exactly as it did before this
// file existed.

/** How often the answer is read again. */
export const ORG_REFRESH_MS = 10 * 60_000
/** How long the last good answer is kept while the CRM cannot be asked: an office that took its default away while the CRM was out of reach cannot keep it forever. */
export const ORG_KEEP_MS = 24 * 60 * 60_000
/** After a failure: the wait before the next try, growing, the last one for ever after (the F-372 pattern: no storm of asks at an unreachable CRM). */
export const ORG_RETRY_MS: readonly number[] = [5_000, 15_000, 45_000, 60_000]
/** The longest wait the CRM may ask for with Retry-After. */
const MAX_RETRY_AFTER_MS = 5 * 60_000
/** A clock that jumps back puts "when it was read" in the future: more than this and the answer is dropped. */
const SKEW_MS = 60_000
/** The one path the app reads (after the CRM's address). */
export const ORG_PATH = 'v1/org/model-settings/default'
const MAX_BODY_CHARS = 16_384
/** The first read, this long after the app starts. */
const FIRST_READ_MS = 5_000
/** The timer never wakes sooner than this. */
const MIN_TICK_MS = 5_000
/** The timer looks at the CRM login (a file read, never a request) at least this often, so signing in is noticed within it; it asks only when an ask is due. */
const LOOK_EVERY_MS = 30_000
/** A PC that is not to read it (a member) only looks again whether it should, this often. */
const INACTIVE_TICK_MS = 60_000
/** The models a chat of this app can be started with from an office default (shared/agentic.ts AGENT_MODELS without ''). */
const APPLIED_MODELS: readonly AgentModel[] = ['opus', 'sonnet', 'haiku']

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** What the CRM said, as it said it (the model id may be one the app cannot name). */
export interface OrgDefaultRead {
  /** false: the office never saved a default; the other fields are the CRM's placeholder and mean nothing. */
  saved: boolean
  model: string | null
  effort: string | null
  ultracode: boolean | null
  /** When this app read it (ISO). */
  at: string
}

/** What of it a chat is started with: '' for each that is not given. */
export interface OrgApplied {
  model: AgentModel
  effort: AgentEffort
}
export const NO_ORG_DEFAULT: OrgApplied = Object.freeze({ model: '', effort: '' }) as OrgApplied

/** The CRM's answer, read: null for anything that is not the shape it has (the app then reads nothing, as for an older CRM). */
export function parseOrgDefault(body: unknown, at: string): OrgDefaultRead | null {
  if (!isObject(body) || typeof body.saved !== 'boolean') return null
  return {
    saved: body.saved,
    model: typeof body.defaultModel === 'string' && body.defaultModel.length > 0 && body.defaultModel.length <= 64 ? body.defaultModel : null,
    effort: typeof body.defaultEffort === 'string' && body.defaultEffort.length > 0 && body.defaultEffort.length <= 32 ? body.defaultEffort : null,
    ultracode: typeof body.defaultUltracode === 'boolean' ? body.defaultUltracode : null,
    at,
  }
}

/** What a chat is started with from this answer: nothing unless the office SAVED a default, and then only what the app can name. Never ultracode. */
export function appliedOf(read: OrgDefaultRead | null): OrgApplied {
  if (!read || !read.saved) return NO_ORG_DEFAULT
  const model = APPLIED_MODELS.find(m => m === read.model) ?? ''
  const effort = AGENT_EFFORTS.find(e => e !== '' && e === read.effort) ?? ''
  return model === '' && effort === '' ? NO_ORG_DEFAULT : { model, effort }
}

/**
 * F-284 (c): the office default as the state frame carries it to a member PC, as the read-only route says it and as the page shows it: CONSTANTS ONLY, chosen here from the allow-lists (opus, sonnet, haiku; low..max), never the CRM's own
 * strings (Agent 14's rule). `model` and `effort` are '' for "none"; `notApplied` names what the office set that this app cannot start a chat with; `ultracode` is what the office set, shown and NEVER applied. `at` is when the hub read it,
 * on THIS PC's clock.
 */
export interface OrgDefaultKept {
  saved: boolean
  model: AgentModel
  effort: AgentEffort
  ultracode: boolean | null
  notApplied: ('model' | 'effort')[]
  at: string
}
/** What travels in the state frame: the same, with the AGE (whole milliseconds, at most 24 hours) in place of a time, because two PCs' clocks differ. null in the frame means "none", always explicitly. */
export type OrgDefaultCopy = Omit<OrgDefaultKept, 'at'> & { ageMs: number }

/** The hub's own read, as constants (nothing of the CRM's strings is carried on). */
export function keptOf(read: OrgDefaultRead): OrgDefaultKept {
  const applied = appliedOf(read)
  const notApplied: ('model' | 'effort')[] = []
  if (read.saved && read.model !== null && applied.model === '') notApplied.push('model')
  if (read.saved && read.effort !== null && applied.effort === '') notApplied.push('effort')
  return { saved: read.saved, model: applied.model, effort: applied.effort, ultracode: read.saved ? read.ultracode : null, notApplied, at: read.at }
}

const MODEL_CONSTANTS: readonly AgentModel[] = ['', ...APPLIED_MODELS]

/**
 * The copy as a member PC reads it back, received at `receivedAtMs` on ITS clock, once, at receipt (a frame sent again carries the hub's age again, so it cannot renew the 24 hours): null for anything that is not exactly that shape, and
 * then the member applies nothing. The age must be a finite non-negative WHOLE number of milliseconds of at most 24 hours; model and effort must be constants of the allow-lists; `notApplied` only 'model' and 'effort'.
 */
export function parseOrgCopy(raw: unknown, receivedAtMs: number): OrgDefaultKept | null {
  if (!isObject(raw) || !Number.isFinite(receivedAtMs)) return null
  const { saved, model, effort, ultracode, notApplied, ageMs } = raw
  if (typeof saved !== 'boolean' || typeof ageMs !== 'number' || !Number.isInteger(ageMs) || ageMs < 0 || ageMs > ORG_KEEP_MS) return null
  if (typeof model !== 'string' || !MODEL_CONSTANTS.some(m => m === model) || typeof effort !== 'string' || !AGENT_EFFORTS.some(e => e === effort)) return null
  if (ultracode !== null && typeof ultracode !== 'boolean') return null
  if (!Array.isArray(notApplied) || notApplied.length > 2 || !notApplied.every(n => n === 'model' || n === 'effort')) return null
  return { saved, model: model as AgentModel, effort: effort as AgentEffort, ultracode, notApplied: [...new Set(notApplied as ('model' | 'effort')[])], at: new Date(receivedAtMs - ageMs).toISOString() }
}

/** The same rules as the hub's own cache, for a kept answer: 24 hours from when the hub read it (inclusive), and not when that time is in the future (a clock that went back). Else null. */
export function keptRead<T extends { at: string }>(kept: T | null, nowMs: number): T | null {
  if (!kept) return null
  const at = Date.parse(kept.at)
  return Number.isFinite(at) && at - nowMs <= SKEW_MS && nowMs - at <= ORG_KEEP_MS ? kept : null
}

/** What a chat on a member PC is started with: the hub's copy while it is kept, run through appliedOf again (the same allow-lists) before any flag. */
export function appliedFromCopy(kept: OrgDefaultKept | null, nowMs: number): OrgApplied {
  const k = keptRead(kept, nowMs)
  return k && k.saved ? appliedOf({ saved: true, model: k.model || null, effort: k.effort || null, ultracode: null, at: k.at }) : NO_ORG_DEFAULT
}

/** What GET /agentic/org-default says (shared/agentic.ts OrgDefaultView): constants only. Null when there is no answer kept. */
export function orgDefaultView(kept: OrgDefaultKept | null, nowMs: number): OrgDefaultView | null {
  const k = keptRead(kept, nowMs)
  if (!k) return null
  const applied = appliedFromCopy(k, nowMs)
  return { saved: k.saved, appliedModel: applied.model, appliedEffort: applied.effort, notApplied: k.saved ? k.notApplied : [], ultracode: k.saved ? k.ultracode : null, ultracodeApplied: false, at: k.at }
}

export interface OrgDefaultOptions {
  proxy: Pick<CrmProxy, 'request' | 'session'>
  now?: () => number
  /** Only the first failure of a run is said, and never an address, a cookie or the CRM's own words. */
  log?: Pick<Logger, 'warn'>
  /** What is applied changed: a new answer, or the answer went away (the hub then tells its members). */
  onChange?: () => void
  /** False: this PC does not read the CRM for it (a member PC gets it from its hub): nothing is asked, nothing is applied. Left out: always. */
  active?: () => boolean
  /** Tests: the clock the timer waits on. Left out: setTimeout, which does not keep the process alive. */
  timer?: { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void }
}

export interface OrgDefault {
  /** What a chat started now gets from the office default. Never waits, never throws, and never asks the CRM: it only looks at what is kept. */
  get(): OrgApplied
  /** The last good answer while it is kept, as the CRM said it (the CRM's own strings: for this module and its tests only; the route, the state frame and the page carry kept() and copy(), never this). */
  last(): OrgDefaultRead | null
  /** The last good answer as CONSTANTS (the route and the page use it), or null. */
  kept(): OrgDefaultKept | null
  /** The same as the state frame carries it to the members (constants with their age), or null: an explicit "none". */
  copy(): OrgDefaultCopy | null
  /** Asks the CRM now (once at a time, and not before the wait a failure or the last answer left). */
  refresh(): Promise<void>
  /** The timer: the first read soon, then each time one is due. Reads nothing on a PC that is not to read it. */
  start(): void
  close(): void
}

export function createOrgDefault(o: OrgDefaultOptions): OrgDefault {
  const now = o.now ?? Date.now
  let read: OrgDefaultRead | null = null
  let readAt = 0
  /** Whose CRM login read it: the answer is that login's and is dropped when the login changes (Agent 14's N1). */
  let readBy: string | null = null
  let retryAt = 0
  let failures = 0
  let said = false
  /** The last look at the CRM login: signed in or not (the timer looks more often while nobody is). */
  let signedIn = true
  let inFlight: Promise<void> | null = null
  let timer: unknown = null
  let stopped = false
  const setT = o.timer?.set ?? ((fn: () => void, ms: number) => {
    const h = setTimeout(fn, ms)
    h.unref()
    return h
  })
  const clearT = o.timer?.clear ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>))

  const key = () => JSON.stringify(appliedOf(read))
  /** Sets `read` and tells the hub when what is applied changed. */
  function set(next: OrgDefaultRead | null, at = 0) {
    const was = key()
    read = next
    readAt = next ? at : 0
    if (next === null) readBy = null
    if (key() !== was) o.onChange?.()
  }
  const warn = (text: string) => {
    if (said) return
    said = true
    o.log?.warn(text)
  }
  /**
   * Who the CRM login is, for "is it the same login": its username, else its name. NOTE (Agent 14's nit B): the proxy's session falls back to the constant "Signed in" when a login has neither, so two logins that have neither a username nor a name
   * count as the same person here. The CRM's own logins always have a username, so this is a note, not a case; an answer is the same for the whole office anyway.
   */
  const identityOf = (s: { username: string | null; name: string | null }) => s.username ?? s.name ?? ''
  /**
   * Looks at the CRM login (a file read, never a request). Signed out: nothing is kept, and the next ask is due AT ONCE (retryAt 0), so signing in again is noticed by the next look and not up to ten minutes later (Agent 14's N1). Signed
   * in as ANOTHER login than the one that read the answer: the answer is not theirs, it is dropped, and the next ask is due at once. Returns whether somebody is signed in.
   */
  function syncLogin(): boolean {
    const s = o.proxy.session()
    signedIn = s.signedIn
    if (!s.signedIn) {
      if (read) set(null)
      readBy = null
      retryAt = 0
      failures = 0
      return false
    }
    if (readBy !== null && readBy !== identityOf(s)) {
      set(null)
      retryAt = 0
      failures = 0
    }
    return true
  }
  /**
   * How long until the next ask is due. A wait further off than the longest this module ever sets (ORG_REFRESH_MS) is the CLOCK's doing, not a wait: the clock was set back since, so it has ended (Agent 14's N3, the F-372 pattern).
   */
  function waitLeft(): number {
    const left = retryAt - now()
    return left > ORG_REFRESH_MS ? 0 : Math.max(0, left)
  }
  /**
   * "Nothing": the CRM does not have it (a 404: an older CRM), will not say (403) or the session ended (401). The answer is DROPPED and asked again at the refresh time. This is NOT what an odd body or a 5xx or no answer is: those are failures
   * (failed(), below): the last good answer is KEPT, under the 24-hour cap, and the CRM is asked again by the back-off (Agent 14's N2).
   */
  function nothing(t: number) {
    set(null)
    failures = 0
    retryAt = t + ORG_REFRESH_MS
  }
  /** A failure (an odd body, a 5xx, a 429, no answer): the last good answer is kept while it is within ORG_KEEP_MS, and the next ask waits the back-off (or as long as Retry-After says, up to five minutes). */
  function failed(t: number, why: string, retryAfterMs = 0) {
    failures++
    retryAt = t + Math.max(ORG_RETRY_MS[Math.min(failures - 1, ORG_RETRY_MS.length - 1)]!, Math.min(retryAfterMs, MAX_RETRY_AFTER_MS))
    warn(`couldn't read the office's default model from the CRM (${why}); chats start as they did`)
  }

  async function ask() {
    const before = o.proxy.session()
    if (!before.signedIn) return
    const by = identityOf(before)
    let res: Response
    try {
      res = await o.proxy.request('GET', ORG_PATH)
    } catch (e) {
      if (e instanceof CrmNotSignedIn) return void syncLogin()
      return failed(now(), e instanceof Error && e.name ? e.name : 'no answer')
    }
    const t2 = now()
    // The login changed while the request was on its way (signed out, or another person signed in): this answer is not theirs. Dropped, and the next ask is due at once.
    const after = o.proxy.session()
    if (!after.signedIn || identityOf(after) !== by) {
      retryAt = 0
      return
    }
    if (res.status === 200) {
      let text = ''
      try {
        text = await res.text()
      } catch {
        return failed(t2, 'the answer was cut')
      }
      let parsed: OrgDefaultRead | null = null
      try {
        parsed = text.length <= MAX_BODY_CHARS ? parseOrgDefault(JSON.parse(text), new Date(t2).toISOString()) : null
      } catch {
        parsed = null
      }
      if (!parsed) return failed(t2, 'an answer this app does not know')
      // The login is looked at AGAIN after the body is read (Agent 14's nit A): it can change during the read too, and the answer must never be stored for a moment under the login that is gone (the hub's onChange would push it once).
      const afterBody = o.proxy.session()
      if (!afterBody.signedIn || identityOf(afterBody) !== by) {
        retryAt = 0
        return
      }
      set(parsed, t2)
      readBy = by
      failures = 0
      said = false
      retryAt = t2 + ORG_REFRESH_MS
      return
    }
    // The CRM does not have it, or will not say: nothing, and not asked again for a while (a 404 is an older CRM; a 401 is a session that ended).
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      warn(`the CRM answered ${res.status} for the office's default model; it is not read`)
      return nothing(t2)
    }
    const retryAfter = Number(res.headers.get('retry-after'))
    return failed(t2, `the CRM answered ${res.status}`, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0)
  }

  function refresh(): Promise<void> {
    if (inFlight) return inFlight
    if (o.active && !o.active()) return Promise.resolve()
    if (!syncLogin()) return Promise.resolve()
    if (waitLeft() > 0) return Promise.resolve()
    inFlight = ask()
      .catch(() => failed(now(), 'an error here'))
      .finally(() => {
        inFlight = null
      })
    return inFlight
  }

  /** The last good answer while it is kept; nobody signed in to the CRM here, or another login than the one that read it, or a PC that is not to read it: none. */
  function last(): OrgDefaultRead | null {
    if (o.active && !o.active()) return null
    if (!syncLogin()) return null
    return read && readAt - now() <= SKEW_MS && now() - readAt <= ORG_KEEP_MS ? read : null
  }

  return {
    get() {
      const t = now()
      if (o.active && !o.active()) return NO_ORG_DEFAULT
      // Nobody signed in to the CRM on this PC (or another login than the one that read it): nothing, at once, and nothing is sent.
      if (!syncLogin()) return NO_ORG_DEFAULT
      // Too old, or read "in the future" by a clock that went back: dropped. (A look NEVER asks the CRM: only the timer, and an explicit refresh(), do. A chat start sends no request of its own.)
      if (read && (readAt - t > SKEW_MS || t - readAt > ORG_KEEP_MS)) set(null)
      return appliedOf(read)
    },
    last,
    kept() {
      const r = last()
      return r ? keptOf(r) : null
    },
    copy() {
      const r = last()
      if (!r) return null
      const { at, ...rest } = keptOf(r)
      return { ...rest, ageMs: Math.min(ORG_KEEP_MS, Math.max(0, Math.floor(now() - Date.parse(at)))) }
    },
    refresh,
    start() {
      if (timer || stopped) return
      // The first read soon after the app starts, then a look every LOOK_EVERY_MS at most (a file read for the CRM login: signing in is noticed within that), asking when the last answer is due again or the wait a failure left is over (never
      // sooner than MIN_TICK_MS); a PC that is not to read it (a member) only looks again in a minute.
      const schedule = (wait: number) => {
        timer = setT(() => {
          void refresh().finally(() => {
            if (!stopped) schedule(o.active && !o.active() ? INACTIVE_TICK_MS : !signedIn ? LOOK_EVERY_MS : Math.min(LOOK_EVERY_MS, Math.max(MIN_TICK_MS, waitLeft())))
          })
        }, wait)
      }
      schedule(FIRST_READ_MS)
    },
    close() {
      stopped = true
      if (timer) clearT(timer)
      timer = null
    },
  }
}
