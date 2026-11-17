// Order obb81 (Shubham, through the Assistant; goal 01a1e092 "Agents tab"), first step: an "Agents" page in the page picker (/agent-directory; the
// address /agents stays the Agentic Platform page). Every agent on every floor in one list (floor, role, engine/model, PC, status), and for the
// selected agent:
//   1. its definition, editable: name, role and brief ("what it does"), saved through the floor's existing PATCH (src/agentic/store.ts patchAgent);
//   2. a read-only look at what it keeps: the floor notes it saved (memory_save), the memory files in its Claude project folder, and its last few
//      replies. These are its RECORDED words, never hidden reasoning (PLAN.md section 7, "Read the brain": faithful inspection, not a mind-reader).
// No memory system of its own yet: that is the later part of Agent 17's plan (C:\saw\plans-agents-vision-20261116\PLAN.md, parts C and G).
// The owner's page for now: Settings › Access row 'agent-directory' (Only me), and the brain route is listed in no access rule (owner only).

import type { ChatMessage, Floor, FloorAgent, MemoryEntry } from './agentic.ts'

export const AGENT_DIRECTORY_ROUTE = '/agent-directory'
/** How many of its last replies the page shows (newest first). */
export const BRAIN_REPLIES = 5
/** A reply's text, at most; a longer one is cut and says so. */
export const BRAIN_REPLY_MAX = 4000
/** The floor notes it saved, at most (newest first). */
export const BRAIN_NOTES_MAX = 50
/** Memory files whose text is sent: its own and the folder's index, at most this many; the folder's other files are listed by name only. */
export const BRAIN_FILES_MAX = 40
/** A memory file's text, at most. */
export const MEMORY_FILE_MAX = 16_000
/** The folder's index file, which Claude Code loads into every chat that works in the folder. */
export const MEMORY_INDEX = 'MEMORY.md'

export interface AgentReply {
  at: string | null
  text: string
  truncated: boolean
}

export interface AgentMemoryFile {
  /** Its file name in the folder (project_x.md); MEMORY.md is the folder's index. */
  file: string
  name: string | null
  description: string | null
  type: string | null
  /** Written by this agent's current chat (the file's originSessionId). A file from one of its earlier chats is not recognised as its own. */
  mine: boolean
  modified: string | null
  bytes: number
  /** Its text (hidden secrets masked): sent for its own files and the index only; null for the folder's other files. */
  text: string | null
  truncated: boolean
}

export interface AgentMemoryFolder {
  /** The project folder's name under ~/.claude/projects (every chat working in the same folder shares it). */
  folder: string
  files: AgentMemoryFile[]
}

/** What GET /agentic/floors/:floor/agents/:agent/brain answers (the owner's only). */
export interface AgentBrain {
  sessionId: string | null
  /** Its conversation file on THIS PC (a chat that runs on another PC keeps its files there). */
  transcript: { found: boolean; bytes: number }
  /** The notes it saved on its floor (memory_save), newest first. */
  notes: MemoryEntry[]
  /** Its Claude project folder's memory, or null when its conversation is not on this PC. */
  memory: AgentMemoryFolder | null
  /** Its last replies, newest first. */
  replies: AgentReply[]
}

/** One row of the page's list. */
export interface DirectoryRow {
  key: string
  floor: Floor
  agent: FloorAgent
}

/** The row's key in the page's address (?agent=floor:agent). */
export const agentKey = (floorId: string, agentId: string) => `${floorId}:${agentId}`

export function parseAgentKey(key: string | null | undefined): { floorId: string; agentId: string } | null {
  if (!key) return null
  const i = key.indexOf(':')
  if (i <= 0 || i === key.length - 1) return null
  return { floorId: key.slice(0, i), agentId: key.slice(i + 1) }
}

/** Every agent, floor by floor in the floors' order, each floor's boss first and the rest in the floor's own order. */
export function directoryRows(floors: readonly Floor[]): DirectoryRow[] {
  const rows: DirectoryRow[] = []
  for (const floor of floors) {
    const agents = floor.agents.map((agent, i) => ({ agent, i })).sort((a, b) => Number(b.agent.isBoss) - Number(a.agent.isBoss) || a.i - b.i)
    for (const { agent } of agents) rows.push({ key: agentKey(floor.id, agent.id), floor, agent })
  }
  return rows
}

/** The rows whose name, role or floor holds every word typed (case-insensitive); all of them for nothing typed. */
export function filterRows(rows: readonly DirectoryRow[], query: string): DirectoryRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return [...rows]
  return rows.filter(r => {
    const hay = `${r.agent.name} ${r.agent.role} ${r.floor.name}`.toLowerCase()
    return words.every(w => hay.includes(w))
  })
}

/** The notes this agent saved on its floor: written by its chat, or under its name. Newest first, at most `max`. */
export function notesBy(entries: readonly MemoryEntry[], agent: Pick<FloorAgent, 'sessionId' | 'name'>, max = BRAIN_NOTES_MAX): MemoryEntry[] {
  const mine = entries.filter(e => e.author === 'agent' && ((!!agent.sessionId && e.sessionId === agent.sessionId) || (!!e.authorName && e.authorName === agent.name)))
  return mine.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0)).slice(0, max)
}

/** Its last `n` replies (assistant turns with text), newest first, each cut at `max` characters. */
export function lastReplies(messages: readonly Pick<ChatMessage, 'role' | 'text' | 'timestamp'>[], n = BRAIN_REPLIES, max = BRAIN_REPLY_MAX): AgentReply[] {
  const out: AgentReply[] = []
  for (let i = messages.length - 1; i >= 0 && out.length < n; i--) {
    const m = messages[i]
    if (!m || m.role !== 'assistant') continue
    const text = m.text.trim()
    if (!text) continue
    out.push({ at: m.timestamp, text: text.length > max ? text.slice(0, max) : text, truncated: text.length > max })
  }
  return out
}

export interface ParsedMemoryFile {
  name: string | null
  description: string | null
  type: string | null
  originSessionId: string | null
  modified: string | null
  /** The text after the frontmatter (all of it when there is none). */
  body: string
}

/**
 * A Claude memory file's frontmatter (`---` lines at the top): name, description, and type / originSessionId / modified either at the top level or
 * under `metadata:`. Only these simple `key: value` lines are read; anything else is left in place.
 */
export function parseMemoryFile(raw: string): ParsedMemoryFile {
  const text = raw.replace(/^\uFEFF/, '')
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)
  if (!m) return { name: null, description: null, type: null, originSessionId: null, modified: null, body: text }
  const head = m[1] ?? ''
  const field = (key: string): string | null => {
    const f = new RegExp(`^[ \\t]*${key}:[ \\t]*(.*)$`, 'm').exec(head)
    if (!f) return null
    const v = (f[1] ?? '').trim().replace(/^(["'])([\s\S]*)\1$/, '$2').trim()
    return v || null
  }
  return { name: field('name'), description: field('description'), type: field('type'), originSessionId: field('originSessionId'), modified: field('modified'), body: text.slice(m[0].length) }
}
