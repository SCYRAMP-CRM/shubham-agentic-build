import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  FEATURES,
  OWNER_ONLY,
  choiceKey,
  choiceOpens,
  cleanChoice,
  featureOf,
  isPcId,
  openTo,
  perPcKey,
  routeRule,
  type AccessChange,
  type AccessChoice,
  type AccessPerson,
  type AccessView,
} from '../../shared/access.ts'
import type { AuthUser } from '../../shared/auth.ts'
import { writeAtomic } from '../config.ts'
import type { Logger } from '../log.ts'
import { appendAccessLog } from './access-log.ts'
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
  /**
   * Whether a feature is open to this caller (the owner: every one). Order o68f0: a feature chosen per PC ('pc-ssh') is open on that PC when `pcId`
   * is given (or the key is '<feature>@<pcId>'), and without it when it is open on at least one PC (what the gate and the menu need).
   */
  allows(c: Caller, feature: string, pcId?: string): boolean
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
  /**
   * F-300 S0 (Agent 14's F1): `fn` is called after every saved change of a choice (set, and the system's seed), when the new choice already stands. The agentic mount judges its open sockets again by it, so closing 'assistant' ends a
   * person's open terminal and chat stream at once, not at the next floors event. A listener that throws is logged and never undoes the change or stops the others.
   */
  onChange(fn: () => void): void
  /**
   * A one-time change made by the SYSTEM and not by a person (F-297, his order od8e2: "yes let ravis be on since start"): sets `feature` to `choice` ONLY when it has no choice yet, writes it, and logs it as a change by `by`
   * (so the owner's history in Settings > Access says who made it and why). It never overwrites a choice: 'exists' when one is there, 'refused' for a feature that is locked, per PC or unknown, or a choice that is
   * "Only me" or is not one. Nothing about it is the owner's: he changes or removes it like any other choice, with one tap.
   */
  seed(feature: string, choice: unknown, by: { id: string; name: string }): 'seeded' | 'exists' | 'refused'
}

const LOG_KEEP = 300

/** A line of the log that is a change of a feature's choice (what Settings › Access shows), not one of the owners file's. */
const isChange = (v: unknown): v is AccessChange => {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return typeof r.feature === 'string' && !!r.from && typeof r.from === 'object' && !!r.to && typeof r.to === 'object' && typeof r.at === 'string' && !!r.by && typeof r.by === 'object'
}

export function createFeatureAccess(o: FeatureAccessOptions): FeatureAccess {
  const file = path.join(o.dir, 'access.json')
  const logFile = path.join(o.dir, 'access-log.jsonl')
  const now = o.now ?? Date.now
  let shares = o.shares ?? (() => false)
  let choices: Record<string, AccessChoice> = load()
  const listeners: Array<() => void> = []
  /** Everyone who asked to be told: called once the choice is saved and in force. */
  const changed = () => {
    for (const fn of listeners) {
      try {
        fn()
      } catch (e) {
        o.log?.warn(`an access change listener failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  function load(): Record<string, AccessChoice> {
    try {
      const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
      const out: Record<string, AccessChoice> = {}
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [k, v] of Object.entries((raw as { choices?: unknown }).choices ?? {})) {
          // Order o68f0: a per-PC feature's choices are '<key>@<pcId>' (choiceKey reads both kinds).
          const ck = choiceKey(k)
          const c = cleanChoice(v)
          // A feature that is locked (or no longer exists) is never open, whatever the file says.
          if (ck && !ck.feature.locked && c) out[k] = c
        }
      }
      return out
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') o.log?.warn(`access.json could not be read, so everything is the owner's only: ${e instanceof Error ? e.message : String(e)}`)
      return {}
    }
  }

  const choiceOf = (key: string): AccessChoice => choices[key] ?? OWNER_ONLY

  function allows(c: Caller, feature: string, pcId?: string): boolean {
    if (!c.person || o.isAdmin(c)) return true
    const at = feature.indexOf('@')
    if (at >= 0) return pcId === undefined && allows(c, feature.slice(0, at), feature.slice(at + 1))
    const f = featureOf(feature)
    if (!f || f.locked) return false
    const person = c.person.id
    if (f.perPc) {
      // Order o68f0: that PC's own choice; with no PC named, open on at least one.
      const open =
        pcId !== undefined
          ? isPcId(pcId) && choiceOpens(choiceOf(perPcKey(f.key, pcId)), person)
          : Object.entries(choices).some(([k, ch]) => choiceKey(k)?.feature === f && choiceOpens(ch, person))
      if (!open) return false
    } else if (pcId !== undefined || !choiceOpens(choiceOf(f.key), person)) return false
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
    // Newest first: from the end, the lines that are changes of a choice, until LOG_KEEP of them. The owners file writes its own lines into this log (agent/auth/owners.ts): they say who is an owner, not what a
    // feature's choice was, and the page's history line reads a feature and two choices. They are left out BEFORE the count, so a flapping owners file cannot push real changes out of the window.
    const out: AccessChange[] = []
    const lines = text.split('\n')
    for (let i = lines.length - 1; i >= 0 && out.length < LOG_KEEP; i--) {
      const line = lines[i]!
      if (!line.trim()) continue
      try {
        const row: unknown = JSON.parse(line)
        if (isChange(row)) out.push(row)
      } catch {
        // A half-written last line (a crash while writing): left out.
      }
    }
    return out
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
    // Order o68f0: a feature chosen per PC takes the PC ({feature, pcId, choice}); any other takes none.
    let key = f.key
    if (f.perPc) {
      if (!isPcId(b.pcId)) throw authError(400, `${f.label} is chosen for each PC: say which PC.`, 'not-allowed')
      key = perPcKey(f.key, b.pcId)
    } else if (b.pcId !== undefined) throw authError(400, `${f.label} is not chosen per PC.`, 'not-allowed')
    const to = cleanChoice(b.choice)
    if (!to) throw authError(400, 'Choose Only me, Chosen people (CRM members) or Everyone signed in.', 'not-allowed')
    const from = choiceOf(key)
    const next = { ...choices }
    if (to.mode === 'owner') delete next[key]
    else next[key] = to
    writeAtomic(file, `${JSON.stringify({ version: 1, choices: next }, null, 2)}\n`, 0o600)
    choices = next
    const change: AccessChange = { at: new Date(now()).toISOString(), by: { id: c.person!.id, name: c.person!.name || c.person!.username }, feature: f.key, ...(f.perPc ? { pcId: b.pcId as string } : {}), from, to }
    logChange(change)
    o.log?.info(`access: ${key} ${from.mode} -> ${to.mode}${to.mode === 'people' ? ` (${to.people.length} people)` : ''} by ${change.by.name}`)
    changed()
    return view(c)
  }

  /** One change into access-log.jsonl (a log grown past its size starts again beside the old one). A failure to log is said, never thrown: the change itself already stands. */
  function logChange(change: AccessChange) {
    appendAccessLog(o.dir, change, message => o.log?.warn(message))
  }

  function seed(feature: string, choice: unknown, by: { id: string; name: string }): 'seeded' | 'exists' | 'refused' {
    const f = featureOf(feature)
    const to = cleanChoice(choice)
    if (!f || f.locked || f.perPc || !to || to.mode === 'owner') return 'refused'
    if (choices[f.key]) return 'exists'
    const next = { ...choices, [f.key]: to }
    writeAtomic(file, `${JSON.stringify({ version: 1, choices: next }, null, 2)}\n`, 0o600)
    choices = next
    logChange({ at: new Date(now()).toISOString(), by, feature: f.key, from: OWNER_ONLY, to })
    o.log?.info(`access: ${f.key} ${OWNER_ONLY.mode} -> ${to.mode}${to.mode === 'people' ? ` (${to.people.length} people)` : ''} by ${by.name}`)
    changed()
    return 'seeded'
  }

  return {
    allows,
    opensRoute,
    features,
    view,
    set,
    seed,
    useShares(fn) {
      shares = fn
    },
    onChange(fn) {
      listeners.push(fn)
    },
  }
}

/** Every feature key (tests, and the tab's order). */
export const FEATURE_KEYS = FEATURES.map(f => f.key)
