// F-300 slice S0 (his order oc60d: the floating Assistant for everyone; Agent 14's review adopted by Lead): the census of EVERY door of a person's own Assistant, kept where the agent is known.
//
// A person's own Assistant ("My Assistant", duty person-assistant, run under the staff policy) is theirs: they made its floor, so by the share clause of shared/access.ts ROUTES they reach the doors
// of an agent they own. Settings > Access 'assistant' only opened the page's button and two routes (/own-assistant, /assistant-history); it never closed the chat's own doors, and the owner-level
// doors (tune, run-on, share, attach, ...) were open to the person as the chat's owner. This file is the table that says, door by door, which a person keeps on their own Assistant and which they do not.
//
// Two rules sit on it, both enforced on the Server (never by the page):
//  1. Closed 'assistant' = closed doors: agent/agentic/access.ts rights() gives a non-owner NOTHING on a person's Assistant while Access has 'assistant' closed to them (needChat, mayType, visible,
//     the sockets, the chat's own tools: they all ask rights()).
//  2. Open 'assistant' = ONLY the rows below marked 'allow'. Everything else, and every door nobody has classified, is refused to the person (never to the owner of the app). The census test
//     (person-assistant-doors.test.ts) holds this table equal to the real route table, so a new door cannot be added without somebody deciding it.
//
// Pure: no I/O, no clock. The enforcement is in agent/agentic/index.ts (checkRule, wsAllow) and access.ts.

export type DoorVerdict = 'allow' | 'refuse'

export interface PersonDoor {
  method: string
  /** What follows /floors/:floor/agents/:agent/ : a plain word, or words with ':id' where the path holds one more segment. */
  tail: string
  verdict: DoorVerdict
  why: string
}

const door = (method: string, tail: string, verdict: DoorVerdict, why: string): PersonDoor => ({ method, tail, verdict, why })

/** Every door under /floors/:floor/agents/:agent/, as the route table (agent/agentic/access.ts POLICY, shared/access.ts ROUTES) and the upload mount have them. */
export const PERSON_ASSISTANT_DOORS: readonly PersonDoor[] = [
  // ---- what a person does with their own Assistant: allowed
  door('POST', 'chat', 'allow', 'opens (starts) their own Assistant; assertStaffStart and staffStartHere decide where and how it runs'),
  door('POST', 'say', 'allow', 'their message; staffText checks the text and the live checks run again at the write'),
  door('POST', 'say-direct', 'allow', 'the same message by the direct line; the same checks'),
  door('GET', 'messages', 'allow', 'reads their own conversation'),
  door('GET', 'chat', 'allow', 'the chat feed they see'),
  door('GET', 'draft', 'allow', 'what their input line holds'),
  door('POST', 'draft/clear', 'allow', 'one tap that clears their own unsent draft'),
  door('GET', 'deliveries', 'allow', 'the delivery contract of their own messages'),
  door('GET', 'deliveries/:id', 'allow', 'the receipt of one of their own messages'),
  door('POST', 'restart', 'allow', 'starts their own Assistant again under the same staff policy (Lead: allowed)'),
  door('POST', 'terminate', 'allow', 'ends only the process of their own chat (it is started again, under the policy, by the next open) and gives its memory back'),
  door('POST', 'move', 'allow', 'a same-floor reorder is theirs (R1b of o3b2f, own-assistant-access.test.ts); a move onto or off a personal Assistant\'s floor is refused where every list change is (index.ts refuseAssistantFloorChange)'),
  // ---- what is the owner's: refused to the person, whatever Access says
  door('POST', 'tune', 'refuse', 'model, effort, engine, MCP servers and the other settings of the agent: the owner of the app sets them (the staff launch fixes them)'),
  door('POST', 'run-on', 'refuse', 'where the chat runs: a person\'s own Assistant runs on the Server only. The one case let through is naming the Server itself (a member PC\'s page reaches the Assistant at its home through the Server\'s run-on: index.ts refusePersonDoor), which moves nothing'),
  door('POST', 'session', 'refuse', 'rebinds the conversation to another session id: the Assistant\'s conversation is not the person\'s to swap'),
  door('POST', 'share', 'refuse', 'shares the chat: a personal Assistant is theirs alone'),
  door('POST', 'attach', 'refuse', 'a file sent to the chat: a personal Assistant takes plain messages only (index.ts staff refusal)'),
  door('GET', 'attachment/:id', 'refuse', 'a file served from the chat: none is ever sent to it'),
  door('GET', 'brain', 'refuse', 'the Agents page look at one agent: the owner\'s only (POLICY OWNER)'),
  door('GET', 'conversion-progress', 'refuse', 'the engine switch\'s progress: there is no engine switch for a person'),
  door('GET', 'execution-capability', 'refuse', 'the engine choice: the owner of the app\'s'),
  door('POST', 'execution-selection', 'refuse', 'the engine choice: the owner of the app\'s'),
  door('POST', 'execution-verify', 'refuse', 'the engine choice: the owner of the app\'s'),
  door('GET', 'execution-intents/:id', 'refuse', 'the engine choice: the owner of the app\'s'),
  door('PUT', 'beat', 'refuse', 'F-359: the goals heartbeat of a chat (it types into the chat on its own, and counts against the usage): the first owner\'s alone, by id (firstOwnerOnly in index.ts)'),
]

/** The sockets, by their path under /agentic: both name the chat by ?session=. */
export const PERSON_ASSISTANT_SOCKETS: readonly { path: string; verdict: DoorVerdict; why: string }[] = [
  { path: '/chat', verdict: 'allow', why: 'the chat feed of their own Assistant (view; typing is asked again at every message)' },
  { path: '/terminal', verdict: 'allow', why: 'the screen of their own Assistant as a VIEW (his order o1fde; Lead: view yes, keys never): terminalRights() (index.ts, F-302 a2/a3) gives them NO keys and NO draft for a policy chat and a geometry-only size to its owner; the pool refuses raw keys as well' },
]

const AGENT_TAIL = /^\/floors\/[^/]+\/agents\/[^/]+\/(.+)$/
/** Paths whose last segment is one more id: that segment is ':id' in the table. */
const WITH_ID = /^(deliveries|attachment|execution-intents)\/[^/]+$/

const TABLE = new Map(PERSON_ASSISTANT_DOORS.map(d => [`${d.method} ${d.tail}`, d]))

/** The tail of an agent door as the table writes it ('deliveries/abc' -> 'deliveries/:id'), or null when the path is not under an agent. `rest` is the mount's path (no /agentic prefix, no query). */
export function agentTail(rest: string): string | null {
  const m = AGENT_TAIL.exec(rest)
  if (!m) return null
  return WITH_ID.test(m[1]) ? m[1].replace(/\/[^/]+$/, '/:id') : m[1]
}

/**
 * What a person may do through this door of their own Assistant. null: the path is not a door of an agent. A door nobody classified is REFUSED (default deny), so a route added later is closed to a
 * person until the table says otherwise.
 */
export function personDoorOf(method: string, rest: string): PersonDoor | null {
  const tail = agentTail(rest)
  if (tail === null) return null
  const m = method.toUpperCase()
  return TABLE.get(`${m} ${tail}`) ?? { method: m, tail, verdict: 'refuse', why: 'not classified: refused until it is (person-assistant-doors.ts)' }
}

/** The verdict for a socket (rest is '/chat' or '/terminal'); null when it is neither. */
export function personSocketOf(rest: string): DoorVerdict | null {
  return PERSON_ASSISTANT_SOCKETS.find(s => s.path === rest)?.verdict ?? null
}

// ---- the floor's chart (PATCH /floors/:id): a person may still rename their Assistant and move its box on the chart (R1b of o3b2f, own-assistant-access.test.ts), and change nothing that decides how it runs.

/**
 * The fields of a personal Assistant's entry in a chart that a PAGE can set and that decide how it runs: its model, effort, ultracode, engine and execution, its MCP servers and skills, its brief, who it reports to and its session binding. A person's
 * chart that changes any of them is refused. Not listed on purpose: name, role and place (a person may change them), and what the Server sets and ignores from a page (the owner's tags, its home PC, its history).
 */
export const CHART_LOCKED: readonly string[] = ['md', 'model', 'effort', 'ultracode', 'engine', 'executionProfile', 'executionRevision', 'opencodeProvider', 'opencodeModel', 'codexModel', 'codexEffort', 'skills', 'mcpServers', 'reportsTo', 'isBoss', 'sessionId']

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Deep equality of plain JSON values, whatever the order of an object's keys. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameValue(v, b[i]))
  if (isRecord(a) && isRecord(b)) {
    const ka = Object.keys(a).filter(k => a[k] !== undefined), kb = Object.keys(b).filter(k => b[k] !== undefined)
    return ka.length === kb.length && ka.every(k => sameValue(a[k], b[k]))
  }
  return false
}

/**
 * What a chart sent by a PERSON changes beyond what they may: null when nothing, else a short plain reason. `current` is the floor now (a floor holding a personal Assistant). The floor's own name is kept (the Assistant is found
 * by it), and so is every CHART_LOCKED field of a personal Assistant's entry. Adds and drops are the existing guard's (index.ts refuseAssistantFloorChange), and entries for other agents are not this table's.
 */
export function personChartTouches(current: { name: string; agents: readonly object[] }, body: unknown): string | null {
  if (!isRecord(body)) return 'the chart'
  if (body.name !== undefined && body.name !== current.name) return "the floor's name"
  if (body.agents === undefined) return null
  if (!Array.isArray(body.agents)) return 'the chart'
  for (const entry of body.agents) {
    if (!isRecord(entry) || typeof entry.id !== 'string') continue
    const now = current.agents.find(a => (a as { id?: unknown }).id === entry.id) as Record<string, unknown> | undefined
    if (!now || now.duty !== 'person-assistant') continue
    for (const key of CHART_LOCKED) {
      if (entry[key] === undefined) continue
      if (!sameValue(entry[key], now[key])) return `the Assistant's ${key}`
    }
  }
  return null
}

/** The words of a refused door: plain, no route names. */
export const PERSON_DOOR_REFUSED = "This is for the owner of this app: a personal Assistant's settings are not changed from here."
