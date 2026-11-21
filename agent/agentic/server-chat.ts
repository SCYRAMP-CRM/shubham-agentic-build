import type { FloorAgent } from '../../shared/agentic.ts'

// F-302 (his order o2f56, 19 Nov; Agent 14's census L1): the "not on the Server" scope asks whether a chat is the SERVER'S. A chat runs as the Server's Windows user when it RUNS on the Server, whatever its
// home says: a chat homed on a member PC but opened here (`here`) or taken over runs here. So a chat is the Server's when the Server is not known, when it has no home yet, when its home IS the Server, or when it
// runs on the Server now. Anything else is a chat on another PC, which stays open to its owner and to a Can type share.

export interface ServerChatWhere {
  /** The Server's own PC id: this PC on the hub (or alone), the hub on a member PC; null when it is not known. */
  server: string | null
  /** Whether this chat runs on the Server right now (on a member PC: the hub's frame says so). */
  runsOnServer: (sessionId: string) => boolean
}

export function isServerChat(a: Pick<FloorAgent, 'homePc' | 'sessionId'>, where: ServerChatWhere): boolean {
  if (!where.server) return true
  if (!a.homePc) return true
  if (a.homePc === where.server) return true
  return !!a.sessionId && where.runsOnServer(a.sessionId)
}
