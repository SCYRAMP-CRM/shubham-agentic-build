import type { ChatElsewhere, ChatState } from './agentic.ts'
import { GOAL_ID_RE, LINK_ID_RE } from './goal-floors.ts'
import { hideKeys, hideSecrets } from './hide-secrets.ts'
import { INVISIBLE } from './invisible.ts'

// F-361 (Shubham: "can we modifyt hte goals for floor to be more laive to see whihc agent is wokring on it and where it has reached?"): on a goal's row in the floor's goals curtain, which agent says it works on the goal,
// the ONE short line it last reported ("where it has reached") and how long ago. The rules are here, pure, so a test pins each one:
//  - what a line may be (cleaned chat text, 200 characters), what the app's own small file may hold (ids, the line, a time), and what one write may change;
//  - how often an agent may write (a gate), and the fixed sentence of every refusal;
//  - how the page puts the answer together with the app's own chat state (running, asking, idle, stopped) and says it.
// A line is CHAT TEXT: other people's words. It is cleaned before it is kept (control characters, bidi and zero-width marks, secret-shaped tokens, 200 code points), kept only in the app's own file (never in a log, never
// in an error, never sent to any chat), and drawn by the page as a text node beside "reported by <agent>": a claim of that agent, never a fact the app vouches for.

export const PROGRESS_FILE_VERSION = 1
/** The most code points one line may have after cleaning. */
export const MAX_LINE = 200
/** Raw text longer than this is refused (it is cut to MAX_LINE, but a wall of text is not "one short line"). */
export const MAX_RAW_LINE = 2_000
/** At most this many goals have an entry; past it the OLDEST entry (by time) is dropped, never the new one refused: it is a live note, not a record. */
export const MAX_ENTRIES = 1_500
/** A file bigger than this is not read at all ("nothing reported"). */
export const MAX_FILE_BYTES = 1_000_000
/** One agent may write about one goal once in this long. */
export const MIN_GAP_MS = 10_000
/** One agent may write this many times in an hour, over all its goals. */
export const HOURLY_MAX = 120
export const HOUR_MS = 3_600_000
/** The page changes its "x ago" and calls a quiet, not-running report old after this long. */
export const STALE_MS = 6 * HOUR_MS

/** 'answered' (F-362): the app's own words after Shubham answered a wait on this goal; 'dismissed': after he said he is not waiting any more (nothing was sent to the chat). Never any text of his. */
export type ProgressKind = 'reported' | 'updated' | 'answered' | 'dismissed'
export interface ProgressEntry {
  floorId: string
  agentId: string
  line: string
  /** The app's clock (an ISO time), never the chat's. */
  at: string
  /** 'reported': the agent's own line (chat text). 'updated': the app's own fixed words after the agent changed the goal with crm_goal_update. */
  kind: ProgressKind
}
export interface ProgressFile {
  version: typeof PROGRESS_FILE_VERSION
  progress: Record<string, ProgressEntry>
}
export const emptyProgress = (): ProgressFile => ({ version: PROGRESS_FILE_VERSION, progress: {} })

/** The fixed words the app writes itself when an agent changes a goal (never any text of the agent's). */
export const UPDATE_WORDS = { done: 'Marked done', abandoned: 'Dropped', todo: 'Back to to do', other: 'Edited' } as const
export const updatePhrase = (status: unknown): string => (status === 'done' ? UPDATE_WORDS.done : status === 'abandoned' ? UPDATE_WORDS.abandoned : status === 'todo' ? UPDATE_WORDS.todo : UPDATE_WORDS.other)

// oxlint-disable-next-line no-control-regex -- matching them is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u061c]/g

/**
 * What a line becomes, or null when nothing is left. In this order: not text or a wall of text is refused; control characters and line breaks become a space; bidi marks and zero-width marks are removed
 * (shared/invisible.ts); secret-shaped tokens, this PC's key shape and any bare run of 40 or more key-like characters are hidden (shared/hide-secrets.ts hideSecrets then hideKeys, BEFORE the cut, so a token cut in half is never left to look like a word); spaces are collapsed; at most MAX_LINE code points,
 * ending in an ellipsis when cut.
 */
export function cleanLine(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_RAW_LINE) return null
  const spaced = raw.replace(CONTROL, ' ').replace(INVISIBLE, '')
  const masked = hideKeys(hideSecrets(spaced)).replace(/\s+/g, ' ').trim()
  if (!masked) return null
  const points = Array.from(masked)
  return points.length > MAX_LINE ? `${points.slice(0, MAX_LINE - 1).join('').trimEnd()}…` : masked
}

const isoOk = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v))

/** One entry as a file or a wire holds it, or null: exactly { floorId, agentId, line, at, kind } with well-formed ids, a line that survives cleaning unchanged-or-shorter, and a real time. */
function entryOf(v: unknown): ProgressEntry | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  const e = v as Record<string, unknown>
  if (typeof e.floorId !== 'string' || !LINK_ID_RE.test(e.floorId) || typeof e.agentId !== 'string' || !LINK_ID_RE.test(e.agentId) || !isoOk(e.at)) return null
  if (e.kind !== 'reported' && e.kind !== 'updated' && e.kind !== 'answered' && e.kind !== 'dismissed') return null
  const line = cleanLine(e.line)
  return line === null ? null : { floorId: e.floorId, agentId: e.agentId, line, at: e.at, kind: e.kind }
}

/** What a file says. Tolerant on purpose: a missing, empty, oversize, torn, odd or wrong-version file is "nothing reported"; an entry that is not exactly an entry is dropped, so a file written by hand or by a newer build cannot put raw text into the app's view. */
export function parseProgress(text: unknown): ProgressFile {
  const out = emptyProgress()
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_FILE_BYTES) return out
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return out
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out
  const file = raw as { version?: unknown; progress?: unknown }
  if (file.version !== PROGRESS_FILE_VERSION || typeof file.progress !== 'object' || file.progress === null || Array.isArray(file.progress)) return out
  let n = 0
  for (const [goalId, v] of Object.entries(file.progress as Record<string, unknown>)) {
    if (n >= MAX_ENTRIES) break
    if (!GOAL_ID_RE.test(goalId)) continue
    const e = entryOf(v)
    if (e === null) continue
    out.progress[goalId] = e
    n++
  }
  return out
}

export const serializeProgress = (file: ProgressFile): string => `${JSON.stringify({ version: PROGRESS_FILE_VERSION, progress: file.progress })}\n`

export type SetResult = 'set' | 'same' | 'invalid'

/**
 * Puts `entry` as goal `goalId`'s one current entry (the last writer wins). The SAME agent saying the SAME line again is 'same' (nothing changes, so nothing is written and nobody is told). The line must already be
 * clean (cleanLine), the ids well-formed and the time real, else 'invalid' and nothing changes. Past MAX_ENTRIES the oldest entry by time is dropped (never the one just set).
 */
export function setEntry(file: ProgressFile, goalId: unknown, entry: ProgressEntry): { file: ProgressFile; result: SetResult } {
  if (typeof goalId !== 'string' || !GOAL_ID_RE.test(goalId)) return { file, result: 'invalid' }
  const clean = entryOf(entry)
  if (clean === null || clean.line !== entry.line) return { file, result: 'invalid' }
  const before = Object.hasOwn(file.progress, goalId) ? file.progress[goalId] : null
  if (before && before.agentId === clean.agentId && before.line === clean.line && before.kind === clean.kind && before.floorId === clean.floorId) return { file, result: 'same' }
  const next: Record<string, ProgressEntry> = { ...file.progress, [goalId]: clean }
  const ids = Object.keys(next)
  if (ids.length > MAX_ENTRIES) {
    const oldest = ids.filter(id => id !== goalId).sort((a, b) => Date.parse(next[a].at) - Date.parse(next[b].at))
    for (const id of oldest.slice(0, ids.length - MAX_ENTRIES)) delete next[id]
  }
  return { file: { version: PROGRESS_FILE_VERSION, progress: next }, result: 'set' }
}

/** What the page is sent for one floor: the entries of goals that belong to THAT floor. */
export type ProgressWire = Record<string, Pick<ProgressEntry, 'agentId' | 'line' | 'at' | 'kind'>>
export function progressForWire(file: ProgressFile, floorId: string): ProgressWire {
  const out: ProgressWire = {}
  for (const [goalId, e] of Object.entries(file.progress)) if (e.floorId === floorId) out[goalId] = { agentId: e.agentId, line: e.line, at: e.at, kind: e.kind }
  return out
}

/** Who made each goal of the floor (the app's own link file, shared/goal-floors.ts madeForWire): the fallback when nobody has reported. */
export type MadeWire = Record<string, { agentId: string; at: string }>

/** The answer of GET /floors/:id/goal-progress. */
export interface GoalProgressAnswer {
  progress: ProgressWire
  made: MadeWire
}

/** What the page makes of an answer: only well-formed entries, lines cleaned again (text that came over a wire is never trusted), at most MAX_ENTRIES of each; null when it is not an answer at all. */
export function cleanAnswer(raw: unknown): GoalProgressAnswer | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const a = raw as { progress?: unknown; made?: unknown }
  if (typeof a.progress !== 'object' || a.progress === null || Array.isArray(a.progress) || typeof a.made !== 'object' || a.made === null || Array.isArray(a.made)) return null
  const progress: ProgressWire = {}
  let n = 0
  for (const [goalId, v] of Object.entries(a.progress as Record<string, unknown>)) {
    if (n >= MAX_ENTRIES) break
    if (!GOAL_ID_RE.test(goalId) || typeof v !== 'object' || v === null || Array.isArray(v)) continue
    const e = v as Record<string, unknown>
    const line = cleanLine(e.line)
    if (line === null || typeof e.agentId !== 'string' || !LINK_ID_RE.test(e.agentId) || !isoOk(e.at) || (e.kind !== 'reported' && e.kind !== 'updated' && e.kind !== 'answered' && e.kind !== 'dismissed')) continue
    progress[goalId] = { agentId: e.agentId, line, at: e.at, kind: e.kind }
    n++
  }
  const made: MadeWire = {}
  n = 0
  for (const [goalId, v] of Object.entries(a.made as Record<string, unknown>)) {
    if (n >= MAX_ENTRIES) break
    if (!GOAL_ID_RE.test(goalId) || typeof v !== 'object' || v === null || Array.isArray(v)) continue
    const e = v as Record<string, unknown>
    if (typeof e.agentId !== 'string' || !LINK_ID_RE.test(e.agentId) || !isoOk(e.at)) continue
    made[goalId] = { agentId: e.agentId, at: e.at }
    n++
  }
  return { progress, made }
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The gate: how often an agent may write. Pure, with an injected clock; the agent keeps one in memory (a restart gives everyone a fresh hour, which is fine for a brake).

export type GateRefusal = 'too-soon' | 'hourly'
export interface ProgressGate {
  /** Whether this agent may write about this goal now; nothing is recorded. */
  allow(agentId: string, goalId: string): GateRefusal | null
  /** A write was kept: it counts from now. */
  record(agentId: string, goalId: string): void
}

export function createProgressGate(o: { now?: () => number; minGapMs?: number; hourlyMax?: number } = {}): ProgressGate {
  const now = o.now ?? Date.now
  const minGap = o.minGapMs ?? MIN_GAP_MS
  const hourly = o.hourlyMax ?? HOURLY_MAX
  const last = new Map<string, number>()
  const hour = new Map<string, number[]>()
  return {
    allow(agentId, goalId) {
      const t = now()
      const at = last.get(`${agentId}\n${goalId}`)
      if (at !== undefined && t - at < minGap) return 'too-soon'
      if ((hour.get(agentId) ?? []).filter(x => t - x < HOUR_MS).length >= hourly) return 'hourly'
      return null
    },
    record(agentId, goalId) {
      const t = now()
      last.set(`${agentId}\n${goalId}`, t)
      const live = (hour.get(agentId) ?? []).filter(x => t - x < HOUR_MS)
      live.push(t)
      hour.set(agentId, live)
      // Memory stays small: a goal-and-agent pair that has been quiet for an hour no longer matters to the gap rule.
      if (last.size > 2_000) for (const [k, v] of last) if (t - v >= HOUR_MS) last.delete(k)
    },
  }
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The tool's answers: one fixed sentence per refusal, with its HTTP status. Nothing a chat or a goal wrote is ever in one.

export type ReportResult = 'ok' | 'same' | 'bad-goal' | 'bad-line' | 'not-here' | 'too-soon' | 'hourly' | 'write-failed'
export const REPORT_WORDS: Record<Exclude<ReportResult, 'ok' | 'same'>, string> = {
  'bad-goal': 'goalId must be a goal id (from crm_goals, or the answer of crm_goal_add). Nothing was kept.',
  'bad-line': 'line must be one short line of words (up to 200 characters, no secret). Nothing was kept.',
  'not-here': "That goal is not on this floor's list, so no line was kept. Only a goal this floor's chats added can be reported on from here.",
  'too-soon': 'You reported on this goal a moment ago. Nothing was kept; report again after your next step.',
  hourly: 'This chat has reported 120 times in the last hour, which is the most. Nothing was kept; carry on with the work.',
  'write-failed': 'The line could not be kept just now. Carry on with the work.',
}
export const REPORT_STATUS: Record<Exclude<ReportResult, 'ok' | 'same'>, number> = { 'bad-goal': 400, 'bad-line': 400, 'not-here': 403, 'too-soon': 429, hourly: 429, 'write-failed': 503 }
export const REPORT_OK_WORDS = 'Noted: it shows on the goal in the floor\'s goals curtain, with your name and the time.'

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The page: which agent, in which state, saying what, how long ago. Derived from the answer above and the chat state the page already has (floors, live, elsewhere).

export type LiveState = 'running' | 'asking' | 'idle' | 'stopped'
export const LIVE_STATE_WORDS: Record<LiveState, string> = { running: 'working', asking: 'asking you', idle: 'idle', stopped: 'stopped' }
export interface LiveAgentRef {
  id: string
  name: string
  sessionId: string | null
}

/** A chat's state as the page already knows it: in `live` (this PC), else in `elsewhere` (another PC of the team), else it is not running. */
export function liveStateOf(sessionId: string | null | undefined, live: Record<string, ChatState>, elsewhere: Record<string, ChatElsewhere>): LiveState {
  if (!sessionId) return 'stopped'
  const s = Object.hasOwn(live, sessionId) ? live[sessionId] : Object.hasOwn(elsewhere, sessionId) ? elsewhere[sessionId].state : undefined
  return s === 'running' ? 'running' : s === 'question' ? 'asking' : s === 'idle' ? 'idle' : 'stopped'
}

export type LiveKind = 'reported' | 'updated' | 'answered' | 'dismissed' | 'made'
export interface GoalLive {
  agentId: string
  /** The agent's name on this floor; "Another agent" when it is no longer on it. */
  agent: string
  state: LiveState
  /** The line to draw (a TEXT NODE only), or null when there is none (the goal was only made by this agent). */
  line: string | null
  at: string
  kind: LiveKind
  /** An old report from an agent that is not running: the page draws it quieter. */
  stale: boolean
}
export const ANOTHER_AGENT = 'Another agent'

/**
 * What one OPEN goal's row says, or null. Order: this agent's report (a line it wrote, or what the app wrote after it changed the goal), else who made the goal (the app's own link), else nothing. A goal that is
 * done or dropped says nothing. A "made by" of a goal he added by hand, or by an agent that is no longer on the floor, says nothing (nobody is "working on it" by that).
 */
export function liveOf(
  goalId: string,
  status: 'todo' | 'done' | 'abandoned',
  answer: GoalProgressAnswer | null,
  agents: readonly LiveAgentRef[],
  live: Record<string, ChatState>,
  elsewhere: Record<string, ChatElsewhere>,
  now: number,
): GoalLive | null {
  if (status !== 'todo' || answer === null || !GOAL_ID_RE.test(goalId)) return null
  const pick = (id: string) => agents.find(a => a.id === id) ?? null
  const reported = Object.hasOwn(answer.progress, goalId) ? answer.progress[goalId] : null
  if (reported) {
    const a = pick(reported.agentId)
    const state = a ? liveStateOf(a.sessionId, live, elsewhere) : 'stopped'
    return { agentId: reported.agentId, agent: a?.name ?? ANOTHER_AGENT, state, line: reported.line, at: reported.at, kind: reported.kind, stale: state !== 'running' && now - Date.parse(reported.at) > STALE_MS }
  }
  const made = Object.hasOwn(answer.made, goalId) ? answer.made[goalId] : null
  if (made) {
    const a = pick(made.agentId)
    if (!a) return null
    const state = liveStateOf(a.sessionId, live, elsewhere)
    return { agentId: made.agentId, agent: a.name, state, line: null, at: made.at, kind: 'made', stale: state !== 'running' && now - Date.parse(made.at) > STALE_MS }
  }
  return null
}

/** "just now", "3 min ago", "2 h ago", "4 d ago" (a time in the future is "just now"). */
export function agoWords(at: string, now: number): string {
  const s = Math.max(0, Math.floor((now - Date.parse(at)) / 1000))
  if (!Number.isFinite(s)) return ''
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86_400)} d ago`
}

/**
 * The words around the line, so a claim is never drawn as a fact (Agent 14): `chip` is the agent and what the app sees of its chat; `byline` says WHO SAID IT. An agent's own line is "Reported by <agent>", the
 * app's own words after a change are "Changed by <agent>", and a goal only made by an agent says "Made by <agent>".
 */
export function liveWords(l: GoalLive, now: number): { chip: string; byline: string } {
  const ago = agoWords(l.at, now)
  // F-362: after his answer the line is the app's own words ("Shubham: Understood, next step") and the byline says the answer went to that agent.
  // A dismissal sent nothing to the chat: its words say the wait was ended, never that an answer went.
  if (l.kind === 'dismissed') return { chip: `${l.agent} · ${LIVE_STATE_WORDS[l.state]}`, byline: `Shubham ended ${l.agent}'s wait${ago ? ` · ${ago}` : ''}` }
  const verb = l.kind === 'reported' ? 'Reported by' : l.kind === 'updated' ? 'Changed by' : l.kind === 'answered' ? 'Answer sent to' : 'Made by'
  return { chip: `${l.agent} · ${LIVE_STATE_WORDS[l.state]}`, byline: `${verb} ${l.agent}${ago ? ` · ${ago}` : ''}` }
}

// ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// "The thing that is happening the latest should show on top" (Shubham, F-361): the curtain's sort "Latest activity". Pure helpers for it, so the order a test pins is the order the page shows.

/**
 * A goal's NEWEST sign of life, in milliseconds, or null when there is none: the newest of what its agent reported or changed (`progress` at), when the app's link says an agent made it (`made` at), and the
 * CRM's own `updatedAt` of the goal (anyone's edit counts as life). null = no sign at all (a goal the app never linked, with no time from the CRM).
 */
export function lastAtOf(goalId: string, answer: GoalProgressAnswer | null, updatedAt?: string | null): number | null {
  const times: number[] = []
  if (answer !== null && GOAL_ID_RE.test(goalId)) {
    if (Object.hasOwn(answer.progress, goalId)) times.push(Date.parse(answer.progress[goalId].at))
    if (Object.hasOwn(answer.made, goalId)) times.push(Date.parse(answer.made[goalId].at))
  }
  if (typeof updatedAt === 'string' && isoOk(updatedAt)) times.push(Date.parse(updatedAt))
  const real = times.filter(t => Number.isFinite(t))
  return real.length ? Math.max(...real) : null
}

/**
 * The order of "Latest activity": the goal with the newest sign of life first; goals with a sign of life before goals without one; ties and the goals with no sign keep the page's own default order
 * (`index`, the place each one has in that order). Returns a negative number when `a` goes first.
 */
export function compareLatest(a: { lastAt: number | null; index: number }, b: { lastAt: number | null; index: number }): number {
  if (a.lastAt !== null && b.lastAt !== null && a.lastAt !== b.lastAt) return b.lastAt - a.lastAt
  if ((a.lastAt === null) !== (b.lastAt === null)) return a.lastAt === null ? 1 : -1
  return a.index - b.index
}

/** `items` in the order of "Latest activity" (a new array; the input order is the default order that breaks ties). */
export function sortLatest<T>(items: readonly T[], lastAt: (item: T) => number | null): T[] {
  return items.map((item, index) => ({ item, lastAt: lastAt(item), index })).sort(compareLatest).map(x => x.item)
}

/**
 * For a nested list: each goal's lastAt becomes the newest of its own and of every goal under it (a goal whose sub-goal an agent just reported on moves up with it). `children(id)` says which goals are directly under
 * a goal; a visited set and a depth limit of 8 keep a loop in odd data from running away. Goals with no sign anywhere in their family stay null.
 */
export function rollUpLastAt(ids: readonly string[], own: (id: string) => number | null, children: (id: string) => readonly string[]): Map<string, number | null> {
  const out = new Map<string, number | null>()
  const walk = (id: string, seen: Set<string>, depth: number): number | null => {
    let best = own(id)
    if (depth >= 8 || seen.has(id)) return best
    seen.add(id)
    for (const kid of children(id)) {
      const t = walk(kid, seen, depth + 1)
      if (t !== null && (best === null || t > best)) best = t
    }
    return best
  }
  for (const id of ids) out.set(id, walk(id, new Set(), 0))
  return out
}
