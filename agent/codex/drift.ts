import { closeSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs'
import path from 'node:path'
import { profileName } from './home.ts'

// Drift: a Codex chat that runs on another model or effort than the app started it on (Lead's order after Agent 19, 18 Nov 2026).
//
// On 18 Nov Agent 19's Codex chat was resumed on its saved gpt-6.1-sol / max and, 7 seconds later, a menu on its own screen was answered and it ran gpt-6-astra /
// ultra for 57 minutes, on Shubham's Codex limit. Nothing recorded WHO answered it (chats.input() is given no caller), and the app saw nothing wrong. Older Codex
// threads (14, 15 and 16 Nov) had changed settings the same way and nobody noticed. The ACTOR cannot be seen; the EFFECT can: Codex writes every settings change to the
// chat's own conversation file (a `thread_settings_applied` row). So this reads what the chat RUNS on now and compares it with
//   - what the app started it with (its profile file: the model and effort the app pinned at the start), and
//   - what is saved (what the next start would use).
// A field has drifted only when the running value matches NEITHER: a setting saved after the start waits for the next start (that is not a drift), and a person
// who changed the chat in its terminal AND saved the same value has not drifted either.
//
// Covered: Codex chats on this PC, model and effort. Not covered, and said so: a Codex chat on another PC (its files are there), a field the app did not pin at the
// start ('' = Codex's own choice cannot drift from nothing), Claude chats (their effort is not recorded anywhere the app can read) and OpenCode chats.

/** A chat's model and reasoning effort; '' = not pinned, or not known. */
export interface Settings {
  model: string
  effort: string
}

export interface RunningSettings extends Settings {
  /** When Codex recorded it (the row's own timestamp). */
  at: string
}

export interface DriftReading {
  /** What the chat's terminal runs on now: the last settings its conversation file recorded since the chat started. */
  running: RunningSettings
  /** What the app started it with (its profile). */
  launched: Settings
  /** What the next start would use (the agent's saved Codex model and effort, else the app's defaults). */
  saved: Settings
}

export interface DriftField {
  field: 'model' | 'effort'
  running: string
  launched: string
  saved: string
}

const norm = (s: string) => s.trim().toLowerCase()

/** The fields on which the chat runs something it was neither started on nor has saved. Empty: no drift. */
export function driftOf(r: DriftReading): DriftField[] {
  const out: DriftField[] = []
  for (const field of ['model', 'effort'] as const) {
    const running = norm(r.running[field]), launched = norm(r.launched[field]), saved = norm(r.saved[field])
    // Nothing known to be running, or the app pinned nothing at the start: there is nothing for it to have drifted from.
    if (!running || !launched) continue
    if (running !== launched && running !== saved) out.push({ field, running: r.running[field], launched: r.launched[field], saved: r.saved[field] })
  }
  return out
}

const pair = (model: string, effort: string) => `${model || "Codex's own model"} at ${effort || "Codex's own effort"}`

/** The plain words the Assistant tells Shubham (heartbeat.ts: "ONE short plain line"). */
export function driftText(who: string, r: DriftReading): string {
  return `${who} now runs ${pair(r.running.model, r.running.effort)}, but it was started on ${pair(r.launched.model, r.launched.effort)}. It changed after the start, not through the app, and the app has not touched it. Its saved setting is ${pair(r.saved.model, r.saved.effort)}: a restart applies it.`
}

/**
 * What the app pinned when it started the chat, from its profile file (home.ts profileToml): the top-level `model` and `model_reasoning_effort`. Every string in that
 * file is one basic string on one line (toml.ts), so a brief with newlines or a lookalike key in it cannot become a key; the first [table] ends the top level.
 */
export function launchedSettings(profileText: string): Settings {
  const out: Settings = { model: '', effort: '' }
  for (const line of profileText.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) break
    const m = /^(model|model_reasoning_effort)\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/.exec(line)
    if (!m) continue
    const value = m[2].replace(/\\(["\\])/g, '$1')
    if (m[1] === 'model') out.model = value
    else out.effort = value
  }
  return out
}

/** A chat's profile file in a Codex home (home.ts: `<home>/<profileName>.config.toml`; a test pins that this is where writeProfile puts it). */
export const profilePath = (home: string, sessionId: string) => path.join(home, `${profileName(sessionId)}.config.toml`)

/** What the profile pinned at the last start; nothing pinned when the file is not there. */
export function readLaunched(home: string, sessionId: string): Settings {
  try {
    return launchedSettings(readFileSync(profilePath(home, sessionId), 'utf8'))
  } catch {
    return { model: '', effort: '' }
  }
}

interface Scan {
  value: RunningSettings | null
  /** Conclusive: a row at or after `sinceMs` was found, or a row from before it was (nothing newer can lie earlier in the file). */
  settled: boolean
}

/**
 * The last `thread_settings_applied` row of a rollout's text that was written at or after `sinceMs` (when the chat started: an earlier row belongs to an earlier
 * run). Only that row is parsed. Its settings are the thread's effective ones: payload.thread_settings.{model, reasoning_effort}.
 */
export function scanRunning(text: string, sinceMs: number): Scan {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line.includes('"thread_settings_applied"')) continue
    let row: { timestamp?: unknown; payload?: { type?: unknown; thread_settings?: { model?: unknown; reasoning_effort?: unknown } } }
    try {
      row = JSON.parse(line)
    } catch {
      continue // a row cut at the edge of what was read
    }
    if (row.payload?.type !== 'thread_settings_applied') continue
    const s = row.payload.thread_settings
    const at = typeof row.timestamp === 'string' ? row.timestamp : ''
    const ms = Date.parse(at)
    if (!s || typeof s.model !== 'string' || !Number.isFinite(ms)) continue
    if (ms < sinceMs) return { value: null, settled: true }
    return { value: { model: s.model, effort: typeof s.reasoning_effort === 'string' ? s.reasoning_effort : '', at }, settled: true }
  }
  return { value: null, settled: false }
}

/** How much of a rollout's end is read, in steps: the last settings row is usually in the first; a turn of very large outputs may push it back. */
export const TAIL_STEPS = [256 * 1024, 2 * 1024 * 1024, 16 * 1024 * 1024]

/** What the chat runs on now, from the END of its conversation file; null when no settings were recorded since `sinceMs` (or the file cannot be read). */
export function readRunning(file: string, sinceMs: number, steps: readonly number[] = TAIL_STEPS): RunningSettings | null {
  let fd: number
  try {
    fd = openSync(file, 'r')
  } catch {
    return null
  }
  try {
    const size = fstatSync(fd).size
    for (const want of steps) {
      const len = Math.min(size, want)
      const buf = Buffer.allocUnsafe(len)
      readSync(fd, buf, 0, len, size - len)
      let text = buf.toString('utf8')
      if (len < size) text = text.slice(text.indexOf('\n') + 1) // the first line is cut by where reading began
      const scan = scanRunning(text, sinceMs)
      if (scan.settled) return scan.value
      if (len >= size) return null
    }
    return null
  } finally {
    closeSync(fd)
  }
}
