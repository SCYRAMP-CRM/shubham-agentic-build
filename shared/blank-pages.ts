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
// F-340 (his words, 24 Nov 2026: "keep clear distninction between his and mine", six pages: Agents, Agentic Platform and Memory, each for Shubham and for Akash; "keep the old agents and Agents(Old)";
// "Agentic Platform(Old) is the current one"; "im goign to make new agentic platfomr"). LABEL SLICE: four NEW blank pages (their routes do not start with /agents/, and inRoute is segment-aware, so
// /agents stays the Agentic Platform page and sectionFor's longest match never mixes them). The two (Old) pages and Memory (Shubham) are the existing ones, label only.
export const PLATFORM_SHUBHAM_ROUTE = '/platform-shubham'
export const PLATFORM_AKASH_ROUTE = '/platform-akash'
export const AGENTS_AKASH_ROUTE = '/agents-akash'
export const MEMORY_AKASH_ROUTE = '/memory-akash'

// F-340: "Agents (new)" is now Agents (Shubham): the same blank page, the same address and Access key (agents-new), only the words changed.
export const AGENTS_NEW: BlankPage = { route: AGENTS_NEW_ROUTE, label: 'Agents (Shubham)', blurb: 'New Agents page for Shubham, blank', key: 'agents-new', access: 'Shubham’s new Agents page: blank for now, redesigned step by step.' }
export const PLATFORM_SHUBHAM: BlankPage = { route: PLATFORM_SHUBHAM_ROUTE, label: 'Agentic Platform (Shubham)', blurb: 'New platform for Shubham, blank', key: 'platform-shubham', access: 'Shubham’s new Agentic Platform: blank for now, he designs it step by step.' }
export const PLATFORM_AKASH: BlankPage = { route: PLATFORM_AKASH_ROUTE, label: 'Agentic Platform (Akash)', blurb: 'New platform for Akash, blank', key: 'platform-akash', access: 'Akash’s new Agentic Platform: blank for now.' }
export const AGENTS_AKASH: BlankPage = { route: AGENTS_AKASH_ROUTE, label: 'Agents (Akash)', blurb: 'New Agents page for Akash, blank', key: 'agents-akash', access: 'Akash’s Agents page: blank for now.' }
export const MEMORY_AKASH: BlankPage = { route: MEMORY_AKASH_ROUTE, label: 'Memory (Akash)', blurb: 'Memory for Akash: not connected yet', key: 'memory-akash', access: 'Akash’s memory layer: not connected yet, blank until its details come.' }
// F-328 (his order o23ce): the Memory page is NOT blank any more (src/pages/MemoryPage.tsx, shared/memory-page.ts). Its address, label and Access key stay as F-320 made them, so the router, the chooser,
// Settings > Access and the owner's list still name it from this one place; only its two sentences changed. This file keeps its name for now.
export const MEMORY: BlankPage = { route: MEMORY_ROUTE, label: 'Memory (Shubham)', blurb: 'What the app has kept about you', key: 'memory', access: 'The Memory page: your own memory, read only. Other people’s memory comes later.' }

/** The pages that are still blank (F-328 built the Memory page; F-340 added four), in the menu's order. */
export const BLANK_PAGES: readonly BlankPage[] = [PLATFORM_SHUBHAM, PLATFORM_AKASH, AGENTS_NEW, AGENTS_AKASH, MEMORY_AKASH]
