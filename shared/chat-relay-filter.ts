import type { ChatUserItem } from './chat.ts'
import { markClusters, type ChatRow } from './chat-rows.ts'
import { hiddenByFilter, relayOfItem } from './relay-kind.ts'

// F-367: the chat's filter, "All messages" | "Only you and this chat". It takes the messages other chats and the app typed into a chat out of what is drawn, and puts ONE slim line where each run of them was ("3 messages from
// other chats hidden · Show") that opens them in place. It works on the rows the page already made (src/chat/delivery-rows.ts), so a message he sent (still waiting, or its echo) is never touched, and it touches only
// messages of a class shared/relay-kind.ts says is not him: his own words, his orders and answers, the chat's answers, its tool work, its questions and approvals (AskUserQuestion cards), notices, media and the
// "Not sent" status are never hidden. "Waiting for you" is not a chat row at all (it is the goal's own row), so this cannot reach it. Pure.

export type RelayFilter = 'all' | 'only-you'
export const DEFAULT_RELAY_FILTER: RelayFilter = 'all'
export const RELAY_FILTER_CHOICES: readonly { value: RelayFilter; label: string }[] = [
  { value: 'all', label: 'All messages' },
  { value: 'only-you', label: 'Only you and this chat' },
]
export const parseRelayFilter = (v: unknown): RelayFilter => (v === 'only-you' ? 'only-you' : DEFAULT_RELAY_FILTER)

/** The saved choices, per chat (the agent's id): anything that is not a known choice for a text id is left out, so a damaged saving can only mean "all". */
export function parseRelayFilters(raw: unknown): Record<string, RelayFilter> {
  const out: Record<string, RelayFilter> = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out
  for (const [id, v] of Object.entries(raw)) if (id && id.length <= 80 && v === 'only-you') out[id] = 'only-you'
  return out
}

type HiddenRow = Extract<ChatRow, { k: 'hidden' }>
/** A message row of something typed into the chat (not the chat's own words). */
type MsgRow = Extract<ChatRow, { k: 'msg' }> & { item: ChatUserItem }

/** A message row the filter may hide: another chat's or the app's, never one he sent (a pending row, or the echo that took its place, keeps the `pending:` key). */
const hideable = (row: ChatRow): row is MsgRow => row.k === 'msg' && row.item.kind === 'user' && !row.key.startsWith('pending:') && hiddenByFilter(relayOfItem(row.item))

/** Who the run is from, for the title of its line: sender names in order of first appearance ("the app" for the app's). */
function namesOf(run: MsgRow[]): string[] {
  const names: string[] = []
  for (const r of run) {
    const name = relayOfItem(r.item) === 'app' ? 'the app' : r.sender || 'another chat'
    if (!names.includes(name)) names.push(name)
  }
  return names
}

/**
 * `rows` as the filter draws them. "all" is the rows as they are. "only-you": each run of hideable message rows (consecutive, so a day line, a tool group or a message of the chat's between them starts a new run) is one
 * `hidden` row, id `hidden:<first message id>` (stable while the run grows); a run listed in `open` keeps its messages, under its line, which then says Hide. The neighbours' clusters are marked again.
 */
export function hideRelayRows(rows: ChatRow[], mode: RelayFilter, open: ReadonlySet<string> = new Set()): ChatRow[] {
  if (mode === 'all' || !rows.some(hideable)) return rows
  const out: ChatRow[] = []
  for (let i = 0; i < rows.length; ) {
    const row = rows[i]
    if (!hideable(row)) {
      out.push(row)
      i++
      continue
    }
    const run: MsgRow[] = []
    for (; i < rows.length; i++) {
      const r = rows[i]
      if (!hideable(r)) break
      run.push(r)
    }
    const id = `hidden:${run[0].id}`
    const isOpen = open.has(id)
    const kinds: HiddenRow['kinds'] = []
    for (const r of run) {
      const k = relayOfItem(r.item)
      if ((k === 'chat' || k === 'app') && !kinds.includes(k)) kinds.push(k)
    }
    out.push({ k: 'hidden', id, count: run.length, kinds, names: namesOf(run), open: isOpen })
    if (isOpen) out.push(...run)
  }
  // The neighbours of what was taken out are not clustered with it any more.
  const copy = out.map(r => (r.k === 'msg' ? { ...r } : r))
  markClusters(copy)
  return copy
}

/** The line's words: "3 messages from other chats hidden", "1 message from the app hidden", "2 messages from other chats and the app hidden"; with the run open, "shown". */
export function hiddenWords(row: Pick<HiddenRow, 'count' | 'kinds' | 'open'>): string {
  const who = row.kinds.length === 2 ? 'other chats and the app' : row.kinds[0] === 'app' ? 'the app' : 'other chats'
  return `${row.count} ${row.count === 1 ? 'message' : 'messages'} from ${who} ${row.open ? 'shown' : 'hidden'}`
}
