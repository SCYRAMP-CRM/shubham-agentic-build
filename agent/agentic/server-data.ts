import { lstatSync, readFileSync } from 'node:fs'
import { lstat, opendir } from 'node:fs/promises'
import path from 'node:path'
import { writeAtomic } from '../config.ts'
import { SERVER_DATA_CATEGORIES } from '../../shared/server-info.ts'

// F-368 (Shubham: the "Data" tab of the "i" button: "what the Server holds"): how much room each KIND of data takes on this PC, by size and by number of files. NAMES AND SIZES OF FIXED PROGRAM FOLDERS ONLY:
// - The folders are a CONSTANT in this file (PLAN). Nothing in a request chooses a path, and a request carries nothing but "refresh".
// - Only numbers and the fixed ids of shared/server-info.ts leave this module: never a path, a file or folder name (a folder that holds a person's name or a chat id is only ever counted), never a line of content.
//   No file is opened: the walk reads a directory and takes each file's size from the directory (lstat); the one file this module reads or writes is its own small cache.
// - It cannot be slow for the agent: the walk is async and gives way every 256 entries; ONE scan runs at a time (single-flight); `read()` never waits for a scan, it answers at once with the last count (or "counting");
//   a scan costs at most CATEGORY_MS and MAX_ENTRIES per kind and TOTAL_MS in all, and past a limit that kind says `partial` (the page shows "at least").
// - It leaks nothing by walking: a symbolic link or a junction is NEVER followed (node_modules and the like are junctions), a folder that cannot be read counts as nothing and says partial.
// - A scan starts only when the owner's page asks (the route), at most every REFRESH_MS on demand, and the last answer is kept TTL_MS (and in one small file, so a restart has something to show).

type Root = 'state' | 'home'
interface Place {
  /** The state folder (<LOCALAPPDATA>/shubham-agentic) or the home folder of the account the chats run as. */
  root: Root
  /** Relative to that folder; no `..`, never absolute. */
  rel: string
  /** `tree`: everything below it. `files`: only the files directly in it (never its folders), optionally of one extension. */
  kind: 'tree' | 'files'
  ext?: string
}

const tree = (root: Root, rel: string): Place => ({ root, rel, kind: 'tree' })
const AGENTIC = 'agent/agentic'

/** Which folders make up each kind of data. The ids are those of shared/server-info.ts (a test pins that every sized one is here, and only those). Order is the page's order: the not-data tools last. */
export const PLAN: Readonly<Record<string, readonly Place[]>> = {
  conversations: [tree('home', '.claude/projects')],
  codex: [tree('state', 'agent/codex')],
  'app-state': [
    { root: 'state', rel: AGENTIC, kind: 'files' },
    ...['briefs', 'assistant-history', 'mcp', 'staff', 'usage', 'old-reader', 'fast', 'fast-preview', 'opencode', 'browser'].map(d => tree('state', `${AGENTIC}/${d}`)),
  ],
  'conv-copies': [tree('state', `${AGENTIC}/conversations`)],
  uploads: ['uploads', 'crm-uploads'].map(d => tree('state', `${AGENTIC}/${d}`)),
  'crm-cache': ['crm-cache', 'crm-pins', 'crm-spool', 'crm-sync'].map(d => tree('state', `${AGENTIC}/${d}`)),
  logs: [tree('state', 'agent/logs'), { root: 'state', rel: '', kind: 'files', ext: '.log' }],
  builds: [tree('state', 'publish'), tree('state', 'chathost')],
  whatsapp: [tree('state', 'whatsapp'), tree('state', 'whatsapp-backend')],
  remote: [tree('state', 'rustdesk-server')],
  'sign-ins': [tree('state', 'agent/identity'), tree('state', 'agent/secrets'), tree('state', 'agent/ssh'), { root: 'state', rel: 'agent', kind: 'files' }],
  tools: [...['android', 'models', 'ffmpeg', 'speech-bin', 'voice-work', 'web-work', 'dev-try'].map(d => tree('state', d)), tree('state', `${AGENTIC}/codex-claude-bin`), tree('state', `${AGENTIC}/codex-claude`)],
}

export const CATEGORY_MS = 2_000
export const TOTAL_MS = 15_000
export const MAX_ENTRIES = 80_000
/** The largest numbers the page reads (shared/server-data-view.ts says the same): a count past them, in a damaged cache file, is no count. */
const MAX_BYTES = 1e15
const MAX_FILES = 1e9
export const TTL_MS = 10 * 60_000
export const REFRESH_MS = 30_000
/** The walk gives way to the rest of the agent this often (entries). */
const YIELD_EVERY = 256

export interface DataCount {
  id: string
  bytes: number
  files: number
  /** True when a limit stopped the count (or a folder could not be read): the real size is at least this. */
  partial: boolean
}

export interface ServerDataAnswer {
  /** The role of THIS agent: the Server ("hub"), a PC that is its member, or one on its own. The page says whose data it is. */
  role: 'hub' | 'member' | 'alone'
  /** A scan is running now (the numbers below are the last ones, or none yet). */
  scanning: boolean
  /** When the numbers were counted (ms since 1970), or null before the first count. */
  at: number | null
  /** This agent's own clock now (ms since 1970): the page says how old the count is by this, not by its own clock. */
  now: number
  tookMs: number | null
  /** Seconds until "Refresh" is allowed again (0: now). */
  refreshInSec: number
  categories: DataCount[]
}

export interface ServerDataOptions {
  /** <LOCALAPPDATA>/shubham-agentic. */
  state: string
  /** The home folder of the account the chats run as. */
  home: string
  /** Where the last count is kept (one small file). */
  cacheFile: string
  role: () => 'hub' | 'member' | 'alone'
  now?: () => number
  ttlMs?: number
  refreshMs?: number
  categoryMs?: number
  totalMs?: number
  maxEntries?: number
  /** Tests: called once each time a scan starts. */
  onScan?: () => void
}

export interface ServerData {
  /** Never waits for a scan: the last count at once. `refresh` asks for a new one (at most every REFRESH_MS). */
  read(refresh?: boolean): ServerDataAnswer
  /** Tests: the scan running now, if any. */
  idle(): Promise<void>
  close(): void
}

const SIZED = SERVER_DATA_CATEGORIES.filter(c => c.sized).map(c => c.id)
const yieldNow = () => new Promise<void>(resolve => setImmediate(resolve))

interface Budget {
  deadline: number
  left: number
  partial: boolean
}

/** Whether the fixed folder `rel` below `base` can be walked without passing through a link: `ok`; `missing` (not there: nothing); `link` (a link on the way, or the folder itself); `unreadable`. `base` itself is the app's own folder and is not looked at. */
async function reach(base: string, rel: string): Promise<'ok' | 'missing' | 'link' | 'unreadable'> {
  let at = base
  for (const part of rel === '' ? [] : rel.split('/')) {
    at = path.join(at, part)
    try {
      if ((await lstat(at)).isSymbolicLink()) return 'link'
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code
      return code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unreadable'
    }
  }
  return 'ok'
}

/** One kind's walk: bytes and files under the places, within the budget. Never follows a link, never opens a file. */
async function measure(places: readonly Place[], roots: Record<Root, string>, budget: Budget, now: () => number, closed: () => boolean): Promise<{ bytes: number; files: number }> {
  let bytes = 0
  let files = 0
  let seen = 0
  const stop = () => {
    if (budget.left <= 0 || now() >= budget.deadline || closed()) {
      budget.partial = true
      return true
    }
    return false
  }
  for (const place of places) {
    // The fixed folder itself, and every folder on the way to it from the app's own folder, must not be a link (a link there would lead out of the allow-list): a link makes it nothing, and partial.
    const reached = await reach(roots[place.root], place.rel)
    if (reached === 'missing') continue
    if (reached !== 'ok') {
      budget.partial = true
      continue
    }
    const top = place.rel === '' ? roots[place.root] : path.join(roots[place.root], ...place.rel.split('/'))
    const stack = [top]
    while (stack.length > 0) {
      if (stop()) return { bytes, files }
      const dir = stack.pop()!
      let handle: Awaited<ReturnType<typeof opendir>>
      try {
        handle = await opendir(dir)
      } catch (e) {
        // A folder that is not there is nothing; one that is there and cannot be read makes the count partial.
        if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT' && (e as NodeJS.ErrnoException)?.code !== 'ENOTDIR') budget.partial = true
        continue
      }
      try {
        for await (const entry of handle) {
          if (stop()) return { bytes, files }
          budget.left--
          if (++seen % YIELD_EVERY === 0) await yieldNow()
          if (entry.isSymbolicLink()) continue
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            if (place.kind !== 'tree') continue
            // Belt and braces: a listing can show a junction as a folder; lstat says what it really is, and a link is never entered.
            try {
              if (!(await lstat(full)).isSymbolicLink()) stack.push(full)
            } catch {
              budget.partial = true
            }
          } else if (entry.isFile()) {
            if (place.ext !== undefined && path.extname(entry.name).toLowerCase() !== place.ext) continue
            try {
              bytes += (await lstat(full)).size
              files++
            } catch {
              budget.partial = true
            }
          }
        }
      } catch {
        budget.partial = true
      } finally {
        await handle.close().catch(() => {})
      }
    }
  }
  return { bytes, files }
}

/**
 * The last count as kept in the cache file: strict, and only the fixed ids. Anything else is no count, and so is a count dated in the FUTURE (`at` after `now`: a planted or damaged file, or a clock that went back; it
 * would otherwise be taken as fresh for as long as it lies ahead).
 */
function parseCache(text: string, now: number): { at: number; tookMs: number; categories: DataCount[] } | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (r.v !== 1 || typeof r.at !== 'number' || !Number.isFinite(r.at) || r.at <= 0 || r.at > now || typeof r.tookMs !== 'number' || !Number.isFinite(r.tookMs) || r.tookMs < 0 || !Array.isArray(r.categories)) return null
  const byId = new Map<string, DataCount>()
  for (const c of r.categories) {
    if (typeof c !== 'object' || c === null) continue
    const { id, bytes, files, partial } = c as Record<string, unknown>
    if (typeof id !== 'string' || !SIZED.includes(id) || byId.has(id)) continue
    if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes < 0 || bytes > MAX_BYTES || typeof files !== 'number' || !Number.isInteger(files) || files < 0 || files > MAX_FILES || typeof partial !== 'boolean') continue
    byId.set(id, { id, bytes, files, partial })
  }
  return { at: r.at, tookMs: r.tookMs, categories: SIZED.flatMap(id => byId.get(id) ?? []) }
}

/** The cache file holds a few hundred bytes (under 1 KB): past this it is not ours, and it is not read at all. */
export const CACHE_MAX_BYTES = 64 * 1024

/** The cache file, looked at BEFORE it is read: it must be a plain file (not a link, not a folder) no larger than CACHE_MAX_BYTES; then it is parsed strictly. Anything else is no count. */
function readCache(file: string, now: number): { at: number; tookMs: number; categories: DataCount[] } | null {
  try {
    const found = lstatSync(file)
    if (!found.isFile() || found.size > CACHE_MAX_BYTES) return null
    return parseCache(readFileSync(file, 'utf8'), now)
  } catch {
    // No cache yet, or one that cannot be read.
    return null
  }
}

export function createServerData(o: ServerDataOptions): ServerData {
  const now = o.now ?? Date.now
  const ttl = o.ttlMs ?? TTL_MS
  const refreshEvery = o.refreshMs ?? REFRESH_MS
  const categoryMs = o.categoryMs ?? CATEGORY_MS
  const totalMs = o.totalMs ?? TOTAL_MS
  const maxEntries = o.maxEntries ?? MAX_ENTRIES
  const roots: Record<Root, string> = { state: o.state, home: o.home }
  let closed = false
  let scanning: Promise<void> | null = null
  let lastStart = Number.NEGATIVE_INFINITY
  let last: { at: number; tookMs: number; categories: DataCount[] } | null = readCache(o.cacheFile, now())

  async function scan() {
    const started = now()
    const overall = started + totalMs
    const categories: DataCount[] = []
    for (const id of SIZED) {
      const begin = now()
      const budget: Budget = { deadline: Math.min(begin + categoryMs, overall), left: maxEntries, partial: false }
      // A kind the total time ran out before is counted as nothing, and partial.
      let got = { bytes: 0, files: 0 }
      if (begin >= overall) budget.partial = true
      else got = await measure(PLAN[id] ?? [], roots, budget, now, () => closed)
      categories.push({ id, bytes: got.bytes, files: got.files, partial: budget.partial })
      if (closed) return
      await yieldNow()
    }
    const done = now()
    last = { at: done, tookMs: Math.max(0, done - started), categories }
    try {
      writeAtomic(o.cacheFile, `${JSON.stringify({ v: 1, ...last })}\n`)
    } catch {
      // The count is still shown; only a restart has nothing to start from.
    }
  }

  function start() {
    lastStart = now()
    o.onScan?.()
    scanning = scan()
      .catch(() => {})
      .finally(() => {
        scanning = null
      })
  }

  return {
    read(refresh = false) {
      const t = now()
      if (!scanning && !closed) {
        if (!last || t - last.at >= ttl) start()
        else if (refresh && t - lastStart >= refreshEvery) start()
      }
      return {
        role: o.role(),
        scanning: scanning !== null,
        at: last?.at ?? null,
        now: t,
        tookMs: last?.tookMs ?? null,
        refreshInSec: scanning ? Math.ceil(refreshEvery / 1000) : Math.max(0, Math.ceil((refreshEvery - (t - lastStart)) / 1000)),
        categories: last ? last.categories.map(c => ({ ...c })) : [],
      }
    },
    idle: () => scanning ?? Promise.resolve(),
    close() {
      closed = true
    },
  }
}
