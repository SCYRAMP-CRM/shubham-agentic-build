// Orders o5c05 and o7c7c (Shubham: "please make it", then "yes give genreic setup page and once a role logs in show them thier desired page please"): the Setup page in three
// role tabs, and where each role lands after signing in. Pure rules, so they are tested without a page.
//
// Three roles, no role system of their own: the OWNER is the Superadmin (the app's one owner: AuthPerson.canSeeAll); an ADMIN is a person the owner opens the Access row
// "Getting started › Admin tab" to (feature setup-admin, which needs setup-normal); a NORMAL user is a person the owner opens "Getting started" to (setup-normal).
// /setup is LOCKED and stays the owner's only; everyone else's page is /start, outside it (a path under /setup would fall under the lock). A role is only a label for which page
// and which tab a person is shown: it opens no route and no feature (agent/api-access.test.ts proves that by effect, not by reading the table).

export type SetupRole = 'normal' | 'admin' | 'superadmin'
export const SETUP_ROLES: readonly SetupRole[] = ['normal', 'admin', 'superadmin']
export const SETUP_ROLE_LABELS: Readonly<Record<SetupRole, string>> = { normal: 'Normal user', admin: 'Admin', superadmin: 'Superadmin' }

export const SETUP_PAGE = '/setup'
export const START_PAGE = '/start'
/** The Access rows (shared/access.ts FEATURES): the keys this file reads. */
export const NORMAL_FEATURE = 'setup-normal'
export const ADMIN_FEATURE = 'setup-admin'

const has = (features: readonly string[] | null, key: string) => features !== null && features.includes(key)

/**
 * The tabs a person may see on a page. `page` 'setup' is the locked page (only the owner ever reaches it: all three tabs); 'start' is the generic page: a person sees Normal user
 * when "Getting started" is open to them, and Admin too when its Admin row is. A person with no Access list (the agent did not say) or without "Getting started" sees no tab at all
 * (fail closed), and the Admin tab needs both rows (setup-admin needs setup-normal), even if the file says otherwise. The owner previews the two of them on /start.
 */
export function setupTabsFor(page: 'setup' | 'start', owner: boolean, features: readonly string[] | null): readonly SetupRole[] {
  if (page === 'setup') return owner ? SETUP_ROLES : []
  if (owner) return ['normal', 'admin']
  if (!has(features, NORMAL_FEATURE)) return []
  return has(features, ADMIN_FEATURE) ? ['normal', 'admin'] : ['normal']
}

/** The tab an address asks for (?tab=admin), if this person has it; else `fallback` when they have that one, else their first. Null when they have no tab. */
export function setupTabFromParam(tabs: readonly SetupRole[], raw: string | null, fallback?: SetupRole): SetupRole | null {
  if (tabs.length === 0) return null
  const asked = tabs.find(t => t === raw)
  if (asked) return asked
  return fallback && tabs.includes(fallback) ? fallback : tabs[0]
}

// ---- which steps of the Setup list each role's tab shows

/**
 * Order o5c05: the steps of the Setup list (src/setup/steps.tsx) that the Normal and Admin tabs also show, by step id. The Superadmin tab shows every step, listed here or not, and a
 * step that is not listed shows to nobody else (a new step is the owner's until it is listed here). Only what a person can really do on their own PC: the steps that join a PC
 * to the server, sign in to GitHub or AWS, or open a PC's ports are not listed, because the pages they use are the owner's (Settings › Devices) or because they are his own sign-ins.
 * This table is Shubham's to change: one line per step.
 */
export const STEP_ROLES: Readonly<Record<string, readonly SetupRole[]>> = {
  'node-git-claude': ['admin'],
  chrome: ['admin'],
  tailscale: ['normal', 'admin'],
  phone: ['normal', 'admin'],
}

/** The steps a role's tab shows, in the list's own order. */
export function stepsFor<T extends { id: string }>(steps: readonly T[], role: SetupRole): T[] {
  return steps.filter(s => role === 'superadmin' || (Object.hasOwn(STEP_ROLES, s.id) && STEP_ROLES[s.id].includes(role)))
}

// ---- where a role lands after signing in (order o7c7c)

/** The two roles that have a landing: the Superadmin (the owner) has none, so nothing changes for him on any day (the decision of order o7c7c's day-one check). */
export type LandingClass = 'normal' | 'admin'
export const LANDING_CLASSES: readonly LandingClass[] = ['normal', 'admin']

/**
 * The role class whose page a person lands on after signing in, or null when they have none: the owner and the open app (nobody signs in), and anyone "Getting started" is not open
 * to, which is everyone until the owner opens it (every Access row starts as Only me). The class follows the Access rows, so when the owner marks a person an Admin their class
 * changes and they see the Admin landing once: intended, not a dismissal that "did not stick".
 */
export function landingRole(owner: boolean, features: readonly string[] | null): LandingClass | null {
  if (owner) return null
  if (!has(features, NORMAL_FEATURE)) return null
  return has(features, ADMIN_FEATURE) ? 'admin' : 'normal'
}

/** Where a role class lands: Getting started, and for an Admin its Admin tab. */
export const landingPath = (cls: LandingClass): string => (cls === 'admin' ? `${START_PAGE}?tab=admin` : START_PAGE)

/** What the page was loaded at: read once, when the page loads, before the router moves anything. */
export interface Loaded {
  pathname: string
  search: string
  hash: string
}

/**
 * Whether a page load IS the app's start: the address is exactly "/" and nothing else. The one rule behind every entry point (tests: src/setup/start-landing.test.mjs names each):
 * a typed or bookmarked "/", the installed app's own start (the manifest's start_url is "/"), the Android app's launcher start (server + "/"), the Install.cmd opening of
 * localhost, a plain reload of "/" and the sign-in screen giving way to "/" all load "/" and count. A deep link or its reload (any other path), anything with a query string or a
 * fragment (a share, a notification, a link that carries something), the overlay's and the Assistant's own page changes and the Home entry of the menu (they happen inside the
 * page, not at its load) never count.
 */
export const isStartAddress = (loaded: Loaded | null): boolean => loaded !== null && loaded.pathname === '/' && loaded.search === '' && loaded.hash === ''

/** How the app starts for a person who has a Getting started page: their role's page (once), or the usual start page (today's way, kept as a setting). */
export type StartPage = 'role' | 'usual'
/** Only "usual" (the old way) is stored: a new device, junk and no storage are all the new way. */
export const START_PAGE_KEY = 'sad-start-page'
export const parseStartPage = (raw: string | null | undefined): StartPage => (raw === 'usual' ? 'usual' : 'role')

/**
 * Which role classes have had their landing on this browser: per browser (per address it is opened at), per ROLE CLASS, never per person, and nothing in it names anyone: the
 * stored value is a list of class names and nothing else.
 */
export const SEEN_KEY = 'sad-start-landing-seen'
export function parseSeen(raw: string | null | undefined): readonly LandingClass[] {
  let v: unknown
  try {
    v = JSON.parse(raw ?? '[]')
  } catch {
    return []
  }
  return Array.isArray(v) ? LANDING_CLASSES.filter(c => v.includes(c)) : []
}
export const rememberSeen = (seen: readonly LandingClass[], cls: LandingClass): readonly LandingClass[] => LANDING_CLASSES.filter(c => c === cls || seen.includes(c))
export const seenText = (seen: readonly LandingClass[]): string => JSON.stringify(seen)

export interface LandingInput {
  /** What this page load was opened at (null: not in a browser). */
  loaded: Loaded | null
  /** Whether this page load has already decided (the decision is made once per page load, at the first mount of the app, never again). */
  spent: boolean
  role: LandingClass | null
  setting: StartPage
  seen: readonly LandingClass[]
}

/**
 * The one decision: where, if anywhere, this page load moves the person at the start. Only a load of exactly "/" (isStartAddress), only once per page load, only a person who has a
 * Getting started page, only while the setting is the new way, and only until their role class has had it once on this browser. Everything else is null: the page stays where it is.
 */
export function startLanding(i: LandingInput): string | null {
  if (i.spent || !isStartAddress(i.loaded)) return null
  if (i.setting !== 'role' || i.role === null || i.seen.includes(i.role)) return null
  return landingPath(i.role)
}
