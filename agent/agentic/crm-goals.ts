import { isMine, normaliseStatus, rankGoals, assigneesOf, dueDay, type Goal, type Member } from '../../shared/goals.ts'
import { mapHistory, type History } from '../../shared/goal-history.ts'
import { hasVisible } from '../../shared/invisible.ts'
import { apiError } from '../api.ts'
import { UUID } from '../claude/crm.ts'
import { createCrmCall, isObject } from './crm-call.ts'
import { createCrmScopes } from './crm-scopes.ts'
import type { CrmProxy } from './crmproxy.ts'

// The CRM's goals as tools for the chats of the app's owner (crm_whoami, crm_members, crm_goals, crm_goal_add, crm_goal_update). They
// replace the scyramp-ai-ship crm_ tools one for one where the CRM Goals page needs them, on the CRM's own routes (sam-crm-be orgRoutes:
// GET/POST /v1/org/goals, PATCH /v1/org/goals/:id, GET /v1/org/members, GET /v1/auth/me), through the CRM proxy that holds this PC's CRM
// sign-in (crmproxy.ts `request`: the session and the CSRF pair are attached there and never seen here). Who a goal is "by" is whoever is
// signed in to the CRM on this PC (the owner). The CRM's own rules stay the CRM's: its answer to a refused change is the answer given back.
//
// The goals' wire format is the CRM's (snake_case; status todo | done | abandoned; priority low | medium | high | urgent; due_date a calendar
// day). The retired statuses (in-progress, review) the old Ship tools offered are not offered; the CRM still folds them into todo if sent.

const STATUSES = ['todo', 'done', 'abandoned'] as const
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
const ID_RE = /^[0-9a-fA-F-]{8,64}$/
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const MAX_TITLE = 500
const MAX_DESCRIPTION = 5000
/** The same goal added again within this long, by this server, is the one already added (a retry, a chat repeating itself). */
const DUPLICATE_MS = 10 * 60_000
/** F-344: how far up a parent chain is walked to refuse a loop (a longer chain is refused, never guessed at). */
const NEST_DEPTH_CAP = 64

const json = (v: unknown) => JSON.stringify(v, null, 2)

export interface CrmGoalsOptions {
  proxy: Pick<CrmProxy, 'request' | 'session'>
  now?: () => number
  /** F-344: one line of ids when a goal is nested under another (never a word of a goal). */
  log?: { info(message: string): void }
}

/** F-334-1: the floor and the agent of the chat that is making the goal. The CRM keeps them on the goal (origin_floor_id, origin_agent_id) so the goals curtain can tell which floor made it, whoever reads it. */
export interface GoalOrigin {
  floorId: string
  /** null: a goal a PERSON added by hand in the curtain (F-343): no chat made it, so the CRM gets the floor only. */
  agentId: string | null
}

interface Person {
  id: string
  name: string
}

function words(v: unknown, what: string, max: number, required: boolean): string | undefined {
  if (v === undefined || v === null) {
    if (required) throw apiError(400, `${what} is missing`)
    return undefined
  }
  if (typeof v !== 'string') throw apiError(400, `${what} must be text`)
  const t = v.trim()
  // a text with nothing that draws (spaces, zero-width characters) is empty: a title of it is refused like no title (the by-hand route says the same, shared/invisible.ts)
  if (!t || !hasVisible(t)) {
    if (required) throw apiError(400, `${what} is empty`)
    return ''
  }
  if (t.length > max) throw apiError(400, `${what} is at most ${max} characters`)
  return t
}

function oneOf<T extends string>(v: unknown, list: readonly T[], what: string): T | undefined {
  if (v === undefined) return undefined
  if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) throw apiError(400, `${what} must be one of: ${list.join(', ')}`)
  return v as T
}

/** A calendar day "2026-11-12" (a real one), or "today" / "tomorrow" in the time of this PC. */
export function dayOf(v: unknown, now: number): string {
  if (typeof v !== 'string') throw apiError(400, 'dueDate must be a day like 2026-11-12, "today" or "tomorrow"')
  const s = v.trim().toLowerCase()
  const p = (n: number) => String(n).padStart(2, '0')
  if (s === 'today' || s === 'tomorrow') {
    const d = new Date(now + (s === 'tomorrow' ? 86_400_000 : 0))
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }
  const m = DAY_RE.exec(s)
  if (!m) throw apiError(400, 'dueDate must be a day like 2026-11-12, "today" or "tomorrow"')
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const real = new Date(Date.UTC(y, mo - 1, d))
  if (real.getUTCFullYear() !== y || real.getUTCMonth() !== mo - 1 || real.getUTCDate() !== d) throw apiError(400, `${s} is not a real day`)
  return s
}

const first = (s: string) => s.trim().toLowerCase()
/** Audit o322f: a name matches where one of its words STARTS ("Ravi", "Pat", "ravi pa"), never inside a word ("Ali" is not Kalindi). */
const startsAWord = (name: string, t: string) => {
  const n = first(name)
  return n.startsWith(t) || n.split(/[\s._-]+/).some(w => w.startsWith(t)) || n.includes(` ${t}`)
}

export function createCrmGoals(o: CrmGoalsOptions) {
  const now = o.now ?? Date.now
  const recent = new Map<string, { id: string; at: number }>()
  /** Audit o322f: an add still on its way, by the same key: the same call made meanwhile (a retry while the first is out) waits for it instead of adding a second goal. */
  const sending = new Map<string, Promise<Goal>>()

  /** One call to the CRM; its own words come back when it refuses, and nothing of the session ever does. */
  const crm = createCrmCall({ proxy: o.proxy, afterServerError: 'Check the goal on the Goals page before trying again.' })

  async function me(): Promise<Person> {
    const r = await crm<{ user?: { id?: string; fullName?: string; username?: string } }>('GET', 'v1/auth/me')
    if (!r.user?.id) throw apiError(502, 'The CRM did not say who is signed in')
    return { id: r.user.id, name: r.user.fullName ?? r.user.username ?? 'You' }
  }

  async function members(): Promise<Member[]> {
    const r = await crm<{ members?: Member[] }>('GET', 'v1/org/members')
    return Array.isArray(r.members) ? r.members : []
  }

  /** "me", a userId, or a name (whole, or a part that is only one person's): never a guess. */
  function person(token: unknown, who: Person, all: readonly Member[]): string {
    if (typeof token !== 'string' || !token.trim()) throw apiError(400, 'A person must be "me", a name or a userId (crm_members lists them)')
    const t = first(token)
    if (t === 'me' || t === 'myself' || t === who.id.toLowerCase()) return who.id
    const byId = all.find(m => m.userId.toLowerCase() === t)
    if (byId) return byId.userId
    // Anyone whose name or username has these words; only one is that person. More than one is not guessed at, except a whole name that is exactly these words ("Ravi" when there is a "Ravi Kumar" too).
    const part = all.filter(m => startsAWord(m.fullName, t) || startsAWord(m.username, t))
    if (part.length === 1) return part[0].userId
    const whole = part.filter(m => first(m.fullName) === t)
    if (whole.length === 1) return whole[0].userId
    if (!part.length) throw apiError(400, `Nobody in the CRM is called "${token.trim()}": crm_members lists the people`)
    throw apiError(400, `"${token.trim()}" is more than one person (${part.slice(0, 6).map(m => m.fullName).join(', ')}): say the full name or the userId`)
  }

  async function people(list: unknown, who: Person): Promise<string[]> {
    if (!Array.isArray(list) || list.length > 20) throw apiError(400, 'assignees must be a list of at most 20 people ("me", a name or a userId)')
    if (!list.length) return []
    const all = await members()
    return [...new Set(list.map(x => person(x, who, all)))]
  }

  const scopes = createCrmScopes({ crm })

  /**
   * The board a goal is put on, in the CRM's own fields (what its Goals page sends): a service is target_type "service" + target_id, a project is
   * project_id, General is target_type "organization". The board must be one the CRM lists (by id, or by a name that is exactly one board's).
   * Not asked for: null, and a new goal stays General, a changed one stays where it is.
   */
  async function boardOf(args: Record<string, unknown>, how: 'add' | 'update'): Promise<Record<string, unknown> | null> {
    if (args.targetType === undefined) {
      if (args.targetId !== undefined || args.targetName !== undefined) throw apiError(400, 'targetId and targetName need targetType (organization, service or project)')
      return null
    }
    const type = oneOf(args.targetType, ['organization', 'service', 'project'] as const, 'targetType')!
    if (type === 'organization') {
      if (args.targetId !== undefined || args.targetName !== undefined) throw apiError(400, 'organization (General) has no targetId or targetName')
      return how === 'add' ? { target_type: 'organization' } : { target_type: 'organization', target_id: null, service_pillar: null, project_id: null }
    }
    const hit = await scopes.resolve(type, { id: args.targetId, name: args.targetName })
    // Audit o322f: a move takes the goal OFF its old board too (the CRM keeps project_id, and a service's target, until they are sent), as the overlay's own category change does.
    if (type === 'service') return how === 'add' ? { target_type: 'service', target_id: hit.targetId } : { target_type: 'service', target_id: hit.targetId, project_id: null }
    return how === 'add' ? { target_type: 'organization', project_id: hit.targetId } : { target_type: 'organization', target_id: null, service_pillar: null, project_id: hit.targetId }
  }

  const named = (g: Pick<Goal, 'ownerId' | 'assigneeIds'>, all: readonly Member[]) =>
    assigneesOf(g).map(id => ({ userId: id, name: all.find(m => m.userId === id)?.fullName ?? 'Someone' }))

  /** F-344: `parentGoalId` (null or the goal it is a sub-goal of) is on every card; `subGoalCount` only where the whole list is at hand (crm_goals). */
  const card = (g: Goal, all: readonly Member[], subGoalCount?: number) => ({
    id: g.id,
    parentGoalId: typeof g.parentGoalId === 'string' && g.parentGoalId ? g.parentGoalId : null,
    ...(subGoalCount === undefined ? {} : { subGoalCount }),
    title: g.title,
    status: normaliseStatus(g.status),
    priority: g.priority,
    dueDate: dueDay(g.dueDate),
    assignees: named(g, all),
    ...(g.description ? { description: g.description.length > 300 ? `${g.description.slice(0, 300)}…` : g.description } : {}),
    page: `goals/${g.id}`,
  })

  return {
    /** Who the CRM is signed in as on this PC, from the saved sign-in and (when it is there) the CRM's own answer. */
    async whoami(): Promise<string> {
      const s = o.proxy.session()
      if (!s.signedIn) return json({ signedIn: false, note: 'The CRM is not signed in on this PC. Shubham signs in from the CRM page, or Devices; no tool can.' })
      const who = await me().catch(() => null)
      return json({ signedIn: true, name: s.name, username: s.username, userId: who?.id ?? null, signInEndsAt: s.expiresAt, note: 'Goals you add or change are by this person.' })
    },

    async members(args: Record<string, unknown>): Promise<string> {
      const q = words(args.query, 'query', 100, false)
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(Math.floor(args.limit), 200) : 50
      const all = (await members()).filter(m => !q || `${m.fullName} ${m.username}`.toLowerCase().includes(q.toLowerCase()))
      return json({ count: all.length, members: all.slice(0, limit).map(m => ({ userId: m.userId, name: m.fullName, username: m.username })) })
    },

    /** The organisation's goals the signed-in person may see, open ones by default, ranked as the Goals page ranks them. */
    async list(args: Record<string, unknown>): Promise<string> {
      const status = oneOf(args.status, ['open', 'todo', 'done', 'abandoned', 'all'] as const, 'status') ?? 'open'
      const q = words(args.query, 'query', 200, false)
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(Math.floor(args.limit), 100) : 30
      const [raw, all, who] = await Promise.all([crm<Goal[] | { goals?: Goal[] }>('GET', 'v1/org/goals'), members(), me()])
      let rows = (Array.isArray(raw) ? raw : (raw.goals ?? [])).filter(g => !g.isDisabled)
      let assignee: string | null = null
      if (args.assignee !== undefined) assignee = person(args.assignee, who, all)
      const total = rows.length
      // F-344: how many sub-goals each goal has (every goal the CRM lists and has switched on), and the optional `parentGoalId`: only that goal's children (walk the tree one level at a time)
      const subs = new Map<string, number>()
      for (const g of rows) if (typeof g.parentGoalId === 'string' && g.parentGoalId) subs.set(g.parentGoalId, (subs.get(g.parentGoalId) ?? 0) + 1)
      let under: string | null = null
      if (args.parentGoalId !== undefined) {
        if (typeof args.parentGoalId !== 'string' || !ID_RE.test(args.parentGoalId.trim())) throw apiError(400, 'parentGoalId must be a goal id from crm_goals')
        under = args.parentGoalId.trim()
      }
      rows = rows.filter(g => {
        if (under !== null && g.parentGoalId !== under) return false
        const s = normaliseStatus(g.status)
        if (status === 'open' || status === 'todo' ? s !== 'todo' : status !== 'all' && s !== status) return false
        if (assignee && !assigneesOf(g).includes(assignee)) return false
        if (q && !`${g.title} ${g.description ?? ''}`.toLowerCase().includes(q.toLowerCase())) return false
        return true
      })
      const ranked = rankGoals(rows)
      return json({
        you: { userId: who.id, name: who.name },
        matching: ranked.length,
        ofGoals: total,
        mine: ranked.filter(g => isMine(g, who.id)).length,
        goals: ranked.slice(0, limit).map(g => card(g, all, subs.get(g.id) ?? 0)),
        ...(ranked.length > limit ? { note: `Only the first ${limit} are shown; narrow it with query, status or assignee.` } : {}),
      })
    },

    /** A new goal, an organisation goal ("General" on the Goals page), assigned to the signed-in person unless told otherwise. */
    async add(args: Record<string, unknown>, origin: GoalOrigin | null = null, expect: { userId: string } | null = null): Promise<string> {
      const title = words(args.title, 'title', MAX_TITLE, true)!
      const description = words(args.description, 'description', MAX_DESCRIPTION, false)
      const priority = oneOf(args.priority, PRIORITIES, 'priority') ?? 'medium'
      const status = oneOf(args.status, STATUSES, 'status') ?? 'todo'
      const due = args.dueDate === undefined || args.dueDate === null || (typeof args.dueDate === 'string' && !args.dueDate.trim()) ? null : dayOf(args.dueDate, now())
      let parent: string | undefined
      if (args.parentGoalId !== undefined) {
        if (typeof args.parentGoalId !== 'string' || !ID_RE.test(args.parentGoalId)) throw apiError(400, 'parentGoalId must be a goal id from crm_goals')
        parent = args.parentGoalId
      }
      const who = await me()
      // F-343 (Agent 14's read): a goal a PERSON adds by hand is made as the person the CRM login on this PC belongs to; F-342 keeps another person's good login, so it is only made when that is who the caller expects (the first owner). Nothing is written otherwise.
      if (expect !== null && who.id.toLowerCase() !== expect.userId.toLowerCase()) throw Object.assign(apiError(409, 'The CRM on this PC is signed in as someone else.'), { code: 'crm-other-person' })
      const assignees = args.assignees === undefined ? [who.id] : await people(args.assignees, who)
      const board = await boardOf(args, 'add')
      // The same goal sent twice in minutes is the one that is there: no second goal in the company's CRM for a retry.
      const key = JSON.stringify([who.id, title.toLowerCase(), assignees, due, parent ?? null, board])
      const t = now()
      for (const [k, v] of recent) if (t - v.at > DUPLICATE_MS) recent.delete(k)
      const same = recent.get(key)
      if (same) return json({ id: same.id, note: 'That goal was added a moment ago: it is the one on the Goals page.', page: `goals/${same.id}` })
      const going = sending.get(key)
      if (going) {
        const first = await going
        return json({ id: first.id, note: 'That goal was added a moment ago: it is the one on the Goals page.', page: `goals/${first.id}` })
      }
      const body = {
        title,
        ...(description ? { description } : {}),
        status,
        priority,
        due_date: due,
        assignee_ids: assignees,
        ...(board ?? { target_type: 'organization' }),
        ...(parent ? { parent_goal_id: parent } : {}),
      }
      // F-334-1: the floor and the agent that made it go to the CRM with the goal (UUIDs only). A backend that does not know the two fields either ignores them or refuses them (400): the goal is then sent ONCE more without
      // them, and only the app's own link (goal-floors) says which floor made it. Nothing here ever edits a goal that already exists.
      const originFields = origin !== null && UUID.test(origin.floorId) && (origin.agentId === null || UUID.test(origin.agentId)) ? { origin_floor_id: origin.floorId.toLowerCase(), ...(origin.agentId !== null ? { origin_agent_id: origin.agentId.toLowerCase() } : {}) } : null
      const post = (async () => {
        let got: Goal
        try {
          got = await crm<Goal>('POST', 'v1/org/goals', originFields ? { ...body, ...originFields } : body)
        } catch (e) {
          if (!(originFields && isObject(e) && e.status === 400)) throw e
          got = await crm<Goal>('POST', 'v1/org/goals', body)
        }
        if (!got || typeof got.id !== 'string') throw apiError(502, 'The CRM answered without the goal. Check the Goals page before adding it again.')
        recent.set(key, { id: got.id, at: t })
        return got
      })()
      sending.set(key, post)
      let made: Goal
      try {
        made = await post
      } finally {
        sending.delete(key)
      }
      const all = await members().catch(() => [] as Member[])
      return json({ added: made.id, goal: card({ ...made, assigneeIds: made.assigneeIds ?? assignees, dueDate: made.dueDate ?? due }, all), by: who.name })
    },

    /** Changes one goal: only what is sent changes. `abandoned` takes a goal off the board and keeps it; nothing here deletes a goal. */
    async update(args: Record<string, unknown>, expect: { userId: string } | null = null): Promise<string> {
      const id = typeof args.id === 'string' ? args.id.trim() : ''
      if (!ID_RE.test(id)) throw apiError(400, 'id is missing or not a goal id: crm_goals gives it')
      const body: Record<string, unknown> = {}
      const title = words(args.title, 'title', MAX_TITLE, false)
      if (title !== undefined) {
        if (!title) throw apiError(400, 'title cannot be empty')
        body.title = title
      }
      if (args.description !== undefined) body.description = words(args.description, 'description', MAX_DESCRIPTION, false) || null
      const status = oneOf(args.status, STATUSES, 'status')
      if (status) body.status = status
      const priority = oneOf(args.priority, PRIORITIES, 'priority')
      if (priority) body.priority = priority
      if (args.dueDate !== undefined) body.due_date = args.dueDate === null || (typeof args.dueDate === 'string' && !args.dueDate.trim()) ? null : dayOf(args.dueDate, now())
      if (args.assignees !== undefined) body.assignee_ids = await people(args.assignees, await me())
      // F-344: nest an EXISTING goal under another (or null / empty: out to the top). Only the owner's chats reach this tool (ADMIN_TOOLS). Refused, in fixed sentences and before anything is sent: a goal under itself, under one of its
      // own sub-goals (the parent chain is walked from the CRM's own list, depth-capped) and a parent the CRM does not list. Nothing but parent_goal_id changes; the goal's floor (link file, origin) is not touched.
      let nested: { under: string | null } | null = null
      if (args.parentGoalId !== undefined) {
        if (args.parentGoalId === null || (typeof args.parentGoalId === 'string' && !args.parentGoalId.trim())) {
          body.parent_goal_id = null
          nested = { under: null }
        } else {
          if (typeof args.parentGoalId !== 'string' || !ID_RE.test(args.parentGoalId.trim())) throw apiError(400, 'parentGoalId must be a goal id from crm_goals, or null to take the goal out of its parent')
          const parent = args.parentGoalId.trim()
          if (parent.toLowerCase() === id.toLowerCase()) throw apiError(400, 'A goal cannot be put under itself.')
          const listed = await crm<Goal[] | { goals?: Goal[] }>('GET', 'v1/org/goals')
          const byId = new Map((Array.isArray(listed) ? listed : (listed.goals ?? [])).filter(g => !g.isDisabled).map(g => [g.id.toLowerCase(), g] as const))
          if (!byId.has(parent.toLowerCase())) throw apiError(404, 'There is no such goal to put it under: crm_goals gives the ids.')
          // walk up from the new parent: if the goal itself is on the way, the new parent is one of its own sub-goals
          let up: Goal | undefined = byId.get(parent.toLowerCase())
          for (let depth = 0; up; depth++) {
            if (depth > NEST_DEPTH_CAP) throw apiError(400, 'The goals are nested too deep to check that safely.')
            if (up.id.toLowerCase() === id.toLowerCase()) throw apiError(400, 'That would put the goal under one of its own sub-goals.')
            up = typeof up.parentGoalId === 'string' && up.parentGoalId ? byId.get(up.parentGoalId.toLowerCase()) : undefined
          }
          body.parent_goal_id = parent
          nested = { under: parent }
        }
      }
      const board = await boardOf(args, 'update')
      if (board) Object.assign(body, board)
      if (!Object.keys(body).length) throw apiError(400, 'Nothing to change: send at least one of title, description, status, priority, dueDate, assignees, parentGoalId, targetType')
      // F-344b: a goal a PERSON changes by hand is changed as the person the CRM login on this PC belongs to (the same check as adding by hand): only when that is who the caller expects (the first owner). Nothing is sent otherwise.
      if (expect !== null && (await me()).id.toLowerCase() !== expect.userId.toLowerCase()) throw Object.assign(apiError(409, 'The CRM on this PC is signed in as someone else.'), { code: 'crm-other-person' })
      const got = await crm<Goal>('PATCH', `v1/org/goals/${id}`, body)
      if (nested) o.log?.info(`goal nested: ${id.slice(0, 64)} ${nested.under === null ? 'taken out of its parent' : `under ${nested.under.slice(0, 64)}`}`)
      const all = await members().catch(() => [] as Member[])
      return json({ updated: id, goal: card(got, all) })
    },

    /** F-344b / F-346: what happened to ONE goal, from the CRM's own trail (a login check, then one GET; nothing written); the answer is shared/goal-history.ts mapHistory (plain sentences, cleaned and capped, at most 100). */
    async history(goalId: string, expect: { userId: string } | null = null): Promise<History> {
      if (typeof goalId !== 'string' || !ID_RE.test(goalId)) throw apiError(400, 'id is not a goal id')
      // Agent 14's read: the trail is read with the PC's CRM login, which may be another person's (F-342 keeps a good login): the owner's page reads it only while that login is the owner's own
      if (expect !== null && (await me()).id.toLowerCase() !== expect.userId.toLowerCase()) throw Object.assign(apiError(409, 'The CRM on this PC is signed in as someone else.'), { code: 'crm-other-person' })
      return mapHistory(await crm<unknown>('GET', `v1/org/goals/${goalId}/activity`))
    },
  }
}

export type CrmGoals = ReturnType<typeof createCrmGoals>
