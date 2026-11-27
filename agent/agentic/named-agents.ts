import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { AGENTS_MAX, MAX_FILE_BYTES, NAME_WORDS, makeAgent, parseAgentsFile, parseNewName, serializeAgents, type NameWhy, type NamedAgent } from '../../shared/named-agents.ts'
import { apiError } from '../api.ts'
import { writeAtomic } from '../config.ts'
import type { Logger } from '../log.ts'

// F-374 (Shubham, 27 Nov 2026: "Please create an Add Agent button and only have the name in it so only the agent will be added"; the page "Agents (Shubham)", /agents-new): the list of NAMED AGENTS, one small file in
// the app's state folder (named-agents.json), written whole to a temp name and renamed. It lives on the Server (the hub), so every device sees the same list. An agent here is ONLY a name (the rules are
// shared/named-agents.ts, the same the page runs). Two things use this store: the two owner routes in index.ts (GET and POST /named-agents). NOTHING ELSE: no chat tool, no MCP tool, no floor, no notebook, no
// wiki, no memory layer reads or writes it, and it writes to none of them (src/agentic/named-agents-wire.test.ts pins that).
//   - A MISSING file is an empty list. A file that is THERE but cannot be read (not JSON, not version 1, over MAX_FILE_BYTES) is NOT an empty list: nothing is listed and nothing is written, so a damaged file is
//     never written over; the owner is told the list could not be read.
//   - The name of an agent is never logged; the log says only that one was added, and its id.

export const NAMED_AGENTS_FILE = 'named-agents.json'

export interface NamedAgentsStore {
  /** The agents, in the order they were added. */
  list(): NamedAgent[]
  /** Adds the agent `body.name` names (nothing else of `body` is read). 400 for a name that fails the rules, 409 for a name already there or a full list. */
  add(body: unknown): NamedAgent
}

const WHY_STATUS: Record<NameWhy, number> = { name: 400, chars: 400, long: 400, same: 409, full: 409 }
const refuse = (why: NameWhy) => Object.assign(apiError(WHY_STATUS[why], NAME_WORDS[why]), { code: `named-agents-${why}` })
const unreadable = () => Object.assign(apiError(503, 'The saved agents could not be read.'), { code: 'named-agents-unreadable' })

export function createNamedAgents(o: { dir: string; log?: Pick<Logger, 'info' | 'warn'>; now?: () => number }): NamedAgentsStore {
  const file = path.join(o.dir, NAMED_AGENTS_FILE)
  const now = o.now ?? Date.now

  /** The saved list; [] when there is no file yet; throws (503) when the file is there and cannot be read, so it is never written over. */
  function load(): NamedAgent[] {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch (e) {
      if (e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT') return []
      o.log?.warn('named agents: the file could not be read')
      throw unreadable()
    }
    const agents = text.length > MAX_FILE_BYTES ? null : parseAgentsFile(text)
    if (agents === null) {
      o.log?.warn('named agents: the file is not a list of agents')
      throw unreadable()
    }
    return agents
  }

  function save(agents: NamedAgent[]) {
    try {
      writeAtomic(file, serializeAgents(agents))
    } catch {
      o.log?.warn('named agents not saved (write failed)')
      throw Object.assign(apiError(503, 'The agent could not be saved.'), { code: 'named-agents-write' })
    }
  }

  return {
    list: load,

    add(body) {
      const all = load()
      const p = parseNewName(body, all)
      if (!p.ok) throw refuse(p.why)
      // The cap is on what is kept; parseNewName has said there is room.
      if (all.length >= AGENTS_MAX) throw refuse('full')
      const made = makeAgent(p.name, randomUUID(), now())
      save([...all, made])
      o.log?.info(`named agent added: ${made.id}`)
      return made
    },
  }
}
