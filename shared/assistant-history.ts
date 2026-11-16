/** oc65c: a read-only, first-message-first view. Source IDs are server-owned native bindings, never paths from a page. */
export type AssistantChannel = 'assistant' | 'quick'
export interface AssistantHistorySource {
  id: string
  channel: AssistantChannel
  engine: 'claude' | 'codex' | 'opencode' | 'quick'
  recordedAt: string | null
  current: boolean
  /** A missing file stays in the list: absence is never presented as an empty conversation. */
  available: boolean
  bytes: number | null
  file: string | null
}
export interface AssistantHistoryIndex {
  person: { id: string; username: string }
  sources: AssistantHistorySource[]
  quickNotice: string
  /** Things the reader should know, such as incomplete native-session receipts. */
  warnings?: string[]
}
export interface AssistantHistoryEntry {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'notice' | 'jsonl'
  text: string
  at: string | null
  partial?: boolean
}
export interface AssistantHistoryPage {
  entries: AssistantHistoryEntry[]
  /** Byte cursor. Null means the last complete record has been reached, not that the history was discarded. */
  next: number | null
  bytes: number
  offset: number
}
export const QUICK_HISTORY_NOTICE = 'Quick used to keep only a few shortened exchanges in memory, with native session persistence off. Its complete earlier conversations were not recorded by the app. Forwarded orders may still be in the Assistant. The durable Quick history begins with this update; it is never cleared when Quick closes.'
