import { readFileSync } from 'node:fs'
import { MAX_DECIDERS, OWNER_ROUTE, type QuestionRoute, type RoutePerson } from '../../shared/question-routing.ts'
import { apiError } from '../api.ts'
import { writeAtomic } from '../config.ts'

// Orders o0c50 / o66aa / oa76b / o7e97: where each floor's decisions go (shared/question-routing.ts). Owner-only, kept on the Server.
// The saved file holds only the floors whose decisions go to people; a floor with no entry is the owner's, the old way.
//
// Fail closed, the same shape as the Quick settings (quick-settings.ts, quick-forwarding.ts): a MISSING file is the default (every floor
// the owner's); an UNREADABLE one (any other read error, not JSON, not the expected shape) is also every floor the owner's, and says so
// (unreadable()) until a choice is saved again. A single bad entry is dropped (that floor is the owner's), the rest are kept. Whether a
// saved person still counts (their share) is not judged here: effectiveRoute does it at every use.

export interface QuestionRouting {
  /** What is saved for a floor (the owner's when nothing is). Whether it is in force is the caller's to judge (effectiveRoute). */
  route(floorId: string): QuestionRoute
  /** True while the saved file could not be read: every floor is the owner's. */
  unreadable(): boolean
  /**
   * The owner's choice for one floor: {to: 'owner'}, or {to: 'people', personIds} (one to MAX_DECIDERS, no repeats). `candidate(personId)`
   * answers the person's name when the floor's chats are shared with (or owned by) them, else null: refused, so a route never names someone
   * with no connection to the floor. A failed save changes nothing.
   */
  set(floorId: string, raw: unknown, candidate: (personId: string) => string | null): QuestionRoute
}

type Saved = { to: 'people'; people: RoutePerson[] }

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/
const isPerson = (v: unknown): v is RoutePerson =>
  !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as RoutePerson).id === 'string' && ID_RE.test((v as RoutePerson).id)
  && typeof (v as RoutePerson).name === 'string' && (v as RoutePerson).name.length > 0 && (v as RoutePerson).name.length <= 200
const isSaved = (v: unknown): v is Saved => {
  if (!v || typeof v !== 'object' || Array.isArray(v) || (v as Saved).to !== 'people') return false
  const people = (v as Saved).people
  return Array.isArray(people) && people.length > 0 && people.length <= MAX_DECIDERS && people.every(isPerson) && new Set(people.map(p => p.id)).size === people.length
}
const bad = () => apiError(400, `Expected {to: "owner"} or {to: "people", personIds: [one to ${MAX_DECIDERS} people]}`)

export function createQuestionRouting(file: string): QuestionRouting {
  let routes = new Map<string, Saved>()
  let unreadable = false
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
    const floors = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { floors?: unknown }).floors : undefined
    if (!floors || typeof floors !== 'object' || Array.isArray(floors)) unreadable = true
    else for (const [id, r] of Object.entries(floors)) if (ID_RE.test(id) && isSaved(r)) routes.set(id, { to: 'people', people: r.people.map(p => ({ id: p.id, name: p.name })) })
  } catch (e) {
    // Only "there is no such file" is the not-yet-made choice; anything else is a choice we could not read.
    if (!(e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT')) unreadable = true
  }
  if (unreadable) routes = new Map()
  const save = (next: Map<string, Saved>) => writeAtomic(file, `${JSON.stringify({ floors: Object.fromEntries(next) }, null, 2)}\n`)
  const copy = (r: Saved | undefined): QuestionRoute => (r ? { to: 'people', people: r.people.map(p => ({ ...p })) } : OWNER_ROUTE)
  return {
    route: floorId => copy(routes.get(floorId)),
    unreadable: () => unreadable,
    set(floorId, raw, candidate) {
      if (!ID_RE.test(floorId)) throw apiError(400, 'No such floor')
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad()
      const r = raw as Record<string, unknown>
      const next = new Map(routes)
      if (r.to === 'owner' && Object.keys(r).length === 1) next.delete(floorId)
      else if (r.to === 'people' && Object.keys(r).length === 2 && Array.isArray(r.personIds)) {
        const ids = r.personIds
        if (!ids.length || ids.length > MAX_DECIDERS || !ids.every(id => typeof id === 'string' && ID_RE.test(id)) || new Set(ids).size !== ids.length) throw bad()
        const people = (ids as string[]).map(id => {
          const name = candidate(id)
          if (name === null) throw apiError(400, "That person has no chat of this floor shared with them, so its decisions can't go to them")
          return { id, name: name.slice(0, 200) || id }
        })
        next.set(floorId, { to: 'people', people })
      } else throw bad()
      // A failed save throws here and nothing in memory changes (unreadable included).
      save(next)
      routes = next
      unreadable = false
      return copy(routes.get(floorId))
    },
  }
}
