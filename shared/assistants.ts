import { isOrchestratorAgent, isPersonAssistant, type AgentDuty } from './agentic.ts'

// Order oa67a (Shubham, 15 Nov 2026: "Also all assistant should show after the pc tab please"; F-234): the Agents sidebar's "Assistants" choice, after
// PCs. It lists the Assistant chats and nothing else, each once:
//  - his overlay Assistant: the chat with the hub's orchestrator duty (F-086), whatever its floor or its name are now;
//  - each person's own Assistant (F-162, Agent 7): the chat with the 'person-assistant' duty (slice B), or the boss of a floor named "My Assistant"
//    (agent/agentic/own-assistant.ts keeps the same rule).
// Not an Assistant: the other agents on his Assistant floor (the workers he talks to through it), and a floor that is only CALLED "Assistant" (an empty
// one, never opened: the hub gives the duty to one chat only). What a person may see is the hub's to decide (it sends each person only their own
// floors, Settings › Access); this only picks the Assistants out of what was sent. Pure, tested.

/** F-162: each person's own Assistant floor is called this (and never "Assistant", which is the hub's orchestrator floor). */
export const OWN_ASSISTANT_FLOOR = 'My Assistant'

export interface AssistantAgent {
  id: string
  name: string
  duty?: AgentDuty
  isBoss?: boolean
  owner?: { id: string; username: string; name: string } | null
}

export interface AssistantFloor<A extends AssistantAgent = AssistantAgent> {
  id: string
  name: string
  agents: A[]
}

const isOwnAssistantFloor = (floor: { name: string }) => floor.name.trim().toLowerCase() === OWN_ASSISTANT_FLOOR.toLowerCase()
const bossOf = <A extends AssistantAgent>(floor: AssistantFloor<A>): A | undefined => floor.agents.find(a => a.isBoss) ?? floor.agents[0]

/** Whether this agent is an Assistant chat (his overlay Assistant, or a person's own). */
export function isAssistantChat<A extends AssistantAgent>(floor: AssistantFloor<A>, agent: A): boolean {
  if (isOrchestratorAgent(floor.name, agent)) return true
  // F-162 slice B: a person's own Assistant carries its own duty ('person-assistant'), whatever its floor is called now.
  if (isPersonAssistant(agent)) return true
  return isOwnAssistantFloor(floor) && bossOf(floor)?.id === agent.id
}

export interface AssistantGroup<F extends AssistantFloor> {
  /** The Assistant's own floor, with only its Assistant chat in it. */
  floor: F
  /** Whose Assistant it is: the chat owner's name (or username), else the floor's name. */
  name: string
  /** His overlay Assistant (the orchestrator); the others are people's own. */
  orchestrator: boolean
}

/** One group per Assistant floor, with only its Assistant chat: his overlay Assistant first, then the people's own by name. Each floor once. */
export function assistantGroups<A extends AssistantAgent, F extends AssistantFloor<A>>(floors: readonly F[]): AssistantGroup<F>[] {
  const out: AssistantGroup<F>[] = []
  const seen = new Set<string>()
  for (const f of floors) {
    if (seen.has(f.id)) continue
    const agents = f.agents.filter(a => isAssistantChat(f, a))
    if (!agents.length) continue
    seen.add(f.id)
    const first = agents[0]
    const orchestrator = agents.some(a => isOrchestratorAgent(f.name, a))
    out.push({ floor: { ...f, agents }, name: first.owner?.name?.trim() || first.owner?.username || f.name, orchestrator })
  }
  return out.sort((a, b) => Number(b.orchestrator) - Number(a.orchestrator) || a.name.localeCompare(b.name))
}
