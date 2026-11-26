import type { AgentDuty } from './agentic.ts'

// F-329 (Shubham, 23 Nov 2026, his words): "when we add a flow, the flow and the agent, the agent default is on the server. That should not be the case.
// Always open the agent on persons. First ask where to open and then open it. Ask which PC to open it on."
//
// Where the default came from: a new agent's chat starts at its FIRST OPEN, and the server runs a chat that has no home on the PC the request
// lands on (index.ts hold(): "the first PC to run a chat is its home"). On a Server page that is the Server. So the page asks first, at that first
// start, and then uses the route that already exists (POST .../run-on {pc}: opens the chat there and makes that PC its home). No server change.
// These are the rules, pure, so they are tested without a page.

/** What the rule reads of an agent (the page's FloorAgent has all of it). */
export interface PcAskAgent {
  sessionId: string | null
  homePc: string | null
  duty?: AgentDuty
  owner?: { id: string } | null
  pcControlSlot?: 1 | 2
}

/** What the rule reads of where the open comes from. */
export interface PcAskContext {
  /** A chat of this agent runs on this PC now. */
  running: boolean
  /** A chat of this agent runs on another PC of the hub's. */
  elsewhere: boolean
  /** A take-over (asked for, and confirmed): it already runs somewhere. */
  takeOver: boolean
  /** Import agent (F-235): the conversation exists already and says where it is. */
  fresh: boolean
  /** Codex in Claude Code and the like: their own dialogs and home rules (execution-choice). */
  managedExecution: boolean
  /** The floor's workspace: 'pc-control' floors are managed by the server, a PC each. */
  workspace?: string | null
}

/**
 * Must the page ask WHICH PC before this agent's chat is started? Only the first start of an ordinary new agent: no conversation, no home PC, nothing
 * running. Existing agents (resume at home, the Run on menu), PC Control, personal Assistants and every agent that has a duty keep their own ways.
 */
export function needsPcAsk(agent: PcAskAgent, ctx: PcAskContext): boolean {
  if (ctx.running || ctx.elsewhere || ctx.takeOver || ctx.fresh || ctx.managedExecution) return false
  if (ctx.workspace === 'pc-control' || agent.pcControlSlot !== undefined) return false
  if (agent.duty) return false
  if (agent.sessionId || agent.homePc) return false
  return true
}

export interface PcAskPc { id: string; name: string; here: boolean }
/** A PC the app knows of (PC Control's list), and whether it is on now. */
export interface PcKnown { id: string; name: string; online: boolean }
/** Why a PC shown in the question cannot be picked now: it is off, or it is on but not linked to the Server (a chat cannot be run on it). */
export type PcOff = 'off' | 'not-linked'
/** `off` is left out of a PC that can be picked. */
export interface PcChoice extends PcAskPc { label: string; off?: PcOff }

/**
 * The PCs the dialog offers, in the order the app lists them, none chosen beforehand. Fail closed: there is no per-person "PCs you may use" rule in
 * the app today, so the FIRST owner (Shubham) sees every PC linked to the Server now, and anyone else (a second owner, staff) only the PC their page is
 * on. (The server's run-on is chat('owner'): it does not look at who may use which PC, so this list is stricter than the route, on purpose.) A PC
 * alone has no list: it still has its one PC, so it is still asked.
 *
 * F-329 (Lead's order, 26 Nov: "a picker with the PC names and which are online"): the FIRST owner also sees the other PCs the app knows of that are
 * not on the list, after the ones that can be picked, each saying why it cannot be (off now, or not linked to the Server). They are never offered
 * as a choice: a start on them would only fail. A second owner sees none of them (they are not hers to know).
 */
export function pcChoices(pcs: readonly PcAskPc[], firstOwner: boolean, known: readonly PcKnown[] = []): PcChoice[] {
  const list: PcChoice[] = (firstOwner ? pcs : pcs.filter(p => p.here)).map(p => ({ id: p.id, name: p.name, here: p.here, label: p.here ? `${p.name} (this PC)` : p.name }))
  if (!list.length) list.push({ id: '', name: 'This PC', here: true, label: 'This PC' })
  if (firstOwner) {
    const seen = new Set<string>([...pcs.map(p => p.id), ''])
    for (const k of known) {
      if (seen.has(k.id)) continue
      seen.add(k.id)
      const name = k.name.trim() || k.id
      const off: PcOff = k.online ? 'not-linked' : 'off'
      list.push({ id: k.id, name, here: false, label: `${name} (${pcOffWords(off)})`, off })
    }
  }
  return list
}

export const pcOffWords = (off: PcOff) => (off === 'off' ? 'off now' : 'not linked to the Server')

export const pcAskTitle = (agentName: string) => `Open ${agentName.trim() || 'this agent'} on which PC?`
export const PC_ASK_TEXT = 'Nothing starts until you choose. The chat runs on the PC you pick, and that PC becomes its home.'
export const PC_ASK_FOOTER = 'A PC that is off or not linked to the Server is not listed.'
/** Said instead of PC_ASK_FOOTER when a PC that cannot be picked is shown. */
export const PC_ASK_FOOTER_OFF = 'A PC that is off, or not linked to the Server, is shown but cannot be picked. Start it, then open this agent again.'
export const pcAskFooter = (choices: readonly PcChoice[]) => (choices.some(c => c.off) ? PC_ASK_FOOTER_OFF : PC_ASK_FOOTER)
