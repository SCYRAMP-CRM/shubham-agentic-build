import { existsSync, readFileSync, renameSync } from 'node:fs'
import { writeAtomic } from '../config.ts'
import {
  AGENT_RAM_MB, BEAT_INTERVALS, BEAT_LOOK_MAX_CHATS, BEAT_PREFIX, DAILY_CAPS, DEFAULT_BEAT_MIN, DEFAULT_DAILY_CAP, DEFAULT_KEEP_ACTIVE, FIVE_HOUR_STOP_PERCENT, HOLD_WORDS, KEEP_ACTIVE_CHOICES, MAX_BEATS_PER_PC_HOUR, MAX_BEATS_PER_PC_TICK, MAX_BEATS_PER_TICK, MAX_UNANSWERED, METER_MAX_AGE_MS,
  ANSWER_GRACE_MS, NO_OPEN_GOALS_LINE, NUDGE_MIN_GAP_MS, PAUSE_WORDS, PC_HOUR_MS, START_LEDGER_MS, UNANSWERED_AFTER_MS, WEEK_STOP_PERCENT, beatChoicesOf, beatMessage, legacyBeatMessage, effectiveCap, effectiveInterval, effectiveKeepActive, keepActiveNow, lastLineOf, lookToMeter, startRoom,
  type BeatHold, type BeatKind, type BeatLook, type BeatLookAsk, type BeatLookChat, type BeatNumbers, type BeatPatch, type BeatPause, type BeatRefusal, type ChatBeatView, type NudgeCode,
} from '../../shared/chat-beat.ts'
import { rankByOrder } from '../../shared/goal-order.ts'
import type { AgentRef, ChatNow, Finding } from './heartbeat.ts'

// F-359: the goals heartbeat of ONE chat (the first owner switches it on; shared/chat-beat.ts has the words and the limits). The old heartbeat (heartbeat.ts) calls
// `GoalBeats.run` once per beat; with no chat switched on it does nothing at all, so everything the old heartbeat does is as it was.
//
// A chat is beaten only when ALL of these hold: it is switched on and not paused; it is one the first owner may have a heartbeat on; it runs on a PC the Server can reach (F-363: THIS PC, or another PC that
// answers `beat-look` and is not over its beats for the hour) and is idle (not working, not at a question); the app's old check-in did not just type into it; it has been idle for its interval and was last beaten at least that long ago;
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
  /**
   * F-365: how many agents of the floor the beat tells the chat to keep active (one of KEEP_ACTIVE_CHOICES), and whether it may be told to start stopped agents. `keepActive` is null until he has chosen it (switching the heartbeat on, or his tap in the
   * dialog): an entry saved before F-365 stays null and its chat still gets the old message, which asks nothing of other agents.
   */
  keepActive: number | null
  mayStart: boolean
}

const fresh = (): BeatEntry => ({ enabled: false, intervalMin: DEFAULT_BEAT_MIN, dailyCap: DEFAULT_DAILY_CAP, paused: null, day: '', beatsToday: 0, lastBeatAt: null, pending: false, unanswered: 0, held: null, keepActive: null, mayStart: true })

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
  if (typeof o.keepActive === 'number' && (KEEP_ACTIVE_CHOICES as readonly number[]).includes(o.keepActive)) e.keepActive = o.keepActive
  if (typeof o.mayStart === 'boolean') e.mayStart = o.mayStart
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
      // His tap on the switch is his word for the default number of agents too (an entry saved before F-365 gets it only so, or by his choice in the dialog).
      if (p.enabled === true && e.keepActive === null) e.keepActive = DEFAULT_KEEP_ACTIVE
      if (p.enabled === false) Object.assign(e, { enabled: false, paused: null, unanswered: 0, pending: false, held: null })
      if (p.intervalMin !== undefined) e.intervalMin = p.intervalMin
      if (p.dailyCap !== undefined) e.dailyCap = p.dailyCap
      if (p.keepActive !== undefined) e.keepActive = p.keepActive
      if (p.mayStart !== undefined) e.mayStart = p.mayStart
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

/** F-363: the PC a chat runs on: this one (the Server, where the engine runs) or another. */
export interface BeatPc {
  id: string
  name: string
  self: boolean
}

export interface GoalBeatDeps {
  now(): number
  agents(): AgentRef[]
  /** Null when this chat may have a heartbeat (the same check the route makes when he switches it on), else why not. */
  ineligible(floorId: string, agentId: string): string | null
  stateOf(sessionId: string): ChatNow
  /** What the chat is made of: it decides the least idle time and the most beats a day it can be given (a Codex-in-Claude-Code chat has no meter, so it gets less). */
  kind(sessionId: string): BeatKind
  /** The PC the chat runs on now (the hub's live view of every PC), or null when it runs nowhere the hub knows. */
  pcOf(sessionId: string): BeatPc | null
  /** The chat's own PC is another one that is not connected to the Server now (so it cannot be running and cannot be asked). */
  homeAway(sessionId: string): boolean
  /**
   * F-363: ONE question to ONE other PC about the chats on it (the peer op `beat-look`): their state, how long ago each was written, whether the last answer is the no-open-goals line, and the meter that guards each, all read
   * on that PC. 'offline': the Server has no link to it; 'older': that PC does not know the question (an older build); 'silent': no usable answer. Only used for chats that are not on this PC.
   */
  look(pc: BeatPc, asks: BeatLookAsk[]): Promise<BeatLook | 'offline' | 'older' | 'silent'>
  /** A fenced run takes no input at all (a chat of this PC: another PC's own pool refuses a fenced run at the write). */
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
  /** F-365 (F-362): does the chat's agent wait for Shubham on a goal that is still open? A chat that does is never beaten and never nudged. */
  waiting(floorId: string, agentId: string): boolean | Promise<boolean>
  /** F-365: how many OTHER agents of the floor are active now: their chat is working this moment, or they reported on a goal in the last ACTIVE_RECENT_MS. */
  activeAgents(floorId: string, exceptAgentId: string, now: number): number
  /** F-365: how many agents of the floor run on this PC (the Server), in any state. */
  runningOnServer(floorId: string): number
  /** F-365: the Server's free memory, in MB. */
  freeMemMb(): number
  /**
   * Types the words into the chat (never over an unsent draft of his). 'sent': it was typed or queued; 'uncertain': it may have been typed (the delivery is still in progress or could not be confirmed): counted as a beat, never typed again;
   * 'later': nothing was typed (a draft, a menu, a chat that is gone): the next look tries again.
   */
  type(sessionId: string, text: string): BeatSend | Promise<BeatSend>
  log?: { info(m: string): void; warn(m: string): void }
}

/** F-365: what a nudge by hand did: the message was typed (or may have been), or the plain reason it was not. */
export type NudgeResult = { ok: true; how: 'sent' | 'uncertain'; at: number } | { ok: false; code: NudgeCode }

export interface GoalBeats {
  /**
   * F-365: the NUDGE BUTTON. Types the same fixed beat message into the chat now, whatever its idle clock, meter, daily cap and heartbeat switch say (a person decided), but never into a chat that is not running, is working or at a question, was stopped on purpose,
   * waits for him, has unsent text in its box, cannot have a heartbeat, or was nudged within the last minute. It never touches the chat's heartbeat entry: no beat is counted, no answer is awaited, it cannot pause the heartbeat.
   */
  nudge(floorId: string, agentId: string): Promise<NudgeResult>
  /** F-365: the number of agents the app holds a floor to when a chat starts one: the largest number a switched-on chat of the floor has chosen, or null when none has (then there is no limit on the count). */
  keepFor(floorId: string): number | null
  /** F-365: the memory (MB) the app has already told chats they may use for starts in the last START_LEDGER_MS: the hard memory check of a start by a chat takes it off the free figure too. */
  grantedMb(): number
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
  /** F-365: chats being typed into right now (a beat and a nudge never overlap on one chat), and when each chat was last nudged by hand (one a minute; a beat also leaves a chat alone for that long after a nudge). */
  const typing = new Set<string>()
  const lastNudge = new Map<string, number>()

  /**
   * F-365 (Agent 14's block): the LEDGER of starts this app has told chats they may make, in the last START_LEDGER_MS (in memory). Each start granted is taken off the free memory every later beat and nudge sees, at AGENT_RAM_MB each, so one look
   * cannot hand three floors "3 now" out of the same free-memory figure.
   */
  const grants: Array<{ at: number; n: number }> = []
  const grantedSince = (now: number) => {
    grants.splice(0, grants.length, ...grants.filter(g => now - g.at < START_LEDGER_MS))
    return grants.reduce((t, g) => t + g.n, 0)
  }
  const noteGrant = (now: number, room: number) => { if (room > 0) grants.push({ at: now, n: room }) }

  /**
   * F-365: the three numbers a beat carries, all computed here and now by the app: N (the saved one, or the kind's default while none is saved, lowered by the chat's own meter), the agents active now, the stopped agents the chat may start
   * (none when `noStart`: a nudge while the meter is at the beat's own stop).
   */
  const numbersFor = (a: AgentRef, e: BeatEntry, kind: BeatKind, meter: Meter | null | 'unmetered', now: number, noStart = false): BeatNumbers => {
    const n = keepActiveNow(kind, e.keepActive ?? beatChoicesOf(kind).defaultKeep, meter)
    const room = noStart ? 0 : startRoom({ n, runningOnServer: d.runningOnServer(a.floorId), freeMb: d.freeMemMb() - grantedSince(now) * AGENT_RAM_MB, mayStart: e.mayStart })
    return { n, active: Math.max(0, Math.min(99, Math.floor(d.activeAgents(a.floorId, a.agentId, now)))), room }
  }

  /** F-363: when each beat to a PC was typed (ms), for the most beats per PC in a rolling hour. Seeded once after a start from each chat's saved last beat (a chat's older beats are not kept: the count can only be low by those). */
  const pcBeats = new Map<string, number[]>()
  let seeded = false
  /** F-363: how long ago a chat on another PC was last written, as that PC last said it (the Server's clock): for "next beat about" on the page. */
  const idleCache = new Map<string, number>()
  const hourCount = (pcId: string, now: number) => {
    const recent = (pcBeats.get(pcId) ?? []).filter(t => now - t < PC_HOUR_MS)
    pcBeats.set(pcId, recent)
    return recent.length
  }
  const noteBeat = (pcId: string, at: number) => pcBeats.set(pcId, [...(pcBeats.get(pcId) ?? []), at])
  const seed = (now: number, refs: readonly AgentRef[]) => {
    if (seeded) return
    seeded = true
    for (const a of refs) {
      const last = store.get(beatKey(a.floorId, a.agentId))?.lastBeatAt
      const pc = a.sessionId && typeof last === 'number' && now - last < PC_HOUR_MS ? d.pcOf(a.sessionId) : null
      if (pc && typeof last === 'number') noteBeat(pc.id, last)
    }
  }

  /**
   * F-363: before the look, ONE question to each other PC that has a chat which may be beaten now (switched on, not paused, eligible, idle by the hub's own view, not just nudged, and not beaten within its interval).
   * The answers are what the gate reads for those chats: their state, idle time, last answer and meter, from the PC itself. A PC that cannot be asked is `trouble` for all its chats.
   */
  async function askRemote(now: number, refs: readonly AgentRef[], nudged: ReadonlySet<string>) {
    const groups = new Map<string, { pc: BeatPc; asks: BeatLookAsk[] }>()
    for (const a of refs) {
      const sid = a.sessionId
      const e = store.get(beatKey(a.floorId, a.agentId))
      if (!sid || !e || !e.enabled || e.paused || a.assistant || nudged.has(sid)) continue
      if (d.ineligible(a.floorId, a.agentId) !== null || d.stateOf(sid) !== 'idle' || d.stoppedOnPurpose(sid)) continue
      const pc = d.pcOf(sid)
      const kind = d.kind(sid)
      if (!pc || pc.self || kind === 'other') continue
      // Not due by the Server's own record (beaten within its interval and nothing awaited): no need to ask.
      if (!e.pending && e.lastBeatAt !== null && now - e.lastBeatAt < effectiveInterval(kind, e.intervalMin) * 60_000) continue
      const g = groups.get(pc.id) ?? { pc, asks: [] }
      if (g.asks.length < BEAT_LOOK_MAX_CHATS) g.asks.push({ sessionId: sid, kind })
      groups.set(pc.id, g)
    }
    const looks = new Map<string, BeatLookChat>()
    const trouble = new Map<string, 'offline' | 'older' | 'silent'>()
    await Promise.all([...groups.values()].map(async g => {
      const answer = await (async () => d.look(g.pc, g.asks))().catch((): 'silent' => 'silent')
      if (typeof answer === 'string') trouble.set(g.pc.id, answer)
      else for (const q of g.asks) { const c = answer[q.sessionId]; if (c) looks.set(q.sessionId, c) }
    }))
    return { looks, trouble }
  }

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
      seed(now, refs)
      // The chat whose last beat is oldest goes first: a PC's limit for the hour then rotates through its chats instead of the first floor taking every turn. The same order decides which chats a PC is asked about when it has more than
      // BEAT_LOOK_MAX_CHATS (Agent 14's read: in list order the 25th chat of a PC would never be asked about).
      const order = [...refs].sort((x, y) => (store.get(beatKey(x.floorId, x.agentId))?.lastBeatAt ?? 0) - (store.get(beatKey(y.floorId, y.agentId))?.lastBeatAt ?? 0))
      const asked = await askRemote(now, order, nudged)
      const sentTo = new Map<string, number>()
      for (const a of order) {
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
        // F-363: a chat that is not known to run, whose own PC is another one that is not connected, is held for that (and nothing is saved up for it).
        if (st === undefined || d.stoppedOnPurpose(sid)) { hold(st === undefined && d.homeAway(sid) ? 'pc-offline' : 'not-running'); continue }
        const pc = d.pcOf(sid)
        if (!pc) { hold('not-running'); continue }
        // A fenced run of THIS PC takes no input; another PC's own pool refuses a fenced run at the write.
        if (pc.self && d.fenced(sid)) { hold('ineligible'); continue }
        // Working or at a question: no beat, and nothing is counted; its clock starts again from the end of this turn (the conversation's last write).
        if (st !== 'idle') { idleCache.delete(sid); continue }
        // A chat of another PC: what only that PC knows comes from its answer to this look's question (askRemote). A PC that could not be asked, or a chat it does not have (or has not idle), is not beaten.
        let lk: BeatLookChat | undefined
        if (!pc.self) {
          const trouble = asked.trouble.get(pc.id)
          if (trouble) { hold(trouble === 'offline' ? 'pc-offline' : trouble === 'older' ? 'pc-older' : 'pc-silent'); continue }
          lk = asked.looks.get(sid)
          // Not asked: it was beaten within its interval by the Server's own record (nothing to look at yet).
          if (!lk) { hold(null); continue }
          if (!lk.found) { hold('not-running'); continue }
          if (lk.state !== 'idle') { idleCache.delete(sid); continue }
        }

        const idleAt = lk ? (lk.idleForMs === null ? null : now - lk.idleForMs) : d.idleSince(sid)
        if (lk) { if (idleAt === null) idleCache.delete(sid); else idleCache.set(sid, idleAt) } else idleCache.delete(sid)
        // The answer to the last beat: the chat wrote words after it, or its conversation was written to well after it (it did something). If its last words end with the no-open-goals line, this heartbeat pauses.
        if (e.pending && e.lastBeatAt !== null) {
          // On another PC only "is its last line the no-open-goals line" and how long ago it was written cross the link.
          const last = lk ? (lk.last ? { text: lk.last.noGoals ? NO_OPEN_GOALS_LINE : '', at: now - lk.last.agoMs } : null) : d.lastAnswer(sid)
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
        // On another PC the meter is the one that PC read for this chat (percentages and ages, put on the Server's clock here).
        // Agent 14's read: "unmetered" is believed only for Codex in Claude Code (the one kind that has no meter); a PC that says it of any other kind has given no reading, and the chat is held.
        const meter = lk ? (lk.meter === 'unmetered' ? (kind === 'bridge' ? ('unmetered' as const) : null) : lk.meter === null ? null : lookToMeter(lk.meter, now)) : d.meter(sid)
        if (meter !== 'unmetered' && !meterAllows(meter, now)) { hold('meter'); continue }
        // One PC never gets all its chats at once: at most MAX_BEATS_PER_PC_TICK in a look and MAX_BEATS_PER_PC_HOUR in a rolling hour (the Server's own chats count as one PC).
        if ((sentTo.get(pc.id) ?? 0) >= MAX_BEATS_PER_PC_TICK || hourCount(pc.id, now) >= MAX_BEATS_PER_PC_HOUR) { hold('pc-cap'); continue }
        // F-365 (F-362): a chat that waits for him is never beaten (when that cannot be told, it is taken as waiting); the hold lifts by itself when he answers. A chat nudged by hand a moment ago is left alone.
        if (await (async () => d.waiting(a.floorId, a.agentId))().catch(() => true)) { hold('waiting'); continue }
        if (now - (lastNudge.get(key) ?? 0) < NUDGE_MIN_GAP_MS || typing.has(key)) continue
        const open = await (async () => d.openGoals(a.floorId))().catch(() => null)
        if (open === 0) {
          store.note(key, { paused: 'all-done', held: null })
          findings.push(pauseFinding(key, a, 'all-done'))
          continue
        }
        // A heartbeat switched on before F-365 whose number he has not chosen still gets the OLD message (nothing asked of other agents).
        const nums = e.keepActive === null ? null : numbersFor(a, e, kind, meter, now)
        const text = nums === null ? legacyBeatMessage(a.floorId, hhmm(now)) : beatMessage(a.floorId, hhmm(now), nums)
        // A nudge by hand may have been typed while the CRM was being read: look again, then claim the chat in the same breath (nothing awaits between the look and the claim).
        if (typing.has(key) || d.now() - (lastNudge.get(key) ?? 0) < NUDGE_MIN_GAP_MS) continue
        typing.add(key)
        const how = await (async () => d.type(sid, text))().catch((): BeatSend => 'later').finally(() => typing.delete(key))
        if (how === 'later') { d.log?.warn(`goals heartbeat: ${key} could not be typed into now`); continue }
        if (how === 'uncertain') d.log?.warn(`goals heartbeat: ${key}: the delivery could not be confirmed; counted as a beat, never typed again`)
        sent++
        sentTo.set(pc.id, (sentTo.get(pc.id) ?? 0) + 1)
        noteBeat(pc.id, now)
        if (nums) noteGrant(now, nums.room)
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
    // F-363: the name of the PC when the chat runs on another one (the dialog says so before anything is switched on).
    const where = sid ? d.pcOf(sid) : null
    const pc = where && !where.self ? where.name : null
    const e = store.get(key)
    if (!e) return { enabled: false, intervalMin: DEFAULT_BEAT_MIN, dailyCap: DEFAULT_DAILY_CAP, state: 'off', why: null, lastBeatAt: null, nextAt: null, beatsToday: 0, keepActive: beatChoicesOf(kind).defaultKeep, mayStart: true, pc }
    const beatsToday = e.day === dayOf(now) ? e.beatsToday : 0
    const base = { enabled: e.enabled, intervalMin: effectiveInterval(kind, e.intervalMin), dailyCap: effectiveCap(kind, e.dailyCap), lastBeatAt: e.lastBeatAt, beatsToday, keepActive: e.keepActive === null ? null : effectiveKeepActive(kind, e.keepActive), mayStart: e.mayStart, pc }
    if (!e.enabled) return { ...base, state: 'off', why: null, nextAt: null }
    if (e.paused) return { ...base, state: 'paused', why: PAUSE_WORDS[e.paused], nextAt: null }
    const idleAt = sid ? (pc !== null ? idleCache.get(sid) ?? null : d.idleSince(sid)) : null
    const every = effectiveInterval(kind, e.intervalMin) * 60_000
    const nextAt = idleAt === null ? null : Math.max(idleAt + every, e.lastBeatAt !== null ? e.lastBeatAt + every : 0)
    if (beatsToday >= effectiveCap(kind, e.dailyCap)) return { ...base, state: 'held', why: HOLD_WORDS.cap, nextAt: null }
    if (e.held) return { ...base, state: 'held', why: HOLD_WORDS[e.held], nextAt }
    return { ...base, state: 'beating', why: null, nextAt }
  }

  async function nudge(floorId: string, agentId: string): Promise<NudgeResult> {
    const now = d.now()
    const key = beatKey(floorId, agentId)
    const a = d.agents().find(x => x.floorId === floorId && x.agentId === agentId)
    if (!a || a.assistant || d.ineligible(floorId, agentId) !== null) return { ok: false, code: 'ineligible' }
    const sid = a.sessionId
    if (!sid) return { ok: false, code: 'not-running' }
    if (d.stoppedOnPurpose(sid)) return { ok: false, code: 'stopped' }
    const st = d.stateOf(sid)
    // F-363: a chat that is not known to run whose own PC is another one that is not connected is said to be on a PC that is not connected.
    if (st === undefined) return { ok: false, code: d.homeAway(sid) ? 'pc-offline' : 'not-running' }
    const pc = d.pcOf(sid)
    if (!pc) return { ok: false, code: 'not-running' }
    // A fenced run of THIS PC takes no input; another PC's own pool refuses a fenced run at the write.
    if (pc.self && d.fenced(sid)) return { ok: false, code: 'ineligible' }
    if (st !== 'idle') return { ok: false, code: 'busy' }
    const was = lastNudge.get(key)
    if (was !== undefined && now - was < NUDGE_MIN_GAP_MS) return { ok: false, code: 'too-soon' }
    if (typing.has(key)) return { ok: false, code: 'busy' }
    const kind = d.kind(sid)
    if (kind === 'other') return { ok: false, code: 'ineligible' }
    // Agent 14's note (a): the minute and the typing lock are taken BEFORE the first await (the CRM is read below), so two quick nudges cannot both type. A refusal after this point gives the minute back.
    typing.add(key)
    lastNudge.set(key, now)
    let kept = false
    try {
      if (await (async () => d.waiting(floorId, agentId))().catch(() => true)) return { ok: false, code: 'waiting' }
      const e = store.get(key) ?? fresh()
      // The meter of this chat: its own PC's reading (F-363: for a chat of another PC the PC is asked, as for a beat, and answers whether the chat is there and idle; "unmetered" is believed for Codex in Claude Code only).
      let meter: Meter | null | 'unmetered'
      if (pc.self) meter = d.meter(sid)
      else {
        const answer = await (async () => d.look(pc, [{ sessionId: sid, kind }]))().catch((): 'silent' => 'silent')
        if (typeof answer === 'string') return { ok: false, code: answer === 'offline' ? 'pc-offline' : answer === 'older' ? 'pc-older' : 'pc-silent' }
        const lk = answer[sid]
        if (!lk || !lk.found) return { ok: false, code: 'not-running' }
        if (lk.state !== 'idle') return { ok: false, code: 'busy' }
        meter = lk.meter === 'unmetered' ? (kind === 'bridge' ? 'unmetered' : null) : lk.meter === null ? null : lookToMeter(lk.meter, now)
      }
      // Agent 14's note (c): at or above the beat's own stop the nudge still goes (his tap is his word) but tells the chat it may start none.
      // A reading that is not there is no room (fail closed), like a reading at the stop; a chat with no meter by its kind (unmetered) is not at a stop.
      const atStop = meter === null || (meter !== 'unmetered' && ((meter.weekPercent ?? 0) >= WEEK_STOP_PERCENT || (meter.fiveHourPercent ?? 0) >= FIVE_HOUR_STOP_PERCENT))
      const nums = numbersFor(a, e, kind, meter, now, atStop)
      // Agent 14's note (b): the nudge's own words say it is Shubham's manual nudge.
      const text = beatMessage(floorId, hhmm(now), nums, true)
      const how = await (async () => d.type(sid, text))().catch((): BeatSend => 'later')
      if (how === 'later') return { ok: false, code: 'draft' }
      kept = true
      noteGrant(now, nums.room)
      d.log?.info(`goals heartbeat: a nudge by hand was typed into the chat of agent ${agentId} on floor ${floorId}`)
      return { ok: true, how: how === 'uncertain' ? 'uncertain' : 'sent', at: now }
    } finally {
      typing.delete(key)
      if (!kept) {
        if (was === undefined) lastNudge.delete(key)
        else lastNudge.set(key, was)
      }
    }
  }

  /** F-365: the number of agents the app holds a floor to when a CHAT starts one (the app_open_chat tool): the largest number a switched-on chat of that floor has CHOSEN; null when there is none (every other floor keeps only the memory check). */
  const keepFor = (floorId: string): number | null => {
    let best = 0
    for (const k of store.keys()) {
      if (!k.startsWith(`${floorId}|`)) continue
      const e = store.get(k)
      if (e?.enabled && typeof e.keepActive === 'number' && e.keepActive > best) best = e.keepActive
    }
    return best > 0 ? best : null
  }

  return {
    run,
    nudge,
    keepFor,
    grantedMb: () => grantedSince(d.now()) * AGENT_RAM_MB,
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
 * F-365: the ids of a floor's OPEN goals from the same one read: null when that cannot be told (the login is not `ownerId`'s, or the floor shows none and the read may have been cut at 100). Used only to ask whether a wait of his
 * (F-362) is on a goal that is still open: a done goal's wait does not hold a chat.
 */
export function openGoalIdsOf(read: GoalsRead, links: Readonly<Record<string, string>>, floorId: string, ownerId: string): ReadonlySet<string> | null {
  const you = read.you as { userId?: unknown } | null | undefined
  if (!you || typeof you.userId !== 'string' || you.userId.toLowerCase() !== ownerId.toLowerCase()) return null
  const ids = (Array.isArray(read.goals) ? read.goals : []).filter((g): g is { id: string } => typeof g.id === 'string' && Object.hasOwn(links, g.id) && links[g.id] === floorId).map(g => g.id)
  if (ids.length > 0) return new Set(ids)
  return typeof read.matching === 'number' && read.matching <= 100 ? new Set() : null
}

/** F-365: what the app knows of each goal besides the CRM's card (from its own progress and wait files): minutes since the newest report on it (or null), and whether an agent waits for him on it. */
export interface GoalStatus {
  reportedMinAgo(goalId: string): number | null
  waiting(goalId: string): boolean
}

/**
 * crm_goals with `floor`: the goals of one read (limit 100) that are LINKED to that floor in the app's own link file, at most `want`, each with its `rank`: its place in HIS order of the floor's goals (Shubham's drag order in the Alt+G
 * curtain is his priority for the Lead). The goals his saved order names come first (its saved order file: ids and positions only), in that order; the goals it does not name (new ones) come after them, in the answer's own order (the CRM's). Rank 1 is
 * first, with no gaps: an id in the saved order that is not among the answer's goals (done, another floor's) takes no place. Read-only; nothing but the CRM's own cards, their `rank`, and the floor's id and name is in the answer.
 */
export function floorGoalsAnswer(read: GoalsRead, links: Readonly<Record<string, string>>, order: readonly string[], floor: { id: string; name: string }, want: number, status?: GoalStatus) {
  const mine = (Array.isArray(read.goals) ? read.goals : []).filter((g): g is { id: string } => typeof g.id === 'string' && Object.hasOwn(links, g.id) && links[g.id] === floor.id)
  const ranked = rankByOrder(mine, order)
  const cut = typeof read.matching === 'number' && read.matching > 100
  return {
    you: read.you,
    floor: { id: floor.id, name: floor.name },
    matching: ranked.length,
    // F-365: beside `rank`, two NUMBERS-AND-YES/NO fields per goal so the Lead can see which goals nobody works on without reading anyone's words: how many minutes ago anyone reported on it (null: never), and whether an agent waits for Shubham on it.
    goals: ranked.slice(0, want).map((g, i) => ({ ...g, rank: i + 1, ...(status ? { reportedMinAgo: status.reportedMinAgo(g.id), waiting: status.waiting(g.id) } : {}) })),
    ...(cut ? { note: 'More than 100 goals matched in the whole app; only the first 100 of them were looked at for this floor. Narrow it with query or status.' } : ranked.length > want ? { note: `Only the first ${want} are shown; narrow it with query or status.` } : {}),
  }
}

/** True when a user row typed into a chat is one of the goals beats (used by tests and by anything that must not count the app's own check-in as a person's words). */
export const isGoalBeatText = (text: string) => text.trimStart().startsWith(BEAT_PREFIX)
