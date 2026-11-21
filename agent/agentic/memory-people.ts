import path from 'node:path'
import type { Floor, FloorAgent } from '../../shared/agentic.ts'
import type { ChatOwner } from '../../shared/auth.ts'
import { apiError } from '../api.ts'
import type { MemoryLayer } from './memory-layer.ts'
import { OWNER_NAME } from './wiki.ts'

// oc65c / F-051, slice S1 (the owner key): a memory belongs to a PERSON. Until now the memory layer was one thing for the whole app: one wiki,
// one turn log, one set of settings, all of it his. This is the seam that makes it one layer per person, without changing anything for him:
//   - the key is the person's CRM id (a UUID), the same key assistant-history/<person-id>/ uses: never a username or a display name (they
//     change), and never a path or an id taken from a page or a tool's arguments; every folder name goes through memoryPersonId;
//   - the app owner's layer stays exactly where it always was (<agentic>/memory-layer and <agentic>/wiki): nothing moves, nothing is copied,
//     every text it makes is the same;
//   - everyone else's would be <agentic>/personal-memory/<person id>/{layer,wiki}, never shared with another person, and sees only the agents
//     that person owns (floorsOwnedBy). Their version is NOT built (S9): until it is, the registry refuses to make it (fail closed).
// Slice S2 (the one door): the registry hands out a layer only for a MemoryScope, and a scope is made only by MemoryPeople.scope(), which asks
// "does this person have a memory, and may it be offered at all?" before anything is made or started. See the door x person matrix in
// agent/SPEC.md (F-051) and memory-doors.test.ts, which holds it and fails for a door that is not in it.

/** A person's CRM id: a UUID, any case. */
const PERSON_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The key, lower case; a 400 for anything that is not a person id, before it can name a folder. */
export function memoryPersonId(id: unknown): string {
  if (typeof id !== 'string' || !PERSON_ID.test(id)) throw apiError(400, 'Not a person id')
  return id.toLowerCase()
}

export interface MemoryPerson {
  id: string
  /** What the texts of this person's memory call them. */
  name: string
}

/** The name a person's memory uses for them: the first word of their name, else their username. */
export function memoryPersonName(owner: { name?: string | null; username?: string | null }): string {
  const first = (owner.name ?? '').trim().split(/\s+/)[0]
  return first || (owner.username ?? '').trim() || 'this person'
}

export interface MemoryHome {
  /** state.json, turns.jsonl, its cursors and the vectors. */
  layerDir: string
  /** The wiki: SCHEMA.md, core.md, pages, inbox/, and its git history. */
  wikiDir: string
  /** The app owner's: the folders it has always had. */
  legacy: boolean
}

/**
 * Where a person's memory lives. The app owner's is where it always was; everyone else's is a folder of their own under personal-memory/,
 * so no two people ever share a file. `dir` is <state>/agent/agentic.
 */
export function memoryHome(dir: string, personId: string, appOwnerId: string): MemoryHome {
  const id = memoryPersonId(personId)
  if (id === memoryPersonId(appOwnerId)) return { layerDir: path.join(dir, 'memory-layer'), wikiDir: path.join(dir, 'wiki'), legacy: true }
  const root = path.join(dir, 'personal-memory', id)
  return { layerDir: path.join(root, 'layer'), wikiDir: path.join(root, 'wiki'), legacy: false }
}

/** Who owns an agent's chat: its owner; an agent made before owners were recorded belongs to the app owner (the rule F-211's folders use). */
export function ownerIdOfAgent(agent: Pick<FloorAgent, 'owner'>, appOwnerId: string): string {
  return (agent.owner?.id || appOwnerId).toLowerCase()
}

/**
 * The floors as one person sees them: only the agents they own, and no floor that is left with none. Copies; the input is not touched.
 * (S4 adds the rest of the feeding rules: no PC-control floor, no chat shared for typing, no other person's staff chat, and which NOTES a personal
 * layer reads: a floor's notes belong to the floor, and every floor's notes are ingested whatever the "learns from chats" setting says.)
 */
export function floorsOwnedBy(floors: readonly Floor[], personId: string, appOwnerId: string): Floor[] {
  const id = memoryPersonId(personId)
  const out: Floor[] = []
  for (const f of floors) {
    const agents = f.agents.filter(a => ownerIdOfAgent(a, appOwnerId) === id)
    if (agents.length) out.push({ ...f, agents })
  }
  return out
}

/**
 * oc65c / F-051 S4 (feeding by owner): does the chat of this agent FEED the memory of this person? Only a chat they OWN (an agent with no owner on record is the app owner's), that
 * nobody else can type into (a chat shared for typing holds other people's words, and `from: 'shubham'` only says "typed, not a relay", not who typed), and that is not a PC
 * Control chat (a slot chat, or any chat of a PC Control floor: they act on a PC and read its screen). Another person's chat, and so another person's Assistant (a staff chat),
 * never feeds this person. A view share is fine: everything said in it is still the owner's.
 */
export function feedsMemory(floor: Pick<Floor, 'workspace'>, agent: Pick<FloorAgent, 'owner' | 'sharedWith' | 'pcControlSlot'>, personId: string, appOwnerId: string): boolean {
  if (floor.workspace === 'pc-control' || agent.pcControlSlot) return false
  if (agent.sharedWith?.some(s => s.can === 'type')) return false
  return ownerIdOfAgent(agent, appOwnerId) === memoryPersonId(personId)
}

/** The floors as a person's memory follows their chats: only the agents that feed it (feedsMemory), no floor left with none. Copies; the input is not touched. */
export function feedFloors(floors: readonly Floor[], personId: string, appOwnerId: string): Floor[] {
  const id = memoryPersonId(personId)
  const out: Floor[] = []
  for (const f of floors) {
    const agents = f.agents.filter(a => feedsMemory(f, a, id, appOwnerId))
    if (agents.length) out.push({ ...f, agents })
  }
  return out
}

/**
 * The agents that do NOT feed a person's memory (everyone else's chats, and their own that are shared for typing or PC Control ones), by floor, no floor left with none; copies.
 * Their transcripts are not read, and their read position is kept at the end of their files (turns.collect's `skip`), so words typed in them while they do not feed are never
 * read as this person's when they do (Agent 14's F2); a chat that changes hands brings no backlog to its new owner (Lead's ruling).
 */
export function unfedFloors(floors: readonly Floor[], personId: string, appOwnerId: string): Floor[] {
  const id = memoryPersonId(personId)
  const out: Floor[] = []
  for (const f of floors) {
    const agents = f.agents.filter(a => !feedsMemory(f, a, id, appOwnerId))
    if (agents.length) out.push({ ...f, agents })
  }
  return out
}

/**
 * The floors whose NOTES a person's memory reads (settles the S1 open item): a floor's notes belong to the floor, and every agent on it writes there, so they are this person's
 * only when EVERY agent of the floor is theirs (and it is not a PC Control floor). One chat of another person on the floor, and its notes are not read. Copies.
 */
export function noteFloors(floors: readonly Floor[], personId: string, appOwnerId: string): Floor[] {
  const id = memoryPersonId(personId)
  return floors.filter(f => f.workspace !== 'pc-control' && f.agents.length > 0 && f.agents.every(a => ownerIdOfAgent(a, appOwnerId) === id)).map(f => ({ ...f }))
}

/**
 * oc65c / F-051 S3 (the end of the global memory-file sweep): the Claude Code project folders (names under the projects folder) a person's memory may read memory files
 * from: the ones their OWN chats run in, and no chat of another person runs in. The folder of a chat is where its transcript is (`<projects>/<folder>/<session>.jsonl`), and a
 * folder that holds the transcript of ANY other person's chat (or of an odd owner id) is left out: a Claude Code memory file there may have been written by theirs. An agent
 * with no owner on record is the app owner's. A folder no known chat runs in is not anyone's (it is never swept). Sorted, without repeats.
 */
export function ownProjects(floors: readonly Floor[], personId: string, appOwnerId: string, transcript: (sessionId: string) => string | null, onThisPc: (agent: FloorAgent) => boolean = () => true): string[] {
  const id = memoryPersonId(personId)
  const mine = new Set<string>()
  const others = new Set<string>()
  // Agent 14's N2 (fail closed): a chat of ANOTHER person that started on this PC but whose transcript cannot be found says nothing about where it ran (the file was never
  // written, was cleaned up by Claude Code while its memory files stayed, or the lookup failed): it may have used any folder, so nobody's folder can be told apart and the list
  // is empty. A chat that lives on another PC (`onThisPc` false) has no folder on this one and is not in doubt.
  let unknown = false
  for (const f of floors) {
    for (const a of f.agents) {
      if (!a.sessionId) continue
      const theirs = ownerIdOfAgent(a, appOwnerId) !== id
      let file: string | null = null
      try {
        file = transcript(a.sessionId)
      } catch {
        file = null
      }
      const folder = file ? path.basename(path.dirname(file)) : ''
      if (!file || !folder || folder === '.' || folder === '..') {
        if (theirs && onThisPc(a)) unknown = true
        continue
      }
      if (!theirs) mine.add(folder)
      else others.add(folder)
    }
  }
  if (unknown) return []
  return [...mine].filter(p => !others.has(p)).sort()
}

/**
 * oc65c / F-051 S2 (the one door), ruling D-S2-1 (Lead, 18 Nov 2026: "privacy first"): a chat that is ACTUALLY SHARED with another person has no memory while it is
 * so. What the recall hook adds to a prompt goes into the chat's context and is kept in its transcript, and whoever the chat is shared with reads that transcript:
 * the owner's memory would be shown to them. The predicate is `sharedWith` not empty (a view share reads the chat, a type share writes in it; the owner is never in
 * his own list: floors.ts setShare). A PC-control slot chat is NOT shared by being a slot (Lead, 18 Nov: his own pinned Chat 1 / Chat 2 keep their memory): access.ts
 * rights() and mayType() already make a slot chat unreadable and untypable for anyone but its owner and an administrator unless it IS shared, which this covers. It
 * protects what is said FROM NOW ON: the brief is read once, at the chat's start, so a chat shared later keeps the section it was started with (and its transcript
 * keeps any recall injected before the share); the memory comes back when the share ends. Sharing is per chat: there is no floor-level share.
 */
export function chatIsShared(agent: Pick<FloorAgent, 'sharedWith'>): boolean {
  return (agent.sharedWith?.length ?? 0) > 0
}

/**
 * THE door for a CHAT (a tool, the recall hook, the brief): whose memory it uses. Its agent's OWNER's: an agent with no owner on record is the app owner's
 * (the rule F-211's folders use), and it is NEVER a person named in a tool's arguments, a query or a body. null: none, because the chat is shared
 * (chatIsShared). The caller still asks the registry for a scope (`MemoryPeople.scope`): until S9 only the app owner has a memory. The administrator
 * flag plays no part here: memory follows the owner's person id (each tool keeps its own administrator test as it was).
 */
export function chatMemoryPerson(agent: Pick<FloorAgent, 'owner' | 'sharedWith'>, appOwner: ChatOwner): ChatOwner | null {
  if (chatIsShared(agent)) return null
  return agent.owner?.id ? agent.owner : appOwner
}

/** Who holds Quick (the fast Assistant) now, as fast.ts's `talker()` says: the connection's kind, and the CRM id of the person signed in on it (null: nobody). */
export interface QuickTalker {
  kind: 'web' | 'phone'
  person: string | null
}

/**
 * S2, Lead's rulings on Agent 7's F1/F6 (18 Nov 2026, fail closed). Quick's tools run as a copy of the Orchestrator's agent, but WHO TALKS TO QUICK is
 * not that agent's owner: a phone is a paired device (pairing is for any signed-in administrator and records NO person: voice.ts Device = id, name, model,
 * hash, at, lastSeen), and a web talker is whoever is signed in. So Quick's LAYER (the hits of memory_search, all of memory_read) is offered only to the
 * app owner talking on a web page: no talker (nobody holds the Assistant now) -> no; a phone -> no; a web talker with a person -> only the app owner;
 * a web talker with no person (the open app, the PC's own program: both are the owner's) -> yes. The floor notes (`entries`, memory_recent) are not the
 * layer and stay as they were. /fast and /talk are the app owner's (index.ts wsAllow, talkPage), so this is the seatbelt, not the lock. If a paired
 * device ever records who paired it, a phone paired by the owner can join the last line (a later slice, with its cost).
 */
export function quickMayUseMemory(talker: QuickTalker | null, appOwnerId: string): boolean {
  if (!talker || talker.kind === 'phone') return false
  return talker.person === null || talker.person.toLowerCase() === appOwnerId.toLowerCase()
}

/**
 * The guard (S2, Lead's ruling 18 Nov): memory is offered only while the app owner is the ONLY administrator. An administrator is owner-equivalent in the
 * chat plane (access.ts mayType and chatRights give them every chat): they can type "search the memory for X" into his chat and read the answer and the
 * recalled text in its transcript, whatever the doors say. So while auth.json's administrators hold anyone else, the memory is off for everybody (fail
 * closed); with the live list (the app cannot add one: only a hand edit of auth.json does) it changes nothing.
 */
export function adminsAreOnlyTheOwner(admins: readonly string[], appOwnerId: string): boolean {
  const owner = appOwnerId.toLowerCase()
  return admins.every(id => id.toLowerCase() === owner)
}

declare const BRAND: unique symbol

/**
 * A grant to use ONE person's memory. Made by `MemoryPeople.scope()` and by nothing else, taken by `MemoryPeople.layer()` and by nothing else: a way to a
 * layer cannot be written without saying whose memory it is for (a zero-argument call does not type-check, and no object literal has the brand), and
 * the question "may this person have one?" is asked before any layer is made or started. The brand is REAL at run time too (Agent 3's read): the registry keeps
 * the scopes it granted in a private WeakSet, and `layer()` refuses any other object, a hand-made scope for the owner included. memory-doors.test.ts also forbids a
 * cast to this type outside this file.
 */
export interface MemoryScope {
  readonly [BRAND]: true
  readonly person: ChatOwner
}

export interface MemoryPeopleOptions {
  /** <state>/agent/agentic */
  dir: string
  /** The app owner: his memory is the one that has always been here. */
  appOwner: ChatOwner
  /** Builds the layer of one person at their home (index.ts gives it the options every layer shares). */
  make(person: MemoryPerson, home: MemoryHome): MemoryLayer
  /** Tests only, until the others' version exists (S9): without it, a person other than the app owner is refused. main.ts never sets it. */
  allowOthers?: boolean
  /**
   * The guard (adminsAreOnlyTheOwner): asked at every scope() and every layer(). LEFT OUT: OFF, for everybody (fail closed: a registry made without saying whether
   * the guard holds offers nothing; Agent 14's S2-5b). index.ts passes it, and memory-doors.test.ts pins that it does.
   */
  enabled?: () => boolean
}

export interface MemoryPeople {
  /**
   * THE ONLY MAKER OF A SCOPE. The app owner's, while the guard is on; and (tests only) anyone's while `allowOthers`. null: none. Never throws: an id that is
   * not a person id has none, so a chat with an odd owner id simply has no memory.
   */
  scope(owner: ChatOwner): MemoryScope | null
  /** What a door that must refuse says when scope() was null (409): why, in plain words, with a code. */
  refusal(): Error & { status: number; code: string }
  /**
   * The layer a scope grants: made when first asked for, then always the same one. (Not started: index.ts starts it.) Throws (403, code `memory-no-scope`) for an object
   * this registry never granted, and the refusal (409) for a granted scope whose person has lost the right since (the guard went off).
   */
  layer(scope: MemoryScope): MemoryLayer
  /**
   * A floor's notes changed: that person's layer, IF it has been made, looks at them at once (asking never makes one, and an id that is not a person id tells nobody and
   * never throws). Nothing comes back: the registry does the telling so that no door ever holds a layer it did not ask a scope for (Agent 14's S2-2, Agent 3's read).
   * Only the app owner's layer exists until S9, so index.ts tells only that one.
   */
  notesChanged(personId: string, floorId: string): void
  /** Closes every layer made. */
  close(): void
}

export function createMemoryPeople(o: MemoryPeopleOptions): MemoryPeople {
  const appId = memoryPersonId(o.appOwner.id)
  const layers = new Map<string, MemoryLayer>()
  // Fail closed: no `enabled` means the guard does not hold, so nobody has a scope (and nothing is made).
  const guardOn = () => (o.enabled ? o.enabled() : false)
  const refusal = (): Error & { status: number; code: string } =>
    guardOn()
      ? Object.assign(apiError(409, "A personal memory for other people is not built yet. Only the owner's memory exists."), { code: 'memory-others-not-built' })
      : Object.assign(apiError(409, "The app's memory is off while another administrator exists: an administrator can read the owner's chats, so it could not be private."), { code: 'memory-admins' })
  // The ONLY place a scope is made (nothing else in the app may write this cast), and the only record of which ones were: a hand-made object is not in it.
  const granted = new WeakSet<object>()
  const grant = (owner: ChatOwner): MemoryScope => {
    // A copy, frozen (Agent 14's residual 2): `access.ownerOf(caller)` gives the caller's own object and SBSKRRT_OWNER is shared, so a scope never holds either.
    const scope = Object.freeze({ person: Object.freeze({ ...owner }) }) as unknown as MemoryScope
    granted.add(scope)
    return scope
  }
  return {
    scope(owner) {
      let id: string
      try {
        id = memoryPersonId(owner.id)
      } catch {
        return null
      }
      if (id !== appId && !o.allowOthers) return null
      if (!guardOn()) return null
      return grant(owner)
    },
    refusal,
    layer(scope) {
      // A scope made by hand (a cast) is not one this registry granted: refused, for the owner too, and nothing is made.
      if (!granted.has(scope)) throw Object.assign(apiError(403, 'That is not a memory scope this app granted.'), { code: 'memory-no-scope' })
      const owner = scope.person
      const id = memoryPersonId(owner.id)
      // A granted scope whose person has lost the right since (the guard went off, a person who never had one) meets the refusal, and nothing is made.
      if ((id !== appId && !o.allowOthers) || !guardOn()) throw refusal()
      const have = layers.get(id)
      if (have) return have
      // The app owner's texts say what they always said, whatever his name is spelt in the CRM.
      const person: MemoryPerson = { id, name: id === appId ? OWNER_NAME : memoryPersonName(owner) }
      const layer = o.make(person, memoryHome(o.dir, id, appId))
      layers.set(id, layer)
      return layer
    },
    notesChanged(personId, floorId) {
      let id: string
      try {
        id = memoryPersonId(personId)
      } catch {
        return
      }
      layers.get(id)?.notesChanged(floorId)
    },
    close() {
      for (const layer of layers.values()) layer.close()
      layers.clear()
    },
  }
}
