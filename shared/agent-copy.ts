// F-316 (Shubham's order o75bb): "Add a copy of an agent": a dropdown within a dropdown, FIRST the floor, THEN the agent. The agent
// picked is the one to COPY; the copy lands on the floor whose Add was pressed (the target). These are the rules of that picker, apart
// from the page so they are tested without one (agent-copy.test.ts). The server has the last word (POST /floors/:id/agents/copy): what
// is offered here is only what could succeed, never what is allowed. Types only; nothing here imports from the app.

import type { CopyAgentRequest } from './agentic.ts'
import { TEMPLATE_NAME_MAX, templateName } from './agent-template.ts'

/** What the picker needs of an agent. */
export interface CopyAgent {
  id: string
  name: string
  role: string
  isBoss?: boolean
  /** The hub's own mark: a person's Assistant and the Orchestrator are made by the hub, never copied by hand. */
  duty?: string | null
  /** A PC Control slot is the server's: two persistent slots, never copied. */
  pcControlSlot?: number
  /** F-316: the template it is an instance of, when it has one. */
  template?: { id?: unknown; name?: unknown } | null
  /** F-118: what this viewer may do with it ('owner' covers an administrator). Absent when the app has no accounts. */
  can?: string
}

export interface CopyFloor {
  id: string
  name: string
  workspace?: string
  agents: CopyAgent[]
}

/** Where a copy comes from: the floor and the agent on it. */
export interface CopySource {
  floorId: string
  agentId: string
}

/**
 * The body of POST /floors/:floorId/agents/copy (shared/agentic.ts CopyAgentRequest, the server's own type). The new chat's name is left to the server
 * ("<source name> 2", the next free number on the target floor). `templateName` is only for a source with no template yet: it names the family the source
 * and the copy then both carry.
 */
export type CopyRequest = CopyAgentRequest


/**
 * An agent a copy can be taken of: not one the hub made for a job, not a PC Control slot, and one the viewer OWNS (a copy takes the brief, so
 * viewing or typing is not enough; an administrator is an owner of every chat). With no accounts nothing says who owns what, so nothing is hidden.
 */
export function copyable(agent: CopyAgent): boolean {
  return agent.pcControlSlot === undefined && agent.duty !== 'orchestrator' && agent.duty !== 'person-assistant' && (agent.can === undefined || agent.can === 'owner')
}

/** The template's name as written on the chat, or '' (a chat with none is its own template). */
export function templateNameOf(agent: Pick<CopyAgent, 'template'>): string {
  const n = agent.template?.name
  return typeof n === 'string' ? templateName(n) : ''
}

export interface FloorChoice {
  id: string
  name: string
  /** How many agents on it can be copied. */
  count: number
}

/** The floors to pick from, as they are listed: every floor that has an agent that can be copied (a PC Control floor never). */
export function floorChoices(floors: CopyFloor[]): FloorChoice[] {
  const out: FloorChoice[] = []
  for (const f of floors) {
    if (f.workspace === 'pc-control') continue
    const count = f.agents.filter(copyable).length
    if (count > 0) out.push({ id: f.id, name: f.name, count })
  }
  return out
}

export interface AgentChoice {
  id: string
  name: string
  /** One line under the name: its role, and which template it is an instance of. */
  hint: string
}

/** The agents of one floor to pick from, in the floor's order. */
export function agentChoices(floor: CopyFloor | undefined): AgentChoice[] {
  if (!floor || floor.workspace === 'pc-control') return []
  return floor.agents.filter(copyable).map(a => {
    const template = templateNameOf(a)
    return { id: a.id, name: a.name, hint: [a.role.trim(), template ? `instance of ${template}` : ''].filter(Boolean).join(' · ') }
  })
}

/**
 * What the pickers start on: the floor being added to when it has an agent to copy (the likeliest: a copy of a teammate), else the first
 * floor that has one; and on it the boss (the floor's lead), else its first agent. Null: nothing can be copied anywhere.
 */
export function startingChoice(floors: CopyFloor[], into: string): { floorId: string; agentId: string } | null {
  const choices = floorChoices(floors)
  const at = choices.find(c => c.id === into) ?? choices[0]
  if (!at) return null
  const floor = floors.find(f => f.id === at.id)
  const agents = (floor?.agents ?? []).filter(copyable)
  const pick = agents.find(a => a.isBoss) ?? agents[0]
  return pick ? { floorId: at.id, agentId: pick.id } : null
}

/** Choosing another floor: keeps the agent when it is on that floor, else the floor's own start. '' when the floor has nothing to copy. */
export function agentOnFloor(floors: CopyFloor[], floorId: string, agentId: string): string {
  const floor = floors.find(f => f.id === floorId)
  const agents = (floor?.agents ?? []).filter(copyable)
  if (floor?.workspace === 'pc-control') return ''
  return (agents.find(a => a.id === agentId) ?? agents.find(a => a.isBoss) ?? agents[0])?.id ?? ''
}

/** The agent a choice names, when it can be copied. */
function sourceOf(floors: CopyFloor[], source: CopySource): { floor: CopyFloor; agent: CopyAgent } | null {
  const floor = floors.find(f => f.id === source.floorId)
  if (!floor || floor.workspace === 'pc-control') return null
  const agent = floor.agents.find(a => a.id === source.agentId)
  return agent && copyable(agent) ? { floor, agent } : null
}

/** A source in no template yet starts one with its copy: the person says what to call that family. */
export function needsTemplateName(floors: CopyFloor[], source: CopySource): boolean {
  const at = sourceOf(floors, source)
  return !!at && templateNameOf(at.agent) === ''
}

/** What the dialog says to a person who may not start a family (only the first owner does, by his id: the hub refuses everyone else with 403 admin-only). */
export const FAMILY_OWNER_ONLY_WORDS = 'This agent is in no template yet. Only the owner of this app starts a template: ask him, or pick an agent that is in one.'

/**
 * What the dialog does about the family's name for this source: 'none' (the source is in a template already: nothing is asked), 'name' (the first owner says what to call the family it
 * starts) or 'owner-only' (anyone else is told, and no box is offered: the hub would refuse the copy; the page does not offer what the hub refuses).
 */
export function familyStep(floors: CopyFloor[], source: CopySource, firstOwner: boolean): 'none' | 'name' | 'owner-only' {
  if (!needsTemplateName(floors, source)) return 'none'
  return firstOwner ? 'name' : 'owner-only'
}

/** What the family's name starts as: the name of the floor the source is on (the person changes it). */
export function suggestedTemplateName(floors: CopyFloor[], source: CopySource): string {
  return templateName(floors.find(f => f.id === source.floorId)?.name ?? '').slice(0, TEMPLATE_NAME_MAX)
}

/**
 * The request for one choice, or null while it cannot be sent: the pickers are not both on something that can be copied, or the source has no template and either no name was given
 * for the family it starts or the person may not start one (only the first owner does). A name given for a source that already has a template is left out (the server ignores it).
 * The name is cleaned by the SERVER's own rule (shared/agent-template.ts templateName).
 */
export function copyRequest(floors: CopyFloor[], source: CopySource, typed: string, firstOwner: boolean): CopyRequest | null {
  const at = sourceOf(floors, source)
  if (!at) return null
  const from = { floorId: at.floor.id, agentId: at.agent.id }
  if (templateNameOf(at.agent)) return { from }
  if (!firstOwner) return null
  const name = templateName(typed)
  return name ? { from, templateName: name } : null
}

/**
 * What the dialog says of a refusal, by the server's CODE, ONLY for a code that means one thing here. 'admin-only' and 'not-yours' now mean several (the first-owner gate on a family, a
 * personal Assistant's floor, the person door; the chat that is not yours, the floor that is not yours to change): the dialog shows the SERVER's own sentence for those, which is accurate at
 * its own gate. A code this page does not know keeps the server's words too. Every refusal changes nothing, so the person can pick again and press again.
 */
export const COPY_REFUSAL_WORDS: Record<string, string> = {
  'template-name-required': 'This chat is in no template yet. Say what to call the family it starts.',
  'copy-source-refused': "That chat can't be copied: it is a person's own Assistant.",
  'pc-control-immutable': 'PC Control has exactly two chats; nothing is copied to or from it.',
}

export function copyRefusalWords(e: unknown): string {
  const code = typeof e === 'object' && e !== null && typeof (e as { code?: unknown }).code === 'string' ? (e as { code: string }).code : ''
  return COPY_REFUSAL_WORDS[code] ?? (e instanceof Error ? e.message : String(e))
}
