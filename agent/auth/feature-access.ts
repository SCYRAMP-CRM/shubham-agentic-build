import { appendFileSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  FEATURES,
  OWNER_ONLY,
  choiceOpens,
  cleanChoice,
  featureOf,
  openTo,
  routeRule,
  type AccessChange,
  type AccessChoice,
  type AccessPerson,
  type AccessView,
} from '../../shared/access.ts'
import type { AuthUser } from '../../shared/auth.ts'
import { writeAtomic } from '../config.ts'
import type { Logger } from '../log.ts'
import { authError, type Caller } from './types.ts'

// Order o9465: Settings › Access, the agent's side (shared/access.ts has the list of features and their routes). ONE check for every route and
// WebSocket, called from agent/api.ts gate() right after its sign-in step (order oc186), and by the agentic mount's owner rule for a feature's own
// routes. The owner (and the PC's own programs) have everything; a signed-in person has only what is open to them; nobody signed in never gets here.
//  - access.json: each feature's choice (missing = "Only me"). access-log.jsonl: every change, who and when, one line each (never rewritten).

export interface FeatureAccessOptions {
  /** The folder that holds access.json and access-log.jsonl (the auth folder). */
  dir: string
  isAdmin(c: Caller): boolean
  /** The CRM's members as last read (for the names of the people chosen). */
  directory(): AuthUser[]
  /** Whether this person has an agent or a floor that is theirs or shared with them (the agentic mount knows; set once it is up). */
  shares?: (c: Caller) => boolean
  now?: () => number
  log?: Logger
}

export interface FeatureAccess {
  /** Whether a feature is open to this caller (the owner: every one). */
  allows(c: Caller, feature: string): boolean
  /**
   * Whether this route is open to this caller: the owner always; a signed-in person when the route's feature is open to them (or, for an Agents
   * route, when something is shared with them); false for a route that is no feature's. Callers with no person (the open app, the PC's programs)
   * are decided elsewhere (the sign-in step), so they pass here.
   */
  opensRoute(c: Caller, method: string, path: string): boolean
  /** The features this caller's page shows; null = every one (the owner). */
  features(c: Caller): string[] | null
  /** The tab's data (the owner's only). */
  view(c: Caller): AccessView
  /** Sets one feature's choice (the owner's only; never a locked one); the change goes to the log. */
  set(c: Caller, body: unknown): AccessView
  /** The agentic mount says who has shares. */
  useShares(fn: (c: Caller) => boolean): void
}

const LOG_KEEP = 300
const LOG_MAX_BYTES = 4 * 1024 * 1024

export function createFeatureAccess(o: FeatureAccessOptions): FeatureAccess {
  const file = path.join(o.dir, 'access.json')
  const logFile = path.join(o.dir, 'access-log.jsonl')
  const now = o.now ?? Date.now
  let shares = o.shares ?? (() => false)
  let choices: Record<string, AccessChoice> = load()

  function load(): Record<string, AccessChoice> {
    try {
      const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
      const out: Record<string, AccessChoice> = {}
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [k, v] of Object.entries((raw as { choices?: unknown }).choices ?? {})) {
          const f = featureOf(k)
          const c = cleanChoice(v)
          // A feature that is locked (or no longer exists) is never open, whatever the file says.
          if (f && !f.locked && c) out[k] = c
        }
      }
      return out
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') o.log?.warn(`access.json could not be read, so everything is the owner's only: ${e instanceof Error ? e.message : String(e)}`)
      return {}
    }
  }

  const choiceOf = (key: string): AccessChoice => choices[key] ?? OWNER_ONLY

  function allows(c: Caller, feature: string): boolean {
    if (!c.person || o.isAdmin(c)) return true
    const f = featureOf(feature)
    if (!f || f.locked) return false
    if (!choiceOpens(choiceOf(f.key), c.person.id)) return false
    // A PC control tab needs the PC control page open too.
    return !f.needs || allows(c, f.needs)
  }

  function opensRoute(c: Caller, method: string, routePath: string): boolean {
    if (!c.person || o.isAdmin(c)) return true
    const rule = routeRule(method, routePath)
    if (!rule) return false
    return rule.features.some(f => allows(c, f)) || (rule.share === true && shares(c))
  }

  function features(c: Caller): string[] | null {
    if (!c.person || o.isAdmin(c)) return null
    const open = openTo(choices, c.person.id).filter(k => allows(c, k))
    // Order o929e: something shared with them keeps the Agents page.
    if (!open.includes('agents') && shares(c)) open.push('agents')
    return open
  }

  function needOwner(c: Caller) {
    if (!c.person || !o.isAdmin(c)) throw authError(403, 'Only the owner of this app sets who gets what.', 'admin-only')
  }

  function readLog(): AccessChange[] {
    let text = ''
    try {
      text = readFileSync(logFile, 'utf8')
    } catch {
      return []
    }
    const out: AccessChange[] = []
    for (const line of text.split('\n').slice(-LOG_KEEP)) {
      if (!line.trim()) continue
      try {
        out.push(JSON.parse(line) as AccessChange)
      } catch {
        // A half-written last line (a crash while writing): left out.
      }
    }
    return out.reverse()
  }

  function view(c: Caller): AccessView {
    needOwner(c)
    const known = new Map(o.directory().map(u => [u.id.toLowerCase(), u]))
    const ids = new Set(Object.values(choices).flatMap(ch => ch.people))
    const people: AccessPerson[] = [...ids].map(id => {
      const u = known.get(id)
      return { id, name: u?.name || u?.username || 'Someone no longer in the CRM list', username: u?.username ?? null }
    })
    return { choices: { ...choices }, people, log: readLog() }
  }

  function set(c: Caller, body: unknown): AccessView {
    needOwner(c)
    const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
    const f = typeof b.feature === 'string' ? featureOf(b.feature) : undefined
    if (!f) throw authError(400, 'There is no such feature.', 'not-allowed')
    if (f.locked) throw authError(400, `${f.label} stays yours: ${f.locked}`, 'not-allowed')
    const to = cleanChoice(b.choice)
    if (!to) throw authError(400, 'Choose Only me, Chosen people (CRM members) or Everyone signed in.', 'not-allowed')
    const from = choiceOf(f.key)
    const next = { ...choices }
    if (to.mode === 'owner') delete next[f.key]
    else next[f.key] = to
    writeAtomic(file, `${JSON.stringify({ version: 1, choices: next }, null, 2)}\n`, 0o600)
    choices = next
    const change: AccessChange = { at: new Date(now()).toISOString(), by: { id: c.person!.id, name: c.person!.name || c.person!.username }, feature: f.key, from, to }
    try {
      mkdirSync(o.dir, { recursive: true })
      // A log grown past its size starts again beside the old one (kept as access-log.old.jsonl).
      try {
        if (statSync(logFile).size > LOG_MAX_BYTES) {
          writeAtomic(path.join(o.dir, 'access-log.old.jsonl'), readFileSync(logFile, 'utf8'))
          writeAtomic(logFile, '')
        }
      } catch {
        // No log yet.
      }
      appendFileSync(logFile, `${JSON.stringify(change)}\n`, { mode: 0o600 })
    } catch (e) {
      o.log?.warn(`the access change could not be logged: ${e instanceof Error ? e.message : String(e)}`)
    }
    o.log?.info(`access: ${f.key} ${from.mode} -> ${to.mode}${to.mode === 'people' ? ` (${to.people.length} people)` : ''} by ${change.by.name}`)
    return view(c)
  }

  return {
    allows,
    opensRoute,
    features,
    view,
    set,
    useShares(fn) {
      shares = fn
    },
  }
}

/** Every feature key (tests, and the tab's order). */
export const FEATURE_KEYS = FEATURES.map(f => f.key)
