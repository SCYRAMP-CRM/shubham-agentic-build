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
export interface PcChoice extends PcAskPc { label: string }

/**
 * The PCs the dialog offers, in the order the app lists them, none chosen beforehand. Fail closed: there is no per-person "PCs you may use" rule in
 * the app today, so the FIRST owner (Shubham) sees every PC linked to the Server now, and anyone else (a second owner, staff) only the PC their page is
 * on. (The server's run-on is chat('owner'): it does not look at who may use which PC, so this list is stricter than the route, on purpose.) A PC
 * alone has no list: it still has its one PC, so it is still asked.
 */
export function pcChoices(pcs: readonly PcAskPc[], firstOwner: boolean): PcChoice[] {
  const list = (firstOwner ? pcs : pcs.filter(p => p.here)).map(p => ({ id: p.id, name: p.name, here: p.here, label: p.here ? `${p.name} (this PC)` : p.name }))
  return list.length ? list : [{ id: '', name: 'This PC', here: true, label: 'This PC' }]
}

export const pcAskTitle = (agentName: string) => `Open ${agentName.trim() || 'this agent'} on which PC?`
export const PC_ASK_TEXT = 'Nothing starts until you choose. The chat runs on the PC you pick, and that PC becomes its home.'
export const PC_ASK_FOOTER = 'A PC that is off or not linked to the Server is not listed.'
