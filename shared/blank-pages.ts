// F-320 (Shubham's orders ofe1f, then o67e8): TWO NEW BLANK PAGES in the page chooser, exactly "Agents (new)" and "Memory". Shubham will redesign the whole Agents page; this is step 1, and he wants
// to open them on Dev. They are BLANK on purpose: the app's page frame and nothing else (one visually-hidden heading names the page for a screen reader): no data, no calls, no tools. The existing
// Agents page (AgentDirectory, /agent-directory), the Agentic Platform page (/agents) and the notebook card are not touched. Each is a page of its own in Settings > Access (default Only me, like
// every page), and the owner's with no list (shared/chat-scope.ts).
//
// One place for the addresses, the words and the Access keys, so the router, the page chooser, Settings > Access and the owner's list can never differ.

export interface BlankPage {
  /** The page's address. */
  route: string
  /** What the chooser, the tab title and a screen reader call it: exactly this. */
  label: string
  /** The page chooser's one line under the name (about 36 characters at most). */
  blurb: string
  /** The row in Settings > Access (shared/access.ts FEATURES). */
  key: string
  /** The row's sentence in Settings > Access. */
  access: string
}

export const AGENTS_NEW_ROUTE = '/agents-new'
export const MEMORY_ROUTE = '/memory'

export const AGENTS_NEW: BlankPage = { route: AGENTS_NEW_ROUTE, label: 'Agents (new)', blurb: 'The new Agents page, blank for now', key: 'agents-new', access: 'The new Agents page: blank for now, redesigned step by step.' }
export const MEMORY: BlankPage = { route: MEMORY_ROUTE, label: 'Memory', blurb: 'A new page, blank for now', key: 'memory', access: 'The new Memory page: blank for now, built step by step.' }

/** In the order the chooser lists them: right after "Agents". */
export const BLANK_PAGES: readonly BlankPage[] = [AGENTS_NEW, MEMORY]
