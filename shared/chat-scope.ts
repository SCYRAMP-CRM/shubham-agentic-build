import { pageFeature } from './access.ts'
import { AGENT_DIRECTORY_ROUTE } from './agent-directory.ts'
import { AGENTS_AKASH_ROUTE, AGENTS_NEW_ROUTE, MEMORY_AKASH_ROUTE, MEMORY_ROUTE, PLATFORM_AKASH_ROUTE, PLATFORM_SHUBHAM_ROUTE } from './blank-pages.ts'
import { isFirstOwner, type AuthPerson, type ChatAccess, type ChatCan, type ChatOwner } from './auth.ts'
import { LIVE_CLASSIC_ROUTE, OLD_LEGACY_ROUTE, OLD_ROUTE } from './old-route.ts'
import { QUICK_ROUTE } from './quick-page.ts'

// F-118: the three tabs of the chat lists (My chats, Shared chats, All chats) and the filter by owner. The agent already sends each connection only the chats it
// may see (shared/auth.ts scopeFloors); this narrows THAT to the tab the person picked, so it never widens anything. Pure, tested.

export type ScopeTab = 'mine' | 'shared' | 'all'

export interface ScopeChoice {
  tab: ScopeTab
  /** Only the chats of this username (the owner filter); null: everyone's. */
  owner: string | null
}

interface ScopedAgent {
  id: string
  owner?: ChatOwner | null
  access?: ChatAccess
  can?: ChatCan
}
interface ScopedFloor<A extends ScopedAgent> {
  id: string
  agents: A[]
}

export const TAB_WORDS: Record<ScopeTab, { label: string; empty: string }> = {
  mine: { label: 'My chats', empty: 'You have not started a chat yet.' },
  shared: { label: 'Shared chats', empty: 'Nobody has shared a chat with you yet.' },
  all: { label: 'All chats', empty: 'There is no chat yet.' },
}

/** The tabs this person gets: none when the app is open as before (nobody has to sign in), else My and Shared, and All for the one who sees everything. */
export function tabsFor(person: Pick<AuthPerson, 'canSeeAll'> | null): ScopeTab[] {
  if (!person) return []
  return person.canSeeAll ? ['mine', 'shared', 'all'] : ['mine', 'shared']
}

/** A remembered tab this person may not use (All, for anyone else) becomes My chats. */
export function normalizeTab(tab: string | null | undefined, person: Pick<AuthPerson, 'canSeeAll'> | null): ScopeTab {
  const allowed = tabsFor(person)
  return allowed.find(t => t === tab) ?? allowed[0] ?? 'mine'
}

const inTab = (a: ScopedAgent, tab: ScopeTab) => (tab === 'all' ? true : a.access === tab)

/**
 * The floors for a tab and an owner filter: only the chats that belong there, and a floor with none left is dropped (a floor with nothing to show is hidden).
 * With nobody signed in (the open app) nothing is narrowed: every chat is shown, as before.
 */
export function filterFloors<A extends ScopedAgent, F extends ScopedFloor<A>>(floors: readonly F[], choice: ScopeChoice, person: Pick<AuthPerson, 'canSeeAll'> | null): F[] {
  if (!person) return [...floors]
  const tab = normalizeTab(choice.tab, person)
  const out: F[] = []
  for (const f of floors) {
    const agents = f.agents.filter(a => inTab(a, tab) && (choice.owner === null || a.owner?.username === choice.owner))
    if (agents.length) out.push({ ...f, agents })
  }
  return out
}

/** How many chats each tab holds, from the floors the agent sent (before any owner filter). */
export function tabCounts(floors: readonly ScopedFloor<ScopedAgent>[]): Record<ScopeTab, number> {
  const n: Record<ScopeTab, number> = { mine: 0, shared: 0, all: 0 }
  for (const f of floors)
    for (const a of f.agents) {
      n.all++
      if (a.access === 'mine') n.mine++
      else if (a.access === 'shared') n.shared++
    }
  return n
}

export interface OwnerOption {
  username: string
  name: string
  count: number
}

/** The owners of the chats in this tab (the options of the filter), most chats first. */
export function ownersOf(floors: readonly ScopedFloor<ScopedAgent>[], tab: ScopeTab): OwnerOption[] {
  const by = new Map<string, OwnerOption>()
  for (const f of floors)
    for (const a of f.agents) {
      if (!a.owner || !inTab(a, tab)) continue
      const o = by.get(a.owner.username) ?? { username: a.owner.username, name: a.owner.name, count: 0 }
      o.count++
      by.set(a.owner.username, o)
    }
  return [...by.values()].sort((a, b) => b.count - a.count || a.username.localeCompare(b.username))
}

/** What this person may do with the chat: read only ('view'), or type too. No `can` (an agent before F-118, or the open app) is everything. */
export const canType = (a: { can?: ChatCan }) => a.can === undefined || a.can !== 'view'
export const isOwnerOf = (a: { can?: ChatCan }) => a.can === undefined || a.can === 'owner'

/**
 * The pages that talk to the PC itself (its devices, ports, build, tasks, drive, phone, WhatsApp, CRM) are for the admin (sbskrrt) only once people sign in: the agent
 * answers everyone else 403 {code:'admin-only'} on every route they use. Everyone else keeps Home, Features, Themes, Agents, Chats and Settings.
 */
// Order o5007: the old-app reader (OLD_ROUTE) is the owner's too: its socket and its setting answer everyone else 403.
// Order o5dc6: the Phone app page (the APKs to download) is the owner's: its routes want the owner signed in.
// Orders o2aac / o6056: Paperclip and Schedules are the owner's too ("like the other pages"); empty for now, what they grow into works on this PC.
// Order obb81: the Agents page (every agent's brief, notes, memory files and replies) is the owner's for now. Placed before '/phone-app': other pages'
// wiring tests pin the tail of this list ('/phone-app', OLD_ROUTE ... and OLD_ROUTE, OLD_LEGACY_ROUTE, LIVE_CLASSIC_ROUTE at the end).
// Order o088b (F-267): the Quick page (live talk on its own page, the locked "talk" feature) is the owner's; placed before '/phone-app' too.
// Orders o5c05 / o7c7c: Getting started ('/start') is a page of its own (its Access rows are in shared/access.ts), so it is open to the people the owner chose when the agent sends the
// list; with no list (an older agent) it is the owner's like every page that is not Home, Features, Themes, Agents, Chats or Settings. Placed after '/setup', where it belongs.
const ADMIN_PATHS = ['/devices', '/ports', '/build', '/setup', '/start', '/tasks', '/drive', '/chris', '/goals', '/whatsapp', '/crm', '/accounts', '/dependencies', '/subscriptions', '/mcps', '/paperclip', '/schedules', '/browser', AGENTS_NEW_ROUTE, MEMORY_ROUTE, PLATFORM_SHUBHAM_ROUTE, PLATFORM_AKASH_ROUTE, AGENTS_AKASH_ROUTE, MEMORY_AKASH_ROUTE, AGENT_DIRECTORY_ROUTE, QUICK_ROUTE, '/phone-app', OLD_ROUTE, OLD_LEGACY_ROUTE, LIVE_CLASSIC_ROUTE]
export function adminOnlyPath(pathname: string): boolean {
  return ADMIN_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
}

/**
 * Shubham's orders o4e4e and o2f32: the pages whose routes the agent keeps for the FIRST owner BY HIS ID, even when a second owner (owners.json) is an administrator: Quick (live talk: appOwnerOnly).
 * A second owner is not offered them (the menu, the page picker, the search bar and a link all go through mayOpen); everything else of an administrator's is as it was.
 */
const FIRST_OWNER_PATHS = [QUICK_ROUTE]
export function firstOwnerPath(pathname: string): boolean {
  return FIRST_OWNER_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
}

/**
 * Whether this page may be shown to this person: everyone while the app is open or signed out of nothing, else the admin's pages only to the admin.
 * Order o9465: when the agent says which features are open to this person (Settings › Access; AuthStatus.features), a page shows only when its
 * feature is one of them, and a page that is no feature's is the owner's (fail closed).
 */
export function mayOpen(pathname: string, person: (Pick<AuthPerson, 'canSeeAll'> & { id?: string }) | null, features?: readonly string[] | null): boolean {
  if (!person) return true
  // Shubham's order o2f32: a second owner (an administrator) is not offered the pages whose routes stay Shubham's BY HIS ID (Quick: live talk).
  if (person.canSeeAll) return !(firstOwnerPath(pathname) && !isFirstOwner(person))
  if (features) {
    const f = pageFeature(pathname)
    return f !== null && features.includes(f.key)
  }
  return !adminOnlyPath(pathname)
}
