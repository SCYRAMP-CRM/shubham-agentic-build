import { createHash, randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import type { Floor, MemoryEntry } from '../../shared/agentic.ts'
import {
  DEFAULT_MEMORY_SETTINGS,
  LIBRARIAN_MODELS,
  type LibrarianMode,
  type LibrarianRun,
  type MemoryHit,
  type MemoryKind,
  type MemorySettings,
  type MemoryStatus,
  type WikiPage,
  type WikiPageMeta,
} from '../../shared/memory.ts'
import { apiError } from '../api.ts'
import { writeAtomic } from '../config.ts'
import type { Logger } from '../log.ts'
import { createEmbedder, type Embedder } from './embedder.ts'
import { librarianEnv, runLibrarian, takeMaterial, writeInbox, type Material, type NoteMaterial, type SeedMaterial } from './librarian.ts'
import { fuse, nearest, sections, snippet, terms, WordIndex, type FusedHit, type WordHit } from './memory-search.ts'
import { cleanSaid, createTurnLog, isRelayText, redact, type SessionRef, type Turn } from './memory-turns.ts'
import { CORE, createWiki, INBOX_KEEP_DAYS, OWNER_NAME, pagePath } from './wiki.ts'

// F-051: the memory layer (agent/SPEC.md › F-051), run on the hub (or a PC on its own); the
// other PCs' chats reach it through the hub as their tool calls do.
//   index      every wiki section, every note of every floor, every turn of the floor chats,
//              by words (BM25) and, once the model is ready, by meaning (memory-search.ts)
//   recall     each prompt of a floor chat (its UserPromptSubmit hook, memory-hook.ts): the few
//              best matches, when they are good enough and weren't just shown to that chat
//   brief      core.md and the wiki's index, for every chat's brief when it starts
//   librarian  compiles what is new into the wiki: when a person presses Compile, or by
//              itself when switched on (at most every everyHours, only with new material)
// State in <state>/agent/agentic/memory-layer: state.json (settings, what was compiled, the
// runs), turns.jsonl, turns-cursors.json, vectors-<model>.jsonl (the meaning vectors, by the
// hash of what they mean); the wiki in <state>/agent/agentic/wiki.

/** A hit counts for recall when its meaning is this close, or it holds this much of the prompt's words. */
export const RECALL_MEANING_MIN = 0.62
export const RECALL_WORDS_MIN = 0.75
export const RECALL_MAX = 4
/** A hit shown to a chat isn't shown to it again within this many of its prompts. */
const RECALL_QUIET = 8
const CORE_MAX = 4000
const INDEX_MAX = 3000
const RUNS_KEPT = 20
const AUTO_MIN_CHARS = 1500
const READ_MAX = 30_000

interface Doc {
  id: string
  kind: MemoryKind
  title: string
  heading: string | null
  text: string
  path: string | null
  floorId: string | null
  sessionId: string | null
  at: string | null
  hash: string
}

interface State {
  settings: MemorySettings
  /**
   * What the librarian has compiled: notes by key → version, memory files by path → mtime; the
   * turns (in the order kept) up to `turns`, and of the past (those before `baseline`) the first `history`.
   */
  compiled: { notes: Record<string, string>; seeds: Record<string, string>; turns: number; history: number }
  /** How many turns there were when the memory first started: those are the past, compiled only when asked. */
  baseline: number | null
  runs: LibrarianRun[]
  lastAutoAt: number | null
}

export interface MemoryLayerOptions {
  /** <state>/agent/agentic */
  dir: string
  /** <state>/agent/models */
  modelsDir: string
  /** Every note of a floor. */
  notes: (floorId: string) => MemoryEntry[]
  /**
   * The floors whose chats FEED this memory, with only the agents that do (memory-people.ts `feedFloors`): their chats' turns are read and kept. A turn already in the log whose session
   * is not one of these (or an earlier session of one: conversationHistory) is not indexed, not read and not compiled.
   */
  floors: () => Floor[]
  /**
   * oc65c/F-051 S4: the floors whose NOTES this memory reads (memory-people.ts `noteFloors`: every agent on the floor is the person's). Left out: the same floors as `floors`.
   */
  noteFloors?: () => Floor[]
  /**
   * oc65c/F-051 S4 (Agent 14's F2): the floors, with only the agents, whose chats do NOT feed this memory (memory-people.ts `unfedFloors`). Their transcripts are not read, but their read
   * position is moved to the end of their files at every collect, so what is typed in them while they do not feed (another person's words in a chat shared for typing, the old
   * owner's backlog of a chat that changed hands) is never read as this person's later. Left out: none are skipped.
   */
  unfedFloors?: () => Floor[]
  /** A session's JSONL on this PC, or null. */
  transcript: (sessionId: string) => string | null
  /** Claude Code's projects folder: the memory files its chats keep are material too. */
  projectsDir: string
  /**
   * oc65c/F-051 S3: the project folders (names under projectsDir) whose Claude Code memory files (`<project>/memory/*.md`) this memory may read: the person's OWN, and
   * no other person's chat runs in them (memory-people.ts `ownProjects`). Left out: none: the memory files of every project are no longer swept, and a layer that is not
   * told whose folders are its own reads no memory file at all (fail closed). What is read is redacted like a note.
   */
  memoryProjects?: () => readonly string[]
  token?: () => string | null
  /** claude on this PC, or null. */
  claude?: () => string | null
  log?: Logger
  /** Tests: a stand-in model. */
  embedder?: Embedder
  env?: NodeJS.ProcessEnv
  /** Tests: no timers (collect and the schedule run when called). */
  timers?: boolean
  /** Tests: put before claude's arguments (a pretend claude run as node <script>). */
  claudeArgs?: string[]
  /** Something the Memory tab shows changed (a run started or ended). */
  onChange?: () => void
  /** False while this PC isn't the one keeping the memory (a hub's member): its timers rest. */
  active?: () => boolean
  /** The chats get it (recall, the brief's section): the layer is switched on, not only there to search. */
  live?: boolean
  /**
   * oc65c/F-051 S1: whose memory this is. Only the name is used, in every text the layer makes ("Shubham on Final", "Shubham said:", what
   * the brief says wins). Left out: the owner's, so every text is as it has always been. The key itself is memory-people.ts's.
   */
  person?: { name: string }
  /** Where the layer keeps its state (default <dir>/memory-layer) and its wiki (default <dir>/wiki): a person's own folders (memory-people.ts). */
  home?: string
  wikiDir?: string
  /**
   * The settings a NEW state starts with (a state already saved keeps its own, and a field it lacks takes this): how a person's memory is
   * told what to learn from before they have chosen. Left out: DEFAULT_MEMORY_SETTINGS.
   */
  settings?: Partial<MemorySettings>
}

export interface MemoryLayer {
  /** Makes the wiki, reads everything in, starts the timers; once. */
  start(): Promise<void>
  search(query: string, o?: { limit?: number; kinds?: MemoryKind[]; excludeSession?: string | null }): Promise<MemoryHit[]>
  /** What a chat's prompt brings from the memory ('' for nothing). */
  recall(o: { sessionId: string; prompt: string }): Promise<string>
  /** The brief's memory section: core.md and the wiki's index. */
  brief(): string
  /** memory_read: a page by path, or a hit by id. */
  read(ref: string): string
  pages(): WikiPageMeta[]
  page(rel: string): WikiPage | null
  status(): MemoryStatus
  setSettings(patch: unknown): MemorySettings
  compile(mode: LibrarianMode, trigger: 'now' | 'auto'): LibrarianRun
  /** A floor's notes changed (saved, edited, deleted, or the floor went). */
  notesChanged(floorId: string): void
  /** Tests and the timer: the floor chats' new turns. */
  collectTurns(): number
  /** Tests: every missing vector made. */
  settle(): Promise<void>
  close(): void
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const round = (n: number) => Math.round(n * 1000) / 1000
const sha1 = (s: string) => createHash('sha1').update(s).digest('hex')
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '')

/** The prompt as a search, or null when it is nothing to search on: a command, another chat's message, a word or two. */
export function recallQuery(prompt: string): string | null {
  const said = cleanSaid(prompt)
  if (!said || said.from === 'chat') return null
  const t = said.text.trim()
  if (t.startsWith('/')) return null
  if (terms(t).filter(w => w.length >= 3).length < 3) return null
  return t.slice(0, 1500)
}

export function relevant(h: MemoryHit): boolean {
  return (h.meaning !== null && h.meaning >= RECALL_MEANING_MIN) || h.words >= RECALL_WORDS_MIN
}

function hitLine(h: MemoryHit): string {
  const text = h.text.replace(/\s+/g, ' ').trim()
  const cut = text.length > 360 ? `${text.slice(0, 360)}…` : text
  if (h.kind === 'wiki') return `- wiki ${h.path}${h.heading ? ` › ${h.heading}` : ''}${h.at ? ` (updated ${day(h.at)})` : ''}: ${cut}`
  if (h.kind === 'note') return `- note, ${h.title}${h.at ? `, ${day(h.at)}` : ''}: ${cut}`
  return `- ${h.title}${h.at ? `, ${day(h.at)}` : ''} [${h.id}]: ${cut}`
}

/** `name`: whose memory it is (left out: the owner's, as it has always been). */
export function formatRecall(hits: MemoryHit[], name: string = OWNER_NAME): string {
  if (!hits.length) return ''
  return [
    `From Shubham Agentic's memory, found for this message (memory_read opens one in full, memory_search finds more; it may be out of date, and what ${name} says now wins):`,
    ...hits.map(hitLine),
  ].join('\n')
}

function loadState(file: string, defaults: Partial<MemorySettings> = {}): State {
  const fresh: State = { settings: cleanSettings(defaults, DEFAULT_MEMORY_SETTINGS), compiled: { notes: {}, seeds: {}, turns: 0, history: 0 }, baseline: null, runs: [], lastAutoAt: null }
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (!isObject(raw)) return fresh
    const c = isObject(raw.compiled) ? raw.compiled : {}
    return {
      settings: cleanSettings(raw.settings, fresh.settings),
      compiled: {
        notes: isObject(c.notes) ? (c.notes as Record<string, string>) : {},
        seeds: isObject(c.seeds) ? (c.seeds as Record<string, string>) : {},
        turns: typeof c.turns === 'number' ? c.turns : 0,
        history: typeof c.history === 'number' ? c.history : 0,
      },
      baseline: typeof raw.baseline === 'number' ? raw.baseline : null,
      runs: Array.isArray(raw.runs) ? (raw.runs as LibrarianRun[]).filter(r => isObject(r) && typeof r.id === 'string').slice(0, RUNS_KEPT) : [],
      lastAutoAt: typeof raw.lastAutoAt === 'number' ? raw.lastAutoAt : null,
    }
  } catch {
    return fresh
  }
}

export function cleanSettings(v: unknown, base: MemorySettings): MemorySettings {
  const s = isObject(v) ? v : {}
  const hours = typeof s.everyHours === 'number' && Number.isFinite(s.everyHours) ? Math.min(168, Math.max(1, Math.round(s.everyHours))) : base.everyHours
  return {
    auto: typeof s.auto === 'boolean' ? s.auto : base.auto,
    everyHours: hours,
    model: (LIBRARIAN_MODELS as readonly unknown[]).includes(s.model) ? (s.model as MemorySettings['model']) : base.model,
    recall: typeof s.recall === 'boolean' ? s.recall : base.recall,
    fromChats: typeof s.fromChats === 'boolean' ? s.fromChats : base.fromChats,
    fromAgents: typeof s.fromAgents === 'boolean' ? s.fromAgents : base.fromAgents,
    pastChats: typeof s.pastChats === 'boolean' ? s.pastChats : base.pastChats,
  }
}

export function createMemoryLayer(o: MemoryLayerOptions): MemoryLayer {
  const home = o.home ?? path.join(o.dir, 'memory-layer')
  mkdirSync(home, { recursive: true })
  const stateFile = path.join(home, 'state.json')
  const state = loadState(stateFile, o.settings)
  const save = () => writeAtomic(stateFile, `${JSON.stringify(state, null, 2)}\n`)
  /** Whose memory this is: the name the texts below use. */
  const name = o.person?.name ?? OWNER_NAME
  const wiki = createWiki(o.wikiDir ?? path.join(o.dir, 'wiki'), name)
  const turns = createTurnLog(home)
  const embedder = o.embedder ?? createEmbedder({ dir: o.modelsDir, model: o.env?.SAD_MEMORY_MODEL ?? process.env.SAD_MEMORY_MODEL, log: o.log })
  const log = o.log

  const docs = new Map<string, Doc>()
  const words = new WordIndex()
  /** By the doc's id, once its meaning is known. */
  const vectors = new Map<string, Float32Array>()
  /** By the hash of what is embedded: a doc unchanged across a restart isn't embedded again. */
  const cache = new Map<string, Float32Array>()
  const vecFile = path.join(home, `vectors-${embedder.model.replace(/[^\w.-]+/g, '_')}.jsonl`)
  let vecLines = 0
  let started = false
  let closed = false
  let pumping: Promise<void> | null = null
  let running: LibrarianRun | null = null
  let wikiMarks = new Map<string, string>()
  let wikiCheckedAt = 0
  const timers: NodeJS.Timeout[] = []
  const shown = new Map<string, { n: number; at: Map<string, number> }>()

  // -------------------------------------------------------------------------------------------
  // The vectors kept on disk

  function loadVectors() {
    if (!existsSync(vecFile)) return
    for (const line of readFileSync(vecFile, 'utf8').split('\n')) {
      if (!line.trim()) continue
      vecLines++
      try {
        const r = JSON.parse(line) as { h: string; v: string }
        const b = Buffer.from(r.v, 'base64')
        cache.set(r.h, new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice())
      } catch {
        // A torn line: that one is embedded again.
      }
    }
  }

  function keepVector(hash: string, v: Float32Array) {
    cache.set(hash, v)
    appendFileSync(vecFile, `${JSON.stringify({ h: hash, v: Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64') })}\n`)
    vecLines++
  }

  /** The file holds every vector ever made; rewritten with only the live ones once it is mostly dead. */
  function compactVectors() {
    const live = new Set([...docs.values()].map(d => d.hash))
    if (vecLines < 2 * live.size + 500) return
    for (const h of [...cache.keys()]) if (!live.has(h)) cache.delete(h)
    writeAtomic(vecFile, [...cache].map(([h, v]) => `${JSON.stringify({ h, v: Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64') })}\n`).join(''))
    vecLines = cache.size
  }

  // -------------------------------------------------------------------------------------------
  // What is indexed

  const fullText = (d: Pick<Doc, 'title' | 'heading' | 'text'>) => `${d.title}${d.heading ? ` › ${d.heading}` : ''}\n${d.text}`
  // Meaning from a turn's opening (what was said comes first), 3x faster to make; words search
  // all of it, and memory_read gives all of it.
  const embedText = (d: Pick<Doc, 'kind' | 'title' | 'heading' | 'text'>) => fullText(d).slice(0, d.kind === 'turn' ? 1000 : 2400)

  function put(d: Omit<Doc, 'hash'>) {
    // A vector is kept by what was embedded, exactly: a change in how that is cut makes a new one.
    const doc: Doc = { ...d, hash: sha1(`${embedder.model}\n${embedText(d)}`) }
    const old = docs.get(doc.id)
    if (old && old.hash === doc.hash) {
      Object.assign(old, { at: doc.at, floorId: doc.floorId })
      return
    }
    docs.set(doc.id, doc)
    words.set(doc.id, fullText(doc))
    const v = cache.get(doc.hash)
    if (v) vectors.set(doc.id, v)
    else vectors.delete(doc.id)
  }

  function drop(id: string) {
    docs.delete(id)
    words.remove(id)
    vectors.delete(id)
  }

  /** The floors whose notes are read (S4). */
  const noteFloorList = (): Floor[] => (o.noteFloors ?? o.floors)()
  const floorName = (id: string) => noteFloorList().find(f => f.id === id)?.name ?? id

  function syncNotes(floorId: string) {
    const prefix = `note:${floorId}/`
    const seen = new Set<string>()
    let entries: MemoryEntry[] = []
    try {
      // S4: the notes of a floor that is not one of this person's (a chat of another person is on it) are not read: any that were are let go below.
      entries = noteFloorList().some(f => f.id === floorId) ? o.notes(floorId) : []
    } catch {
      entries = []
    }
    const fname = floorName(floorId)
    for (const e of entries) {
      const id = `${prefix}${e.id}`
      seen.add(id)
      put({
        id,
        kind: 'note',
        title: e.author === 'agent' ? `${e.authorName ?? 'a chat'} (a chat) on ${fname}` : `${name} on ${fname}`,
        heading: null,
        // S3 (F2): a note is redacted like a turn before it is indexed (it is recalled into chats and compiled by the librarian). The floor's own note is as it was.
        text: redact(e.tags.length ? `${e.text}\n[${e.tags.join(', ')}]` : e.text),
        path: null,
        floorId,
        sessionId: e.sessionId,
        at: e.editedAt ?? e.ts,
      })
    }
    for (const id of [...docs.keys()]) if (id.startsWith(prefix) && !seen.has(id)) drop(id)
  }

  function syncAllNotes() {
    const ids = new Set(noteFloorList().map(f => f.id))
    for (const id of ids) syncNotes(id)
    // A floor that went takes its notes with it.
    for (const d of [...docs.values()]) if (d.kind === 'note' && d.floorId && !ids.has(d.floorId)) drop(d.id)
  }

  function syncWiki(force = false) {
    const now = Date.now()
    if (!force && now - wikiCheckedAt < 5000) return
    wikiCheckedAt = now
    const marks = wiki.snapshot()
    const same = marks.size === wikiMarks.size && [...marks].every(([k, v]) => wikiMarks.get(k) === v)
    if (same && !force) return
    for (const [rel, mark] of marks) {
      if (!force && wikiMarks.get(rel) === mark) continue
      const page = wiki.read(rel)
      for (const id of [...docs.keys()]) if (id.startsWith(`wiki:${rel}#`)) drop(id)
      if (!page) continue
      for (const s of sections(page.body)) {
        put({
          id: `wiki:${rel}#${s.n}`,
          kind: 'wiki',
          title: page.title,
          heading: s.heading === page.title ? null : s.heading,
          text: s.n === 0 && page.summary ? `${page.summary}\n\n${s.text}` : s.text,
          path: rel,
          floorId: null,
          sessionId: null,
          at: page.updated,
        })
      }
    }
    for (const rel of wikiMarks.keys()) if (!marks.has(rel)) for (const id of [...docs.keys()]) if (id.startsWith(`wiki:${rel}#`)) drop(id)
    wikiMarks = marks
    void pump()
  }

  function turnDoc(t: Turn) {
    put({
      id: `turn:${t.id}`,
      kind: 'turn',
      title: t.from === 'shubham' ? `${name} to ${t.agentName} on ${t.floorName}` : `Another chat to ${t.agentName} on ${t.floorName}`,
      heading: null,
      // S3 (Agent 14's F1): the log may hold turns made under an older rule set (the owner's 14 MB one): redacted here too (idempotent), as in memory_read below.
      text: redact(t.answer ? `${t.said}\n\nAnswer: ${t.answer}` : t.said),
      path: null,
      floorId: t.floorId,
      sessionId: t.sessionId,
      at: t.at,
    })
  }

  /**
   * S4: the sessions of the chats that feed this memory now: each agent's chat, and the earlier sessions of that agent (its native lineage). A turn from any other session (another
   * person's chat in a log made before turns were joined to their owner, a chat that is shared for typing, a PC Control chat, a chat that went) is not this memory's.
   */
  function fedSessions(): Set<string> {
    const out = new Set<string>()
    for (const f of o.floors()) {
      for (const a of f.agents) {
        if (a.sessionId) out.add(a.sessionId)
        for (const r of a.conversationHistory ?? []) if (typeof r.sessionId === 'string' && r.sessionId) out.add(r.sessionId)
      }
    }
    return out
  }
  /**
   * S4: a turn is kept in the index and compiled when its chat feeds this memory and it was SAID: a relay (what the chats and the app type into a chat: message, broadcast, reply,
   * heartbeat; Agent 14's F3) only with `fromAgents`. Judged on the `said` text too, because the legacy log's `from` was made by a regex that knew two of the four shapes.
   */
  const turnFed = (t: Turn, fed: ReadonlySet<string>) => fed.has(t.sessionId) && ((t.from === 'shubham' && !isRelayText(t.said)) || state.settings.fromAgents)

  /** The turn docs are made to match: the turns that feed the memory in, the others out (a setting or a chat's owner, share or kind changed). */
  function syncTurns() {
    const fed = fedSessions()
    const want = new Set<string>()
    for (const t of turns.all()) {
      if (!turnFed(t, fed)) continue
      const id = `turn:${t.id}`
      want.add(id)
      if (!docs.has(id)) turnDoc(t)
    }
    for (const id of [...docs.keys()]) if (id.startsWith('turn:') && !want.has(id)) drop(id)
  }

  function sessionRefs(): SessionRef[] {
    const out: SessionRef[] = []
    for (const f of o.floors()) {
      for (const a of f.agents) {
        if (!a.sessionId) continue
        const file = o.transcript(a.sessionId)
        if (file) out.push({ sessionId: a.sessionId, file, floorId: f.id, floorName: f.name, agentName: a.name })
      }
    }
    return out
  }

  /** The chats that do not feed this memory, as session refs (their files are only measured, never read). */
  function skipRefs(): SessionRef[] {
    const out: SessionRef[] = []
    for (const f of o.unfedFloors?.() ?? []) {
      for (const a of f.agents) {
        if (!a.sessionId) continue
        const file = o.transcript(a.sessionId)
        if (file) out.push({ sessionId: a.sessionId, file, floorId: f.id, floorName: f.name, agentName: a.name })
      }
    }
    return out
  }

  function collectTurns(): number {
    if (!state.settings.fromChats) return 0
    let found: Turn[] = []
    try {
      found = turns.collect(sessionRefs(), Date.now(), skipRefs())
    } catch (e) {
      log?.warn(`memory: couldn't read the floor chats' turns: ${e instanceof Error ? e.message : String(e)}`)
      return 0
    }
    syncTurns()
    if (found.length) void pump()
    return found.length
  }

  // -------------------------------------------------------------------------------------------
  // Meaning: every doc without a vector gets one, a batch at a time, in the background

  function pump(): Promise<void> {
    if (pumping || closed) return pumping ?? Promise.resolve()
    pumping = (async () => {
      try {
        for (;;) {
          const missing: Doc[] = []
          for (const d of docs.values()) {
            if (vectors.has(d.id)) continue
            const v = cache.get(d.hash)
            if (v) vectors.set(d.id, v)
            else missing.push(d)
          }
          if (!missing.length || closed) break
          // Notes and the wiki before turns: they are what recall mostly brings.
          missing.sort((a, b) => (a.kind === 'turn' ? 1 : 0) - (b.kind === 'turn' ? 1 : 0))
          const batch = missing.slice(0, 16)
          const vecs = await embedder.embed(batch.map(embedText), 'passage')
          if (!vecs) break
          batch.forEach((d, i) => {
            keepVector(d.hash, vecs[i])
            if (docs.get(d.id)?.hash === d.hash) vectors.set(d.id, vecs[i])
          })
          // The agent serves screens and chats too: a breath between batches.
          await new Promise(r => setTimeout(r, 25))
        }
        compactVectors()
      } catch (e) {
        if (!closed) log?.warn(`memory: making vectors stopped: ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        pumping = null
      }
    })()
    return pumping
  }

  // -------------------------------------------------------------------------------------------
  // Search and recall

  function toHit(d: Doc, f: FusedHit, query: string): MemoryHit {
    return {
      id: d.id,
      kind: d.kind,
      title: d.title,
      heading: d.heading,
      text: snippet(d.text, query, 420),
      path: d.path,
      floorId: d.floorId,
      sessionId: d.sessionId,
      at: d.at,
      score: round(f.score),
      meaning: f.meaning === null ? null : round(f.meaning),
      words: round(f.words),
    }
  }

  async function search(query: string, so: { limit?: number; kinds?: MemoryKind[]; excludeSession?: string | null } = {}): Promise<MemoryHit[]> {
    const q = query.trim().slice(0, 2000)
    if (!q) return []
    syncWiki()
    const kinds = new Set<MemoryKind>(so.kinds?.length ? so.kinds : ['wiki', 'note', 'turn'])
    if (!state.settings.fromChats) kinds.delete('turn')
    const filter = (id: string) => {
      const d = docs.get(id)
      return !!d && kinds.has(d.kind) && !(so.excludeSession && d.sessionId === so.excludeSession)
    }
    const byWords = words.search(q, 50, filter)
    let byMeaning: WordHit[] | null = null
    // The model is used when it is ready; a search never waits for it to download.
    if (embedder.status().state === 'ready') {
      const v = await embedder.embed([q], 'query').catch(() => null)
      if (v) byMeaning = nearest(v[0], vectors.entries(), 50, filter)
    } else
      void embedder.ready().then(ok => {
        if (ok) void pump()
      })
    const limit = Math.max(1, Math.min(so.limit ?? 10, 50))
    return fuse(byMeaning, byWords, id => words.coverage(q, id), limit).map(f => toHit(docs.get(f.id)!, f, q))
  }

  // -------------------------------------------------------------------------------------------
  // The librarian

  /** `memoryProjects`, kept for 30 s (status asks for it every few seconds and it reads every floor's transcript place); a compile asks afresh. */
  let projectsMemo: { at: number; list: string[] } | null = null
  function ownProjectNames(fresh = false): string[] {
    if (!o.memoryProjects) return []
    const now = Date.now()
    if (fresh || !projectsMemo || now - projectsMemo.at > 30_000) {
      let list: string[] = []
      try {
        list = [...o.memoryProjects()]
      } catch {
        list = []
      }
      projectsMemo = { at: now, list }
    }
    return projectsMemo.list
  }

  function seedFiles(fresh = false): SeedMaterial[] {
    const out: SeedMaterial[] = []
    // S3: only the project folders that are this person's own (a name, never a path: nothing outside projectsDir is read).
    const projects = ownProjectNames(fresh).filter(p => typeof p === 'string' && p !== '' && p !== '.' && p !== '..' && p === path.basename(p) && !/[\\/]/.test(p))
    for (const p of projects) {
      const dir = path.join(o.projectsDir, p, 'memory')
      let files: string[] = []
      try {
        files = readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md')
      } catch {
        continue
      }
      for (const f of files) {
        const file = path.join(dir, f)
        try {
          const st = statSync(file)
          if (st.size > 20_000) continue
          // S3 (F2): redacted before it is counted, handed to the librarian or written in the inbox.
          out.push({ key: `${file}:${Math.round(st.mtimeMs)}`, label: `${p}/memory/${f}`, text: redact(readFileSync(file, 'utf8')) })
        } catch {
          // Gone.
        }
      }
    }
    return out
  }

  /** `askAfresh`: the person's project folders are asked for again, not taken from the 30 s memory (a compile does). */
  function pending(askAfresh = false): Material {
    const notes: NoteMaterial[] = []
    for (const f of noteFloorList()) {
      let entries: MemoryEntry[] = []
      try {
        entries = o.notes(f.id)
      } catch {
        entries = []
      }
      for (const e of entries) {
        const key = `${f.id}/${e.id}`
        const version = e.editedAt ?? e.ts
        if (state.compiled.notes[key] === version) continue
        notes.push({ key, floorName: f.name, author: e.author === 'agent' ? `${e.authorName ?? 'a chat'} (an AI chat)` : name, at: version, text: redact(e.text), version })
      }
    }
    notes.sort((a, b) => a.at.localeCompare(b.at))
    const seeds = state.settings.fromChats ? seedFiles(askAfresh).filter(s => state.compiled.seeds[s.key.slice(0, s.key.lastIndexOf(':'))] !== s.key.slice(s.key.lastIndexOf(':') + 1)) : []
    const { past, fresh } = pendingTurns()
    // The past first (oldest first), then what came after the memory started.
    return { notes, seeds, turns: (state.settings.pastChats ? [...past, ...fresh] : fresh).map(e => e.t) }
  }

  /**
   * The turns still to compile: of the past (before the baseline), and since, each with its place in the log. What was compiled is counted by PLACE (the log only grows), and a turn
   * that does not feed this memory (S4: another person's chat, a relay while `fromAgents` is off) is skipped, never compiled: a run moves the count past it.
   */
  function pendingTurns(): { past: { t: Turn; pos: number }[]; fresh: { t: Turn; pos: number }[] } {
    if (!state.settings.fromChats) return { past: [], fresh: [] }
    const all = turns.all()
    const fed = fedSessions()
    const base = Math.min(state.baseline ?? 0, all.length)
    const pastFrom = Math.min(state.compiled.history, base)
    const freshFrom = Math.max(state.compiled.turns, base)
    const past: { t: Turn; pos: number }[] = []
    const fresh: { t: Turn; pos: number }[] = []
    for (let pos = pastFrom; pos < base; pos++) if (turnFed(all[pos], fed)) past.push({ t: all[pos], pos })
    for (let pos = freshFrom; pos < all.length; pos++) if (turnFed(all[pos], fed)) fresh.push({ t: all[pos], pos })
    return { past, fresh }
  }

  const turnChars = (list: Turn[]) => list.reduce((s, t) => s + t.said.length + Math.min(t.answer.length, 700), 0)

  function pendingCount() {
    const p = pending()
    const chars = p.notes.reduce((s, n) => s + n.text.length, 0) + p.seeds.reduce((s, n) => s + n.text.length, 0) + turnChars(p.turns)
    return { notes: p.notes.length, turns: p.turns.length, seeds: p.seeds.length, chars }
  }

  function compile(mode: LibrarianMode, trigger: 'now' | 'auto'): LibrarianRun {
    if (running) throw apiError(409, 'The librarian is already running')
    const claude = o.claude?.() ?? null
    if (!claude) throw apiError(503, "Claude Code isn't installed on the hub (no claude on PATH)")
    const id = randomBytes(3).toString('hex')
    let take: Material = { notes: [], turns: [], seeds: [] }
    let chars = 0
    let inbox: string | undefined
    // How many of the turns given come from the past (they are first): what the run moves on. Their places, from the same moment as the material below.
    const pt = pendingTurns()
    const pastGiven = state.settings.pastChats ? pt.past.length : 0
    if (mode === 'ingest') {
      const t = takeMaterial(pending(true))
      take = t.take
      chars = t.chars
      if (!take.notes.length && !take.turns.length && !take.seeds.length) throw apiError(409, 'Nothing new to compile: every note and turn is in the wiki')
      inbox = writeInbox(wiki.dir, id, take, name)
    }
    const run: LibrarianRun = {
      id,
      mode,
      trigger,
      startedAt: new Date().toISOString(),
      endedAt: null,
      state: 'running',
      model: state.settings.model,
      material: { notes: take.notes.length, turns: take.turns.length, seeds: take.seeds.length, chars },
      changed: [],
      summary: '',
      costUsd: null,
      tokens: null,
      error: null,
    }
    running = run
    if (trigger === 'auto') state.lastAutoAt = Date.now()
    save()
    o.onChange?.()
    const before = wiki.snapshot()
    void (async () => {
      const r = await runLibrarian({
        dir: wiki.dir,
        mode,
        model: run.model,
        inbox,
        claude,
        env: librarianEnv(o.env ?? process.env, o.token?.() ?? null),
        log,
        claudeArgs: o.claudeArgs,
      })
      const after = wiki.snapshot()
      run.changed = [...new Set([...after.keys(), ...before.keys()])].filter(k => before.get(k) !== after.get(k)).sort()
      run.endedAt = new Date().toISOString()
      run.state = r.ok ? 'done' : 'failed'
      run.summary = r.summary.slice(0, 4000)
      run.costUsd = r.costUsd
      run.tokens = r.tokens
      run.error = r.error
      if (r.ok) {
        for (const n of take.notes) state.compiled.notes[n.key] = n.version
        for (const s of take.seeds) {
          const cut = s.key.lastIndexOf(':')
          state.compiled.seeds[s.key.slice(0, cut)] = s.key.slice(cut + 1)
        }
        const fromPast = Math.min(take.turns.length, pastGiven)
        if (fromPast > 0) state.compiled.history = pt.past[fromPast - 1].pos + 1
        const freshTaken = take.turns.length - fromPast
        state.compiled.turns = Math.max(state.compiled.turns, state.baseline ?? 0)
        if (freshTaken > 0) state.compiled.turns = pt.fresh[freshTaken - 1].pos + 1
      } else if (inbox) rmSync(path.join(wiki.dir, ...inbox.split('/')), { force: true })
      try {
        wiki.writeIndex()
        const what = mode === 'ingest' ? `${run.material.notes} notes, ${run.material.seeds} memory files, ${run.material.turns} turns` : 'every page'
        const cost = r.costUsd !== null ? `, $${r.costUsd.toFixed(2)} at API rates` : ''
        wiki.appendLog(`${mode} | ${what} | ${run.model}${cost} | ${run.changed.length} pages changed`, r.ok ? r.summary || '(no account given)' : `Failed: ${r.error}`)
        await wiki.commit(`${mode} (run ${id}): ${run.changed.length} pages changed`)
        purgeInbox()
      } catch (e) {
        log?.warn(`memory: after the run: ${e instanceof Error ? e.message : String(e)}`)
      }
      syncWiki(true)
      running = null
      state.runs = [run, ...state.runs].slice(0, RUNS_KEPT)
      save()
      log?.info(`memory: the librarian ${r.ok ? 'finished' : 'failed'} (${run.changed.length} pages changed${r.costUsd !== null ? `, $${r.costUsd.toFixed(3)} at API rates` : ''})${r.ok ? '' : `: ${r.error}`}`)
      o.onChange?.()
    })()
    return run
  }

  /** S3: the raw material of old runs is not kept (the inbox is never in git either: wiki.ts GITIGNORE). */
  function purgeInbox() {
    const n = wiki.purgeInbox(INBOX_KEEP_DAYS)
    if (n) log?.info(`memory: ${n} old inbox file${n === 1 ? '' : 's'} removed`)
  }

  function autoCheck() {
    const s = state.settings
    if (!s.auto || running || closed) return
    if (state.lastAutoAt && Date.now() - state.lastAutoAt < s.everyHours * 3_600_000) return
    if (pendingCount().chars < AUTO_MIN_CHARS) return
    try {
      compile('ingest', 'auto')
    } catch (e) {
      log?.warn(`memory: the scheduled compile didn't start: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // -------------------------------------------------------------------------------------------

  function brief(): string {
    const core = wiki.core()
    const pages = wiki.pages().filter(p => p.path !== CORE)
    const out = [
      '## What you remember',
      "Shubham Agentic keeps a memory for every chat: a wiki its librarian compiles from the floors' notes and conversations, with every note and turn, searched by words and by meaning. What it holds about each message you get is shown with that message, under \"From Shubham Agentic's memory\". Open a page or a hit with `memory_read`, search with `memory_search`, and keep what should outlast this chat with `memory_save`. What " + name + " says now wins over what the memory says.",
    ]
    const coreText = core && !/^_Nothing here yet/.test(core) ? core : ''
    if (coreText) out.push('### Core (core.md)', coreText.length > CORE_MAX ? `${coreText.slice(0, CORE_MAX)}\n\n[...cut: memory_read core for the rest]` : coreText)
    if (pages.length) {
      const sorted = [...pages].sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? '') || a.path.localeCompare(b.path))
      const lines: string[] = []
      let size = 0
      for (const p of sorted) {
        const line = `- ${p.path.replace(/\.md$/, '')}: ${p.title}${p.summary ? `. ${p.summary}` : ''}`
        if (size + line.length > INDEX_MAX) break
        lines.push(line)
        size += line.length + 1
      }
      const more = pages.length - lines.length
      out.push(`### The wiki's pages (${pages.length})`, lines.join('\n') + (more > 0 ? `\n- ... and ${more} more (memory_read index lists them all)` : ''))
    }
    return out.join('\n\n')
  }

  function read(ref: string): string {
    const r = typeof ref === 'string' ? ref.trim() : ''
    if (!r) throw apiError(400, 'Name a page (projects/x) or a hit id (note:..., turn:..., wiki:...)')
    if (r.startsWith('note:') || r.startsWith('turn:')) {
      if (r.startsWith('turn:')) {
        const t = turns.get(r.slice(5))
        if (!t || !turnFed(t, fedSessions())) throw apiError(404, `No turn ${r}`)
        return [`${t.from === 'shubham' ? name : 'Another chat'} to ${t.agentName} on ${t.floorName}, ${t.at}:`, redact(t.said), '', `${t.agentName} answered:`, redact(t.answer) || '(no answer kept)'].join('\n')
      }
      const d = docs.get(r)
      if (!d) throw apiError(404, `No note ${r}`)
      return `${d.title}, ${d.at ?? ''}:\n${d.text}`
    }
    const rel = pagePath(r.startsWith('wiki:') ? r.slice(5).replace(/#\d+$/, '') : r)
    const page = rel ? wiki.read(rel) : null
    if (!page) throw apiError(404, `No wiki page ${r}. memory_read index lists them.`)
    const head = [`# ${page.title} (${page.path})`, page.summary ? `${page.summary}` : '', page.updated ? `Updated ${page.updated}.` : ''].filter(Boolean).join('\n')
    const text = `${head}\n\n${page.body.trim()}`
    return text.length > READ_MAX ? `${text.slice(0, READ_MAX)}\n\n[...cut at ${READ_MAX} characters]` : text
  }

  function recallText(sessionId: string, hits: MemoryHit[]): string {
    const s = shown.get(sessionId) ?? { n: 0, at: new Map<string, number>() }
    s.n++
    shown.set(sessionId, s)
    // Each chat's last few hundred matter, not every one since the agent started.
    if (shown.size > 200) shown.delete(shown.keys().next().value!)
    const chosen = hits.filter(relevant).filter(h => (s.at.get(h.id) ?? -Infinity) < s.n - RECALL_QUIET)
    // One section of a page at a time, its best.
    const pagesSeen = new Set<string>()
    const out: MemoryHit[] = []
    for (const h of chosen) {
      if (h.path && pagesSeen.has(h.path)) continue
      if (h.path) pagesSeen.add(h.path)
      out.push(h)
      if (out.length >= RECALL_MAX) break
    }
    for (const h of out) s.at.set(h.id, s.n)
    return formatRecall(out, name)
  }

  return {
    async start() {
      if (started) return
      started = true
      await wiki.ensure().catch(e => log?.warn(`memory: couldn't make the wiki: ${e instanceof Error ? e.message : String(e)}`))
      purgeInbox()
      loadVectors()
      syncAllNotes()
      syncWiki(true)
      syncTurns()
      collectTurns()
      // The first start: every turn there is now is the past (searched, compiled only when asked).
      if (state.baseline === null) {
        state.baseline = turns.all().length
        state.compiled.turns = Math.max(state.compiled.turns, state.baseline)
        save()
      }
      void pump()
      if (o.timers !== false) {
        const every = (ms: number, fn: () => void) => {
          const t = setInterval(() => {
            if (o.active && !o.active()) return
            try {
              fn()
            } catch (e) {
              log?.warn(`memory: ${e instanceof Error ? e.message : String(e)}`)
            }
          }, ms)
          t.unref()
          timers.push(t)
        }
        every(60_000, collectTurns)
        every(30_000, () => syncWiki())
        every(15 * 60_000, autoCheck)
        every(3_600_000, purgeInbox)
      }
      log?.info(`memory: ${docs.size} sections, notes and turns indexed; ${vectors.size} with meaning so far`)
    },

    search,

    async recall({ sessionId, prompt }) {
      if (!state.settings.recall) return ''
      const q = recallQuery(prompt)
      if (!q) return ''
      const hits = await search(q, { limit: 12, excludeSession: sessionId })
      return recallText(sessionId, hits)
    },

    brief,
    read,
    pages: () => wiki.pages(),
    page: rel => {
      const p = pagePath(rel)
      return p ? wiki.read(p) : null
    },

    status() {
      const m = embedder.status()
      const count = (k: MemoryKind) => [...docs.values()].filter(d => d.kind === k).length
      const s = state.settings
      const nextAutoAt = s.auto ? new Date(Math.max(Date.now(), (state.lastAutoAt ?? 0) + s.everyHours * 3_600_000)).toISOString() : null
      return {
        here: true,
        live: o.live === true,
        meaning: { state: m.state, model: m.model, progress: m.progress, error: m.error },
        index: { chunks: docs.size, wiki: count('wiki'), notes: count('note'), turns: count('turn'), embedded: vectors.size },
        wiki: { dir: wiki.dir, pages: wiki.pages().length, git: wiki.git() },
        settings: { ...s },
        pending: pendingCount(),
        past: (() => {
          const all = turns.all()
          const fed = fedSessions()
          const base = Math.min(state.baseline ?? 0, all.length)
          const left = all.slice(Math.min(state.compiled.history, base), base).filter(t => turnFed(t, fed))
          return { total: all.slice(0, base).filter(t => turnFed(t, fed)).length, left: left.length, chars: turnChars(left) }
        })(),
        running: running ? { ...running } : null,
        runs: state.runs,
        nextAutoAt,
      }
    },

    setSettings(patch) {
      const before = state.settings.fromAgents
      state.settings = cleanSettings(patch, state.settings)
      save()
      // S4: relays come in or go out of the index with the switch.
      if (started && state.settings.fromAgents !== before) {
        syncTurns()
        void pump()
      }
      if (state.settings.fromChats) collectTurns()
      return { ...state.settings }
    },

    compile,

    notesChanged(floorId) {
      if (!started) return
      syncNotes(floorId)
      void pump()
    },

    collectTurns,

    async settle() {
      while (pumping) await pumping
      await pump()
    },

    close() {
      closed = true
      for (const t of timers) clearInterval(t)
      embedder.close()
    },
  }
}
