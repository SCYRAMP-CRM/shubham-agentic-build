import type { FloorAgent } from './agentic.ts'

// F-338: the "Edit agent" form opens inside its window, so several forms can be open at once, one per window. Two forms (or a form and a menu, or another person) may then change the same floor at the same moment, and a
// save is the floor's whole agent list (the server REPLACES the list: agent/agentic/floors.ts `patch`). So a save must not write back the agent as it was when the form opened: it sends only the fields THIS form
// changed, put on the agent as it is NOW (`rebaseAgentEdit`), and a field changed here AND meanwhile elsewhere to a different value is a conflict, said in plain words, never overwritten. Pure: no React, no network.

/** The fields the form can change, with the word for each (the server's own fields, the session and the PC it lives on, are never in it). */
export const FORM_FIELDS: ReadonlyArray<readonly [keyof FloorAgent, string]> = [
  ['name', 'Name'],
  ['role', 'Role'],
  ['reportsTo', 'Reports to'],
  ['engine', 'Engine'],
  ['model', 'Model'],
  ['effort', 'Effort'],
  ['codexModel', 'Model'],
  ['codexEffort', 'Effort'],
  ['opencodeProvider', 'OpenCode provider'],
  ['opencodeModel', 'OpenCode model'],
  ['md', 'Brief'],
]

/** What an agent whose engine and policy are locked (a profile the form may not leave) can still have changed here. */
export const LOCKED_FIELDS: readonly (keyof FloorAgent)[] = ['name', 'role', 'reportsTo', 'md']

/** Nothing, null and '' are the same "empty" (a select shows an absent value as its first option, and typing then deleting leaves ''). */
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '')

const labelsOf = (keys: readonly (keyof FloorAgent)[]): string[] => {
  const out: string[] = []
  for (const [k, label] of FORM_FIELDS) if (keys.includes(k) && !out.includes(label)) out.push(label)
  return out
}

/** The fields whose value in `draft` is not the one in `base` (the agent as the form was opened), within `only` when given. */
export function editedFields(base: FloorAgent, draft: FloorAgent, only?: readonly (keyof FloorAgent)[]): (keyof FloorAgent)[] {
  return FORM_FIELDS.map(([k]) => k).filter(k => (only === undefined || only.includes(k)) && !same(base[k], draft[k]))
}

/** The labels of the form's fields that are not what they were when the form was opened: someone changed them elsewhere meanwhile. */
export function changedElsewhere(latest: FloorAgent, base: FloorAgent): string[] {
  return labelsOf(FORM_FIELDS.map(([k]) => k).filter(k => !same(latest[k], base[k])))
}

export type Rebased = { ok: true; agent: FloorAgent; fields: string[] } | { ok: false; conflicts: string[] }

/**
 * The agent to save: `latest` (as it is now) with only the fields this form changed put on it. A field changed by the form and also meanwhile, to a different value, is a conflict (nothing is written); one changed
 * only elsewhere keeps its new value; one the form changed to what it already is now is no conflict.
 */
export function rebaseAgentEdit(latest: FloorAgent, base: FloorAgent, draft: FloorAgent, only?: readonly (keyof FloorAgent)[]): Rebased {
  const take: (keyof FloorAgent)[] = []
  const clash: (keyof FloorAgent)[] = []
  for (const k of editedFields(base, draft, only)) {
    if (same(latest[k], base[k])) take.push(k)
    else if (!same(latest[k], draft[k])) clash.push(k)
  }
  if (clash.length) return { ok: false, conflicts: labelsOf(clash) }
  const agent: Record<string, unknown> = { ...latest }
  for (const k of take) agent[k] = draft[k]
  return { ok: true, agent: agent as unknown as FloorAgent, fields: labelsOf(take) }
}

/** The sentence for a conflict. */
export const conflictWords = (name: string, fields: readonly string[]) => `${name} changed elsewhere (${fields.join(', ')}). Close this form and open it again.`
/** The line in the form while the agent differs from what it was when the form was opened. */
export const elsewhereWords = 'Changed elsewhere since you opened it'
export const goneWords = (name: string) => `${name} is no longer on this floor. Close this form.`

export class AgentEditConflict extends Error {
  readonly fields: string[]
  constructor(name: string, fields: string[]) {
    super(conflictWords(name, fields))
    this.name = 'AgentEditConflict'
    this.fields = fields
  }
}

/**
 * One agent's save, built from the floor as it is when this runs (not when the form was opened): the list to write is the floor's agents with this one rebased, and what the page must still hold when it is written
 * (`expected`, the page's own guard). Run it inside a per-floor queue (`createWriteQueue`) so the floor it reads already holds the previous save's answer.
 */
export async function saveAgentEdit<R>(o: {
  agentId: string
  base: FloorAgent
  draft: FloorAgent
  only?: readonly (keyof FloorAgent)[]
  /** The page's floor as it is now. */
  latestFloor: () => { agents: FloorAgent[] } | undefined
  write: (agents: FloorAgent[], expected: FloorAgent[]) => Promise<R>
}): Promise<R> {
  const floor = o.latestFloor()
  const latest = floor?.agents.find(a => a.id === o.agentId)
  if (!floor || !latest) throw new Error(goneWords(o.base.name))
  const r = rebaseAgentEdit(latest, o.base, o.draft, o.only)
  if (!r.ok) throw new AgentEditConflict(o.base.name, r.conflicts)
  return o.write(
    floor.agents.map(a => (a.id === o.agentId ? r.agent : a)),
    floor.agents,
  )
}
