import { existsSync, readFileSync, renameSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { writeAtomic } from '../config.ts'
import type { Logger } from '../log.ts'
import type { WaNote } from '../../shared/whatsapp.ts'

// Order oWA S6 (the reference whatsapp-frontend's per-chat notes): private, timestamped notes about a chat, kept on THIS Server in <dir>\notes.json: not in WhatsApp, not in the CRM, not
// in any cloud. A chat holds a list of entries; each is a person's words, with the time it was written. Only the app's owner reaches them (the proxy's mount is the owner's, and a
// change needs a person's own request). Deleting a note deletes the person's own words in this app, never anything in the CRM or WhatsApp.
// An unreadable file is never overwritten: it is set aside as notes.json.unreadable-<time> and the notes start empty, so a damaged file loses nothing that a person could still recover.
// Nothing here logs a note, a chat or a number: only that the file was set aside.

const CHAT_ID = /^[\w.:-]{1,80}@(c\.us|g\.us|lid|s\.whatsapp\.net)$/
export const NOTE_MAX = 4000
export const NOTES_PER_CHAT = 500
export const NOTE_CHATS_MAX = 5000

export interface NotesStore {
  /** The ids of the chats that have at least one note (for the marks in the chat list). */
  index(): string[]
  /** A chat's notes, oldest first. */
  list(chatId: string): WaNote[]
  /** Adds a note (its words as written, not trimmed); words that are only blanks add nothing. Returns the chat's notes. */
  add(chatId: string, text: string): WaNote[]
  /** Takes one note away (a note that is not there is not an error). Returns what is left. */
  remove(chatId: string, noteId: string): WaNote[]
}

const bad = (message: string, status = 400) => Object.assign(new Error(message), { status })

export function createNotes(file: string, log: Pick<Logger, 'warn'>, o: { now?: () => number; id?: () => string } = {}): NotesStore {
  const now = o.now ?? Date.now
  const newId = o.id ?? (() => `${now().toString(36)}_${randomBytes(4).toString('hex')}`)
  let map: Record<string, WaNote[]> | null = null

  function load(): Record<string, WaNote[]> {
    if (map) return map
    const out: Record<string, WaNote[]> = {}
    if (existsSync(file)) {
      try {
        const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not an object')
        for (const [chatId, list] of Object.entries(raw as Record<string, unknown>)) {
          if (!CHAT_ID.test(chatId) || !Array.isArray(list)) continue
          const notes = list.filter((n): n is WaNote => n !== null && typeof n === 'object' && typeof (n as WaNote).id === 'string' && typeof (n as WaNote).text === 'string' && Number.isFinite((n as WaNote).createdAt))
          if (notes.length > 0) out[chatId] = notes.map(n => ({ id: n.id, text: n.text, createdAt: n.createdAt }))
        }
      } catch {
        const aside = `${file}.unreadable-${now()}`
        try {
          renameSync(file, aside)
          log.warn(`WhatsApp notes: the notes file could not be read; it was set aside as ${aside.split(/[\\/]/).pop()} and the notes start empty`)
        } catch {
          log.warn('WhatsApp notes: the notes file could not be read, and could not be set aside; it is left as it is and the notes start empty')
        }
      }
    }
    map = out
    return out
  }

  const save = (m: Record<string, WaNote[]>) => writeAtomic(file, `${JSON.stringify(m, null, 2)}\n`, 0o600)
  const checked = (chatId: string) => {
    if (!CHAT_ID.test(chatId)) throw bad('That is not a WhatsApp chat id.')
    return chatId
  }

  return {
    index: () => Object.keys(load()).filter(k => (load()[k]?.length ?? 0) > 0),
    list: chatId => [...(load()[checked(chatId)] ?? [])],
    add(chatId, text) {
      const m = load()
      const id = checked(chatId)
      if (typeof text !== 'string') throw bad('Expected the note as text.')
      if (text.trim() === '') return [...(m[id] ?? [])]
      if (text.length > NOTE_MAX) throw bad(`A note is at most ${NOTE_MAX} characters.`)
      const have = m[id] ?? []
      if (have.length >= NOTES_PER_CHAT) throw bad(`A chat holds at most ${NOTES_PER_CHAT} notes.`, 409)
      if (!m[id] && Object.keys(m).length >= NOTE_CHATS_MAX) throw bad(`Notes are kept for at most ${NOTE_CHATS_MAX} chats.`, 409)
      const next = { ...m, [id]: [...have, { id: newId(), text, createdAt: now() }] }
      save(next)
      map = next
      return [...next[id]]
    },
    remove(chatId, noteId) {
      const m = load()
      const id = checked(chatId)
      const have = m[id] ?? []
      const left = have.filter(n => n.id !== noteId)
      if (left.length === have.length) return [...have]
      const next = { ...m }
      if (left.length > 0) next[id] = left
      else delete next[id]
      save(next)
      map = next
      return [...left]
    },
  }
}
