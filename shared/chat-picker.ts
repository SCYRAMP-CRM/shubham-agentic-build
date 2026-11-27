import type { OwnerMark } from './owner-label.ts'

// F-088: what the Floor and Agent chips of a chat bar list, and what choosing does. Pure, so it is tested.

export type PickStatus = 'running' | 'waiting' | 'done' | 'idle' | 'error'

export interface PickAgent {
  id: string
  name: string
  isBoss?: boolean
  status?: PickStatus
  /** "Working", "Waiting for you", "Not running": the word for the status. */
  label?: string
  /** Order oe6cd: the owner's name when it is to be drawn (shared/owner-label.ts decides), said on the row's second line. */
  owner?: string
  /** Order oca89: the owner's avatar (two letters and the words) when it is to be drawn: the Agent chip's lead and each row's. */
  ownerMark?: OwnerMark
}
export interface PickFloor {
  id: string
  name: string
  agents: PickAgent[]
  /** Order oe6cd: the name of whoever made the floor, when it is to be drawn. */
  owner?: string
}

/** A chip's small caption ("Floor", "Agent") with the owner's name after it: the one place a phone's header can say whose it is without a taller header or a narrower name (the caption is its own line above the name). */
export const captionWithOwner = (caption: string, owner: string | undefined): string => (owner ? `${caption} · ${owner}` : caption)

/** A row's second line with the owner's name at its end, or the line as it was when there is no name to draw. */
export const withOwner = (line: string | undefined, owner: string | undefined): string | undefined => (owner ? [line, owner].filter(Boolean).join(' · ') : line)

/** How many of a floor's agents wait for him. */
export const waitingOn = (f: PickFloor) => f.agents.filter(a => a.status === 'waiting').length

/**
 * What choosing a floor does: the agent stays when it is on that floor, else the floor's first chat (its boss first, as the
 * floors list them). A floor with no agents cannot be chosen: null.
 */
export function pickOnFloor(floor: PickFloor, current: string | null): string | null {
  if (current && floor.agents.some(a => a.id === current)) return current
  return floor.agents.find(a => a.isBoss)?.id ?? floor.agents[0]?.id ?? null
}

/** Floors in the order shown, the floor in hand first (the Agents page keeps its own floor on top). */
export function floorsFirst<T extends { id: string }>(floors: readonly T[], first: string | null): T[] {
  const here = floors.find(f => f.id === first)
  return here ? [here, ...floors.filter(f => f !== here)] : [...floors]
}

// ---- F-373: ONE select with two tabs (Floor | Chat) -----------------------------------------------------------------------------------------
// (Shubham, 27 Nov 2026: "It will be like a tab. Once I click on the select, there will be two tabs in the select: floor and chat. In the chat I can select the chat and in the floor I can select the floor.")
// What the select lists, which tab a key goes to, which row a key goes to. Pure, so it is tested; the component is src/chat/ChatSelect.tsx.

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** A floor's second line: "7 chats · 2 waiting for you · by Ravi Teja" (the same words as the Floor chip's list). */
export function floorHint(f: PickFloor): string {
  const waits = waitingOn(f)
  return `${plural(f.agents.length, 'chat', 'chats')}${waits ? ` · ${waits} waiting for you` : ''}${f.owner ? ` · by ${f.owner}` : ''}`
}

/** One row of either tab. */
export interface SelectRow {
  id: string
  name: string
  hint?: string
  status?: PickStatus
  boss?: boolean
  disabled?: boolean
  mark?: OwnerMark
}

/** The Floor tab: every floor; one with no chats is there but cannot be chosen. */
export const floorSelectRows = (floors: readonly PickFloor[]): SelectRow[] => floors.map(f => ({ id: f.id, name: f.name, hint: floorHint(f), disabled: f.agents.length === 0 }))

/** The Chat tab: the chats of the floor being browsed, with whose they are (orders oca89, oe6cd) and their state. */
export const chatSelectRows = (floor: PickFloor | null): SelectRow[] => (floor?.agents ?? []).map(a => ({ id: a.id, name: a.name, boss: a.isBoss, hint: withOwner(a.label, a.owner), status: a.status, mark: a.ownerMark }))

export type SelectTab = 'floor' | 'chat'
/** In the order drawn: Floor, then Chat. The Chat tab is the one that opens. */
export const SELECT_TABS: readonly { value: SelectTab; label: string }[] = [
  { value: 'floor', label: 'Floor' },
  { value: 'chat', label: 'Chat' },
]
export const SELECT_TAB_START: SelectTab = 'chat'

/** The tab a key goes to from `current`: Left and Right (they wrap), Home and End; null for any other key. */
export function nextTab(current: SelectTab, key: string): SelectTab | null {
  const at = SELECT_TABS.findIndex(t => t.value === current)
  const last = SELECT_TABS.length - 1
  const to = key === 'ArrowRight' ? (at >= last ? 0 : at + 1) : key === 'ArrowLeft' ? (at <= 0 ? last : at - 1) : key === 'Home' ? 0 : key === 'End' ? last : -1
  return to < 0 ? null : (SELECT_TABS[to]?.value ?? null)
}

/** The row a key goes to from row `at`: Up and Down skip the ones that cannot be chosen and stop at the ends; Home and End reach the first and last that can; null when it stays or the key is not one. */
export function nextRowIndex(disabled: readonly boolean[], at: number, key: string): number | null {
  const can = (i: number) => i >= 0 && i < disabled.length && !disabled[i]
  let to = -1
  if (key === 'Home') {
    to = disabled.findIndex((_, i) => can(i))
  } else if (key === 'End') {
    to = disabled.findLastIndex((_, i) => can(i))
  } else if (key === 'ArrowDown') {
    for (let i = at + 1; i < disabled.length && to < 0; i++) if (can(i)) to = i
  } else if (key === 'ArrowUp') {
    for (let i = at - 1; i >= 0 && to < 0; i--) if (can(i)) to = i
  }
  return to < 0 || to === at ? null : to
}

/** The row that has the focus when a list opens (and in the tab order): the chosen one when it can be chosen, else the first that can; -1 when none can. */
export function startRowIndex(rows: readonly { id: string; disabled?: boolean }[], chosen: string | null): number {
  const at = chosen === null ? -1 : rows.findIndex(r => r.id === chosen && !r.disabled)
  return at >= 0 ? at : rows.findIndex(r => !r.disabled)
}
