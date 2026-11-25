import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { writeAtomic } from '../config.ts'
import { MCP_DRIVES_PC } from '../../shared/mcp-inventory.ts'

// F-349 (Shubham: "in the mcp tab for each machine i should be able to inject mcp for all chats for that machine"; he answered: also the chats created later): the MCP servers THIS PC gives to EVERY chat that starts on it.
// A small file of this PC's own, machine-mcps.json beside the other agentic state: { version: 1, pc: <this PC's id>, servers: [names] }. Names only: no command, argument or value ever travels or is written here. A name
// counts only if it is in THIS PC's own list of servers (mcp-servers.json, the registry): `chosen` in mcp-registry.ts drops the rest at each chat start, and the writer here is told the registry's names. The file is read
// at each chat START and its names are added to the agent's own list (wantedFor), once each; nothing in floors.json is written, so there is no rewrite of the agents and no race with an agent being edited. A file made
// on another PC (a different `pc`), a damaged one or a wrong shape gives NO default, never a crash.

export const MACHINE_MCPS_MAX = 32
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/

/** The names a server needs the person to say "I understand" for: every RESTRICTED one (mcp-registry.ts restrictedNames: the default list, every server of this PC's own list, the file's own "restricted" names): today only an agent that names it gets it, after this EVERY chat of the first owner on this PC gets it, with whatever it can reach (the desktop, files, keys, accounts). Those that drive the whole PC say so louder on the page (MCP_DRIVES_PC). */
export const needsUnderstanding = (restricted: ReadonlySet<string>, name: string): boolean => restricted.has(name) || MCP_DRIVES_PC.includes(name)

/** The names in the file for this PC, valid and distinct; [] for a missing, damaged, other-PC or wrong-shape file. */
export function readMachineMcps(file: string, pcId: string): string[] {
  try {
    if (!existsSync(file)) return []
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return []
    const o = raw as Record<string, unknown>
    if (o.version !== 1 || o.pc !== pcId || !Array.isArray(o.servers) || o.servers.length > MACHINE_MCPS_MAX) return []
    const names = o.servers.filter((n): n is string => typeof n === 'string' && NAME.test(n))
    return [...new Set(names)]
  } catch {
    return []
  }
}

/** What an agent's chat is started with: the agent's own names, then this PC's, each once. */
export const wantedFor = (own: readonly string[], machine: readonly string[]): string[] => [...new Set([...own, ...machine])]

/**
 * What a CHAT starts with: the PC's defaults reach only the first owner's own chats (`firstOwnersOwn`: the chat's agent belongs to the first owner by id and is no person's staff Assistant). A second owner's or another person's
 * chat on the same PC starts with its agent's own names only: a default may drive the PC's desktop and must never reach a chat of somebody else (Agent 14's read).
 */
export const wantedForChat = (own: readonly string[], machine: readonly string[], firstOwnersOwn: boolean): string[] => wantedFor(own, firstOwnersOwn ? machine : [])

export class MachineMcpsError extends Error {
  readonly kind: 'name' | 'unknown' | 'understand' | 'full'
  constructor(kind: 'name' | 'unknown' | 'understand' | 'full', message: string) {
    super(message)
    this.kind = kind
  }
}

/**
 * Gives (`on`) or takes away (`!on`) ONE server for every chat on this PC. `registryNames` are the names in this PC's own list: a name that is not in it cannot be given (taking one away is always allowed, so a name
 * that left the list can still be cleaned out). A restricted server (every server of the PC's own list is) needs `understood: true`. Written atomically (owner-only file); returns the names now in the file.
 */
export function setMachineMcp(file: string, pcId: string, registryNames: ReadonlySet<string>, restricted: ReadonlySet<string>, name: string, on: boolean, understood: boolean): string[] {
  if (typeof name !== 'string' || !NAME.test(name)) throw new MachineMcpsError('name', 'That is not a server name.')
  const now = readMachineMcps(file, pcId)
  let next: string[]
  if (on) {
    if (!registryNames.has(name)) throw new MachineMcpsError('unknown', 'That server is not in this PC\'s list yet: add it first.')
    if (needsUnderstanding(restricted, name) && understood !== true) throw new MachineMcpsError('understand', 'Giving a server to every chat is a wide step (it reaches whatever that server can reach): the answer must say it is understood.')
    next = now.includes(name) ? now : [...now, name]
    if (next.length > MACHINE_MCPS_MAX) throw new MachineMcpsError('full', 'Too many servers are given to every chat on this PC.')
  } else {
    next = now.filter(n => n !== name)
  }
  if (next.length === now.length && next.every((n, i) => n === now[i])) return now
  mkdirSync(path.dirname(file), { recursive: true })
  writeAtomic(file, `${JSON.stringify({ version: 1, pc: pcId, servers: next }, null, 2)}\n`, 0o600)
  return next
}
