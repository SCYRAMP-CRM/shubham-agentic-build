// F-374 (Shubham, 27 Nov 2026: "Please create agents in the Agents, Shubham. Please create an Add Agent button and only have the name in it so only the agent will be added. ... Basically add agents and just
// the name of the agent, nothing else."; the page is "Agents (Shubham)", /agents-new): the rules of the list of NAMED AGENTS. An agent here is ONLY a name: no role, no chat, no memory, no task, no floor. The page
// (src/pages/AgentsShubham.tsx) and the Server's store (agent/agentic/named-agents.ts) both use THESE rules, so a name the page lets through is a name the Server keeps and the other way round. Pure: no network, no file.

/** A name is 1 to this many characters (letters as a person counts them, not UTF-16 units). */
export const NAME_MAX = 60
/** At most this many agents. */
export const AGENTS_MAX = 200
/** The saved file is never read when it is bigger than this (200 names of 60 characters are far under it). */
export const MAX_FILE_BYTES = 262_144
export const AGENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** One agent: a name, and the moment it was added. The list keeps the order they were added in. */
export interface NamedAgent {
  id: string
  name: string
  addedAt: string
}
export interface NamedAgentsAnswer {
  agents: NamedAgent[]
}

export type NameWhy = 'name' | 'chars' | 'long' | 'same' | 'full'
/** What the page shows under the field when a name is refused: fixed sentences, which never repeat what was typed. */
export const NAME_WORDS: Record<NameWhy, string> = {
  name: 'Give the agent a name.',
  chars: 'A name cannot have line breaks, tabs or hidden characters.',
  long: `A name can have at most ${NAME_MAX} characters.`,
  same: 'There is already an agent with that name.',
  full: `There are ${AGENTS_MAX} agents already.`,
}

// Control (tabs, line breaks, the C0 and C1 codes), format (the zero-width and direction marks), line and paragraph separators, lone surrogates, private use and unassigned code points are never part of a name.
const HIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Co}\p{Cn}]/u
// Every kind of space (a no-break space, an ideographic space) is one ordinary space, and a run of them is one.
const SPACES = /\p{Zs}+/gu
const MARKS = /\p{M}/gu

/** How long a name is, in characters. */
export const nameLength = (s: string): number => [...s].length

export type Cleaned = { ok: true; name: string } | { ok: false; why: 'name' | 'chars' | 'long' }

/**
 * A typed name as it is kept: composed (NFC), every space an ordinary one and a run of them one, trimmed. A name that is not a string, or is empty, "name"; one with a control or format character, "chars"; one over
 * NAME_MAX characters, "long". (The same function is run on every name read back from the file.)
 */
export function cleanName(raw: unknown): Cleaned {
  if (typeof raw !== 'string') return { ok: false, why: 'name' }
  // A name is never more than a few hundred units, even before it is cleaned: a longer thing is not worked on.
  if (raw.length > NAME_MAX * 8) return { ok: false, why: 'long' }
  const name = raw.normalize('NFC').replace(SPACES, ' ').trim()
  if (name === '') return { ok: false, why: 'name' }
  if (HIDDEN.test(name)) return { ok: false, why: 'chars' }
  if (nameLength(name) > NAME_MAX) return { ok: false, why: 'long' }
  return { ok: true, name }
}

/** What two names must differ in: case and accents do not count ("Zoë" and "zoe" are one name). */
export const foldName = (name: string): string => name.normalize('NFD').replace(MARKS, '').toLowerCase().normalize('NFC')

export type NewName = { ok: true; name: string } | { ok: false; why: NameWhy }

/**
 * The name to add, or why not: the name rules, then a name that is already in `existing` (ignoring case and accents), then the cap. `body` is what the page sent: ONLY its `name` is read, so nothing else
 * can ride in with an agent.
 */
export function parseNewName(body: unknown, existing: readonly { name: string }[]): NewName {
  const raw = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as { name?: unknown }).name : undefined
  const c = cleanName(raw)
  if (!c.ok) return c
  const key = foldName(c.name)
  if (existing.some(a => foldName(a.name) === key)) return { ok: false, why: 'same' }
  if (existing.length >= AGENTS_MAX) return { ok: false, why: 'full' }
  return { ok: true, name: c.name }
}

/** The page's own check of what is typed, before anything is sent: the same rules, as the sentence to show (null: it can be sent). */
export function nameProblem(raw: string, existing: readonly { name: string }[]): string | null {
  const p = parseNewName({ name: raw }, existing)
  return p.ok ? null : NAME_WORDS[p.why]
}

export const makeAgent = (name: string, id: string, now: number): NamedAgent => ({ id, name, addedAt: new Date(now).toISOString() })

/** The file's text for a list (what is written). */
export const serializeAgents = (agents: readonly NamedAgent[]): string => `${JSON.stringify({ version: 1, agents }, null, 2)}\n`

/**
 * The list in a saved file, or null when the file is not one (not JSON, not version 1, no list): the Server then keeps its hands off the file rather than write over what it cannot read. An entry that is not an
 * agent (an id that is not one, a name that fails the rules) is left out, a repeat of a name is left out, and no more than AGENTS_MAX are kept; the order is the file's.
 */
export function parseAgentsFile(text: string): NamedAgent[] | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const file = raw as { version?: unknown; agents?: unknown }
  if (file.version !== 1 || !Array.isArray(file.agents)) return null
  const out: NamedAgent[] = []
  const seen = new Set<string>()
  for (const item of file.agents) {
    if (out.length >= AGENTS_MAX) break
    if (typeof item !== 'object' || item === null) continue
    const a = item as { id?: unknown; name?: unknown; addedAt?: unknown }
    if (typeof a.id !== 'string' || !AGENT_ID_RE.test(a.id)) continue
    const c = cleanName(a.name)
    if (!c.ok) continue
    const key = foldName(c.name)
    if (seen.has(key)) continue
    seen.add(key)
    const at = typeof a.addedAt === 'string' && !Number.isNaN(Date.parse(a.addedAt)) ? new Date(a.addedAt).toISOString() : new Date(0).toISOString()
    out.push({ id: a.id, name: c.name, addedAt: at })
  }
  return out
}
