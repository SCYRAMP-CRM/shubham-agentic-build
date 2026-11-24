// F-334 (Shubham's orders odf14, o09a5, o307d: Alt+G on a floor drops a curtain of the CRM goals connected to THAT floor). The rules of the app's own link file, pure so a test pins every one:
// which CRM goal was made by which floor's chat. The CRM keeps no such field and gets none: the app stamps the link when a chat calls crm_goal_add (agent/agentic/index.ts toolFor), in its own small
// file (agent/agentic/goal-floors.ts). It holds ids and times ONLY: never a title, a name, a description. A goal made any other way has no link, and none is ever guessed.

/** The CRM's goal id shape (the same test crm-goals.ts makes before it forwards an id). */
export const GOAL_ID_RE = /^[0-9a-fA-F-]{8,64}$/
/** A floor id or an agent id of this app. */
export const LINK_ID_RE = /^[A-Za-z0-9._:-]{1,64}$/
/** At most this many links are kept (the CRM has a few hundred goals today); more are refused, never silently dropped from the file. Sized so that a file full of links with the LONGEST ids still fits under MAX_FILE_BYTES (a test builds it). */
export const MAX_LINKS = 6_000
/** A file bigger than this is not read at all (fail closed to "nothing linked"). */
export const MAX_FILE_BYTES = 2_000_000
export const FILE_VERSION = 1

export interface GoalLink {
  floorId: string
  agentId: string
  /** When the link was made (an ISO time). */
  at: string
}

export interface GoalFloorsFile {
  version: typeof FILE_VERSION
  links: Record<string, GoalLink>
}

export const emptyGoalFloors = (): GoalFloorsFile => ({ version: FILE_VERSION, links: {} })

const isoOk = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v))

/**
 * What a file says. Tolerant on purpose: a missing, empty, oversize, torn, odd or wrong-version file is "nothing linked" (never a crash, never a guess), and a link that is not exactly
 * { floorId, agentId, at } with well-formed ids is dropped, so a file written by hand or by a newer build cannot put a word of text into the app's view.
 */
export function parseGoalFloors(text: unknown): GoalFloorsFile {
  const out = emptyGoalFloors()
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_FILE_BYTES) return out
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return out
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out
  const file = raw as { version?: unknown; links?: unknown }
  if (file.version !== FILE_VERSION || typeof file.links !== 'object' || file.links === null || Array.isArray(file.links)) return out
  let n = 0
  for (const [goalId, v] of Object.entries(file.links as Record<string, unknown>)) {
    if (n >= MAX_LINKS) break
    if (!GOAL_ID_RE.test(goalId) || typeof v !== 'object' || v === null || Array.isArray(v)) continue
    const l = v as Record<string, unknown>
    if (typeof l.floorId !== 'string' || !LINK_ID_RE.test(l.floorId) || typeof l.agentId !== 'string' || !LINK_ID_RE.test(l.agentId) || !isoOk(l.at)) continue
    out.links[goalId] = { floorId: l.floorId, agentId: l.agentId, at: l.at }
    n++
  }
  return out
}

export const serializeGoalFloors = (file: GoalFloorsFile): string => `${JSON.stringify({ version: FILE_VERSION, links: file.links })}\n`

export type LinkResult = 'linked' | 'kept' | 'invalid' | 'full'

/**
 * Records that `goalId` was made by a chat of `link.floorId`. FIRST LINK WINS: a goal that is linked already keeps its link (the same goal added again within minutes, even by a chat of another floor,
 * is the SAME goal and the SAME link, never a second one). Returns the file (a new object when it changed) and what happened.
 */
export function linkGoal(file: GoalFloorsFile, goalId: unknown, link: GoalLink): { file: GoalFloorsFile; result: LinkResult } {
  if (typeof goalId !== 'string' || !GOAL_ID_RE.test(goalId) || !LINK_ID_RE.test(link.floorId) || !LINK_ID_RE.test(link.agentId) || !isoOk(link.at)) return { file, result: 'invalid' }
  if (Object.hasOwn(file.links, goalId)) return { file, result: 'kept' }
  if (Object.keys(file.links).length >= MAX_LINKS) return { file, result: 'full' }
  return { file: { version: FILE_VERSION, links: { ...file.links, [goalId]: { floorId: link.floorId, agentId: link.agentId, at: link.at } } }, result: 'linked' }
}

/** What the page is sent: goal id -> floor id. Nothing else (no agent, no time): the page only needs to know which floor a goal belongs to. */
export function linksForWire(file: GoalFloorsFile): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [id, l] of Object.entries(file.links)) out[id] = l.floorId
  return out
}

/**
 * The goal id in what crm_goal_add answered, and ONLY when this is the answer of the call that MADE the goal: `{ added: <id>, ... }`. The answer of a call that found the goal already made or still being made
 * (`{ id, note, page }`: the same goal added a moment ago, maybe by a chat of ANOTHER floor) is not the maker's and never stamps a link: that answer can come back before the maker's own, so stamping it would give the
 * goal to the waiter's floor (Agent 14, 24 Nov). Anything else (an odd answer) is null: no link is made from a guess.
 */
export function goalIdOfAnswer(answer: unknown): string | null {
  if (typeof answer !== 'string' || answer.length > 200_000) return null
  let j: unknown
  try {
    j = JSON.parse(answer)
  } catch {
    return null
  }
  if (typeof j !== 'object' || j === null) return null
  const id = (j as { added?: unknown }).added
  return typeof id === 'string' && GOAL_ID_RE.test(id) ? id : null
}
