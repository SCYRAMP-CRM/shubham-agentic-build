// Order o0c50 (Shubham, 16 Nov 2026, relayed by the Assistant): "I want questions only pertaining to the Agentic Platform floor, not
// for 1cal. 1cal questions only for Ravi Teja's Assistant, and create [a view] through which we can see it."
// Order o66aa: "I don't want it. Give a right-click option on every floor for who has to take the decision for each floor, ok, and we
// will assign a user for it." Orders oa76b / o7e97, his answers: "1A. 2 No, that question doesn't come back to me. And I can give option
// for questions and approvals to be answered by multiple people who have their floor shared; only who have a floor shared can do that."
//
// - A floor's decisions go to one or more people he picks ("Decisions go to…" on the floor's menu), only from the people the floor's chats
//   are shared with (or owned by): routing never invents access for someone with no connection to the floor.
// - Everything waiting on that floor goes to them: its questions AND its command approvals, answered as the chat's owner would answer them,
//   in that floor's unshared chats too (his "1A", chosen after the consequence was put to him twice). The first answer wins.
// - Nothing of that floor is PUSHED to him any more: no card or badge in his overlay, no heartbeat line, nothing in Quick's snapshot, and no
//   return after any time (his "2 No"). It never becomes invisible: he keeps every right, sees them when he looks (a routed floor, or all),
//   and may answer them himself.
// - Fail closed, never to nobody and never open: a chosen person counts only while they still have a share on the floor, checked at every use
//   (listing, and again at the answer); with nobody left, or nobody chosen, the floor's decisions are his, today's way.

export interface RoutePerson {
  id: string
  name: string
}

/** Where a floor's decisions go. No setting for a floor is the old way: the owner. */
export type QuestionRoute = { to: 'owner' } | { to: 'people'; people: RoutePerson[] }

export const OWNER_ROUTE: Readonly<QuestionRoute> = Object.freeze({ to: 'owner' })

/** At most this many decision-makers for one floor. */
export const MAX_DECIDERS = 8

/** A floor as GET /agentic/question-routing describes it. */
export interface QuestionRoutingFloor {
  floorId: string
  floorName: string
  /** What is saved for it. */
  route: QuestionRoute
  /** What is in force: the chosen people who still have a share on the floor; nobody left, the owner (fail closed). */
  effective: QuestionRoute
  /** False for a floor whose decisions stay his whatever is chosen: PC control, or one holding a person's Assistant or the Orchestrator. */
  routable: boolean
  /** The people its chats are shared with or owned by (who may be chosen). */
  candidates: RoutePerson[]
}

/** GET /agentic/question-routing (owner only). */
export interface QuestionRoutingAnswer {
  floors: QuestionRoutingFloor[]
  /** Floors whose decisions go to someone else now (his badge and cards leave them out). */
  routedFloorIds: string[]
  /** The saved routing could not be read: every floor is the owner's until a choice is saved again. */
  unreadable?: true
}

/** PUT /agentic/question-routing/<floorId>: the owner's again, or one to MAX_DECIDERS of the floor's candidates. */
export type QuestionRouteRequest = { to: 'owner' } | { to: 'people'; personIds: string[] }

/** Which waiting prompts GET /agentic/approvals lists for the owner: his own, every floor, or one floor. A decision-maker gets theirs only. */
export type ApprovalsScope = 'mine' | 'all' | `floor:${string}`

export function parseApprovalsScope(raw: string | null): ApprovalsScope | null {
  if (raw === null || raw === '' || raw === 'mine') return 'mine'
  if (raw === 'all') return 'all'
  return /^floor:[A-Za-z0-9_-]{1,80}$/.test(raw) ? (raw as ApprovalsScope) : null
}

/** A routed floor's questions as the owner's view counts them when he looks, without listing them. */
export interface RoutedElsewhere {
  floorId: string
  floorName: string
  /** Whom they go to ("Ravi Teja, Priya"). */
  to: string
  count: number
}

/** A chat waiting at a question, as the hub sees it. */
export interface WaitingQuestion {
  sessionId: string
  floorId: string
  floorName: string
  agentId: string
  agentName: string
}

/** What a floor needs to be judged: its chats' owners and shares (shared/agentic.ts FloorAgent). */
export interface RoutableFloor {
  id: string
  name: string
  agents: { owner?: { id: string; name?: string } | null; sharedWith?: { id: string; name: string }[] }[]
}

/** The people a floor's decisions can go to: whoever its chats are shared with or owned by, the owner left out (he is the default). */
export function candidatesOf(floor: RoutableFloor, ownerId: string | null): RoutePerson[] {
  const seen = new Map<string, string>()
  for (const a of floor.agents) {
    for (const s of a.sharedWith ?? []) if (s.id && s.id !== ownerId && !seen.has(s.id)) seen.set(s.id, s.name || s.id)
    if (a.owner?.id && a.owner.id !== ownerId && !seen.has(a.owner.id)) seen.set(a.owner.id, a.owner.name || a.owner.id)
  }
  return [...seen].map(([id, name]) => ({ id, name })).sort((x, y) => x.name.localeCompare(y.name))
}

/** Fail closed: the chosen people who still have a share on (or a chat of) the floor; nobody left, or no floor, the owner's. */
export function effectiveRoute(route: QuestionRoute, floor: RoutableFloor | null): QuestionRoute {
  if (route.to !== 'people' || !floor) return OWNER_ROUTE
  const still = route.people.filter(p => floor.agents.some(a => a.owner?.id === p.id || (a.sharedWith ?? []).some(s => s.id === p.id)))
  return still.length ? { to: 'people', people: still } : OWNER_ROUTE
}

/** Whether this person is one of the decision-makers a route (in force) names. */
export const decidesOn = (route: QuestionRoute, personId: string): boolean => route.to === 'people' && route.people.some(p => p.id === personId)

/** The people of a route as words ("Ravi Teja, Priya"); the owner's: ''. */
export const routeNames = (route: QuestionRoute): string => (route.to === 'people' ? route.people.map(p => p.name).join(', ') : '')

/**
 * The owner's share of the waiting questions: everything whose route in force is his (no route, a route no longer in force, or a chat whose
 * prompts stay his whatever its floor's route: `routeOf` says). The others are never his to be pushed (no return after any time); they are
 * counted per floor for when he looks.
 */
export function splitQuestions(waiting: WaitingQuestion[], routeOf: (q: WaitingQuestion) => QuestionRoute): { mine: WaitingQuestion[]; elsewhere: RoutedElsewhere[] } {
  const mine: WaitingQuestion[] = []
  const away = new Map<string, RoutedElsewhere>()
  for (const q of waiting) {
    const route = routeOf(q)
    if (route.to !== 'people') {
      mine.push(q)
      continue
    }
    const e = away.get(q.floorId) ?? { floorId: q.floorId, floorName: q.floorName, to: routeNames(route), count: 0 }
    e.count++
    away.set(q.floorId, e)
  }
  return { mine, elsewhere: [...away.values()] }
}
