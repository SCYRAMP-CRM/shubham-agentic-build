// F-368: what the "i" button's Data tab draws, from the answer of GET /server-data (agent/agentic/server-data.ts). The page READS THE ANSWER STRICTLY (exact keys, the fixed ids of shared/server-info.ts only, plain numbers): a shape it
// does not know is no answer, never a quietly shorter table. And the plain words: a size in the largest unit it fits, "at least" when a limit stopped the count, "counting" before there is one, "not read by this app" for the
// standalone memory. No path, name or content is ever in the answer, so none is ever on this page.

import { SERVER_DATA_CATEGORIES, type DataCategory } from './server-info.ts'

export type DataRole = 'hub' | 'member' | 'alone'

export interface DataCountView {
  id: string
  bytes: number
  files: number
  partial: boolean
}

export interface ServerDataView {
  role: DataRole
  scanning: boolean
  at: number | null
  /** The agent's own clock when it answered (ms since 1970): the age of the count is by this. */
  now: number
  tookMs: number | null
  refreshInSec: number
  categories: DataCountView[]
}

const SIZED_IDS = new Set(SERVER_DATA_CATEGORIES.filter(c => c.sized).map(c => c.id))
const ROLES: readonly string[] = ['hub', 'member', 'alone']
const MAX_BYTES = 1e15

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const sameKeys = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k))
const count = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max

export function readServerDataAnswer(v: unknown): ServerDataView | null {
  if (!isObject(v) || !sameKeys(v, ['role', 'scanning', 'at', 'now', 'tookMs', 'refreshInSec', 'categories'])) return null
  if (typeof v.role !== 'string' || !ROLES.includes(v.role) || typeof v.scanning !== 'boolean') return null
  if (!(v.at === null || (typeof v.at === 'number' && Number.isFinite(v.at) && v.at > 0))) return null
  if (typeof v.now !== 'number' || !Number.isFinite(v.now) || v.now <= 0) return null
  if (!(v.tookMs === null || (typeof v.tookMs === 'number' && Number.isFinite(v.tookMs) && v.tookMs >= 0))) return null
  if (!count(v.refreshInSec, 3600) || !Array.isArray(v.categories) || v.categories.length > SIZED_IDS.size) return null
  const seen = new Set<string>()
  const categories: DataCountView[] = []
  for (const c of v.categories) {
    if (!isObject(c) || !sameKeys(c, ['id', 'bytes', 'files', 'partial'])) return null
    if (typeof c.id !== 'string' || !SIZED_IDS.has(c.id) || seen.has(c.id) || !count(c.bytes, MAX_BYTES) || !count(c.files, 1e9) || typeof c.partial !== 'boolean') return null
    seen.add(c.id)
    categories.push({ id: c.id, bytes: c.bytes, files: c.files, partial: c.partial })
  }
  return { role: v.role as DataRole, scanning: v.scanning, at: v.at, now: v.now, tookMs: v.tookMs, refreshInSec: v.refreshInSec, categories }
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/** A size in the largest unit that keeps it under 1000: "7.5 GB", "668 MB", "3.4 KB". Binary units (1024), as the file manager shows them. */
export function formatBytes(bytes: number): string {
  let v = Math.max(0, bytes)
  let i = 0
  while (v >= 1000 && i < UNITS.length - 1) {
    v /= 1024
    i++
  }
  return `${i === 0 ? String(Math.round(v)) : v < 10 ? v.toFixed(1) : String(Math.round(v))} ${UNITS[i]}`
}

export function formatFiles(n: number): string {
  return `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} ${n === 1 ? 'file' : 'files'}`
}

/** "just now", "3 min ago", "2 h ago", "1 day ago". */
export function ageWords(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`
  const d = Math.round(s / 86_400)
  return `${d} ${d === 1 ? 'day' : 'days'} ago`
}

/** Whose data this is: the page asks its own agent, which answers for itself. */
export const roleWords = (role: DataRole): string => (role === 'hub' ? 'Counted on the Server' : role === 'member' ? 'Counted on this PC, which is not the Server' : 'Counted on this PC, which is on its own')

/** Why the tab has no numbers, in fixed words (the page never shows the answer's own words): which way the read failed. */
export type DataErrorKind = 'sign-in' | 'owner' | 'older' | 'unreadable' | 'failed'
export const DATA_ERROR_WORDS: Readonly<Record<DataErrorKind, string>> = {
  'sign-in': 'Sign in through the CRM on this app to see this.',
  owner: 'This is for the owner of the app.',
  older: 'This app is older than the Data tab: update it.',
  unreadable: "The app answered something this page can't read: update the app.",
  failed: 'The app could not answer just now.',
}

export function dataErrorKind(e: unknown): DataErrorKind {
  const status = typeof e === 'object' && e !== null ? (e as { status?: unknown }).status : undefined
  if (status === 401) return 'sign-in'
  if (status === 403) return 'owner'
  if (status === 404) return 'older'
  if (typeof status !== 'number' && e instanceof Error && e.message.includes("can't read")) return 'unreadable'
  return 'failed'
}

export const DATA_GROUP_TITLES: Readonly<Record<DataCategory['group'], string>> = { data: "The app's own data", tools: 'Tools and models (not data)' }
export const DATA_WORDS = { refresh: 'Refresh', retry: 'Try again', total: 'Total', counting: 'Counting', asking: 'Asking the app…' } as const

/** The line above the numbers: whose they are and how old, or that the app is counting. */
export function statusLine(view: ServerDataView | null): string {
  if (!view) return DATA_WORDS.asking
  const when = view.at === null ? null : ageWords(view.at, view.now)
  if (view.scanning) return when === null ? 'Counting now. This can take a few seconds.' : `Counting again. Showing the count from ${when}.`
  return when === null ? 'No count yet.' : `${roleWords(view.role)}, ${when}.`
}

/** Refresh is allowed when the agent is not counting and its own limit (one count every 30 seconds) has passed. */
export const canRefresh = (view: ServerDataView | null): boolean => view !== null && !view.scanning && view.refreshInSec === 0

export type RowState = 'counted' | 'partial' | 'not-counted' | 'counting' | 'not-read'

export interface DataRow {
  id: string
  label: string
  holds: string
  group: DataCategory['group']
  state: RowState
  /** The size in words, or the reason there is none. */
  words: string
  /** The files in words, or null. */
  filesWords: string | null
  /** This kind's share of everything counted, 0 to 1 (0 when there is no count). */
  share: number
}

/** One row for each kind of data, in the panel's order. `view` null (no answer yet) makes every row that can be counted "counting". */
export function dataRows(view: ServerDataView | null): DataRow[] {
  const got = new Map((view?.categories ?? []).map(c => [c.id, c]))
  const total = [...got.values()].reduce((s, c) => s + c.bytes, 0)
  return SERVER_DATA_CATEGORIES.map(c => {
    const base = { id: c.id, label: c.label, holds: c.holds, group: c.group }
    if (!c.sized) return { ...base, state: 'not-read' as const, words: 'not read by this app', filesWords: null, share: 0 }
    const n = got.get(c.id)
    if (!n) return { ...base, state: 'counting' as const, words: 'counting', filesWords: null, share: 0 }
    if (n.partial && n.bytes === 0 && n.files === 0) return { ...base, state: 'not-counted' as const, words: 'not counted in time', filesWords: null, share: 0 }
    return {
      ...base,
      state: n.partial ? ('partial' as const) : ('counted' as const),
      words: n.partial ? `at least ${formatBytes(n.bytes)}` : formatBytes(n.bytes),
      filesWords: `${n.partial ? 'at least ' : ''}${formatFiles(n.files)}`,
      share: total > 0 ? n.bytes / total : 0,
    }
  })
}

export interface Subtotal {
  group: DataCategory['group']
  words: string
}

/** The total of the app's own data, and of the tools it downloaded, each "at least" when any part of it was only partly counted (or not yet counted). */
export function subtotals(view: ServerDataView | null): Subtotal[] {
  const group = (g: DataCategory['group']): Subtotal => {
    const ids = SERVER_DATA_CATEGORIES.filter(c => c.group === g && c.sized).map(c => c.id)
    const parts = ids.map(id => view?.categories.find(c => c.id === id))
    if (parts.some(p => p === undefined)) return { group: g, words: 'counting' }
    const rows = parts as DataCountView[]
    const bytes = rows.reduce((s, c) => s + c.bytes, 0)
    return { group: g, words: `${rows.some(c => c.partial) ? 'at least ' : ''}${formatBytes(bytes)}` }
  }
  return [group('data'), group('tools')]
}
