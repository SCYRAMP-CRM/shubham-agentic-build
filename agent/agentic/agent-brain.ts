// Order obb81 (Agents page, step 1): what the page shows of one agent, read on THIS PC. Its route is 'local': a chat that runs on another PC keeps
// its conversation and its Claude project folder there. Read-only; every text sent has hidden secrets masked (shared/secret-text.ts).
//   - notes: the floor notes it saved (memory_save), from the floor's store;
//   - memory: the memory folder of the Claude project folder its conversation is in (~/.claude/projects/<folder>/memory). Every chat that works
//     in the same folder shares it, so its own files (originSessionId = its chat) and the index come with their text; the others by name only;
//   - replies: its last few assistant turns, from the end of its conversation (readTranscriptFile reads at most the file's last 8 MB).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import type { FloorAgent, MemoryEntry } from '../../shared/agentic.ts'
import {
  BRAIN_FILES_MAX,
  MEMORY_FILE_MAX,
  MEMORY_INDEX,
  lastReplies,
  notesBy,
  parseMemoryFile,
  type AgentBrain,
  type AgentMemoryFile,
  type AgentMemoryFolder,
} from '../../shared/agent-directory.ts'
import { hideSecrets } from '../../shared/secret-text.ts'
import { claudeProjectsDir, findTranscript, readTranscriptFile } from './transcripts.ts'

/** A folder can hold many notes; at most this many of its files are listed. */
const FOLDER_FILES_MAX = 500

const sizeOf = (file: string) => {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}
const mtimeOf = (file: string) => {
  try {
    return statSync(file).mtime.toISOString()
  } catch {
    return null
  }
}
const masked = (s: string | null) => (s === null ? null : hideSecrets(s))

export function readAgentBrain(agent: Pick<FloorAgent, 'sessionId' | 'name'>, floorNotes: readonly MemoryEntry[], projectsDir = claudeProjectsDir()): AgentBrain {
  const sessionId = agent.sessionId ?? null
  const transcript = sessionId ? findTranscript(sessionId, projectsDir) : null
  return {
    sessionId,
    transcript: { found: !!transcript, bytes: transcript ? sizeOf(transcript) : 0 },
    notes: notesBy(floorNotes, agent).map(n => ({ ...n, text: hideSecrets(n.text) })),
    memory: transcript ? readMemoryFolder(path.dirname(transcript), sessionId) : null,
    replies: transcript ? lastReplies(readTranscriptFile(transcript)).map(r => ({ ...r, text: hideSecrets(r.text) })) : [],
  }
}

/** A Claude project folder's memory: its index and this chat's own files with their text (at most BRAIN_FILES_MAX), the folder's others by name. */
export function readMemoryFolder(projectDir: string, sessionId: string | null): AgentMemoryFolder {
  const dir = path.join(projectDir, 'memory')
  const folder = path.basename(projectDir)
  let names: string[]
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile() && e.name.toLowerCase().endsWith('.md'))
      .map(e => e.name)
      .slice(0, FOLDER_FILES_MAX)
  } catch {
    return { folder, files: [] }
  }
  const read: { f: AgentMemoryFile; body: string }[] = []
  for (const file of names) {
    const full = path.join(dir, file)
    let raw: string
    try {
      raw = readFileSync(full, 'utf8')
    } catch {
      continue
    }
    const isIndex = file === MEMORY_INDEX
    const p = parseMemoryFile(raw)
    read.push({
      f: {
        file,
        name: isIndex ? null : masked(p.name),
        description: isIndex ? null : masked(p.description),
        type: isIndex ? 'index' : p.type,
        mine: !isIndex && !!sessionId && p.originSessionId === sessionId,
        modified: (isIndex ? null : p.modified) ?? mtimeOf(full),
        bytes: Buffer.byteLength(raw),
        text: null,
        truncated: false,
      },
      body: isIndex ? raw : p.body,
    })
  }
  // Its own first (newest first), then the index, then the folder's others (newest first).
  const rank = (f: AgentMemoryFile) => (f.mine ? 0 : f.file === MEMORY_INDEX ? 1 : 2)
  read.sort((a, b) => rank(a.f) - rank(b.f) || (b.f.modified ?? '').localeCompare(a.f.modified ?? '') || a.f.file.localeCompare(b.f.file))
  let withText = 0
  for (const r of read) {
    if (!(r.f.mine || r.f.file === MEMORY_INDEX) || withText >= BRAIN_FILES_MAX) continue
    withText++
    r.f.text = hideSecrets(r.body.slice(0, MEMORY_FILE_MAX))
    r.f.truncated = r.body.length > MEMORY_FILE_MAX
  }
  return { folder, files: read.map(r => r.f) }
}
