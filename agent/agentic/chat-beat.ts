import { existsSync, readFileSync, renameSync } from 'node:fs'
import { writeAtomic } from '../config.ts'
import {
  BEAT_INTERVALS, BEAT_PREFIX, DAILY_CAPS, DEFAULT_BEAT_MIN, DEFAULT_DAILY_CAP, FIVE_HOUR_STOP_PERCENT, HOLD_WORDS, MAX_BEATS_PER_TICK, MAX_UNANSWERED, METER_MAX_AGE_MS,
  ANSWER_GRACE_MS, NO_OPEN_GOALS_LINE, PAUSE_WORDS, UNANSWERED_AFTER_MS, WEEK_STOP_PERCENT, beatMessage, effectiveCap, effectiveInterval, lastLineOf,
  type BeatHold, type BeatKind, type BeatPatch, type BeatPause, type BeatRefusal, type ChatBeatView,
} from '../../shared/chat-beat.ts'
import { rankByOrder } from '../../shared/goal-order.ts'
import type { AgentRef, ChatNow, Finding } from './heartbeat.ts'

// F-359: the goals heartbeat of ONE chat (the first owner switches it on; shared/chat-beat.ts has the words and the limits). The old heartbeat (heartbeat.ts) calls
// `GoalBeats.run` once per beat; with no chat switched on it does nothing at all, so everything the old heartbeat does is as it was.
//
// A chat is beaten only when ALL of these hold: it is switched on and not paused; it is one the first owner may have a heartbeat on; it runs on THIS PC and is idle
// (not working, not at a question); the app's old check-in did not just type into it; it has been idle for its interval and was last beaten at least that long ago;
// today's most beats is not reached; the usage meter that guards the chat (Claude's weekly and 5-hour, or the Codex account's, read from the chat's own rollout) is known, fresh and below the stop (a Codex-in-Claude-Code chat has none: unmetered); the floor has goals linked to it and, when the CRM can
// be read, at least one of them is open. Nothing a chat wrote is ever typed back: the message is fixed text (beatMessage).
// The state is a file of its own (chat-beats.json), NOT part of floors.json: floor PATCH (the page sends the whole agents array) cannot carry it, and no chat tool reaches it.

/** The key of one chat's entry: its floor and agent (the session id changes at every new conversation). */
export const beatKey = (floorId: string, agentId: string) => `${floorId}|${agentId}`

export interface BeatEntry {
  enabled: boolean
  intervalMin: number
  dailyCap: number
  paused: BeatPause | null
  /** The local day (YYYY-MM-DD) `beatsToday` counts. */
  day: string
  beatsToday: number
  lastBeatAt: number | null
  /** A beat was typed and its answer has not been seen yet. */
  pending: boolean
  unanswered: number
  /** Why the last look that found it due did not beat; shown, and cleared as soon as a look can beat or is only waiting. */
  held: BeatHold | null
}

const fresh = (): BeatEntry => ({ enabled: false, intervalMin: DEFAULT_BEAT_MIN, dailyCap: DEFAULT_DAILY_CAP, paused: null, day: '', beatsToday: 0, lastBeatAt: null, pending: false, unanswered: 0, held: null })

const PAUSES: readonly string[] = Object.keys(PAUSE_WORDS)
const HOLDS: readonly string[] = Object.keys(HOLD_WORDS)

/** One saved entry as it is read back: every field checked, anything unknown made the safe value (off, defaults, no history). */
export function entryOf(raw: unknown): BeatEntry {
  const e = fresh()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return e
  const o = raw as Record<string, unknown>
  e.enabled = o.enabled === true
  if (typeof o.intervalMin === 'number' && (BEAT_INTERVALS as readonly number[]).includes(o.intervalMin)) e.intervalMin = o.intervalMin
  if (typeof o.dailyCap === 'number' && (DAILY_CAPS as readonly number[]).includes(o.dailyCap)) e.dailyCap = o.dailyCap
  if (typeof o.paused === 'string' && PAUSES.includes(o.paused)) e.paused = o.paused as BeatPause
  if (typeof o.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.day)) e.day = o.day
  if (typeof o.beatsToday === 'number' && Number.isInteger(o.beatsToday) && o.beatsToday >= 0 && o.beatsToday <= 1000) e.beatsToday = o.beatsToday
  if (typeof o.lastBeatAt === 'number' && Number.isFinite(o.lastBeatAt) && o.lastBeatAt > 0) e.lastBeatAt = o.lastBeatAt
  e.pending = o.pending === true && e.lastBeatAt !== null
  if (typeof o.unanswered === 'number' && Number.isInteger(o.unanswered) && o.unanswered >= 0 && o.unanswered <= MAX_UNANSWERED) e.unanswered = o.unanswered
  if (typeof o.held === 'string' && HOLDS.includes(o.held)) e.held = o.held as BeatHold
  return e
}

export interface ChatBeats {
  get(key: string): BeatEntry | undefined
  keys(): string[]
  /** What the page asked for (already checked by parseBeatPatch). Returns the entry as saved. */
  patch(key: string, p: BeatPatch): BeatEntry
  /** The engine's own bookkeeping. */
  note(key: string, change: Partial<BeatEntry>): void
  remove(key: string): void
  /** The file could not be read when the agent started: it was set aside and nothing is switched on. */
  unreadable(): boolean
}

/** The file `chat-beats.json`. Missing = nothing switched on. Not readable = set aside (never overwritten), nothing switched on, said once in the log. */
export function createChatBeats(o: { file: string; log?: { info(m: string): void; warn(m: string): void } }): ChatBeats {
  const entries = new Map<string, BeatEntry>()
  let unreadable = false
  if (existsSync(o.file)) {
    try {
      const raw = JSON.parse(readFileSync(o.file, 'utf8')) as unknown
      const chats = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { chats?: unknown }).chats : undefined
      if (!chats || typeof chats !== 'object' || Array.isArray(chats)) throw new Error('not a heartbeat file')
      for (const [k, v] of Object.entries(chats)) if (/^[A-Za-z0-9._:-]{1,64}\|[A-Za-z0-9._:-]{1,64}$/.test(k)) entries.set(k, entryOf(v))
    } catch (e) {
      unreadable = true
      entries.clear()
      try {
        renameSync(o.file, `${o.file}.unreadable-${Date.now()}`)
      } catch {
        // Left where it is: it is still never read as switched on.
      }
      o.log?.warn(`chat heartbeats: the file could not be read (${e instanceof Error ? e.message : String(e)}); it was set aside and no chat has a heartbeat until he switches one on again`)
    }
  }
  const save = () => {
    try {
      writeAtomic(o.file, `${JSON.stringify({ version: 1, chats: Object.fromEntries(entries) }, null, 2)}\n`)
    } catch (e) {
      o.log?.warn(`chat heartbeats: the file could not be written (${e instanceof Error ? e.message : String(e)})`)
    }
  }
  return {
    get: key => (entries.has(key) ? { ...entries.get(key)! } : undefined),
    keys: () => [...entries.keys()],
    patch(key, p) {
      const e = entries.get(key) ?? fresh()
      if (p.enabled === true && !e.enabled) Object.assign(e, { enabled: true, paused: null, unanswered: 0, pending: false, held: null })
      if (p.enabled === false) Object.assign(e, { enabled: false, paused: null, unanswered: 0, pending: false, held: null })
      if (p.intervalMin !== undefined) e.intervalMin = p.intervalMin
      if (p.dailyCap !== undefined) e.dailyCap = p.dailyCap
      if (p.paused === true && e.enabled) e.paused = 'by-hand'
      if (p.paused === false && e.enabled) Object.assign(e, { paused: null, unanswered: 0 })
      entries.set(key, e)
      save()
      return { ...e }
    },
    note(key, change) {
      const e = entries.get(key)
      if (!e) return
      Object.assign(e, change)
      save()
    },
    remove(key) {
      if (entries.delete(key)) save()
    },
    unreadable: () => unreadable,
  }
}

/** The local day as YYYY-MM-DD. */
const dayOf = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

/** Claude's meter for the subscription these chats run on, as the newest limits snapshot says (usage/usage.ts), or null. */
export interface Meter {
  weekPercent: number | null
  fiveHourPercent: number | null
  /** When each window resets (ms), when the snapshot said. */
  weekResetsAt?: number | null
  fiveHourResetsAt?: number | null
  /** When it was observed (ms). */
  at: number
}

/**
 * True when the meter allows a beat: known, not too old, and below both stops. A week that is not known is not allowed (never beaten blind), and neither is a week whose window has reset
 * since the reading (its percentage is of the old week). A 5-hour window that has reset since the reading is not counted: it started over.
 */
export function meterAllows(m: Meter | null, now: number): boolean {
  if (m === null || now - m.at > METER_MAX_AGE_MS || m.at > now + 60_000) return false
  if (m.weekPercent === null || !(m.weekPercent < WEEK_STOP_PERCENT)) return false
  if (typeof m.weekResetsAt === 'number' && m.weekResetsAt <= now) return false
  if (typeof m.fiveHourResetsAt === 'number' && m.fiveHourResetsAt <= now) return true
  return m.fiveHourPercent === null || m.fiveHourPercent < FIVE_HOUR_STOP_PERCENT
}

export type BeatSend = 'sent' | 'uncertain' | 'later'

export interface GoalBeatDeps {
  now(): number
  agents(): AgentRef[]
  /** Null when this chat may have a heartbeat (the same check the route makes when he switches it on), else why not. */
  ineligible(floorId: string, agentId: string): string | null
  stateOf(sessionId: string): ChatNow
  /** What the chat is made of: it decides the least idle time and the most beats a day it can be given (a Codex-in-Claude-Code chat has no meter, so it gets less). */
  kind(sessionId: string): BeatKind
  /** The chat runs on THIS PC. */
  here(sessionId: string): boolean
  /** A fenced run takes no input at all. */
  fenced(sessionId: string): boolean
  /** He stopped the chat on purpose and has not opened it since. */
  stoppedOnPurpose(sessionId: string): boolean
  /** When its conversation was last written (ms), or null when there is none: a chat that never wrote anything is never beaten. */
  idleSince(sessionId: string): number | null
  /** The chat's last answer: its words and when it was written (ms), or null. */
  lastAnswer(sessionId: string): { text: string; at: number } | null
  /** The meter that guards THIS chat: Claude's for a Claude chat, the Codex account's (read from the chat's own rollout) for a Codex chat, null when there is none to read (held), 'unmetered' when no meter exists for it at all (Codex in Claude Code: only today's cap and the pauses guard it). */
  meter(sessionId: string): Meter | null | 'unmetered'
  /** How many goals are linked to this floor, of any status (the app's own link file: local and always known). */
  linkedGoals(floorId: string): number
  /** How many of this floor's linked goals are open, read from the CRM; null when that cannot be told (not signed in, an error, more goals than one read holds). */
  openGoals(floorId: string): Promise<number | null>
  /**
   * Types the words into the chat (never over an unsent draft of his). 'sent': it was typed or queued; 'uncertain': it may have been typed (the delivery is still in progress or could not be confirmed): counted as a beat, never typed again;
   * 'later': nothing was typed (a draft, a menu, a chat that is gone): the next look tries again.
   */
  type(sessionId: string, text: string): BeatSend | Promise<BeatSend>
  log?: { info(m: string): void; warn(m: string): void }
}

export interface GoalBeats {
  /** One look at every chat that is switched on. `nudged`: chats the old check-in typed into in this same beat (they are left alone now). Returns what is worth telling. */
  run(now: number, nudged: ReadonlySet<string>): Promise<Finding[]>
  view(floorId: string, agentId: string): ChatBeatView
  /** Every entry's view by key, for the page. */
  views(): Record<string, ChatBeatView>
}

export function createGoalBeats(store: ChatBeats, d: GoalBeatDeps): GoalBeats {
  let busy = false
  /** Entries whose agent was not found in a look: removed only after several looks in a row (a floor list that failed to load must not wipe them). */
  const missing = new Map<string, number>()
  const MISSES = 3

  const pauseFinding = (key: string, a: AgentRef, reason: BeatPause): Finding => ({
    kind: 'goal-beat', key: `goalbeat:${key}:${reason}`, did: true, agent: a.agentName, floor: a.floorName,
    text: `${a.agentName} on ${a.floorName}: its goals heartbeat paused itself. ${PAUSE_WORDS[reason]}`,
  })

  async function run(now: number, nudged: ReadonlySet<string>): Promise<Finding[]> {
    const findings: Finding[] = []
    if (busy) return findings
    busy = true
    try {
      const refs = d.agents()
      const seen = new Set<string>()
      let sent = 0
      for (const a of refs) {
        const key = beatKey(a.floorId, a.agentId)
        seen.add(key)
        missing.delete(key)
        const first = store.get(key)
        if (!first || !first.enabled || first.paused) continue
        let e: BeatEntry = first
        const refresh = () => { e = store.get(key) ?? e }
        const hold = (h: BeatHold | null) => { if (e.held !== h) { store.note(key, { held: h }); refresh() } }
        const sid = a.sessionId
        if (!sid) { hold('not-running'); continue }
        if (a.assistant || d.ineligible(a.floorId, a.agentId) !== null) { hold('ineligible'); continue }
        if (nudged.has(sid)) continue
        const st = d.stateOf(sid)
        if (st === undefined || d.stoppedOnPurpose(sid)) { hold('not-running'); continue }
        if (!d.here(sid)) { hold('elsewhere'); continue }
        if (d.fenced(sid)) { hold('ineligible'); continue }
        // Working or at a question: no beat, and nothing is counted; its clock starts again from the end of this turn (the conversation's last write).
        if (st !== 'idle') continue

        const idleAt = d.idleSince(sid)
        // The answer to the last beat: the chat wrote words after it, or its conversation was written to well after it (it did something). If its last words end with the no-open-goals line, this heartbeat pauses.
        if (e.pending && e.lastBeatAt !== null) {
          const last = d.lastAnswer(sid)
          const wrote = last !== null && last.at >= e.lastBeatAt
          if (wrote || (idleAt !== null && idleAt - e.lastBeatAt > ANSWER_GRACE_MS)) {
            const said = wrote && lastLineOf(last.text) === NO_OPEN_GOALS_LINE
            store.note(key, { pending: false, unanswered: 0, ...(said ? { paused: 'no-open-goals' as const, held: null } : {}) })
            refresh()
            if (said) { findings.push(pauseFinding(key, a, 'no-open-goals')); continue }
          } else if (now - e.lastBeatAt >= UNANSWERED_AFTER_MS) {
            const n = e.unanswered + 1
            const stop = n >= MAX_UNANSWERED
            store.note(key, { pending: false, unanswered: n, ...(stop ? { paused: 'unanswered' as const, held: null } : {}) })
            refresh()
            if (stop) { findings.push(pauseFinding(key, a, 'unanswered')); continue }
          } else continue // its answer is still awaited
        }

        const day = dayOf(now)
        if (e.day !== day) { store.note(key, { day, beatsToday: 0 }); refresh() }
        // The saved setting is never more than the kind of chat allows (a chat that was Claude when he chose it, or whose file holds 24 or 48 a day, and is now Codex in Claude Code).
        const kind = d.kind(sid)
        if (e.beatsToday >= effectiveCap(kind, e.dailyCap)) { hold('cap'); continue }
        if (idleAt === null) { hold(null); continue }
        const every = effectiveInterval(kind, e.intervalMin) * 60_000
        if (now - idleAt < every || (e.lastBeatAt !== null && now - e.lastBeatAt < every)) { hold(null); continue }
        if (sent >= MAX_BEATS_PER_TICK) continue

        // Due. The cheap checks first, the CRM last.
        if (d.linkedGoals(a.floorId) === 0) { hold('no-goals'); continue }
        const meter = d.meter(sid)
        if (meter !== 'unmetered' && !meterAllows(meter, now)) { hold('meter'); continue }
        const open = await (async () => d.openGoals(a.floorId))().catch(() => null)
        if (open === 0) {
          store.note(key, { paused: 'all-done', held: null })
          findings.push(pauseFinding(key, a, 'all-done'))
          continue
        }
        const text = beatMessage(a.floorId, hhmm(now))
        const how = await (async () => d.type(sid, text))().catch((): BeatSend => 'later')
        if (how === 'later') { d.log?.warn(`goals heartbeat: ${key} could not be typed into now`); continue }
        if (how === 'uncertain') d.log?.warn(`goals heartbeat: ${key}: the delivery could not be confirmed; counted as a beat, never typed again`)
        sent++
        store.note(key, { lastBeatAt: now, beatsToday: e.beatsToday + 1, day, pending: true, held: null })
        d.log?.info(`goals heartbeat: a beat was typed into the chat of agent ${a.agentId} on floor ${a.floorId}`)
      }
      // An entry whose agent has not been on any floor for several looks in a row is forgotten (a deleted agent or floor). Never when no agent was found at all.
      if (refs.length > 0) {
        for (const key of store.keys()) {
          if (seen.has(key)) continue
          const n = (missing.get(key) ?? 0) + 1
          if (n >= MISSES) { store.remove(key); missing.delete(key) } else missing.set(key, n)
        }
      }
    } finally {
      busy = false
    }
    return findings
  }

  function viewOf(key: string, sid: string | null, now: number): ChatBeatView {
    const kind = sid ? d.kind(sid) : 'claude'
    const e = store.get(key)
    if (!e) return { enabled: false, intervalMin: DEFAULT_BEAT_MIN, dailyCap: DEFAULT_DAILY_CAP, state: 'off', why: null, lastBeatAt: null, nextAt: null, beatsToday: 0 }
    const beatsToday = e.day === dayOf(now) ? e.beatsToday : 0
    const base = { enabled: e.enabled, intervalMin: effectiveInterval(kind, e.intervalMin), dailyCap: effectiveCap(kind, e.dailyCap), lastBeatAt: e.lastBeatAt, beatsToday }
    if (!e.enabled) return { ...base, state: 'off', why: null, nextAt: null }
    if (e.paused) return { ...base, state: 'paused', why: PAUSE_WORDS[e.paused], nextAt: null }
    const idleAt = sid ? d.idleSince(sid) : null
    const every = effectiveInterval(kind, e.intervalMin) * 60_000
    const nextAt = idleAt === null ? null : Math.max(idleAt + every, e.lastBeatAt !== null ? e.lastBeatAt + every : 0)
    if (beatsToday >= effectiveCap(kind, e.dailyCap)) return { ...base, state: 'held', why: HOLD_WORDS.cap, nextAt: null }
    if (e.held) return { ...base, state: 'held', why: HOLD_WORDS[e.held], nextAt }
    return { ...base, state: 'beating', why: null, nextAt }
  }

  return {
    run,
    view: (floorId, agentId) => {
      const a = d.agents().find(x => x.floorId === floorId && x.agentId === agentId)
      return viewOf(beatKey(floorId, agentId), a?.sessionId ?? null, d.now())
    },
    views: () => {
      const now = d.now()
      const sids = new Map(d.agents().map(a => [beatKey(a.floorId, a.agentId), a.sessionId] as const))
      return Object.fromEntries(store.keys().map(k => [k, viewOf(k, sids.get(k) ?? null, now)] as const))
    },
  }
}

/** What decides whether a chat may have a goals heartbeat at all (index.ts reads each from the floors, the access rules and the chat defaults). */
export interface RefusalFacts {
  /** The floor is a PC Control floor. */
  pcControl: boolean
  /** The overlay Assistant (the hub's Orchestrator). */
  orchestrator: boolean
  /** A person's own Assistant (duty person-assistant), staff or not. */
  personAssistant: boolean
  /** The chat's owner is the FIRST owner of this app by id (a chat with no owner is his). A second owner's chat is not. */
  firstOwnerChat: boolean
  /** What the chat is made of (beatKindOfProfile): Claude, Codex, Codex in Claude Code, or something that cannot have a heartbeat. */
  kind: BeatKind
}

/** The chat's execution profile (runtime-engine.ts executionIdentityOf) as a BeatKind: anything but the three that can have a heartbeat, an unreadable profile included, is 'other'. */
export function beatKindOfProfile(profile: unknown): BeatKind {
  return profile === 'claude-native-v1' ? 'claude' : profile === 'codex-native-v1' ? 'codex' : profile === 'codex-in-claude-v1' ? 'bridge' : 'other'
}

/** Why this chat cannot have a goals heartbeat, in the order the sentences are chosen; null when it may. */
export function beatRefusalOf(f: RefusalFacts): BeatRefusal | null {
  if (f.pcControl) return 'pc-control'
  if (f.orchestrator) return 'assistant'
  if (f.personAssistant) return 'person-assistant'
  if (!f.firstOwnerChat) return 'not-first-owner'
  if (f.kind === 'other') return 'engine'
  return null
}

/** What crmGoals.list answers (JSON), as far as the heartbeat reads it. */
export interface GoalsRead {
  you?: { userId?: string } | unknown
  goals?: { id?: unknown }[]
  matching?: number
}

/**
 * How many of a floor's goals are open, from one read of the CRM's open goals (crmGoals.list with limit 100): null when that cannot be told - the CRM login is not `ownerId`'s (another person's kept login lists what THEY
 * see), or the floor shows none and the read may have been cut at 100. A count above 0 is always a sure count; 0 only when the whole list was seen.
 */
export function openGoalsOf(read: GoalsRead, links: Readonly<Record<string, string>>, floorId: string, ownerId: string): number | null {
  const you = read.you as { userId?: unknown } | null | undefined
  if (!you || typeof you.userId !== 'string' || you.userId.toLowerCase() !== ownerId.toLowerCase()) return null
  const here = (Array.isArray(read.goals) ? read.goals : []).filter(g => typeof g.id === 'string' && Object.hasOwn(links, g.id) && links[g.id] === floorId).length
  if (here > 0) return here
  return typeof read.matching === 'number' && read.matching <= 100 ? 0 : null
}

/**
 * crm_goals with `floor`: the goals of one read (limit 100) that are LINKED to that floor in the app's own link file, at most `want`, each with its `rank`: its place in HIS order of the floor's goals (Shubham's drag order in the Alt+G
 * curtain is his priority for the Lead). The goals his saved order names come first (its saved order file: ids and positions only), in that order; the goals it does not name (new ones) come after them, in the answer's own order (the CRM's). Rank 1 is
 * first, with no gaps: an id in the saved order that is not among the answer's goals (done, another floor's) takes no place. Read-only; nothing but the CRM's own cards, their `rank`, and the floor's id and name is in the answer.
 */
export function floorGoalsAnswer(read: GoalsRead, links: Readonly<Record<string, string>>, order: readonly string[], floor: { id: string; name: string }, want: number) {
  const mine = (Array.isArray(read.goals) ? read.goals : []).filter((g): g is { id: string } => typeof g.id === 'string' && Object.hasOwn(links, g.id) && links[g.id] === floor.id)
  const ranked = rankByOrder(mine, order)
  const cut = typeof read.matching === 'number' && read.matching > 100
  return {
    you: read.you,
    floor: { id: floor.id, name: floor.name },
    matching: ranked.length,
    goals: ranked.slice(0, want).map((g, i) => ({ ...g, rank: i + 1 })),
    ...(cut ? { note: 'More than 100 goals matched in the whole app; only the first 100 of them were looked at for this floor. Narrow it with query or status.' } : ranked.length > want ? { note: `Only the first ${want} are shown; narrow it with query or status.` } : {}),
  }
}

/** True when a user row typed into a chat is one of the goals beats (used by tests and by anything that must not count the app's own check-in as a person's words). */
export const isGoalBeatText = (text: string) => text.trimStart().startsWith(BEAT_PREFIX)
