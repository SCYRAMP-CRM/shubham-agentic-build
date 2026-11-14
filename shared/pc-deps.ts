/**
 * Order oc7c9 (Shubham, 14 Nov 2026: "If dependencies are the issue, then in PC control introduce a Dependencies tab and list all dependencies required."):
 * PC control's Dependencies tab, READ ONLY and the owner's. One PC's list of what the app needs there, as its own agent finds it: the required version,
 * the installed one (or none), where it was found, a state (ok, outdated, missing, broken) and, for each one that is not ok, the exact command that
 * fixes it. Nothing is installed from here (installs need Shubham's yes); npm is run once (`npm --version`) to prove it is not broken.
 *
 * - The page asks its own agent: GET /agent-api/pc-deps/pcs/<id> (owner only, like every core route). The Server answers for itself and asks a member
 *   over their link (stream 'pc-deps-v1', one request line, one answer line, as Ports and SSH do). A PC that is off, or on an older build, says so.
 * - What a member says is checked by the Server and again by the page (cleanDepsReport): the right PC, known words, bounded sizes.
 * - The broader list here is the app's; what Codex in Claude Code needs exactly stays on the Dependencies page (F-165).
 */

export const PC_DEPS_STREAM = 'pc-deps-v1'
export const PC_DEPS_PROTOCOL = 1 as const
export const PC_DEPS_PREFIX = '/pc-deps'

/** ok: in place and working. outdated: older than the app needs. missing: not there. broken: there but it does not work. unknown: could not be checked. */
export type DepState = 'ok' | 'outdated' | 'missing' | 'broken' | 'unknown'
/** The tab's sections, in order. */
export type DepGroup = 'core' | 'packages' | 'chats' | 'tools' | 'drive' | 'voice'

export interface DepRow {
  /** Stable id, e.g. "node", "npm", "pkg:postgres", "claude". */
  id: string
  group: DepGroup
  /** What it is, e.g. "Node.js", "npm", "postgres (app package)". */
  name: string
  /** What the app needs, e.g. ">=22.22", "3.4.8", "any", "en-IN and hi-IN". */
  required: string
  /** What this PC has, e.g. "24.22.1"; null when there is none. */
  installed: string | null
  /** Where it was found (a path, a service, a registry place); null when nowhere. */
  where: string | null
  state: DepState
  /** One plain sentence: why it matters, what is wrong, or what it is for. */
  note: string | null
  /** The exact command that fixes it on this PC (to run by hand, with his yes); null when it is ok or there is none. */
  fix: string | null
  /** What that command needs: 'admin' (an administrator PowerShell), 'sudo', 'none' (the person's own account), 'person' (only the person can, e.g. a sign-in). */
  fixRights: 'admin' | 'sudo' | 'none' | 'person' | null
}

export interface PcDepsReport {
  protocol: 1
  pcId: string
  /** 'online': the PC answered. 'offline': it is off or not connected. 'unsupported': its build cannot say (it needs an update). */
  connection: 'online' | 'offline' | 'unsupported'
  reason: string | null
  os: 'windows' | 'linux' | 'mac' | 'other' | null
  /** Where the app runs from on that PC (the folder its commands run in). */
  appRoot: string | null
  checkedAt: string | null
  rows: DepRow[]
}

export const DEP_GROUPS: readonly { group: DepGroup; title: string }[] = [
  { group: 'core', title: 'Node.js and npm' },
  { group: 'packages', title: 'The app’s packages' },
  { group: 'chats', title: 'Chats: Claude Code and Codex' },
  { group: 'tools', title: 'Tools' },
  { group: 'drive', title: 'The CRM drive' },
  { group: 'voice', title: 'Voice' },
]

export const DEP_STATE_WORDS: Readonly<Record<DepState, string>> = { ok: 'OK', outdated: 'Outdated', missing: 'Missing', broken: 'Broken', unknown: 'Unknown' }

// ---- strict checks ----

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const plain = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && ![...v].some(ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)
const plainOrNull = (v: unknown, max: number): string | null => (plain(v, max) ? v : null)
const PC_ID = /^[a-z0-9]{16}$/
const GROUPS = new Set<string>(DEP_GROUPS.map(g => g.group))
const STATES = new Set<string>(['ok', 'outdated', 'missing', 'broken', 'unknown'])

function cleanRow(raw: unknown): DepRow | null {
  if (!obj(raw) || !plain(raw.id, 80) || !GROUPS.has(String(raw.group)) || !plain(raw.name, 120) || !plain(raw.required, 160) || !STATES.has(String(raw.state))) return null
  return {
    id: raw.id,
    group: raw.group as DepGroup,
    name: raw.name,
    required: raw.required,
    installed: plainOrNull(raw.installed, 160),
    where: plainOrNull(raw.where, 400),
    state: raw.state as DepState,
    note: plainOrNull(raw.note, 400),
    // A fix may be a few commands on one line; it is shown as text to copy, never run from the page.
    fix: plainOrNull(raw.fix, 1200),
    fixRights: ['admin', 'sudo', 'none', 'person'].includes(String(raw.fixRights)) ? (raw.fixRights as DepRow['fixRights']) : null,
  }
}

/** What a fix needs, in words. */
export const FIX_RIGHTS_WORDS: Readonly<Record<NonNullable<DepRow['fixRights']>, string>> = {
  admin: 'In an administrator PowerShell (Windows asks to allow it).',
  sudo: 'Typed by you on that PC (it asks for your password).',
  none: 'In a normal terminal on that PC.',
  person: 'Only you can do this (a sign-in).',
}

/** The report as a PC said it, checked. Throws on one that is not that PC's; a bad row is left out. */
export function cleanDepsReport(raw: unknown, pcId: string): PcDepsReport {
  if (!obj(raw) || raw.protocol !== PC_DEPS_PROTOCOL || raw.pcId !== pcId || !PC_ID.test(pcId)) throw new Error('This is not that PC’s dependency list.')
  if (!['online', 'offline', 'unsupported'].includes(String(raw.connection)) || !Array.isArray(raw.rows) || raw.rows.length > 300) throw new Error('The dependency list is incomplete.')
  return {
    protocol: PC_DEPS_PROTOCOL,
    pcId,
    connection: raw.connection as PcDepsReport['connection'],
    reason: plainOrNull(raw.reason, 300),
    os: ['windows', 'linux', 'mac', 'other'].includes(String(raw.os)) ? (raw.os as PcDepsReport['os']) : null,
    appRoot: plainOrNull(raw.appRoot, 400),
    checkedAt: typeof raw.checkedAt === 'string' && Number.isFinite(Date.parse(raw.checkedAt)) ? raw.checkedAt : null,
    rows: raw.rows.map(cleanRow).filter((r): r is DepRow => r !== null),
  }
}

export function unknownDepsReport(pcId: string, connection: 'offline' | 'unsupported', reason: string): PcDepsReport {
  return { protocol: PC_DEPS_PROTOCOL, pcId, connection, reason, os: null, appRoot: null, checkedAt: null, rows: [] }
}

/** How a PC's list stands, for the tab's summary line: counts by state. */
export function depCounts(rows: readonly DepRow[]): Record<DepState, number> {
  const c: Record<DepState, number> = { ok: 0, outdated: 0, missing: 0, broken: 0, unknown: 0 }
  for (const r of rows) c[r.state]++
  return c
}

// ---- versions: the few forms package.json uses here (exact, ^, ~, >=), compared by numbers ----

/** "24.22.1" → [24, 22, 1, pre?]; null when there are no numbers. */
export function parseSemver(v: string): { nums: number[]; pre: string | null } | null {
  const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/.exec(v)
  return m ? { nums: [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)], pre: m[4] ?? null } : null
}

/** -1, 0 or 1. A pre-release is below its release. */
export function compareSemver(a: string, b: string): number {
  const x = parseSemver(a)
  const y = parseSemver(b)
  if (!x || !y) return 0
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] < y.nums[i] ? -1 : 1
  if (x.pre === y.pre) return 0
  if (x.pre === null) return 1
  if (y.pre === null) return -1
  return x.pre < y.pre ? -1 : 1
}

/** Does `version` meet `range` (exact, =, ^, ~, >=, >, *, x; anything else is taken as met)? */
export function meetsRange(version: string, range: string): boolean {
  const r = range.trim()
  if (!r || r === '*' || r === 'latest' || /^[a-z]+:/i.test(r)) return true
  const m = /^(\^|~|>=|>|=)?\s*v?(\d[\w.+-]*)$/.exec(r)
  if (!m) return true
  const [, op = '=', want] = m
  const cmp = compareSemver(version, want)
  const v = parseSemver(version)
  const w = parseSemver(want)
  if (!v || !w) return true
  if (op === '=') return cmp === 0
  if (op === '>=') return cmp >= 0
  if (op === '>') return cmp > 0
  if (op === '~') return cmp >= 0 && v.nums[0] === w.nums[0] && v.nums[1] === w.nums[1]
  // ^: the same major (or, below 1.0, the same minor).
  return cmp >= 0 && v.nums[0] === w.nums[0] && (w.nums[0] !== 0 || v.nums[1] === w.nums[1])
}
