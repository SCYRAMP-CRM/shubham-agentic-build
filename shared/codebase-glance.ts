import { sortRows } from './accounts-table.ts'
import type { CodebaseRow, DetailKind } from './codebase-accounts.ts'
import { SECTION_WORDS } from './codebase-tabs.ts'

// order o844d (F-275, Shubham via the Assistant: "please give some oen het job to make ui ofth e codebase stabs better please"): the Codebases tab's cards. The pure part: what a card says about a
// codebase at a glance (which of its details are filled in and which are missing), the words of the gentle "Add ..." prompt, the order a card list is shown in, and the shape of an address.
// The component is src/accounts/CodebaseCards.tsx. UI ONLY: everything here is worked out from the row the list already gives (shared/codebase-accounts.ts), so no door, query or agent answer changes
// for it. What is under the window's own tabs (the links and descriptions of Frontend, Backend, Deployment, Database, and the Env tab) is read only when the window opens, so a card does not claim to know
// it: a tab chip is a shortcut that opens the window at that tab, and it shows a number only for what the row itself lists (the CRM's Deployment and Database rows).
// Nothing here ever holds a secret: a hidden address or note is only "hidden".

/** The details of a codebase a card reports on (the fields of the edit form). These, and only these, are counted for "4 of 4 filled in". */
export type FieldId = 'repo' | 'stack' | 'owner' | 'about'
/** The tabs of the codebase window a card has a chip for. Env is not one: it holds variable names and values behind their own switches and is left to the window. */
export type TabId = 'fe' | 'be' | 'database' | 'deployment'

export interface FieldPart {
  id: FieldId
  /** The word on the card: "Repository", "Stack", "Owner", "Description". */
  label: string
  filled: boolean
  /** What is there, in a few words, with nothing secret in it ("github.com/org/repo", "hidden"). Null when empty. */
  summary: string | null
  /** The gentle prompt of an empty field: "Add repository". */
  add: string
}

export interface TabPart {
  id: TabId
  /** "Frontend", "DB"; the old names (FE, Database...) when Settings shows the old five. */
  label: string
  /** The CRM's own rows of that kind (Deployment, Database) that the row lists, switched-off ones left out; 0 for the others, and for none. Never a measure of what the tab itself holds. */
  count: number
}

export interface Glance {
  fields: FieldPart[]
  /** The tab chips, in the order the codebase window shows its tabs. */
  tabs: TabPart[]
  /** Fields that are filled in, and the fields counted (always the same four). */
  filled: number
  total: number
  /** What the Repository line shows: the codebase's own address, else the first GitHub row's; hidden when it looked like a secret. */
  repo: { url: string | null; hidden: boolean; fromRow: boolean }
}

/** The chips, in the order of the window's tabs: Frontend, Backend, DB by default (the window also has Env, last); the old four of the five when Settings asks. */
export const TAB_ORDER_DEFAULT: readonly TabId[] = ['fe', 'be', 'database']
export const TAB_ORDER_FIVE: readonly TabId[] = ['be', 'fe', 'deployment', 'database']

const DEFAULT_WORDS: Record<'fe' | 'be' | 'database', string> = { fe: 'Frontend', be: 'Backend', database: 'DB' }

export function tabLabel(id: TabId, five: boolean): string {
  if (!five && (id === 'fe' || id === 'be' || id === 'database')) return DEFAULT_WORDS[id]
  return SECTION_WORDS[id]
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "github.com/org/repo" from an address: no scheme, no trailing slash, no ".git"; "git@host:org/repo.git" reads the same way. */
export function shortAddress(url: string): string {
  const t = url.trim()
  const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(t)
  const bare = scp ? `${scp[1]}/${scp[2]}` : t.replace(/^[a-z][a-z0-9+.-]*:\/\/(?:[^/@]*@)?/i, '')
  return bare.replace(/\/+$/, '').replace(/\.git$/i, '')
}

const detailsOf = (row: CodebaseRow, kind: DetailKind) => row.details.filter(d => d.kind === kind && !d.disabled)

function repoOf(row: CodebaseRow): Glance['repo'] {
  if (row.repoUrl) return { url: row.repoUrl, hidden: false, fromRow: false }
  if (row.repoHidden) return { url: null, hidden: true, fromRow: false }
  const g = detailsOf(row, 'github').find(d => d.url)
  if (g?.url) return { url: g.url, hidden: false, fromRow: true }
  return { url: null, hidden: false, fromRow: false }
}

/** What a card says about one codebase. `five` is Settings > Pages > "Show all five codebase tabs": the chips shown (the fields counted are the same either way). */
export function glance(row: CodebaseRow, five: boolean): Glance {
  const repo = repoOf(row)
  const field = (id: FieldId, label: string, add: string, filled: boolean, summary: string | null): FieldPart => ({ id, label, filled, summary: filled ? summary : null, add })
  const fields: FieldPart[] = [
    field('repo', 'Repository', 'Add repository', repo.url !== null || repo.hidden, repo.url ? shortAddress(repo.url) : repo.hidden ? 'hidden' : null),
    field('stack', 'Stack', 'Add stack', row.stack !== null, row.stack),
    field('owner', 'Owner', 'Add owner', row.owner !== null, row.owner),
    field('about', 'Description', 'Add a description', row.note !== null || row.noteHidden, row.noteHidden ? 'hidden' : null),
  ]
  // The CRM's own rows of the same kind (a deployment, a database console) are shown in the window under the tabs, so they are what a chip can count.
  const tabs: TabPart[] = (five ? TAB_ORDER_FIVE : TAB_ORDER_DEFAULT).map(id => ({ id, label: tabLabel(id, five), count: id === 'deployment' || id === 'database' ? detailsOf(row, id).length : 0 }))
  return { fields, tabs, filled: fields.filter(f => f.filled).length, total: fields.length, repo }
}

/** "3 of 4 filled in". */
export const filledWords = (g: Pick<Glance, 'filled' | 'total'>): string => `${g.filled} of ${g.total} filled in`

/** "repository", "repository and owner", "repository, owner and stack": the words of the gentle "Add ..." prompt. */
export function listWords(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** A tab chip's name for a screen reader: what it is and what it does. */
export function tabAria(t: TabPart): string {
  return t.count > 0 ? `${t.label}: ${plural(t.count, 'link')}. Open it.` : `${t.label}. Open it.`
}

// ---- the order of the cards --------------------------------------------------------------------------------------------------------------------------

export type CardSort = 'name' | 'gaps' | 'complete' | 'updated' | 'owner'
export const CARD_SORTS: readonly { value: CardSort; label: string }[] = [
  { value: 'name', label: 'Name, A to Z' },
  { value: 'gaps', label: 'Least filled in first' },
  { value: 'complete', label: 'Most filled in first' },
  { value: 'updated', label: 'Recently updated first' },
  { value: 'owner', label: 'Owner' },
]
export const isCardSort = (v: unknown): v is CardSort => CARD_SORTS.some(o => o.value === v)

const ratio = (row: CodebaseRow): number => {
  const g = glance(row, false)
  return g.total === 0 ? 0 : g.filled / g.total
}
const time = (iso: string | null): number | null => {
  const t = iso ? Date.parse(iso) : Number.NaN
  return Number.isNaN(t) ? null : t
}

/** The rows in the order a card list asks for (a copy). Ties keep the name order, so a second sort never shuffles equals; a codebase with no owner or date goes last either way. */
export function sortCards(rows: readonly CodebaseRow[], mode: CardSort): CodebaseRow[] {
  const byName = sortRows(rows, r => r.name, 'asc')
  switch (mode) {
    case 'name':
      return byName
    case 'gaps':
      return sortRows(byName, r => ratio(r), 'asc')
    case 'complete':
      return sortRows(byName, r => ratio(r), 'desc')
    case 'updated':
      return sortRows(byName, r => time(r.updatedAt), 'desc')
    case 'owner':
      return sortRows(byName, r => r.owner, 'asc')
  }
}
