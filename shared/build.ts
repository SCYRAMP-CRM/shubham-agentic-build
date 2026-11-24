// F-020: the Shubham Agentic build. Dev (shubham-agentic-dev, on the hub) is the source; a
// build is what Publish makes of it, pushed to the build repo on GitHub; every PC runs a build,
// a clone of that repo started by its Start.cmd. Types only, shared by the agent (agent/build.ts)
// and the Build page, at `${AGENT_API_PREFIX}/build/...`.

export const BUILD_REPO = 'https://github.com/bztechserver-droid/shubham-agentic-build.git'

/** The agent exits with this when asked to update; Start.cmd then pulls the new build and starts it again. */
export const UPDATE_EXIT_CODE = 75

// F-348 (Shubham: "make a restart button also asap in the next publish"): a PLAIN restart of the app. Under Start.cmd / the guard the app is started again on ANY exit; only the code 75 runs the update step first (agent/guard/supervisor.ts), so a plain
// restart leaves with this code and pulls nothing. Chats live in the chat host (its own process), which a plain restart never touches.
export const RESTART_EXIT_CODE = 0
export const RESTART_CODES = ['restart-busy', 'restart-unsupervised', 'restart-already'] as const
export type RestartCode = (typeof RESTART_CODES)[number]
/** The fixed sentences of a refused restart (the page shows only these) and what the confirmation says plainly. */
export const RESTART_WORDS: Record<RestartCode, string> = {
  'restart-busy': 'An update or a publish is running. Restart after it has finished.',
  'restart-unsupervised': 'This app was not started by Start.cmd, so it would not come back by itself. Nothing was restarted.',
  'restart-already': 'The app is already restarting.',
}
export const RESTART_ABOUT = 'The app restarts in a few seconds and this page reconnects by itself. Stopping the app can take up to about 25 seconds (it also closes the WhatsApp browser windows). Chats that are running keep running: they live in their own process. Nothing new is pulled. A message sent in those seconds may need sending again.'
/** An Update pressed while a restart is on its way: a second stop would cut the first one off, so it waits. */
export const RESTART_UPDATE_WORDS = 'The app is restarting. Update after it is back.'

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
  /** F-318: what this build gave, in the owner's own plain words (the note written at Publish, or edited after): one entry per line; absent when none was written. */
  gave?: string[]
  /** F-318: the commit titles that went into this build, collected by the publish from Dev (git log previous..this, no merges): at most 60 of at most 160 characters, no author, no body; absent when it could not be told. Never sent to a person. */
  changes?: string[]
  /** F-318: Dev's commit (short hash) this build was made from; absent in records from before. */
  commit?: string
  /** F-318 follow-up (Agent 14): TRUE when Dev had changes that were not committed when this build was made (they were published as they were, so the commit titles do not tell the whole story); absent otherwise and in records from before. */
  dirty?: true
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
  /** F-318: what this build gives, in plain words, for the History tab's Simple view: lines separated by \n, at most BUILD_NOTE_MAX_LINES of BUILD_NOTE_MAX_CHARS. Optional; refused (400) when over the limits, never cut. */
  note?: string
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

// ---- F-318 (Shubham's orders oa668 and oa79a, 22 Nov 2026): the Build page's History tab, "what each build update gave", as two inner tabs: SIMPLE (a plain note per published build, for everyone who can open the Build page)
// and COMPLEX (the automatic commit titles, the owner only). Honest limits, kept in the open: the note is plain text the owner or Lead wrote (nothing here can judge its words, so it must hold no secret and no person's name);
// the commit titles are what the developers typed; neither is checked against what the build really does.

/** The note's limits: at most this many lines, of at most this many characters each. A note over them is REFUSED (400), never silently cut. */
export const BUILD_NOTE_MAX_LINES = 12
export const BUILD_NOTE_MAX_CHARS = 200
/** The commit titles kept per build, and a title's length (a longer one is cut with "…"). */
export const BUILD_CHANGES_MAX = 60
export const BUILD_CHANGE_MAX_CHARS = 160
/** The History tab shows at most this many PUBLISHED builds (failed and unchanged attempts are not in it). */
export const BUILD_HISTORY_MAX_ROWS = 100

/**
 * One line of a note or a commit title, made safe to store and to show: any control character (a tab, an escape, a line end) becomes a space, `<` and `>` become the look-alike quotes ‹ › (no HTML, whatever draws it), and a "[" that begins
 * a sibling-chat style mark ("[message from", "[broadcast from", "[heartbeat", "[staff send", "[order") becomes "(" so a note can never pose as a message from the app. Cut to `max` characters with "…" when longer.
 * The mark list is the set the app's chat relays PREPEND to a line they type into a chat, and it is not meant to be every mark that exists: "[reply from", "[tapped" and "[spoken" are not in it because nothing types a note or a commit title into a chat
 * (they are stored and drawn on the Build page, as text, and go nowhere else). If a note is ever to be typed into a chat, the list must be revisited then, with that chat's own marks.
 */
export function cleanNoteLine(text: string, max = BUILD_NOTE_MAX_CHARS): string {
  const spaced = [...text].map(c => (c.charCodeAt(0) < 32 || (c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159) || c === '\u2028' || c === '\u2029' ? ' ' : c)).join('')
  const plain = spaced
    .replace(/</g, '‹')
    .replace(/>/g, '›')
    .replace(/\[(?=\s*(?:message from|broadcast from|heartbeat|staff send|order\b))/gi, '(')
    .replace(/ {2,}/g, ' ')
    .trim()
  const chars = [...plain]
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : plain
}

/**
 * A note as the owner writes it: lines separated by a line end. Each line is trimmed and made safe (cleanNoteLine), empty lines go; more than BUILD_NOTE_MAX_LINES lines or a line over BUILD_NOTE_MAX_CHARS characters is an error
 * (in words that never repeat the text). A note of nothing means "no note" (`lines` is empty).
 */
export function parseBuildNote(raw: unknown): { lines: string[] } | { error: string } {
  if (typeof raw !== 'string') return { error: 'The note must be text.' }
  const lines: string[] = []
  let n = 0
  for (const part of raw.split(/\r\n|\r|\n/)) {
    n += 1
    const trimmed = part.trim()
    if (!trimmed) continue
    if ([...trimmed].length > BUILD_NOTE_MAX_CHARS) return { error: `A note line is at most ${BUILD_NOTE_MAX_CHARS} characters (line ${n} is ${[...trimmed].length}).` }
    const clean = cleanNoteLine(trimmed)
    if (clean) lines.push(clean)
  }
  if (lines.length > BUILD_NOTE_MAX_LINES) return { error: `A note is at most ${BUILD_NOTE_MAX_LINES} lines (this one has ${lines.length}).` }
  return { lines }
}

/** The commit titles git printed (one per line), as the record keeps them: each made safe and cut to BUILD_CHANGE_MAX_CHARS, empty ones gone, at most BUILD_CHANGES_MAX. */
export function cleanCommitTitles(raw: readonly string[]): string[] {
  const out: string[] = []
  for (const title of raw) {
    const clean = cleanNoteLine(title, BUILD_CHANGE_MAX_CHARS)
    if (clean) out.push(clean)
    if (out.length >= BUILD_CHANGES_MAX) break
  }
  return out
}

/** "2026.11.22-1249" as an ISO time, to the minute, read as the hub's local time (the stamp is made from the hub's own clock in agent/scripts/publish.ts); null for anything that is not a real stamp. */
export function builtAtOf(version: unknown): string | null {
  const m = typeof version === 'string' ? /^(\d{4})\.(\d{2})\.(\d{2})-(\d{2})(\d{2})$/.exec(version) : null
  if (!m) return null
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number) as [number, number, number, number, number]
  const t = new Date(y, mo - 1, d, h, mi)
  return t.getFullYear() === y && t.getMonth() === mo - 1 && t.getDate() === d && t.getHours() === h && t.getMinutes() === mi ? t.toISOString() : null
}

/** One PUBLISHED build in the History tab, as every signed-in person who can open the Build page reads it. No author, no id, no commit, no error, no path: only these four fields. */
export interface BuildHistoryRow {
  /** The build's version stamp, "2026.11.22-1249". */
  version: string
  /** When it was built (ISO, to the minute); null if the stamp cannot be read as a time. */
  builtAt: string | null
  /** When its publish finished (ISO). */
  publishedAt: string | null
  /** What this build gave, in plain words: one entry per line the owner wrote. EMPTY when no note was written (the page says "No note was written for this build"). */
  gave: string[]
}
/** The same row as the OWNER reads it (the first owner by id, or the PC's own program): plus the record's id, Dev's commit, and the automatic commit titles. */
export interface BuildHistoryOwnerRow extends BuildHistoryRow {
  /** The publish record's id: PUT /build/history/:id/note names it. */
  id: string
  /** Dev's commit it was built from (short hash); null when it was not recorded. */
  commit: string | null
  /** The commit titles that went into this build (newest first, as git prints them); null = NOT RECORDED (the page says so); an empty list = recorded, nothing new. */
  changes: string[] | null
  /** Present (true) only when Dev had changes that were NOT committed when this build was made: the page says "plus changes not committed" beside the titles. Absent for a clean Dev and for records that do not say. Never in a person's row. */
  dirty?: true
}
/** GET /build/history: `view` says which rows these are, so the page never guesses from a missing key. A person's rows NEVER carry id, commit or changes (the keys are absent). Newest published build first, at most BUILD_HISTORY_MAX_ROWS. */
export type BuildHistory = { view: 'person'; rows: BuildHistoryRow[] } | { view: 'owner'; rows: BuildHistoryOwnerRow[] }
/** PUT /build/history/:id/note (the first owner, or the PC's own program): replaces a PUBLISHED build's note; an empty `note` clears it. The answer is the edited row, in the owner's shape. 400 over the limits, 403 for anyone else, 404 for a build that is not a published record. */
export interface BuildNoteRequest {
  note: string
}

const strings = (v: unknown, maxLines: number, maxChars: number): string[] | null =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, maxLines).map(x => [...x].slice(0, maxChars).join('')) : null

/**
 * The History tab's allow-list: builds the answer from the publish records one field at a time, so a field that is not named here (the actor, the checks, the error, a path) cannot reach anyone. Only PUBLISHED records with a real
 * version stamp, newest first, at most BUILD_HISTORY_MAX_ROWS; the person's view has four fields per row, the owner's seven. Records written before F-318 have no note, no titles and no commit, and read fine (`gave` empty, `changes` and `commit` null).
 */
export function buildHistoryOf(records: readonly PublishRecord[], view: 'person' | 'owner'): BuildHistory {
  const rows = records
    .filter(r => r.outcome === 'published' && stamp(r.version) !== null)
    .map(r => ({ r, at: when(r.endedAt ?? r.startedAt) }))
    .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
    .slice(0, BUILD_HISTORY_MAX_ROWS)
  const person = ({ r, at }: (typeof rows)[number]): BuildHistoryRow => ({
    version: stamp(r.version)!,
    builtAt: builtAtOf(r.version),
    publishedAt: at,
    gave: strings(r.gave, BUILD_NOTE_MAX_LINES, BUILD_NOTE_MAX_CHARS) ?? [],
  })
  if (view === 'person') return { view: 'person', rows: rows.map(person) }
  return {
    view: 'owner',
    rows: rows.map(x => ({
      ...person(x),
      id: typeof x.r.id === 'string' && /^[a-f0-9]{32}$/.test(x.r.id) ? x.r.id : '',
      commit: typeof x.r.commit === 'string' && /^[0-9a-f]{7,40}$/.test(x.r.commit) ? x.r.commit : null,
      changes: strings(x.r.changes, BUILD_CHANGES_MAX, BUILD_CHANGE_MAX_CHARS),
      ...(x.r.dirty === true ? { dirty: true as const } : {}),
    })),
  }
}
