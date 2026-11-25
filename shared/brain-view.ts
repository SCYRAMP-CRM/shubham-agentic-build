// F-332: a small PARSER of the new memory's "brain" (a Markdown document the standalone service writes: C:/saw/memory-standalone-20261123/service/src/brain.mjs), for the Memory page. It is not a
// general Markdown reader and does not try to be one: the brain has a fixed shape (a title, an intro, `## Scope <x>` with `### <section>` lists, `## Links`, `## Decisions and reasons`, a footer),
// and every piece of STORED text in it is escaped by the service with a backslash before each of  \ ` * _ { } [ ] ( ) # + ! | < > ~  so it can never become a heading, a link, a code span or HTML.
//   - The text is turned into NODES (text, bold, code, italic, an item's #id); the page renders them as React text, never as HTML.
//   - A backslash escape is undone ONLY AFTER the text has been cut into nodes, so an escaped `\*\*x\*\*` stays plain text and can never become bold.
//   - It never throws, whatever it is given, and it reads each line once (no backtracking): a 5 MB brain is a linear pass.

export type Inline =
  | { t: 'text'; s: string }
  | { t: 'bold'; s: string }
  | { t: 'code'; s: string }
  | { t: 'em'; s: string }
  | { t: 'id'; id: number }
  /** F-333: the predicate of a memory he ADDED (`note-20261124-130501-123`): its raw name and the UTC time in it (ISO). The page draws it as "Note, 24 Nov 13:05" and keeps the raw name only in a tooltip. */
  | { t: 'note'; raw: string; at: string }

export interface BrainItem {
  nodes: Inline[]
  /** A nested line (a dispute's two sides). */
  children: BrainItem[]
}

export interface BrainSection {
  title: string
  items: BrainItem[]
  /** Lines that are not list items. */
  notes: Inline[][]
}

export interface BrainScope {
  name: string
  sections: BrainSection[]
}

export interface BrainDoc {
  title: string
  intro: Inline[][]
  scopes: BrainScope[]
  /** `## Links`, `## Decisions and reasons` and any other `## ` group the service may add later: shown, never dropped. */
  groups: BrainSection[]
  footer: Inline[] | null
}

export const MAX_INLINE = 4000

const SPECIAL = new Set('\\`*_{}[]()#+!|<>~-=>'.split(''))

/** The text with the brain's backslash escapes undone: `\_` is `_`. A backslash before anything else is left as it is. */
export function unescapeBrain(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && i + 1 < s.length && SPECIAL.has(s[i + 1])) {
      out += s[i + 1]
      i++
    } else out += c
  }
  return out
}

const isWord = (c: string | undefined) => c !== undefined && /[A-Za-z0-9]/.test(c)

/** The index of the next UNESCAPED `needle` at or after `from` (a backslash skips the character after it), or -1. */
function findClose(s: string, needle: string, from: number): number {
  for (let i = from; i < s.length; i++) {
    if (s[i] === '\\') {
      i++
      continue
    }
    if (s.startsWith(needle, i)) return i
  }
  return -1
}

/** One line of the brain as nodes. Escapes are undone inside each node's text, after the cutting. */
export function parseInline(line: string): Inline[] {
  // The service cuts every stored text to 300-600 characters, so a line is short. A far longer one is not a brain line: plain text (a quadratic search for a closing mark on a hostile line is not allowed).
  if (line.length > MAX_INLINE) return [{ t: 'text', s: unescapeBrain(line) }]
  const out: Inline[] = []
  let buf = ''
  const flush = () => {
    if (buf) out.push({ t: 'text', s: unescapeBrain(buf) })
    buf = ''
  }
  let i = 0
  while (i < line.length) {
    const c = line[i]
    if (c === '\\') {
      // an escape: the pair stays in the buffer as it is and is undone when the buffer is flushed
      buf += line.slice(i, i + 2)
      i += 2
      continue
    }
    if (c === '*' && line[i + 1] === '*') {
      const end = findClose(line, '**', i + 2)
      if (end > i + 2) {
        flush()
        out.push({ t: 'bold', s: unescapeBrain(line.slice(i + 2, end)) })
        i = end + 2
        continue
      }
    }
    if (c === '`') {
      const end = line.indexOf('`', i + 1)
      if (end > i + 1) {
        flush()
        out.push({ t: 'code', s: line.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }
    if (c === '_' && !isWord(line[i - 1])) {
      const end = findClose(line, '_', i + 1)
      if (end > i + 1 && !isWord(line[end + 1])) {
        flush()
        out.push({ t: 'em', s: unescapeBrain(line.slice(i + 1, end)) })
        i = end + 1
        continue
      }
    }
    if (c === '#' && /[0-9]/.test(line[i + 1] ?? '') && !isWord(line[i - 1])) {
      let j = i + 1
      while (j < line.length && /[0-9]/.test(line[j])) j++
      if (j - i - 1 <= 12) {
        flush()
        out.push({ t: 'id', id: Number(line.slice(i + 1, j)) })
        i = j
        continue
      }
    }
    buf += c
    i++
  }
  flush()
  return out
}

const plain = (nodes: Inline[]) => nodes.map(n => (n.t === 'id' ? `#${n.id}` : n.t === 'note' ? n.raw : n.s)).join('')

// F-333: a memory he added is a fact whose predicate is `note-YYYYMMDD-HHMMSS-mmm` (UTC; shared/new-memory.ts notePredicate). In an item the predicate stands right after the bold subject ("**Shubham Bhole** · note-...: \"...\""):
// ONLY there, and only when the stamp is a real date, it becomes a `note` node. Any other predicate, and the same words anywhere else in a line (inside what he typed), stay exactly as they are: text.
const NOTE_AFTER_SUBJECT = /^( · )(note-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(\d{3}))(?=: )/

function noteStamp(m: RegExpExecArray): string | null {
  const [y, mo, d, h, mi, s, ms] = [m[3], m[4], m[5], m[6], m[7], m[8], m[9]].map(Number)
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi, s, ms))
  if (Number.isNaN(t.getTime()) || t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d || t.getUTCHours() !== h || t.getUTCMinutes() !== mi || t.getUTCSeconds() !== s) return null
  return t.toISOString()
}

/** The nodes of an item, with the predicate of an added memory (right after the bold subject) made a `note` node. Nothing else changes. */
export function noteify(nodes: Inline[]): Inline[] {
  const out: Inline[] = []
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    const m = i > 0 && nodes[i - 1].t === 'bold' && n.t === 'text' ? NOTE_AFTER_SUBJECT.exec(n.s) : null
    const at = m ? noteStamp(m) : null
    if (m && at && n.t === 'text') {
      out.push({ t: 'text', s: m[1] }, { t: 'note', raw: m[2], at })
      if (n.s.length > m[0].length) out.push({ t: 'text', s: n.s.slice(m[0].length) })
    } else out.push(n)
  }
  return out
}

/** "Note, 24 Nov 13:05": the time in a note's predicate, shown in `timeZone` (the page passes none: the reader's own). */
export function noteLabel(at: string, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(timeZone ? { timeZone } : {}) }).formatToParts(new Date(at))
  const get = (k: string) => parts.find(p => p.type === k)?.value ?? ''
  return `Note, ${get('day')} ${get('month')} ${get('hour')}:${get('minute')}`
}

/** The brain as a document. Any text at all gives a document (an empty one for nothing). */
export function parseBrain(markdown: string): BrainDoc {
  const doc: BrainDoc = { title: '', intro: [], scopes: [], groups: [], footer: null }
  let section: BrainSection | null = null
  let scope: BrainScope | null = null
  let lastItem: BrainItem | null = null
  const lines = String(markdown ?? '').split('\n')
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '')
    if (!line.trim()) continue
    const h1 = /^# (.*)$/.exec(line)
    if (h1) {
      doc.title = plain(parseInline(h1[1]))
      continue
    }
    const h2 = /^## (.*)$/.exec(line)
    if (h2) {
      lastItem = null
      const scopeName = /^Scope (.*)$/.exec(h2[1])
      if (scopeName) {
        scope = { name: unescapeBrain(scopeName[1]), sections: [] }
        doc.scopes.push(scope)
        section = null
      } else {
        scope = null
        section = { title: plain(parseInline(h2[1])), items: [], notes: [] }
        doc.groups.push(section)
      }
      continue
    }
    const h3 = /^### (.*)$/.exec(line)
    if (h3) {
      lastItem = null
      section = { title: plain(parseInline(h3[1])), items: [], notes: [] }
      if (scope) scope.sections.push(section)
      else doc.groups.push(section)
      continue
    }
    const nested = /^ {2,}- (.*)$/.exec(line)
    if (nested && lastItem) {
      lastItem.children.push({ nodes: noteify(parseInline(nested[1])), children: [] })
      continue
    }
    const item = /^- (.*)$/.exec(line)
    if (item) {
      lastItem = { nodes: noteify(parseInline(item[1])), children: [] }
      if (section) section.items.push(lastItem)
      else if (scope) {
        section = { title: '', items: [lastItem], notes: [] }
        scope.sections.push(section)
      } else doc.intro.push(lastItem.nodes)
      continue
    }
    const nodes = parseInline(line.trim())
    lastItem = null
    // the footer: an italic line at the very end ("_Generated ... etag ..._"); detected by its shape, kept as the last one seen
    if (nodes.length === 1 && nodes[0].t === 'em' && /^Generated /.test(nodes[0].s)) {
      doc.footer = nodes
      continue
    }
    if (section) section.notes.push(nodes)
    else doc.intro.push(nodes)
  }
  return doc
}

/** The scope names in a brain, one per `## Scope <x>` heading, as the real names (escapes undone), in the brain's order, no repeats. */
export function scopesOf(markdown: string): string[] {
  const out: string[] = []
  for (const raw of String(markdown ?? '').split('\n')) {
    const m = /^## Scope (.+?)\r?$/.exec(raw)
    if (!m) continue
    const name = unescapeBrain(m[1])
    if (!out.includes(name)) out.push(name)
  }
  return out
}

/** Whether a document has nothing a person would read: no scope, no group with an item. */
export const brainIsEmpty = (d: BrainDoc): boolean => d.scopes.every(s => s.sections.every(x => !x.items.length && !x.notes.length)) && d.groups.every(g => !g.items.length && !g.notes.length)
