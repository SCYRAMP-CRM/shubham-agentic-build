// F-020: the Shubham Agentic build. Dev (shubham-agentic-dev, on the hub) is the source; a
// build is what Publish makes of it, pushed to the build repo on GitHub; every PC runs a build,
// a clone of that repo started by its Start.cmd. Types only, shared by the agent (agent/build.ts)
// and the Build page, at `${AGENT_API_PREFIX}/build/...`.

export const BUILD_REPO = 'https://github.com/bztechserver-droid/shubham-agentic-build.git'

/** The agent exits with this when asked to update; Start.cmd then pulls the new build and starts it again. */
export const UPDATE_EXIT_CODE = 75

/** A build's RELEASE.json. */
export interface BuildVersion {
  /** "2026.10.31-1305": when it was built, to the minute. */
  version: string
  /** Dev's commit it was built from (short), and whether Dev had changes not committed. */
  commit: string | null
  dirty: boolean
  builtAt: string
  /** F-026: a fingerprint of Dev's files it was built from (its commit, its changes, its new files); null for builds from before. */
  devHash: string | null
  /** F-075: the chat host this build ships (its wire protocol and code version); absent in builds from before it. */
  chatHost?: { protocol: number; version: number } | null
  /** F-126: SHA-256 of the CRM drive host (crm-fs/crm-fs.exe) this build ships; absent when the publishing PC could not build it. The agent checks the exe against it before starting it. */
  crmFsSha256?: string
  /** obcbd: the checks decision that produced this artifact (absent in older builds). */
  publishAudit?: PublishAudit
}

export type PublishChecks = 'full' | 'skip'
export interface PublishActor {
  kind: 'owner' | 'lead'
  id: string
  name: string
}
export interface PublishAudit {
  checks: PublishChecks
  by: PublishActor
  at: string
}
export interface PublishRecord {
  id: string
  audit: PublishAudit
  startedAt: string
  endedAt: string | null
  outcome: 'running' | 'published' | 'unchanged' | 'failed'
  version: string | null
  error: string | null
}
export const SKIP_TESTS_WARNING = 'No tests will run. Types, lint, themes, frontend, backend and try-it smoke checks will all be skipped. The app must still compile before it can be published.'

export type UpdateState = 'unknown' | 'checking' | 'up-to-date' | 'available' | 'failed'
export type PublishState = 'idle' | 'running' | 'done' | 'failed'

export interface BuildInfo {
  /** 'build': this agent runs from a build (RELEASE.json beside it); 'dev': from Dev's source. */
  kind: 'build' | 'dev'
  /** The folder it runs from. */
  root: string
  /** The build this is; null for Dev. */
  current: BuildVersion | null
  update: {
    state: UpdateState
    /** The newer build on GitHub, when there is one. */
    available: BuildVersion | null
    checkedAt: string | null
    error: string | null
    /** It can update itself: a build, a clone of the build repo, started by Start.cmd. When not, why. */
    can: boolean
    cannot: string | null
    /**
     * F-075: Update was pressed and the chat host changes with it, so it waits for the chats to be idle (10 minutes), then
     * asks (`ask`): the chats are restarted and resumed if it is confirmed (POST /update {force: true}). Null: not waiting.
     */
    hostWait?: { since: string; busy: number; ask: boolean } | null
  }
  /** F-119: whether THIS browser may press Publish (signed in as sbskrrt). Only GET /build/info sets it; the pushed state does not carry it. */
  mayPublish?: boolean
  /** Publishing, on the hub that has Dev; null elsewhere. */
  publish: {
    devDir: string
    /** Dev's commit now (short) and how many files it has changed but not committed. */
    devCommit: string | null
    devChanges: number
    /**
     * F-026: whether Dev has anything the newest build hasn't: false hides Publish. Null when it
     * can't be told (a build from before the fingerprint, or Dev not read yet).
     */
    pending: boolean | null
    /** The newest build, that `pending` is against. */
    newest: string | null
    state: PublishState
    startedAt: string | null
    endedAt: string | null
    /** The publish's own lines, the last few hundred. */
    log: string[]
    /** What the last publish that worked published. */
    published: BuildVersion | null
    error: string | null
    /** Persisted attempts, newest first; records skipped checks even if compilation fails. */
    history?: PublishRecord[]
  } | null
}

/**
 * Order odb34 (Shubham: "can you give the build icon with update for everyone, so they know an update is available."): what every signed-in
 * person's page is told about this PC's build, in /auth/status. Versions only: nothing about publishing, Dev, or who may update.
 */
export interface BuildBadge {
  /** The build this PC runs ("2026.11.16-1806"); null when it runs from Dev's source. */
  current: string | null
  /** A newer published build this PC has seen (it looks every 15 minutes); null when there is none. */
  available: string | null
}

/** POST /build/publish */
export interface PublishRequest {
  /** Missing means full. Never persisted as the next publish's preference. */
  checks?: PublishChecks
  /** Required on every skip request, after the explicit warning. Only the owner's own page may skip (obcbd); the machine channel is refused. */
  confirmSkipTests?: boolean
  /** Old full-check clients can still send false; true is refused, never a bypass. */
  skipChecks?: boolean
}

// ---- Shubham's order ob12b (22 Nov 2026): the Build page for every signed-in person, with an Update button. What such a person may READ is this ALLOW-LIST, built field by field
// (never a copy of BuildInfo): /build/info carries folder paths, Dev's path, the publish log, error texts and who published, and stays the owner's.

/** The words of a build's version stamp, "2026.11.21-2000": only a string of this shape is ever sent, so no path or text can ride in a version. */
const VERSION_STAMP = /^\d{4}\.\d{2}\.\d{2}-\d{4}$/
const stamp = (v: unknown): string | null => (typeof v === 'string' && VERSION_STAMP.test(v) ? v : null)
const when = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/** Why this caller cannot press Update now: a CLOSED set of codes, each with its own fixed words (a free text from the agent never reaches a person's page). */
export type UpdateWhyNot =
  | 'not-signed-in'
  | 'first-owner-only'
  | 'people-off'
  | 'dev'
  | 'not-a-clone'
  | 'not-supervised'
  | 'member'
  | 'no-newer'
  | 'publishing'
  | 'held'
  | 'cooldown'
  | 'just-started'
  /** Only ever a PRESS's refusal (never in the status): the press could not be written to the audit first, so nothing was started. */
  | 'no-record'
export const UPDATE_WHY_WORDS: Readonly<Record<UpdateWhyNot, string>> = {
  'not-signed-in': 'Sign in to update.',
  'first-owner-only': 'Pressing Update is for the first owner of this app only.',
  'people-off': 'The owner has switched off Update for everyone else.',
  dev: 'This is Dev, run from its source: it is updated with git, not here.',
  'not-a-clone': 'This build is not a clone of the build repo, so it has nowhere to pull from.',
  'not-supervised': 'This build was not started by its Start.cmd, so it cannot start itself again.',
  member: "This PC is not the Server: it is updated from the Server's PC control, by its owner.",
  'no-newer': 'There is no newer build to update to.',
  publishing: 'A publish is running: try again when it has finished.',
  held: 'The update is held right now (something is running that must not be cut): try again later.',
  cooldown: 'Someone pressed Update a short while ago: try again in a while.',
  'just-started': 'The app restarted a moment ago: try again in a few minutes.',
  'no-record': 'This press could not be recorded, so nothing was started: try again, or ask the first owner.',
}

const STATE_WORDS: Readonly<Record<UpdateState, string>> = {
  unknown: 'Not looked yet.',
  checking: 'Looking for a newer build.',
  'up-to-date': 'This is the newest build.',
  available: 'A newer build is published.',
  failed: 'Could not look for a newer build just now.',
}

/** What a person's Build page is told. Versions are stamps, times are ISO, everything else is a number, a boolean or a fixed phrase. */
export interface BuildStatus {
  /** The build this PC runs; null when it runs from Dev's source. */
  current: { version: string; builtAt: string | null } | null
  update: {
    state: UpdateState
    words: string
    /** A newer published build this PC has seen. */
    available: { version: string } | null
    checkedAt: string | null
    /** Update was pressed and is waiting for busy chats to finish: how many are busy, never which. */
    waitingForChats: { busy: number } | null
    /** Whether the newer build changes the chat host, so pressing Update restarts every chat (null: nothing known yet). Otherwise only the app restarts and chats carry on. */
    restartsChats: boolean | null
    /** Whether THIS caller may press Update now, and why not in words. */
    allowed: boolean
    why: string | null
  }
  /** The last five publishes, newest first: version, time, outcome. Nothing of who, how or why. */
  published: { version: string | null; at: string | null; outcome: PublishRecord['outcome'] }[]
}

export interface BuildStatusContext {
  /** Whether the caller may press Update now (the agent decides: who, the switch, the guards). */
  allowed: boolean
  /** The reason it may not, as a CODE. Null while allowed. */
  why: UpdateWhyNot | null
  restartsChats: boolean | null
}

const OUTCOMES: readonly PublishRecord['outcome'][] = ['running', 'published', 'unchanged', 'failed']

/** The allow-list: builds the answer from `info` one field at a time. A field that is not named here cannot reach a person. */
export function buildStatusOf(info: BuildInfo, ctx: BuildStatusContext): BuildStatus {
  const current = info.current ? { version: stamp(info.current.version), builtAt: when(info.current.builtAt) } : null
  const available = info.update.available ? stamp(info.update.available.version) : null
  const wait = info.update.hostWait
  const history = info.publish?.history ?? []
  return {
    current: current && current.version ? { version: current.version, builtAt: current.builtAt } : null,
    update: {
      state: info.update.state,
      words: STATE_WORDS[info.update.state] ?? STATE_WORDS.unknown,
      available: available ? { version: available } : null,
      checkedAt: when(info.update.checkedAt),
      waitingForChats: wait && Number.isFinite(wait.busy) ? { busy: Math.max(0, Math.floor(wait.busy)) } : null,
      restartsChats: typeof ctx.restartsChats === 'boolean' ? ctx.restartsChats : null,
      allowed: ctx.allowed === true && ctx.why === null,
      why: ctx.why === null ? null : (UPDATE_WHY_WORDS[ctx.why] ?? UPDATE_WHY_WORDS['first-owner-only']),
    },
    published: history.slice(0, 5).map(r => ({
      version: stamp(r.version),
      at: when(r.endedAt ?? r.startedAt),
      outcome: OUTCOMES.includes(r.outcome) ? r.outcome : 'failed',
    })),
  }
}

// ---- The Update press by a person, and the owner's switch (C2 implements exactly these; the page builds on them).

/** POST /build/update by a signed-in person: names the build they SAW (the one available now). The first owner's press is unchanged (no body needed; `force` and update-cancel are his only). */
export interface UpdatePressRequest {
  to: string
}
/** 200 for a person's press: `restarting` false means it is waiting for busy chats (status.update.waitingForChats says how many). The answer is the allow-list again, never BuildInfo. */
export interface UpdatePressAnswer {
  restarting: boolean
  status: BuildStatus
}
/**
 * A person's refused press changes nothing and answers 409 { error: plain words, code, why }: code 'update-refused' with a `why` (the same codes and words as status.update.why), or 'look-again' when the build named is not the one available now
 * (the page reads /build/status again). 401 {code:'sign-in'} when not signed in; 403 {code:'admin-only'} for `force`, for update-cancel and when the owner has switched Update off for everyone else.
 */
export interface UpdateRefusal {
  error: string
  code: 'update-refused' | 'look-again'
  why?: UpdateWhyNot
}
/** GET and PUT /build/update-policy: the first owner's only (by id; a second owner is refused). Default ON; a file that cannot be read means OFF. */
export interface UpdatePolicy {
  peopleMayUpdate: boolean
}
