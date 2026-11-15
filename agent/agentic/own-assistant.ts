import type { Floor } from '../../shared/agentic.ts'

// F-162 slice A: each signed-in person's own Assistant is a floor named "My Assistant" whose boss (the agent that answers for it) is theirs.
// Only that person's chats are its own. The floor's name is never "Assistant": ensureDuty (floors.ts) gives the hub's orchestrator duty
// to a floor called "Assistant", and each person's Assistant must not become the hub's. The feature gate (Settings › Access, 'assistant',
// "Only me" until the owner opens it) is checked by the routes' rule in shared/access.ts; this file is the identity rule only.

export const OWN_ASSISTANT_FLOOR = 'My Assistant'

/** The floor that is this person's own Assistant: named "My Assistant" with its boss owned by them. Null when they have none. */
export function ownAssistantFloor(floors: readonly Floor[], personId: string): Floor | null {
  if (!personId) return null
  return floors.find(f => isOwnAssistantFloor(f, personId)) ?? null
}

export function isOwnAssistantFloor(floor: Pick<Floor, 'name' | 'agents'>, personId: string): boolean {
  if (!personId || floor.name.trim().toLowerCase() !== OWN_ASSISTANT_FLOOR.toLowerCase()) return false
  const boss = floor.agents.find(a => a.isBoss) ?? floor.agents[0]
  return boss?.owner?.id === personId
}

/** A chat is in a person's own Assistant only when that chat is theirs (agent.owner). Shared chats are not, so the Assistant never reads them. */
export function ownAssistantMayUse(chatOwnerId: string | null | undefined, personId: string): boolean {
  return !!personId && !!chatOwnerId && chatOwnerId === personId
}
