// F-371 (26 Nov 2026, Lead's order; Shubham's words: "The CRM turned the sign-in down (the CRM answered 429)"): the CRM's firewall (the AWS WAF "overall-ceiling" rule: 300 requests a minute for ALL callers together) answered 429 to every request, and
// it counts the requests it blocks too, so a caller that asks again at once keeps it shut. This app was such a caller: every reader of the CRM drive that met a refusal fired two or three new calls, a dozen sessions polled claude-access/me, and each
// conversation copy asked again. This is the ONE wait for all of the app's CRM calls: when the CRM answers 429 (or 503), no CRM call is sent until a time T; every call made before T is answered at once, here, with a 429 of its own (so
// every caller says what it already says when the CRM refuses), and NOTHING goes over the network. T is the CRM's Retry-After when it gives one, else 30 s, doubling for each further 429 that comes after a wait, up to 5 minutes. The first answer
// that is not a refusal for load (a 2xx, but also a 401 or a 404: the CRM is answering again) ends the cooldown and starts the doubling over. When the wait is over, ONE call goes out as a probe and the others are answered here until its answer
// comes (a dozen callers all let go at the same second would shut the firewall again). A 401 is never a cooldown. Three places fetch from the CRM and all three go through here: claude/crm.ts
// call() (sign-in, who-am-I, the Claude/Codex/OpenCode credentials, the members, the usage), agentic/crmproxy.ts (the built-in CRM page, Goals, the crm_* tools, the CRM drive, the conversation copies) and agentic/views.ts (saved views); a test pins that no
// other file of the agent fetches a CRM path. It is one wait for the whole process, so it is a module-wide one; tests make their own with createCooldown.
// Agent 14's fixes (26 Nov): (1) the sign-in route /v1/auth/login is NOT part of this wait: the CRM's own login limit answers 429 per ACCOUNT, so a stranger who knows a username could otherwise stall every CRM call of the app (and escape the app's own
// five-a-minute throttle); the global wait never gates it and its answer never starts or ends that wait. (3) But with sign-in outside the wait and a busy sign-in uncounted, a visitor (or a retry loop) could send unlimited sign-ins to a CRM that is
// answering busy, and the firewall counts what it blocks: so sign-in has its OWN small wait, a separate instance (crmLoginCooldown): ONE busy answer starts it (one path), 10 s doubling to 60 s, any other answer ends it, every sign-in before it ends
// is answered locally with the same synthetic 429. It never touches the global wait, and the global wait never gates it (about 6 sign-ins a minute at most in a storm). (2) A wait does not start on ONE busy answer: it starts after TWO busy (429/503) answers within 10 s from at least TWO DIFFERENT paths (a path
// without its query or ids), so one route's backing-service 503 (an AI or email provider the CRM relays) cannot stop the app for everyone; a firewall storm, which answers every path, satisfies it at once. Once a wait has started, the probe that
// follows it is judged alone (a second busy answer restarts the wait, doubled). A busy answer for a request that started before the last wait ended (it was in flight, slow) is ignored: it cannot double a wait it was not part of.

export const COOLDOWN_BASE_MS = 30_000
export const COOLDOWN_CAP_MS = 300_000
/** A wait starts only on two busy answers inside this long, from two different paths. */
export const COOLDOWN_WINDOW_MS = 10_000
/** The sign-in route's own small wait (Agent 14's fix 3): 10 s, doubling to 60 s. */
export const LOGIN_COOLDOWN_BASE_MS = 10_000
export const LOGIN_COOLDOWN_CAP_MS = 60_000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const urlText = (input: Parameters<typeof fetch>[0]): string => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)

/** A path with no query and no ids ("/v1/org/projects/<uuid>/files" is "/v1/org/projects/:id/files"): what `two different paths` is counted by. */
export function pathKeyOf(url: string): string {
  let path: string
  try {
    path = new URL(url, 'https://crm.invalid').pathname
  } catch {
    path = url.split(/[?#]/)[0]
  }
  return path
    .split('/')
    .map(s => (UUID.test(s) || /^\d+$/.test(s) || /^[A-Za-z0-9_-]{20,}$/.test(s) ? ':id' : s))
    .join('/')
    .replace(/\/+$/, '') || '/'
}

/** The sign-in route: outside the global wait both ways (the CRM's login limit is per ACCOUNT; Agent 14's fix 1), with a small wait of its own (fix 3). */
export const isLoginPath = (url: string): boolean => pathKeyOf(url).toLowerCase() === '/v1/auth/login'

/** The statuses that mean "too much asked, wait": 429 (the firewall, or the CRM's own limit) and 503 (the CRM is shedding load). Never 401 or 403. */
export const isBusyStatus = (status: number): boolean => status === 429 || status === 503

export interface Cooldown {
  /** Milliseconds still to wait; 0 when calls may go. */
  remaining(): number
  active(): boolean
  /** May a call go out now? 0: yes (and, after a wait, THIS call is the one probe). Else the milliseconds to wait: answer it here, send nothing. */
  enter(): number
  /** A call that was let go and got no answer at all (the network failed): the probe, if it was one, is free again. */
  release(): void
  /** The clock this cooldown reads (ms): a request's start is stamped with it. */
  stamp(): number
  /**
   * What the CRM answered. A 429 or 503 counts toward a wait (it starts after two, from two different paths, inside COOLDOWN_WINDOW_MS; after a wait the first busy answer restarts it); any other answer ends a wait. `retryAfter` is the header's
   * value, when there was one; `from` says which request it was (its path key and when it started): a busy answer for a request that started before the last wait ended is ignored.
   */
  note(status: number, retryAfter?: string | null, from?: { path?: string; startedAt?: number }): void
  /** Ends the wait and the doubling (tests; and a sign-in that works). */
  reset(): void
  /** One line when a wait starts and one when it ends: never one per call. Null: none. */
  setLog(log: ((message: string) => void) | null): void
}

/** The wait a Retry-After header asks for, in ms: whole seconds, or an HTTP date. Null for anything else (and for nothing). Never over the cap, never under a second. */
export function retryAfterMs(value: string | null | undefined, now: number, capMs = COOLDOWN_CAP_MS): number | null {
  const raw = (value ?? '').trim()
  if (!raw) return null
  let ms: number
  if (/^\d{1,9}$/.test(raw)) ms = Number(raw) * 1000
  else {
    // An HTTP date ("Wed, 21 Oct 2026 07:28:00 GMT"): anything Date.parse would take for a date but that is not one ("1.5", "soon", a bare year) is not a wait.
    if (!/^[A-Za-z]{3},\s/.test(raw)) return null
    const at = Date.parse(raw)
    if (!Number.isFinite(at)) return null
    ms = at - now
  }
  if (!Number.isFinite(ms) || ms <= 0) return null
  return Math.min(Math.max(ms, 1000), capMs)
}

export function createCooldown(o: { now?: () => number; baseMs?: number; capMs?: number; need?: number; what?: string } = {}): Cooldown {
  const now = o.now ?? Date.now
  const base = o.baseMs ?? COOLDOWN_BASE_MS
  const cap = o.capMs ?? COOLDOWN_CAP_MS
  /** How many busy answers, from how many different paths, inside the window start the first wait (2: a storm; 1: the sign-in's own wait). */
  const need = o.need ?? 2
  const what = o.what ?? 'calls to it'
  let until = 0
  let lastUntil = 0
  let streak = 0
  let probing = false
  let busy: { at: number; path: string }[] = []
  let log: ((message: string) => void) | null = null
  const say = (m: string) => {
    try {
      log?.(m)
    } catch {
      // A logger that fails never decides what the app does.
    }
  }
  return {
    remaining: () => Math.max(0, until - now()),
    active: () => until > now(),
    enter() {
      const t = now()
      if (until > t) return until - t
      if (streak > 0) {
        if (probing) return 1000
        probing = true
      }
      return 0
    },
    release() {
      probing = false
    },
    stamp: () => now(),
    note(status, retryAfter, from = {}) {
      const t = now()
      if (isBusyStatus(status)) {
        // An answer that was already on its way when the wait began (several calls in flight): the same incident, not a new one.
        if (until > t) return
        // A slow answer to a request that started before the last wait ended: it was not part of what came after, and it cannot double that wait.
        if (from.startedAt !== undefined && from.startedAt < lastUntil) return
        probing = false
        if (streak === 0) {
          // The first wait: two busy answers inside the window from two different paths (one route's trouble is not the CRM's).
          const path = from.path ?? ''
          busy = [...busy.filter(b => t - b.at <= COOLDOWN_WINDOW_MS), { at: t, path }]
          if (busy.length < need || new Set(busy.map(b => b.path)).size < need) return
        }
        busy = []
        streak += 1
        const ms = retryAfterMs(retryAfter, t, cap) ?? Math.min(cap, base * 2 ** (streak - 1))
        until = t + ms
        lastUntil = until
        say(`the CRM answered ${status}: no ${what} for ${Math.ceil(ms / 1000)} s (it is not asked again before then)`)
        return
      }
      probing = false
      if (streak > 0) {
        streak = 0
        until = 0
        busy = []
        say(`the CRM answers again: ${what} go out as before`)
      }
    },
    reset() {
      streak = 0
      until = 0
      lastUntil = 0
      busy = []
      probing = false
    },
    setLog(l) {
      log = l
    },
  }
}

/** The app's one cooldown for its CRM calls. */
export const crmCooldown: Cooldown = createCooldown()

/** The sign-in route's own wait: a separate instance that never touches the one above (Agent 14's fix 3). One busy answer (one path) starts it. */
export const createLoginCooldown = (o: { now?: () => number } = {}): Cooldown => createCooldown({ ...o, baseMs: LOGIN_COOLDOWN_BASE_MS, capMs: LOGIN_COOLDOWN_CAP_MS, need: 1, what: 'sign-in calls to it' })
export const crmLoginCooldown: Cooldown = createLoginCooldown()

/**
 * A fetch that obeys a cooldown: before the wait is over it answers at once, from here, with a 429 (an empty JSON body and a Retry-After: what the firewall's own 429 looks like to a caller that reads the status) and sends nothing; otherwise it
 * calls `f`, and tells the cooldown what came back. A fetch that throws (no network) is no answer and changes nothing. The sign-in route obeys its OWN small wait (`login`), never the global one, and the global one never hears about it
 * (Agent 14's fixes 1 and 3): the only difference between the two is which cooldown is asked.
 */
export function withCooldown(f: typeof fetch, cd: Cooldown = crmCooldown, login: Cooldown = crmLoginCooldown): typeof fetch {
  return async (input, init) => {
    const url = urlText(input)
    const gate = isLoginPath(url) ? login : cd
    const wait = gate.enter()
    if (wait > 0) return new Response('{}', { status: 429, headers: { 'content-type': 'application/json', 'retry-after': String(Math.max(1, Math.ceil(wait / 1000))), 'x-sad-cooldown': '1' } })
    const startedAt = gate.stamp()
    let res: Response
    try {
      res = await f(input, init)
    } catch (e) {
      gate.release()
      throw e
    }
    gate.note(res.status, res.headers.get('retry-after'), { path: pathKeyOf(url), startedAt })
    return res
  }
}

/** The global fetch, obeying the app's cooldown. The global is looked at on each call (a test may replace it). */
export const crmFetch: typeof fetch = (input, init) => withCooldown(globalThis.fetch)(input, init)
