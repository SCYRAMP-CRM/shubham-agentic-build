// F-309 N4 (Shubham's order ob56f, "agent memory inside the Agentic Platform"; his ob16b "start the memory work now"): the Agents page's card for the agent
// notebook. This file is what the page and the agent both know: the shape of what the owner's six /agentic/notebooks routes answer (the same shapes as
// agent/agentic/memory-notebook.ts; agent/agentic/memory-notebook-wire.test.ts pins that they match), the words the card says about the notebook's limits, and
// the two pure questions the page asks: "which agents WOULD be instances" (before the notebook is on, the server's list is empty) and "which notebook is this
// agent in" (the one line on an agent's own page).
//
// The notebook is OFF until the owner switches it on. With it off nothing about a chat changes; the page only shows the owner's card, because the card is where it
// is switched on. Nothing here reads a note: the page asks the routes, and only the first owner's calls are answered.

import type { Floor } from './agentic.ts'

/** The query word the Agents page keeps the open notebook in (?notebook=agentic-platform), as it keeps the open agent in ?agent=. */
export const NOTEBOOK_PARAM = 'notebook'
/** The template the card sets up, by the first owner's order (ob56f, of77e: "agent should be agentic platform not lead or agent 1 or agent 2"). */
export const NOTEBOOK_TEMPLATE = 'agentic-platform'
export const NOTEBOOK_TEMPLATE_NAME = 'Agentic Platform'
/** A notebook's notes an hour for an instance, whole numbers from 1 to 1000 (memory-notebook.ts cleanPerHour). */
export const NOTEBOOK_PER_HOUR_MIN = 1
export const NOTEBOOK_PER_HOUR_MAX = 1000
/** How many notes the page draws before "Show more" (the notebook holds up to 2,000; a phone does not draw them all at once). */
export const NOTEBOOK_PAGE = 30

export type NotebookRole = 'chat' | 'wrapup' | 'librarian'
export const NOTEBOOK_ROLES: readonly NotebookRole[] = ['chat', 'wrapup', 'librarian']
export type NotebookScope = 'notebook' | 'instance'
export type NotebookNoteType = 'rule' | 'fact' | 'howto' | 'result' | 'note'
export type NotebookHoldCode = 'secret' | 'too-long' | 'scope-beyond' | 'replaces-unknown' | 'notebook-full' | 'hourly-cap'

// --- what the routes answer (agent/agentic/memory-notebook.ts: InstanceRow, TemplateRow, Settings, TemplateStatus, NoteView, Held, LogEntry, AddResult) ---

export interface NotebookInstanceRow {
  in?: boolean
  to?: string
  role?: NotebookRole
  perHour?: number
}
export interface NotebookTemplateRow {
  name: string
  on: boolean
  owner: string
  floors: string[]
  perHour: number | null
  instances: Record<string, NotebookInstanceRow>
}
export interface NotebookSettings {
  version: 1
  enabled: boolean
  templates: Record<string, NotebookTemplateRow>
}
export interface NotebookTemplateStatus {
  id: string
  name: string
  on: boolean
  owner: string
  floors: string[]
  perHour: number | null
  notes: { active: number; replaced: number; instance: number; person: number; total: number; max: number }
  held: number
  log: number
  index: { docs: number; bytes: number }
  instances: { id: string; name: string; floorId: string; floorName: string; role: NotebookRole; perHour: number }[]
}
/** What GET /agentic/notebooks answers (the first owner's only). */
export interface NotebooksStatus {
  enabled: boolean
  roleDefaults: Record<NotebookRole, number>
  settings: NotebookSettings
  templates: NotebookTemplateStatus[]
}
export interface NotebookNote {
  id: string
  by: string
  byId: string
  scope: NotebookScope
  type: NotebookNoteType
  from: 'person' | 'work'
  source: string
  created: string
  validUntil: string
  replaces: string[]
  replacedBy: string | null
  status: 'active' | 'replaced' | 'expired'
  title: string
  text: string
}
export interface NotebookHeld {
  id: string
  at: string
  byId: string
  byName: string
  code: NotebookHoldCode
  reason: string
  scopeAsked: string
  type: NotebookNoteType
  from: 'person' | 'work'
  source: string
  replaces: string[]
  validUntil: string
  text: string
  cut: boolean
}
export interface NotebookLogEntry {
  at: string
  event: 'held' | 'identical' | 'merged' | 'refused' | 'released' | 'deleted-held' | 'shared' | 'erased'
  code?: string
  reason?: string
  by?: string
  byId?: string
  heldId?: string
  noteId?: string
  existing?: string
  replaces?: string[]
  chars?: number
}
export type NotebookAddResult =
  | { status: 'saved' | 'merged'; id: string; replaces: string[]; scope: NotebookScope; message: string }
  | { status: 'held'; heldId: string; code: NotebookHoldCode; message: string }
  | { status: 'identical'; existing: string; message: string }
  | { status: 'refused'; code: 'held-full'; message: string }

// --- what the card says ---

/**
 * The limits, in plain words, shown on the card before and after the switch: not behind a click. `instances` is how many chats the notebook has now (null: not known),
 * because the second line is about how many chats a mistake reaches.
 */
export function notebookLimits(instances: number | null): string[] {
  const readers = instances && instances > 0 ? `all ${instances} of its instances` : 'every instance of the notebook'
  return [
    'Privacy here is a door, not a wall. A chat runs as the Server’s own Windows user, so a chat that can run commands could read the notebook’s files. The notebook keeps its notes from chats that are not its instances; it cannot stop one that goes around it.',
    `A secret that the filter misses reaches ${readers}. The filter hides the keys, tokens and passwords it recognises, and a recognised one is held for you here instead of being saved. It is a safety net, not a guarantee.`,
    'Notes are found by their words, not by their meaning: “reports” does not find “report”.',
    'Whether a note is “from a person” or “from work” is the writing chat’s own claim. Nothing checks it.',
    'Notes that record what a person said are held back from every chat while a second owner exists (the guard that keeps one person’s memory private).',
    'An erased note is gone from the notebook and its search; a copy a chat has already read stays in that chat’s own history. Erase each copy and each older version too: a copy made by Share and the older notes a note replaced are separate notes, and erasing a note that replaced another brings the older one back.',
    'This app does not back the notes up. A copy of the notebook’s notes folder is an arrangement outside it (the Backup page is another program).',
  ]
}

/**
 * One line on the card that is not a limit (Agent 14's N4 read, N4-4): what the start brief does with a note, and what that lets one instance do to the others. `12` is the brief's own number
 * (memory-notebook.ts BRIEF_NOTES; memory-notebook.test.ts holds the two together).
 */
export const NOTEBOOK_BRIEF_NOTE =
  'The start brief puts up to 12 note titles into every instance’s system prompt, as unverified notes. Any instance can hide another’s shared note by writing one that replaces it: a chat that has read something hostile can write a misleading note that the others see at their start.'

/**
 * Under the floor list while the notebook is ON (Agent 14's N4-2): the checkboxes and each agent's Uses it decide which chats get the notebook (at their next start); Role and Notes an hour
 * do not: they set how many notes an instance may add in an hour (ROLE_PER_HOUR is the role's default; memory-notebook.ts).
 */
export const NOTEBOOK_FLOORS_NOTE =
  'These checkboxes, and each agent’s Uses it, change which chats get the notebook at their next start. Role and Notes an hour change how many notes an instance may add in an hour, not whether it gets the notebook.'

/** The line on an agent's own page. */
export function notebookLine(name: string, instances: number): string {
  return `Notebook: ${name}, shared by ${instances} ${instances === 1 ? 'instance' : 'instances'}`
}

/** The notebook this agent is an instance of NOW (the server's own list, so it is empty until the master switch and the template are on), or null. */
export function notebookOfAgent(status: NotebooksStatus | null, floorId: string, agentId: string): { id: string; name: string; instances: number } | null {
  if (!status || !status.enabled) return null
  for (const t of status.templates) {
    if (t.on && t.instances.some(i => i.floorId === floorId && i.id === agentId)) return { id: t.id, name: t.name, instances: t.instances.length }
  }
  return null
}

export type PreviewLeft = '' | 'left-out' | 'pc-control' | 'other-person' | 'sent-elsewhere' | 'other-template'
export interface PreviewInstance {
  agentId: string
  name: string
  floorId: string
  floorName: string
  /** '' when it would be an instance; otherwise why not (the same reasons memory-notebook.ts templateOf gives, switches aside). */
  left: PreviewLeft
  role: NotebookRole
  perHour: number
}

/**
 * The agents of the template, and for each whether it WOULD be an instance once the notebook is on: the same rule as memory-notebook.ts templateOf with the two
 * switches ignored (agent/agentic/memory-notebook-wire.test.ts holds the two together over a floor matrix). F-316: a chat that carries a template of its own belongs to THAT
 * one on whatever floor it is; a chat with none is found by its floor, as before. An agent with no owner is the app owner's, and the page does not know his id: it stands in the
 * template's person, which is the app owner for every template there is. Once the notebook is on the server's list is the truth.
 */
export function previewInstances(templateId: string, row: NotebookTemplateRow, floors: readonly Floor[], roleDefaults: Record<NotebookRole, number>): PreviewInstance[] {
  const out: PreviewInstance[] = []
  const person = row.owner.toLowerCase()
  for (const floor of floors) {
    const mapped = row.floors.includes(floor.id)
    for (const agent of floor.agents) {
      const named = agent.template?.id
      // Named here: this one's, wherever it is. Named elsewhere: listed only on a floor this template maps (to say why it is not one). Named nothing: by its floor.
      if (named ? named !== templateId && !mapped : !mapped) continue
      const inst = row.instances[agent.id]
      const role = inst?.role ?? 'chat'
      let left: PreviewLeft = ''
      if (floor.workspace === 'pc-control' || agent.pcControlSlot) left = 'pc-control'
      else if (named && named !== templateId) left = 'other-template'
      else if (inst?.in === false) left = 'left-out'
      else if (inst?.to !== undefined && inst.to !== templateId) left = 'sent-elsewhere'
      else if ((agent.owner?.id || person).toLowerCase() !== person) left = 'other-person'
      out.push({ agentId: agent.id, name: agent.name, floorId: floor.id, floorName: floor.name, left, role, perHour: inst?.perHour ?? row.perHour ?? roleDefaults[role] })
    }
  }
  return out
}

/** The row a first "Set up" makes: OFF, the floor(s) named Agentic Platform, no per-agent settings. The owner is left out, so the hub gives it the app owner's id. */
export function setupRow(floors: readonly Pick<Floor, 'id' | 'name' | 'workspace'>[]): Omit<NotebookTemplateRow, 'owner'> {
  return {
    name: NOTEBOOK_TEMPLATE_NAME,
    on: false,
    floors: floors.filter(f => f.workspace !== 'pc-control' && f.name.trim().toLowerCase() === NOTEBOOK_TEMPLATE_NAME.toLowerCase()).map(f => f.id),
    perHour: null,
    instances: {},
  }
}

/** The row with one agent's setting changed: only what says something is kept, as the hub keeps it (an agent that is "in", of the default role, with no number, has no row). */
export function withInstance(row: NotebookTemplateRow, agentId: string, change: { in?: boolean; role?: NotebookRole; perHour?: number | null }): NotebookTemplateRow {
  const was = row.instances[agentId] ?? {}
  const next: NotebookInstanceRow = { ...was }
  if (change.in !== undefined) {
    if (change.in) delete next.in
    else next.in = false
  }
  if (change.role !== undefined) {
    if (change.role === 'chat') delete next.role
    else next.role = change.role
  }
  if (change.perHour !== undefined) {
    if (change.perHour === null) delete next.perHour
    else next.perHour = change.perHour
  }
  const instances = { ...row.instances }
  if (Object.keys(next).length) instances[agentId] = next
  else delete instances[agentId]
  return { ...row, instances }
}

/** A notes-an-hour field's text: '' is "the default" (null), a whole number from 1 to 1000 is itself, anything else is not accepted (undefined). */
export function parsePerHour(text: string): number | null | undefined {
  const t = text.trim()
  if (t === '') return null
  if (!/^\d{1,4}$/.test(t)) return undefined
  const n = Number(t)
  return n >= NOTEBOOK_PER_HOUR_MIN && n <= NOTEBOOK_PER_HOUR_MAX ? n : undefined
}
