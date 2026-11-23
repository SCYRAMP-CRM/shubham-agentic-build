// F-162 o7e6d: what a staff member's own Assistant may look at on the screen. ui_screen is its only UI tool, and it sees only the
// pages below. Fail closed everywhere else: any route with a query or a hash (the Agents page reads ?agent=, ?tab= and ?floor= to show
// other people's chats), any encoding, any double slash, any file-style or unknown route, and the whole Settings family, PC control,
// Devices and Remote, Browser, Accounts, WhatsApp, Hey Chris, Paperclip, Schedules, Setup, Build, MCPs, Themes and Features.
//
// Dropped on purpose (Lead's review): /agents (query selects other people's chats, preamble and memory), /tasks (Shubham's one task
// list) and /goals (lists may hold other people's goals). Only the home page stays: it shows nothing of anybody else.

/** The pages a staff Assistant may look at (exact routes only). */
export const STAFF_SCREEN_PAGES: readonly string[] = ['/']

const DENIED = /settings|pc-|devices|remote|rustdesk|browser|access|accounts|whatsapp|chris|paperclip|schedules|setup|build|mcps|themes|features|agents|memory|tasks|goals|chats|crm/

/**
 * The page's route as the page reports it. Anything that is not a plain path (a query, a hash, an encoding, a double slash, a
 * dot segment or a file name) normalises to the empty string, which is never allowed.
 */
export function normaliseRoute(route: string): string {
  // No trimming: a stray space is not a route to be quietly fixed (fail closed).
  const raw = typeof route === 'string' ? route.toLowerCase() : ''
  if (!raw.startsWith('/') || raw.startsWith('//')) return ''
  if (/[?#%\\]/.test(raw) || raw.includes('/./') || raw.includes('/../') || /\/\.\.?$/.test(raw)) return ''
  if (/\.(html?|js|json|txt)$/.test(raw)) return ''
  if (/[^a-z0-9/_-]/.test(raw)) return ''
  return raw.length > 1 && raw.endsWith('/') ? raw.slice(0, -1) : raw
}

/** Whether a staff Assistant may look at the page `route` (fail closed: only an exact match in STAFF_SCREEN_PAGES, never a denied name). */
export function staffMayScreen(route: string): boolean {
  const r = normaliseRoute(route)
  if (!r) return false
  if (DENIED.test(r)) return false
  return STAFF_SCREEN_PAGES.includes(r)
}
