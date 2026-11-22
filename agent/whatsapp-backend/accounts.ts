import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import path from 'node:path'
import { WA_ACCOUNT_LABEL_MAX, WA_ACCOUNT_RE, WA_ACCOUNTS_MAX, WA_MAIN_ACCOUNT } from '../../shared/whatsapp.ts'
import { writeAtomic } from '../config.ts'
import type { Logger } from '../log.ts'

// F-312 (Shubham, 22 Nov 2026: "link multiple WhatsApp"): the list of NUMBERS this Server's WhatsApp backend holds, and each one's name. The first number, `main`, is the login he linked before this existed: it is
// never created, moved or written here (its folder is <dir>\whatsapp, exactly where it always was; only its NAME may be kept in this file). Every other number has an id made here (WA_ACCOUNT_RE: `a` and hex)
// and its own folder <dir>\whatsapp\accounts\<id>, which holds its own login (auth), its own settings and its own pid note, and shares the installed packages (lib) with the first. Nothing a client sends is ever a path:
// an id is checked against WA_ACCOUNT_RE before anything uses it, and a folder is only ever joined from an id this module made.
// An unreadable file is never overwritten: it is set aside as accounts.json.unreadable-<time>, and the numbers are found again from the folders that exist (their names are their ids; the label is lost, never the login).

export const ACCOUNTS_FILE = 'accounts.json'
/** What the first number is called until he names it. */
export const MAIN_LABEL = 'Main number'

export interface AccountEntry {
  id: string
  label: string
}

export interface AccountsStore {
  /** Every number, the first first. */
  list(): AccountEntry[]
  has(id: string): boolean
  /** A new number (its id is made here). Refused in plain words (a 409 with a code) when there are already WA_ACCOUNTS_MAX of them. */
  add(label: string): AccountEntry
  /** A number's name (the first one's too: only its name is kept here). */
  rename(id: string, label: string): AccountEntry
  /** The folder of a number's own state under `whatsappDir` (`<whatsappDir>` itself for the first one). */
  dirOf(whatsappDir: string, id: string): string
}

const bad = (message: string, status = 400, code?: string) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) })

/** A label as it is kept: trimmed, one line, at most WA_ACCOUNT_LABEL_MAX characters; null when nothing is left. */
export function cleanLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  // oxlint-disable-next-line no-control-regex
  const t = raw.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim()
  return t === '' ? null : t.slice(0, WA_ACCOUNT_LABEL_MAX)
}

export function createAccounts(dir: string, log: Pick<Logger, 'warn'>, o: { now?: () => number; id?: () => string; folders?: () => string[] } = {}): AccountsStore {
  const file = path.join(dir, ACCOUNTS_FILE)
  const now = o.now ?? Date.now
  const newId = o.id ?? (() => `a${randomBytes(3).toString('hex')}`)
  let labels: Map<string, string> | null = null
  /** The ids of the extra numbers, in the order they were added. */
  let extra: string[] = []

  function load(): Map<string, string> {
    if (labels) return labels
    const out = new Map<string, string>()
    let found: string[] | null = null
    if (existsSync(file)) {
      try {
        const raw = JSON.parse(readFileSync(file, 'utf8')) as { accounts?: unknown }
        if (!Array.isArray(raw.accounts)) throw new Error('not the expected shape')
        for (const a of raw.accounts as { id?: unknown; label?: unknown }[]) {
          if (typeof a?.id !== 'string' || !WA_ACCOUNT_RE.test(a.id) || out.has(a.id)) continue
          const label = cleanLabel(a.label) ?? (a.id === WA_MAIN_ACCOUNT ? MAIN_LABEL : `Number ${a.id}`)
          out.set(a.id, label)
          if (a.id !== WA_MAIN_ACCOUNT) extra.push(a.id)
        }
        found = extra
      } catch {
        try {
          renameSync(file, `${file}.unreadable-${now()}`)
        } catch {
          // Left where it is: the next write replaces nothing that could not be read.
        }
        log.warn('the WhatsApp numbers file could not be read: it was set aside, and the numbers are found again from their folders')
        out.clear()
        extra = []
      }
    }
    if (found === null) for (const id of o.folders?.() ?? []) if (WA_ACCOUNT_RE.test(id) && id !== WA_MAIN_ACCOUNT && !out.has(id)) {
      out.set(id, `Number ${id}`)
      extra.push(id)
    }
    if (!out.has(WA_MAIN_ACCOUNT)) out.set(WA_MAIN_ACCOUNT, MAIN_LABEL)
    labels = out
    return out
  }

  function save() {
    const m = load()
    mkdirSync(dir, { recursive: true })
    // The first number is written only once he has named it: until then the file lists the extra numbers alone.
    const rows = [...(m.get(WA_MAIN_ACCOUNT) !== MAIN_LABEL ? [WA_MAIN_ACCOUNT] : []), ...extra].map(id => ({ id, label: m.get(id)! }))
    writeAtomic(file, `${JSON.stringify({ version: 1, accounts: rows }, null, 2)}\n`)
  }

  return {
    list() {
      const m = load()
      return [WA_MAIN_ACCOUNT, ...extra].map(id => ({ id, label: m.get(id)! }))
    },
    has: id => load().has(id),
    add(rawLabel) {
      const label = cleanLabel(rawLabel)
      if (!label) throw bad('Give the number a name, for example "Work".')
      const m = load()
      if (m.size >= WA_ACCOUNTS_MAX) throw bad(`This Server holds at most ${WA_ACCOUNTS_MAX} WhatsApp numbers (each one runs its own Chrome).`, 409, 'wa-accounts-full')
      let id = newId()
      for (let tries = 0; m.has(id) && tries < 10; tries++) id = newId()
      if (!WA_ACCOUNT_RE.test(id) || m.has(id)) throw bad('A number could not be added.', 500)
      m.set(id, label)
      extra.push(id)
      save()
      return { id, label }
    },
    rename(id, rawLabel) {
      const label = cleanLabel(rawLabel)
      if (!label) throw bad('Give the number a name, for example "Work".')
      const m = load()
      if (!m.has(id)) throw bad('There is no such number.', 404, 'wa-no-such-account')
      m.set(id, label)
      save()
      return { id, label }
    },
    dirOf(whatsappDir, id) {
      // The only way an id becomes a path: it must be exactly one this app makes.
      if (!WA_ACCOUNT_RE.test(id)) throw bad('That is not a WhatsApp number of this app.', 400, 'wa-bad-account')
      return id === WA_MAIN_ACCOUNT ? whatsappDir : path.join(whatsappDir, 'accounts', id)
    },
  }
}
