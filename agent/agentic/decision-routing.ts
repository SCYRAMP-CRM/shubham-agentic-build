import { isOrchestratorAgent, isPersonAssistant, type Floor, type FloorAgent } from '../../shared/agentic.ts'
import { phoneUser } from './orders.ts'
import { isPcControl } from './pc-control.ts'

// Orders o66aa / oa76b / o7e97: which chats and floors may have their decisions go to the people he chose. Pure, so each exclusion is pinned on
// its own (Lead: an untested member of an exclusion class is where a bug lives; Agent 3's F1 was one such member, "Mobile" on "Final").

/**
 * A chat whose prompts may go to its floor's chosen people: never a PC-control slot, a person's own Assistant, the Orchestrator, or a chat that
 * holds his phone (phoneUser: the Orchestrator, and "Mobile" on "Final"). Their prompts stay their owner's whatever the floor's route.
 */
export const routableChat = (f: Pick<Floor, 'name'>, a: FloorAgent): boolean =>
  !a.pcControlSlot && !isPersonAssistant(a) && !isOrchestratorAgent(f.name, a) && !phoneUser(f.name, a)

/** A floor whose decisions may go to people at all: never a PC-control floor, nor one holding any chat that is not routable (then it is his, whole). */
export const floorRoutable = (f: Floor | null | undefined): f is Floor => !!f && !isPcControl(f) && f.agents.every(a => routableChat(f, a))
