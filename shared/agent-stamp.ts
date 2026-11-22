// F-316 (Shubham's order o75bb): the first owner's one click that gives a floor's chats a template ("Make every chat here an instance of…"):
// POST /floors/:id/template {id, name} stamps every chat of the floor that has none; POST /floors/:id/template/undo {id} takes it away from exactly
// the chats the last stamping gave it. The rules of the dialog are here, apart from the page, so they are tested without one (agent-stamp.test.ts).
// The server has the last word and keeps a copy of floors.json first (the way back). Types only; nothing here imports from the app.

import type { StampTemplateAnswer, UnstampTemplateAnswer } from './agentic.ts'
import { templateIdOf, templateName } from './agent-template.ts'

/** What the stamping rules need of an agent. */
export interface StampAgent {
  pcControlSlot?: number
  duty?: string | null
  template?: { id?: unknown; name?: unknown } | null
}

export interface StampFloor {
  id: string
  name: string
  workspace?: string
  agents: StampAgent[]
}

/** The body of POST /floors/:id/template (the id is the key of the F-309 notebook table: lower case letters, digits and dashes, at most 40). */
export interface StampRequest {
  id: string
  name: string
}

/** What the server answers (shared/agentic.ts StampTemplateAnswer / UnstampTemplateAnswer: `copy` is the file name of the copy of floors.json kept first, the way back), minus the floor. */
export type StampAnswer = Omit<StampTemplateAnswer, 'floor'>
export type UnstampAnswer = Omit<UnstampTemplateAnswer, 'floor'>

/** One chat the stamping would give a template: it has none, and it is not a PC Control slot or a person's own Assistant (the server leaves those alone). */
export function stampable(agent: StampAgent): boolean {
  return !agent.template && agent.pcControlSlot === undefined && agent.duty !== 'person-assistant'
}

/** How many chats of the floor the stamping would change, and how many it would leave as they are. A PC Control floor changes none. */
export function stampCounts(floor: StampFloor): { stamp: number; skip: number } {
  if (floor.workspace === 'pc-control') return { stamp: 0, skip: floor.agents.length }
  const stamp = floor.agents.filter(stampable).length
  return { stamp, skip: floor.agents.length - stamp }
}

/** The name of a template as written on a chat, or ''. */
function nameOf(agent: StampAgent): string {
  const n = agent.template?.name
  return typeof n === 'string' ? templateName(n) : ''
}

/**
 * What the name box starts as: the template most of the floor's chats already carry (the others join it), else the floor's own name.
 * The first of two that tie wins.
 */
export function suggestedFamily(floor: StampFloor): string {
  const counts = new Map<string, number>()
  for (const a of floor.agents) {
    const n = nameOf(a)
    if (n) counts.set(n, (counts.get(n) ?? 0) + 1)
  }
  let best = ''
  let most = 0
  for (const [n, c] of counts) if (c > most) { best = n; most = c }
  return best || templateName(floor.name)
}

/**
 * Which template a typed name means: the one a chat anywhere already carries under that name or that id (so the family is one), else a new id from the name. The name and the id
 * are made by the SERVER's own rules (shared/agent-template.ts templateName / templateIdOf: accents folded, a name with no letter or digit is "template"), so a stamping here and a copy
 * that starts a family there give one name the same id.
 */
export function templateChoice(floors: StampFloor[], typed: string): { id: string; name: string; joins: boolean } | null {
  const name = templateName(typed)
  if (!name) return null
  const id = templateIdOf(name)
  for (const f of floors) {
    for (const a of f.agents) {
      const t = a.template
      if (!t || typeof t.id !== 'string' || typeof t.name !== 'string') continue
      const known = templateName(t.name)
      if (known && (known.toLowerCase() === name.toLowerCase() || t.id === id)) return { id: t.id, name: known, joins: true }
    }
  }
  return { id, name, joins: false }
}

/** The request for one floor and one typed name, or null while it cannot be sent: nothing to stamp (or a PC Control floor), or no usable name. */
export function stampRequest(floors: StampFloor[], floor: StampFloor, typed: string): StampRequest | null {
  if (stampCounts(floor).stamp === 0) return null
  const choice = templateChoice(floors, typed)
  return choice ? { id: choice.id, name: choice.name } : null
}

const chats = (n: number) => `${n} ${n === 1 ? 'chat' : 'chats'}`

/** What the toast says after a stamping. */
export function stampedWords(floorName: string, name: string, answer: StampAnswer): { title: string; description: string | undefined } {
  const left = answer.skipped > 0 ? ` ${chats(answer.skipped)} left as ${answer.skipped === 1 ? 'it was' : 'they were'}.` : ''
  const copy = answer.copy ? `A copy of the floors file was kept first: ${answer.copy}.` : undefined
  return { title: `${chats(answer.stamped)} on ${floorName} ${answer.stamped === 1 ? 'is' : 'are'} now ${answer.stamped === 1 ? 'an instance' : 'instances'} of “${name}”.${left}`, description: copy }
}

/** What the toast says after an undo. */
export function unstampedWords(answer: UnstampAnswer, name: string): string {
  return answer.removed > 0 ? `Undone: ${chats(answer.removed)} no longer ${answer.removed === 1 ? 'is an instance' : 'are instances'} of “${name}”.` : `Nothing left to undo for “${name}”.`
}

/** The server's refusals, by CODE (its sentences may change); a code this page does not know keeps the server's words. */
export const STAMP_REFUSAL_WORDS: Record<string, string> = {
  'template-nothing-to-do': "Every chat on this floor has a template already, or can't have one: nothing to do.",
  'template-nothing-to-undo': 'No stamping of this template on this floor is left to undo.',
  'pc-control-immutable': 'PC Control chats take no template.',
  'admin-only': "Only the first owner of this app gives a floor's chats a template.",
  'not-yours': "Only the owner's page may do this.",
}

export function stampRefusalWords(e: unknown): string {
  const code = typeof e === 'object' && e !== null && typeof (e as { code?: unknown }).code === 'string' ? (e as { code: string }).code : ''
  return STAMP_REFUSAL_WORDS[code] ?? (e instanceof Error ? e.message : String(e))
}
