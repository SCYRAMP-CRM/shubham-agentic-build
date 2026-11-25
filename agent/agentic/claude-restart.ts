import { NOT_A_CLAUDE_CHAT, type ClaudeChatEngine, type ClaudeChatState, type ClaudePcStatus } from '../../shared/claude-pcs.ts'

// F-350 (restart): which of the chats the person ticked on one PC are restarted to pick up the token now placed there, and why each of the others is left alone. Pure: what the PC said of itself and what the
// Server knows of its chats in, a plan out. The runner (agentic/index.ts) restarts the planned chats one at a time; nothing here touches a chat.

/** A chat running on the PC, with what only the Server knows about it. */
export interface RestartCandidate {
  sessionId: string
  name: string
  floor: string | null
  engine: ClaudeChatEngine
  state: ClaudeChatState
  /** Started before the token now placed (true), after it (false), or not known (null). */
  onOldToken: boolean | null
  /** The chat's home is this PC: the Server opens it again there (the same conversation, the same PC). */
  homeOk: boolean
  /** The app's own safety rules hold it (a quarantined run): only an explicit stop replaces it. */
  fenced: boolean
  /** A reason the app never restarts it for a token: a person's own Assistant, PC Control. Null otherwise. */
  special: string | null
}

export interface PlannedLine {
  sessionId: string
  name: string
  floor: string | null
  /** 'restart': the runner restarts it. 'skip': it is left as it is, and `note` says why. */
  action: 'restart' | 'skip'
  note: string | null
}

export interface RestartPlan {
  /** The whole job is turned down, in words: nothing is touched. */
  refused: string | null
  lines: PlannedLine[]
}

export const alreadyOnTokenWords = 'Already on the token in place: nothing to apply.'

export function planRestart(i: { pcName: string; status: ClaudePcStatus; candidates: readonly RestartCandidate[]; requested: readonly string[] }): RestartPlan {
  const none = (refused: string): RestartPlan => ({ refused, lines: [] })
  if (i.requested.length === 0) return none('Tick at least one chat to restart.')
  // The token a restarted chat would pick up must be there: nothing placed, nothing to apply.
  if (i.status.token !== 'set' || !i.status.placed) return none(`Nothing is placed on ${i.pcName} yet: a restarted chat would find no new token. Change its subscription first, or check its CRM sign-in.`)
  const byId = new Map(i.candidates.map(c => [c.sessionId, c]))
  const lines: PlannedLine[] = []
  const wanted: RestartCandidate[] = []
  for (const sid of new Set(i.requested)) {
    const c = byId.get(sid)
    if (!c) {
      lines.push({ sessionId: sid, name: sid.slice(0, 8), floor: null, action: 'skip', note: `It is not running on ${i.pcName} any more.` })
      continue
    }
    const skip = (note: string) => lines.push({ sessionId: c.sessionId, name: c.name, floor: c.floor, action: 'skip', note })
    if (c.engine !== 'claude') skip(NOT_A_CLAUDE_CHAT)
    else if (c.special) skip(c.special)
    else if (c.fenced) skip("The app's safety rules hold this chat: stop it and open it yourself.")
    else if (!c.homeOk) skip(`Its home is not ${i.pcName}: restart it from its own chat window.`)
    else {
      wanted.push(c)
      if (c.onOldToken === false) skip(alreadyOnTokenWords)
      else lines.push({ sessionId: c.sessionId, name: c.name, floor: c.floor, action: 'restart', note: null })
    }
  }
  // Every chat that could be restarted already started after the placed token: there is no new token to apply, so the job is refused whole, not run as a string of no-ops.
  if (wanted.length > 0 && wanted.every(c => c.onOldToken === false)) {
    return none(`No new token placed yet on ${i.pcName}: the chats you ticked started after the subscription now in place, so a restart would change nothing.`)
  }
  return { refused: null, lines }
}
