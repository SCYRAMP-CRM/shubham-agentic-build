// F-350: which Claude subscription each PC runs on, as GET /agent-api/agentic/claude-pcs answers it (the Subscriptions page), and as one PC says it of itself to the Server (the peer op `claude-status`).
// Names, percentages, times, counts and fixed words only: never a token, its hash or last characters, a cookie, an address with a login in it, or a path.

import type { SwitchCap, SwitchPreview, SwitchSubscription, SwitchWarning, SwitchWeek } from './claude-switch.ts'

export const CLAUDE_PCS_LIMIT = 64
export const CLAUDE_PC_CHOICES_LIMIT = 64
export const CLAUDE_PC_CHATS_LIMIT = 300

/** The Windows account variable (or Linux store): set = holds the CRM subscription's token the app put there; taken = something else set it; empty = nothing; unsupported = this PC cannot hold one. */
export type ClaudeTokenState = 'set' | 'taken' | 'empty' | 'unsupported'
/** signed-in: this PC holds the person's CRM login. ended: there was one and it is over (or it was made at another address): sign in again on that PC. none: nobody is signed in there. */
export type ClaudeCrmState = 'signed-in' | 'ended' | 'none'
export type ClaudeChatEngine = 'claude' | 'codex' | 'opencode'
export type ClaudeChatState = 'running' | 'question' | 'idle'

/** The one subscription's own weekly reading, exactly as the PC's own status holds it. Never guessed: no reading, no object. */
export interface ClaudePcWeek {
  /** How much of the week everyone on it has used, 0 to 100, or null. */
  percent: number | null
  resetsAt: string | null
  observedAt: string | null
  /** The CRM has had no recent news of it: the number may be higher by now. */
  stale: boolean
}

/** One of the office's subscriptions as this PC knows it from the CRM. No token, no hint. */
export interface ClaudePcChoice {
  id: string
  name: string
  /** The PC runs on it now. */
  active: boolean
  /** The CRM turned it off. */
  disabled: boolean
  weekPercent: number | null
}

/** A chat running on that PC, as that PC sees it (the Server adds its name and floor). */
export interface ClaudePcRunning {
  sessionId: string
  state: ClaudeChatState
  /** When its process started (ISO), or null: the token it holds is the one placed before then. */
  startedAt: string | null
  engine: ClaudeChatEngine
}

/** What a PC says of itself. */
export interface ClaudePcStatus {
  version: 1
  pc: { id: string; name: string }
  /** The app build this PC runs, or null when it does not know. */
  build: string | null
  builtAt: string
  token: ClaudeTokenState
  /** The subscription the app put in, while `token` is 'set'. */
  placed: { id: string; name: string; kind: 'subscription' | 'api_key'; setAt: string } | null
  /** The weekly reading of the placed subscription, only when the PC's own status holds it. */
  week: ClaudePcWeek | null
  crm: { state: ClaudeCrmState; name: string | null; expiresAt: string | null }
  choices: ClaudePcChoice[]
  running: ClaudePcRunning[]
}

/** A chat as the page lists it: its name and floor are the Server's. */
export interface ClaudePcChat {
  sessionId: string
  name: string
  floor: string | null
  state: ClaudeChatState
  engine: ClaudeChatEngine
  /** true: it started before the token now placed, so it still holds the old one. null: not known (no token placed, or no start time). */
  onOldToken: boolean | null
  /** A Claude chat: restarting it picks up the placed token. false: nothing to restart (its subscription is not this one). */
  restartable: boolean
  /** Why it is not restartable, in words; null otherwise. */
  note: string | null
}

export interface ClaudePcRow {
  id: string
  name: string
  here: boolean
  status: ClaudePcStatus | null
  chats: ClaudePcChat[]
  /** Why there is no status: unreachable, or an older build. */
  error: string | null
  /** The PC answered that it does not know the question: it runs an older build and needs the update first. */
  older: boolean
}

export interface ClaudePcsAnswer {
  version: 1
  pcs: ClaudePcRow[]
}

/** What the page says of a chat that is not a Claude chat. */
export const NOT_A_CLAUDE_CHAT = 'Not a Claude chat: nothing to restart (its subscription is not this one).'
export const OLDER_BUILD_WORDS = 'That PC runs an older build: update it to see its subscription.'

// ── strict readers: anything unknown or oversized makes the whole answer unreadable, never a quietly shorter one ─────────────────────────────

const rec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)
const only = (v: unknown, keys: readonly string[]): v is Record<string, unknown> => rec(v) && Object.keys(v).every(k => keys.includes(k))
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max && !/[\0\r\n]/.test(v)
const name = (v: unknown): v is string => text(v, 200) && v.trim().length > 0
const when = (v: unknown): v is string => text(v, 40) && Number.isFinite(Date.parse(v))
const whenOrNull = (v: unknown): v is string | null => v === null || when(v)
const pct = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1000)
const pcOk = (v: unknown): v is { id: string; name: string } => only(v, ['id', 'name']) && text(v.id, 200) && v.id.length > 0 && name(v.name)
const ENGINES: readonly string[] = ['claude', 'codex', 'opencode']
const CHAT_STATES: readonly string[] = ['running', 'question', 'idle']

function readWeek(v: unknown): ClaudePcWeek | null | undefined {
  if (v === null) return null
  if (!only(v, ['percent', 'resetsAt', 'observedAt', 'stale']) || !pct(v.percent) || !whenOrNull(v.resetsAt) || !whenOrNull(v.observedAt) || typeof v.stale !== 'boolean') return undefined
  return { percent: v.percent, resetsAt: v.resetsAt, observedAt: v.observedAt, stale: v.stale }
}

export function readClaudePcStatus(v: unknown): ClaudePcStatus | null {
  if (!only(v, ['version', 'pc', 'build', 'builtAt', 'token', 'placed', 'week', 'crm', 'choices', 'running']) || v.version !== 1 || !pcOk(v.pc) || !(v.build === null || text(v.build, 64)) || !when(v.builtAt)
    || !['set', 'taken', 'empty', 'unsupported'].includes(String(v.token))) return null
  let placed: ClaudePcStatus['placed'] = null
  if (v.placed !== null) {
    const p = v.placed
    if (!only(p, ['id', 'name', 'kind', 'setAt']) || !text(p.id, 200) || p.id.length === 0 || !name(p.name) || (p.kind !== 'subscription' && p.kind !== 'api_key') || !when(p.setAt)) return null
    placed = { id: p.id, name: p.name, kind: p.kind, setAt: p.setAt }
  }
  if ((placed !== null) !== (v.token === 'set')) return null
  const week = readWeek(v.week)
  if (week === undefined || (week !== null && placed === null)) return null
  const c = v.crm
  if (!only(c, ['state', 'name', 'expiresAt']) || !['signed-in', 'ended', 'none'].includes(String(c.state)) || !(c.name === null || name(c.name)) || !whenOrNull(c.expiresAt)) return null
  if (!Array.isArray(v.choices) || v.choices.length > CLAUDE_PC_CHOICES_LIMIT || !Array.isArray(v.running) || v.running.length > CLAUDE_PC_CHATS_LIMIT) return null
  const choices: ClaudePcChoice[] = []
  for (const x of v.choices) {
    if (!only(x, ['id', 'name', 'active', 'disabled', 'weekPercent']) || !text(x.id, 200) || x.id.length === 0 || !name(x.name) || typeof x.active !== 'boolean' || typeof x.disabled !== 'boolean' || !pct(x.weekPercent)) return null
    choices.push({ id: x.id, name: x.name, active: x.active, disabled: x.disabled, weekPercent: x.weekPercent })
  }
  const running: ClaudePcRunning[] = []
  for (const x of v.running) {
    if (!only(x, ['sessionId', 'state', 'startedAt', 'engine']) || !text(x.sessionId, 200) || x.sessionId.length === 0 || !CHAT_STATES.includes(String(x.state)) || !whenOrNull(x.startedAt) || !ENGINES.includes(String(x.engine))) return null
    running.push({ sessionId: x.sessionId, state: x.state as ClaudeChatState, startedAt: x.startedAt, engine: x.engine as ClaudeChatEngine })
  }
  if (new Set(running.map(r => r.sessionId)).size !== running.length || new Set(choices.map(x => x.id)).size !== choices.length) return null
  return {
    version: 1, pc: { id: v.pc.id, name: v.pc.name }, build: v.build as string | null, builtAt: v.builtAt, token: v.token as ClaudeTokenState, placed, week,
    crm: { state: c.state as ClaudeCrmState, name: c.name as string | null, expiresAt: c.expiresAt as string | null }, choices, running,
  }
}

function readChat(v: unknown): ClaudePcChat | null {
  if (!only(v, ['sessionId', 'name', 'floor', 'state', 'engine', 'onOldToken', 'restartable', 'note']) || !text(v.sessionId, 200) || v.sessionId.length === 0 || !name(v.name) || !(v.floor === null || text(v.floor, 200))
    || !CHAT_STATES.includes(String(v.state)) || !ENGINES.includes(String(v.engine)) || !(v.onOldToken === null || typeof v.onOldToken === 'boolean') || typeof v.restartable !== 'boolean' || !(v.note === null || text(v.note, 400))) return null
  return { sessionId: v.sessionId, name: v.name, floor: v.floor as string | null, state: v.state as ClaudeChatState, engine: v.engine as ClaudeChatEngine, onOldToken: v.onOldToken as boolean | null, restartable: v.restartable, note: v.note as string | null }
}

export function readClaudePcsAnswer(v: unknown): ClaudePcsAnswer | null {
  if (!only(v, ['version', 'pcs']) || v.version !== 1 || !Array.isArray(v.pcs) || v.pcs.length < 1 || v.pcs.length > CLAUDE_PCS_LIMIT) return null
  const pcs: ClaudePcRow[] = []
  for (const p of v.pcs) {
    if (!only(p, ['id', 'name', 'here', 'status', 'chats', 'error', 'older']) || !text(p.id, 200) || p.id.length === 0 || !name(p.name) || typeof p.here !== 'boolean' || typeof p.older !== 'boolean'
      || !(p.error === null || (text(p.error, 600) && p.error.length > 0)) || !Array.isArray(p.chats) || p.chats.length > CLAUDE_PC_CHATS_LIMIT) return null
    const status = p.status === null ? null : readClaudePcStatus(p.status)
    if ((p.status === null) === (p.error === null) || (p.status !== null && !status) || (status && status.pc.id !== p.id) || (p.older && p.status !== null)) return null
    const chats: ClaudePcChat[] = []
    for (const c of p.chats) {
      const read = readChat(c)
      if (!read) return null
      chats.push(read)
    }
    pcs.push({ id: p.id, name: p.name, here: p.here, status, chats, error: p.error as string | null, older: p.older })
  }
  return new Set(pcs.map(p => p.id)).size === pcs.length ? { version: 1, pcs } : null
}

// ── F-350 commit 2: change it from here, and restart that PC's chats to apply it ─────────────────────────────────────────────────────────────────

/** The words for a PC whose own CRM sign-in has ended: nothing can be changed there until someone signs in on that PC. */
export const crmSignInEndedWords = (pcName: string) => `Sign in on ${pcName}: its CRM sign-in ended`

/** What a PC answers to `claude-preview` (the Server's click on Change, before anything is changed). */
export type ClaudePreviewWire = { version: 1; kind: 'ok'; preview: SwitchPreview } | { version: 1; kind: 'crm-signin-ended' } | { version: 1; kind: 'error'; message: string }
/** What a PC answers to `claude-switch` (the Server's Confirm): it ran its OWN switch; no chat was restarted. */
export type ClaudeSwitchWire = { version: 1; kind: 'switched' | 'refused'; message: string } | { version: 1; kind: 'crm-signin-ended' }

/** Answer of POST /claude-pcs/preview: what changing would do on that PC. The PC's own chat list is left out (the Server lists the chats); no token hint. */
export interface ClaudePcPreview {
  version: 1
  pc: { id: string; name: string }
  preview: SwitchPreview
}

export type ClaudePcSwitchCode = 'switched' | 'crm-signin-ended' | 'refused'
/** Answer of POST /claude-pcs/switch. `placed` is what that PC reports AFTER the change (asked again, not assumed). */
export interface ClaudePcSwitched {
  version: 1
  pc: { id: string; name: string }
  ok: boolean
  code: ClaudePcSwitchCode
  message: string
  placed: ClaudePcStatus['placed']
}

export type RestartLineState = 'waiting' | 'restarting' | 'done' | 'skipped' | 'failed'
export interface RestartLine {
  sessionId: string
  name: string
  floor: string | null
  state: RestartLineState
  note: string | null
}
/** One restart of some chats on one PC: one chat at a time, a line each. `refused`: the whole job was turned down (nothing was touched). */
export interface RestartJob {
  version: 1
  id: string
  pc: { id: string; name: string }
  startedAt: string
  finishedAt: string | null
  refused: string | null
  lines: RestartLine[]
}

const wk = (v: unknown): SwitchWeek | null | undefined => {
  if (v === null) return null
  if (!only(v, ['percent', 'resetsAt', 'observedAt', 'stale']) || !pct(v.percent) || !whenOrNull(v.resetsAt) || !whenOrNull(v.observedAt) || typeof v.stale !== 'boolean') return undefined
  return { percent: v.percent, resetsAt: v.resetsAt, observedAt: v.observedAt, stale: v.stale }
}
const cp = (v: unknown): SwitchCap | null | undefined => {
  if (v === null) return null
  if (!only(v, ['percent', 'source', 'known', 'usedPercent', 'over', 'at']) || typeof v.percent !== 'number' || !Number.isFinite(v.percent) || !['person', 'default'].includes(String(v.source)) || !['now', 'seen', 'default'].includes(String(v.known))
    || !pct(v.usedPercent) || typeof v.over !== 'boolean' || !whenOrNull(v.at)) return undefined
  return { percent: v.percent, source: v.source as SwitchCap['source'], known: v.known as SwitchCap['known'], usedPercent: v.usedPercent, over: v.over, at: v.at }
}
const sub = (v: unknown): SwitchSubscription | null => (only(v, ['id', 'name', 'hint']) && text(v.id, 200) && v.id.length > 0 && name(v.name) ? { id: v.id, name: v.name, hint: null } : null)

/** The existing switch preview, read strictly, with every token hint dropped and the PC's own chat list emptied (the Server lists the chats itself). */
export function readSwitchPreview(v: unknown): SwitchPreview | null {
  if (!only(v, ['from', 'to', 'allowed', 'warnings', 'chats', 'week', 'cap']) || typeof v.allowed !== 'boolean' || !Array.isArray(v.warnings) || v.warnings.length > 20 || !Array.isArray(v.chats)) return null
  const from = sub(v.from)
  const to = sub(v.to)
  if (!from || !to || !only(v.week, ['from', 'to']) || !only(v.cap, ['from', 'to'])) return null
  const wf = wk(v.week.from), wt = wk(v.week.to), cf = cp(v.cap.from), ct = cp(v.cap.to)
  if (wf === undefined || wt === undefined || cf === undefined || ct === undefined) return null
  const warnings: SwitchWarning[] = []
  for (const w of v.warnings) {
    if (!only(w, ['code', 'severity', 'message']) || !['same', 'disabled', 'target-used-up', 'cap-over', 'low-cap', 'cap-unknown', 'stale-reading', 'not-allowed'].includes(String(w.code)) || !['block', 'warn'].includes(String(w.severity)) || !text(w.message, 600)) return null
    warnings.push({ code: w.code as SwitchWarning['code'], severity: w.severity as SwitchWarning['severity'], message: w.message })
  }
  return { from, to, allowed: v.allowed, warnings, chats: [], week: { from: wf, to: wt }, cap: { from: cf, to: ct } }
}

export function readClaudePreviewWire(v: unknown): ClaudePreviewWire | null {
  if (!rec(v) || v.version !== 1) return null
  if (v.kind === 'crm-signin-ended') return only(v, ['version', 'kind']) ? { version: 1, kind: 'crm-signin-ended' } : null
  if (v.kind === 'error') return only(v, ['version', 'kind', 'message']) && text(v.message, 600) ? { version: 1, kind: 'error', message: v.message } : null
  if (v.kind === 'ok' && only(v, ['version', 'kind', 'preview'])) {
    const preview = readSwitchPreview(v.preview)
    return preview ? { version: 1, kind: 'ok', preview } : null
  }
  return null
}

export function readClaudeSwitchWire(v: unknown): ClaudeSwitchWire | null {
  if (!rec(v) || v.version !== 1) return null
  if (v.kind === 'crm-signin-ended') return only(v, ['version', 'kind']) ? { version: 1, kind: 'crm-signin-ended' } : null
  if ((v.kind === 'switched' || v.kind === 'refused') && only(v, ['version', 'kind', 'message']) && text(v.message, 600)) return { version: 1, kind: v.kind, message: v.message }
  return null
}

export function readClaudePcPreview(v: unknown): ClaudePcPreview | null {
  if (!only(v, ['version', 'pc', 'preview']) || v.version !== 1 || !pcOk(v.pc)) return null
  const preview = readSwitchPreview(v.preview)
  return preview ? { version: 1, pc: { id: v.pc.id, name: v.pc.name }, preview } : null
}

export function readClaudePcSwitched(v: unknown): ClaudePcSwitched | null {
  if (!only(v, ['version', 'pc', 'ok', 'code', 'message', 'placed']) || v.version !== 1 || !pcOk(v.pc) || typeof v.ok !== 'boolean' || !['switched', 'crm-signin-ended', 'refused'].includes(String(v.code)) || !text(v.message, 800)) return null
  let placed: ClaudePcSwitched['placed'] = null
  if (v.placed !== null) {
    const p = v.placed
    if (!only(p, ['id', 'name', 'kind', 'setAt']) || !text(p.id, 200) || p.id.length === 0 || !name(p.name) || (p.kind !== 'subscription' && p.kind !== 'api_key') || !when(p.setAt)) return null
    placed = { id: p.id, name: p.name, kind: p.kind, setAt: p.setAt }
  }
  return { version: 1, pc: { id: v.pc.id, name: v.pc.name }, ok: v.ok, code: v.code as ClaudePcSwitchCode, message: v.message, placed }
}

export function readRestartJob(v: unknown): RestartJob | null {
  if (!only(v, ['version', 'id', 'pc', 'startedAt', 'finishedAt', 'refused', 'lines']) || v.version !== 1 || !text(v.id, 80) || v.id.length === 0 || !pcOk(v.pc) || !when(v.startedAt) || !whenOrNull(v.finishedAt)
    || !(v.refused === null || text(v.refused, 600)) || !Array.isArray(v.lines) || v.lines.length > CLAUDE_PC_CHATS_LIMIT) return null
  const lines: RestartLine[] = []
  for (const l of v.lines) {
    if (!only(l, ['sessionId', 'name', 'floor', 'state', 'note']) || !text(l.sessionId, 200) || l.sessionId.length === 0 || !name(l.name) || !(l.floor === null || text(l.floor, 200))
      || !['waiting', 'restarting', 'done', 'skipped', 'failed'].includes(String(l.state)) || !(l.note === null || text(l.note, 600))) return null
    lines.push({ sessionId: l.sessionId, name: l.name, floor: l.floor as string | null, state: l.state as RestartLineState, note: l.note as string | null })
  }
  return { version: 1, id: v.id, pc: { id: v.pc.id, name: v.pc.name }, startedAt: v.startedAt, finishedAt: v.finishedAt as string | null, refused: v.refused as string | null, lines }
}
