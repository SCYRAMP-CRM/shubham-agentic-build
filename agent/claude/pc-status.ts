import type { ClaudeInfo } from '../../shared/agent-api.ts'
import type { SwitchPreview } from '../../shared/claude-switch.ts'
import {
  CLAUDE_PC_CHATS_LIMIT,
  CLAUDE_PC_CHOICES_LIMIT,
  NOT_A_CLAUDE_CHAT,
  type ClaudeCrmState,
  type ClaudePcChat,
  type ClaudePcRunning,
  type ClaudePcStatus,
  type ClaudePcWeek,
} from '../../shared/claude-pcs.ts'

// F-350: what this PC says of its own Claude subscription (the peer op `claude-status`, and the Server's own row). Pure: the Claude module's status in, a plain shape out. Only the fields below are ever
// copied: the token's last characters (`hint`), the CRM address, the cookie and the user name of the CRM account's email are never read here, so they cannot reach an answer.

/** A name from the CRM or a person: one line, no control characters, cut. */
export function cleanName(s: string, max = 200): string {
  let out = ''
  let inRun = false
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    // a control character or a line separator (U+2028, U+2029): a run of them is one space
    const control = c < 0x20 || c === 0x7f || c === 0x2028 || c === 0x2029
    if (control) {
      if (!inRun) out += ' '
      inRun = true
    } else {
      out += ch
      inRun = false
    }
  }
  return out.trim().slice(0, max)
}

const iso = (v: string | null | undefined): string | null => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null)

/** What this PC's own Claude module gives the Subscriptions table (and the Server's question): its status, its CRM sign-in in three words, and its build. Nothing else of it is reachable from here. */
export interface ClaudeSubSlice {
  info(): ClaudeInfo
  crmState(): ClaudeCrmState
  build(): string | null
  /**
   * F-350 (change): what moving THIS PC's own person to subscription `to` would do, by the PC's own preview (the CRM read and every warning live in claude/failover.ts). 'crm-signin-ended': this PC holds no CRM login now,
   * so nothing can be read or changed from here. Left out (a test's slice): the PC cannot change from here.
   */
  preview?(to: string): Promise<SlicePreview>
  /**
   * F-350 (change): the PC runs its OWN switch (claude/index.ts switchTo, with every safeguard it has: the CRM's own refusals, the cap, the anti-flip-flop rules), switching only: NO chat is restarted by it (the Server restarts chats,
   * one at a time, when the person asks). The Server never holds or moves a token.
   */
  switchOnly?(to: string): Promise<SliceSwitch>
}

export type SlicePreview = { kind: 'ok'; preview: SwitchPreview } | { kind: 'crm-signin-ended' } | { kind: 'error'; message: string }
export type SliceSwitch = { kind: 'switched'; message: string } | { kind: 'crm-signin-ended' } | { kind: 'refused'; message: string }

/** A sentence another PC (or a failed request) gave, made safe to show and to log: one line, cut, and nothing token-, cookie- or key-shaped left in it. */
export function safeWords(s: string, max = 160): string {
  return cleanName(s, 2000)
    .replace(/sk-ant-[A-Za-z0-9_-]{6,}/g, '[token]')
    .replace(/crm_(?:token|csrf)=\S+/gi, '[cookie]')
    .replace(/\b(?:bearer|basic)\s+\S+/gi, '[credential]')
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s/@]*@\S*/gi, '[address]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[…]')
    .slice(0, max)
}

export interface PcStatusInput {
  pc: { id: string; name: string }
  build: string | null
  info: ClaudeInfo
  crmState: ClaudeCrmState
  running: readonly ClaudePcRunning[]
  now: () => Date
}

export function buildClaudePcStatus(i: PcStatusInput): ClaudePcStatus {
  const info = i.info
  const sub = info.token === 'set' ? info.subscription : null
  const placed = sub
    ? { id: sub.id, name: cleanName(sub.name) || 'Claude', kind: sub.kind === 'api_key' ? ('api_key' as const) : ('subscription' as const), setAt: iso(sub.setAt) ?? i.now().toISOString() }
    : null
  const choices = (info.switch?.choices ?? []).slice(0, CLAUDE_PC_CHOICES_LIMIT).map(c => ({
    id: c.id,
    name: cleanName(c.name) || 'Claude',
    active: c.active,
    disabled: c.disabled,
    weekPercent: typeof c.week?.percent === 'number' && Number.isFinite(c.week.percent) ? c.week.percent : null,
  }))
  // The weekly reading is the placed subscription's own, and only when this PC's status holds one: never worked out from anything else.
  const held = placed ? info.switch?.choices.find(c => c.id === placed.id)?.week ?? null : null
  const week: ClaudePcWeek | null = held
    ? { percent: typeof held.percent === 'number' && Number.isFinite(held.percent) ? held.percent : null, resetsAt: iso(held.resetsAt), observedAt: iso(held.observedAt), stale: held.stale !== false }
    : null
  return {
    version: 1,
    pc: { id: i.pc.id, name: cleanName(i.pc.name) || i.pc.id },
    build: i.build ? cleanName(i.build, 64) || null : null,
    builtAt: i.now().toISOString(),
    token: info.token,
    placed,
    week: week && week.percent === null && week.resetsAt === null && week.observedAt === null ? null : week,
    crm: { state: i.crmState, name: info.crm ? cleanName(info.crm.name) || null : null, expiresAt: iso(info.crm?.expiresAt) },
    choices,
    running: i.running.slice(0, CLAUDE_PC_CHATS_LIMIT).map(r => ({ sessionId: r.sessionId, state: r.state, startedAt: iso(r.startedAt), engine: r.engine })),
  }
}

/** The Server's page lists a PC's chats by name and floor; this joins what the PC said (state, start time, engine) with the names the Server holds. */
export function joinChats(status: ClaudePcStatus, names: (sessionId: string) => { name: string; floor: string | null } | null): ClaudePcChat[] {
  const setAt = status.placed ? Date.parse(status.placed.setAt) : NaN
  const out: ClaudePcChat[] = []
  for (const r of status.running) {
    const known = names(r.sessionId)
    const claude = r.engine === 'claude'
    const started = r.startedAt ? Date.parse(r.startedAt) : NaN
    out.push({
      sessionId: r.sessionId,
      name: known ? cleanName(known.name) || r.sessionId.slice(0, 8) : r.sessionId.slice(0, 8),
      floor: known?.floor ? cleanName(known.floor) || null : null,
      state: r.state,
      engine: r.engine,
      onOldToken: claude && Number.isFinite(setAt) && Number.isFinite(started) ? started < setAt : null,
      restartable: claude,
      note: claude ? null : NOT_A_CLAUDE_CHAT,
    })
  }
  return out.sort((a, b) => (a.floor ?? '').localeCompare(b.floor ?? '') || a.name.localeCompare(b.name))
}
