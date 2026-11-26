import { isFirstOwner } from './auth.ts'
import { isAssistantChat, type AssistantAgent, type AssistantFloor } from './assistants.ts'
import { isOrchestratorAgent } from './agentic.ts'
import type { ChatItem, ChatMenu } from './chat.ts'

// F-317 (Shubham, 22 Nov 2026, order o0933, exactly as relayed; the [to] is the Assistant's own repair of an unclear word): "Now make the tab 4 as questions tab, question that is asked [to] you, a history of it stays there, get that
// implemented." The Assistant's questions to HIM are claude's AskUserQuestion: while one waits it is on the chat's screen (ChatMenu: question, options), and once he has answered it is a tool call in the transcript (ChatToolItem
// with `ask` and the answer in `output`). This file is the rules, pure: the rows a chat's items and its open question make, how a device's kept list takes them in (the history that stays), and the order they are shown in.
// Nothing is sent, nothing is asked of the server, no tool is added: it reads what the chat page already has. The kept list is the device's own, per person (src/overlay-notes/questions-store.ts).

export type QuestionStatus = 'waiting' | 'answered' | 'closed'

export interface QuestionRow {
  /** Stable: the same question seen again is the same row. */
  id: string
  /** The Assistant chat it was asked in. */
  sid: string
  /** ISO: when claude asked it (the transcript's time), or when this page first saw it waiting. */
  at: string
  header: string
  question: string
  options: { label: string; description: string }[]
  multi: boolean
  /** waiting: on the chat's screen now. answered: he answered it (`answer`). closed: it left the screen and the transcript has no answer for it (he dismissed it, or it has not been written yet). */
  status: QuestionStatus
  /** What he answered, as claude recorded it; '' until then. */
  answer: string
}

/** The most rows a device keeps: the oldest answered ones go first, never a waiting one. */
export const QUESTIONS_KEPT = 300
const MAX_OPTIONS = 8
const MAX_ID = 200
/** The time of a row that has none: the start of time, so it sorts last and never changes between looks (the tab draws no time for it). */
export const NO_TIME = new Date(0).toISOString()
const CLIP = { header: 60, question: 600, label: 120, description: 300, answer: 400 }

const clip = (v: unknown, n: number): string => {
  if (typeof v !== 'string') return ''
  const t = v.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** A short stable key for a question's words (an open question has no id of its own). Not a secret, not a security measure. */
function key(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0
  return h.toString(36)
}

/** A transcript row's id, never over the 200 characters a stored row may have (a longer one would be dropped when the list is read back): a long item id is shortened to its key. */
export function rowId(sid: string, itemId: string, index: number): string {
  const id = `${sid.slice(0, 80)}:${itemId}:${index}`
  return id.length <= MAX_ID ? id : `${sid.slice(0, 80)}:${key(itemId)}:${index}`
}

/** What he answered, from claude's reply to the tool call: `"Which colour?"="Blue"` pairs when it has them, else the reply cut short. */
export function answerOf(output: string, question: string): string {
  const pairs = [...output.matchAll(/"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)"/g)]
  const mine = pairs.find(p => p[1].replace(/\\"/g, '"') === question) ?? (pairs.length === 1 ? pairs[0] : undefined)
  if (mine) return clip(mine[2].replace(/\\"/g, '"'), CLIP.answer)
  return clip(output, CLIP.answer)
}

/** The rows the transcript holds: each question of each AskUserQuestion call. A call with an answer is answered; one still running is waiting; one that failed or was refused is closed. */
export function rowsFromItems(sid: string, items: readonly ChatItem[]): QuestionRow[] {
  const rows: QuestionRow[] = []
  for (const it of items) {
    if (it.kind !== 'tool' || !it.ask || it.ask.length === 0) continue
    it.ask.forEach((q, i) => {
      const question = clip(q.question, CLIP.question)
      if (!question) return
      rows.push({
        id: rowId(sid, it.id, i),
        sid,
        // A row the transcript gives no time (at is null) is the oldest, always the same: a time made up from now would change at every look.
        at: it.at ?? NO_TIME,
        header: clip(q.header, CLIP.header),
        question,
        options: (q.options ?? []).slice(0, MAX_OPTIONS).map(o => ({ label: clip(o.label, CLIP.label), description: clip(o.description, CLIP.description) })),
        multi: q.multiSelect === true,
        status: it.status === 'done' ? 'answered' : it.status === 'running' ? 'waiting' : 'closed',
        answer: it.status === 'done' ? answerOf(it.output, q.question) : '',
      })
    })
  }
  return rows
}

/** The question on the chat's screen now, as a row (null: none). It has no time of its own: `now` is when this page saw it. */
export function openRow(sid: string, menu: ChatMenu | null, now: string): QuestionRow | null {
  const question = clip(menu?.question, CLIP.question)
  if (!menu || !question) return null
  return {
    id: `open:${sid}:${key(question)}`,
    sid,
    at: now,
    header: clip(menu.header, CLIP.header),
    question,
    options: menu.options.slice(0, MAX_OPTIONS).map(o => ({ label: clip(o.label, CLIP.label), description: clip(o.description, CLIP.description) })),
    multi: menu.multi === true,
    status: 'waiting',
    answer: '',
  }
}

/** Waiting ones first, then the rest, each newest first. A new array. */
export function orderQuestions(rows: readonly QuestionRow[]): QuestionRow[] {
  return [...rows].sort((a, b) => Number(b.status === 'waiting') - Number(a.status === 'waiting') || Date.parse(b.at) - Date.parse(a.at) || (a.id < b.id ? -1 : 1))
}

/** A question the page saw waiting and that then showed up in the transcript is the same question, if it was written at or after the moment it was first seen (a minute of slack for clocks). */
const SAME_QUESTION_SLACK_MS = 60_000

/**
 * The device's kept list after this chat's items and open question were seen. The transcript wins for what it holds; the waiting question is kept with the time it was FIRST seen; a waiting row of this chat that is
 * no longer on screen becomes the transcript's answered row (the same question), or `closed` when the transcript has none. Rows of other chats are not touched. At most QUESTIONS_KEPT rows are kept.
 */
export function reconcile(kept: readonly QuestionRow[], seen: { sid: string; items: readonly QuestionRow[]; open: QuestionRow | null }): QuestionRow[] {
  const byId = new Map<string, QuestionRow>(kept.map(r => [r.id, r]))
  for (const r of seen.items) byId.set(r.id, r)
  // The question open now: its first-seen time stays; a transcript row that already holds it (still running) makes a second row needless.
  if (seen.open) {
    const running = seen.items.some(r => r.status === 'waiting' && r.question === seen.open!.question)
    // Seen again after it was closed (the screen read had not come yet when the page opened): waiting again, with the time it was first seen.
    if (!running) byId.set(seen.open.id, { ...(byId.get(seen.open.id) ?? seen.open), status: 'waiting' })
  }
  for (const r of [...byId.values()]) {
    if (r.sid !== seen.sid || r.status !== 'waiting' || r.id === seen.open?.id) continue
    // A row this look holds keeps the status the transcript gave it. One it does not hold (a question that was only seen on the screen, or a call that was running and is gone) is no longer waiting.
    if (seen.items.some(t => t.id === r.id)) continue
    // A transcript row with no time (NO_TIME) cannot be compared by time: the same question, written, is the same question (else the open row was closed next to its own answered row).
    const written = r.id.startsWith('open:') && seen.items.some(t => t.question === r.question && t.status !== 'waiting' && (t.at === NO_TIME || Date.parse(t.at) >= Date.parse(r.at) - SAME_QUESTION_SLACK_MS))
    if (written) byId.delete(r.id)
    else byId.set(r.id, { ...r, status: 'closed' })
  }
  let rows = [...byId.values()]
  if (rows.length > QUESTIONS_KEPT) {
    const waiting = rows.filter(r => r.status === 'waiting')
    const rest = orderQuestions(rows.filter(r => r.status !== 'waiting')).slice(0, Math.max(0, QUESTIONS_KEPT - waiting.length))
    rows = [...waiting, ...rest]
  }
  return orderQuestions(rows)
}

const STATUSES: readonly QuestionStatus[] = ['waiting', 'answered', 'closed']

/** The kept list as it was stored, tolerantly: anything that is not a row is left out, every text is cut again, the number of rows is capped. Never throws. */
export function parseKept(raw: unknown): QuestionRow[] {
  if (!Array.isArray(raw)) return []
  const rows: QuestionRow[] = []
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) continue
    const o = r as Record<string, unknown>
    const question = clip(o.question, CLIP.question)
    if (typeof o.id !== 'string' || !o.id || o.id.length > MAX_ID || typeof o.sid !== 'string' || typeof o.at !== 'string' || !Number.isFinite(Date.parse(o.at)) || !question) continue
    if (!STATUSES.includes(o.status as QuestionStatus)) continue
    rows.push({
      id: o.id,
      sid: o.sid.slice(0, 80),
      at: o.at,
      header: clip(o.header, CLIP.header),
      question,
      options: Array.isArray(o.options) ? o.options.slice(0, MAX_OPTIONS).map(x => ({ label: clip((x as Record<string, unknown> | null)?.label, CLIP.label), description: clip((x as Record<string, unknown> | null)?.description, CLIP.description) })).filter(x => x.label) : [],
      multi: o.multi === true,
      status: o.status as QuestionStatus,
      answer: clip(o.answer, CLIP.answer),
    })
    if (rows.length >= QUESTIONS_KEPT) break
  }
  return orderQuestions(rows)
}

/**
 * Whose questions this page may record: only the viewer's OWN Assistant. The first owner's is the hub's Assistant (the Orchestrator); anyone else's is a person's own Assistant, owned by that person. An owner who opens ANOTHER person's
 * Assistant from the Agents page (the Assistants group), or the hub's Assistant when he is not the first owner, records nothing: those are not his questions and must not be kept under his key. The open app (nobody signed in) is the first owner's.
 */
export function mayRecordQuestions<A extends AssistantAgent>(person: { id: string } | null | undefined, floor: AssistantFloor<A>, agent: A): boolean {
  if (!isAssistantChat(floor, agent)) return false
  if (isOrchestratorAgent(floor.name, agent)) return isFirstOwner(person)
  return !!person && !!agent.owner && agent.owner.id.toLowerCase() === person.id.toLowerCase()
}
