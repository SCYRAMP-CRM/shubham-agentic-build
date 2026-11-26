import { isOrchestratorAgent, isPersonAssistant, type Floor, type FloorAgent, type ShareFloorAnswer, type UnshareFloorAnswer } from './agentic.ts'
import { SBSKRRT_ID, type ShareLevel } from './auth.ts'

// F-231 (Shubham, 14 Nov 2026: "Currently we only have the ability to share agents, not floors. Please add that."): what the Share floor dialog shows and says. PURE: no network, no clock. The server decides at the tap (agent/agentic/floors.ts
// shareFloor); `previewShare` mirrors its rules only so the dialog can say, before the tap, which chats it expects to share and which it will leave: the RECEIPT is what the server answers. The words are here so a test can hold them: each of the
// things the owner must be told (the whole history is read, the app's memory is off while shared, what typing reaches, what is seen of the floor) is a sentence below, and the dialog shows all of them.

export type SkipWhy = ShareFloorAnswer['skipped'][number]['why']

export interface PreviewRow {
  id: string
  name: string
}

/** A chat a third person owns, as the preview names it (the owner's name is the page's own knowledge: the server's receipt carries chat names only). */
export interface OtherOwnerRow extends PreviewRow {
  ownerName: string
}

/** The chats the server would share with this person now, and the ones it would leave (a preview: the server decides at the tap, from the floor as it is THEN). */
export function previewShare(floor: Floor, personId: string, can: ShareLevel, includeOthers = false): { share: (PreviewRow & { was: 'view' | null })[]; skip: (PreviewRow & { why: SkipWhy })[]; others: OtherOwnerRow[] } {
  const pid = personId.toLowerCase()
  const share: (PreviewRow & { was: 'view' | null })[] = []
  const skip: (PreviewRow & { why: SkipWhy })[] = []
  // The chats a THIRD person owns (neither the first owner, who is the caller, nor the person): left alone unless the box is ticked; named for the dialog either way.
  const others: OtherOwnerRow[] = []
  for (const a of floor.agents) {
    const row = { id: a.id, name: a.name }
    const have = (a.sharedWith ?? []).find(s => s.id.toLowerCase() === pid)?.can
    if (floor.workspace === 'pc-control' || a.pcControlSlot) skip.push({ ...row, why: 'pc-control' })
    else if (isPersonAssistant(a) || isOrchestratorAgent(floor.name, a)) skip.push({ ...row, why: 'assistant' })
    else if (a.owner?.id.toLowerCase() === pid) skip.push({ ...row, why: 'owner' })
    else if (a.owner?.id && a.owner.id.toLowerCase() !== SBSKRRT_ID.toLowerCase() && !includeOthers) {
      skip.push({ ...row, why: 'other-owner' })
      others.push({ ...row, ownerName: a.owner.name || a.owner.username })
    }
    else if (have === can) skip.push({ ...row, why: 'already' })
    else if (can === 'view' && have === 'type') skip.push({ ...row, why: 'has-type' })
    else {
      share.push({ ...row, was: have === 'view' ? 'view' : null })
      if (a.owner?.id && a.owner.id.toLowerCase() !== SBSKRRT_ID.toLowerCase()) others.push({ ...row, ownerName: a.owner.name || a.owner.username })
    }
  }
  return { share, skip, others }
}

/** The people who have a share on some chat of the floor now, and on how many chats at each level (what the owner sees: the share lists are his). */
export function floorPeople(floor: Pick<Floor, 'agents'>): { id: string; name: string; username: string; view: number; type: number }[] {
  const out = new Map<string, { id: string; name: string; username: string; view: number; type: number }>()
  for (const a of floor.agents as FloorAgent[]) {
    for (const s of a.sharedWith ?? []) {
      const row = out.get(s.id.toLowerCase()) ?? { id: s.id.toLowerCase(), name: s.name || s.username, username: s.username, view: 0, type: 0 }
      if (s.can === 'type') row.type++
      else row.view++
      out.set(row.id, row)
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** What the picker says beside a person who already holds chats on the floor (so a partial share can be topped up or raised from the same list): "has 3 of 16 chats (Can view 2, Can type 1)". */
export function holdsWords(p: { view: number; type: number }, total: number): string {
  const parts = [p.view ? `Can view ${p.view}` : '', p.type ? `Can type ${p.type}` : ''].filter(Boolean).join(', ')
  return `has ${p.view + p.type} of ${total} ${total === 1 ? 'chat' : 'chats'} (${parts})`
}

const chats = (n: number) => `${n} ${n === 1 ? 'chat' : 'chats'}`
export const levelWords = (can: ShareLevel) => (can === 'type' ? 'Can type' : 'Can view')

/** The button that does it: it says exactly what it will do, with the count the dialog showed ("now": the server shares the floor as it is at the tap). */
export const shareButtonWords = (floorName: string, n: number, personName: string, can: ShareLevel) => `Share the ${chats(n)} on ${floorName} with ${personName} as ${levelWords(can)}`

/** Everything a person is told before a share, whatever the level (each is a plain sentence the dialog shows). */
export function shareWarnings(personName: string, n: number): { history: string; sees: string; memory: string; notebook: string; later: string } {
  const each = n === 1 ? 'this chat' : `each of these ${n} chats`
  return {
    history: `${personName} will be able to read the whole conversation of ${each}, including everything already said in ${n === 1 ? 'it' : 'them'}.`,
    sees: `${personName} will also see the floor's instructions, its work folder and each chat's brief.`,
    memory: `While ${n === 1 ? 'it is' : 'they are'} shared, the app's memory is off for ${n === 1 ? 'this chat' : 'these chats'}: recall and the memory tools stop for ${n === 1 ? 'it' : 'them'} until you take ${personName} out again.`,
    notebook: `While ${n === 1 ? 'it is' : 'they are'} shared, ${n === 1 ? 'this chat also loses' : 'these chats also lose'} ${n === 1 ? 'its' : 'their'} template notebook and cannot message ${n === 1 ? 'its' : 'their'} sibling instances: the instances lose their notebook while shared.`,
    later: `Only the chats on the floor now are shared. A chat added later is not.`,
  }
}

/** The line above the tick that includes chats a third person owns: how many, and whose. */
export function othersLine(others: { ownerName: string }[]): string {
  const names = [...new Set(others.map(o => o.ownerName))]
  const n = others.length
  return `${n} of these ${n === 1 ? 'chat belongs' : 'chats belong'} to ${names.join(', ')}, not to you: ${n === 1 ? 'it holds' : 'they hold'} ${n === 1 ? 'that' : 'their'} conversation${n === 1 ? '' : 's'}.`
}
export const OTHERS_TICK = 'Include them too'

/** Said beside every Take out: it is not an undo. */
export const unshareNotUndo = (personName: string): string =>
  `This is not an undo of the share: it takes ${personName} out of EVERY chat on this floor, including chats you shared with them one by one and any share they were given by a chat's own owner.`

/** The second step for "Can type": what typing reaches, with the chats named. */
export function typeWarnings(personName: string, names: string[]): { reach: string; tools: string; chats: string } {
  return {
    reach: `Can type means ${personName} types into these chats with YOUR powers: whatever a chat can do on this PC, ${personName} can ask it to do.`,
    tools: `That includes the chats' own tools (the CRM tools, sending a message to another chat that is not shared).`,
    chats: names.length ? `The chats: ${names.join(', ')}.` : 'There are no chats to share.',
  }
}

/** Before taking a person out: what stays in the chats they could type in. null when they could only view. */
export function unshareTypedWarning(personName: string, typed: number): string | null {
  if (typed <= 0) return null
  return `${personName} could type in ${chats(typed)}. What ${personName} typed stays in ${typed === 1 ? 'that chat' : 'those chats'}, and ${typed === 1 ? 'it feeds' : 'they feed'} your memory again when the share ends.`
}

export const unshareButtonWords = (floorName: string, n: number, personName: string) => `Take ${personName} out of the ${chats(n)} on ${floorName}`

const WHY: Record<SkipWhy, string> = {
  assistant: 'an Assistant (never shared in bulk)',
  'pc-control': 'a PC Control chat',
  owner: 'already theirs',
  'other-owner': 'belongs to someone else (tick the box to include it)',
  already: 'already shared that way',
  'has-type': 'has Can type there (not lowered)',
}
export const skipWhyWords = (why: SkipWhy): string => WHY[why]

/** What the receipt says after a share: how many, how many raised, what was left and why, and the copy kept. */
export function sharedReceipt(answer: Pick<ShareFloorAnswer, 'shared' | 'skipped' | 'copy'>, personName: string, can: ShareLevel): string[] {
  const raised = answer.shared.filter(x => x.was === 'view').length
  const lines = [answer.shared.length ? `Shared ${chats(answer.shared.length)} with ${personName} as ${levelWords(can)}${raised ? ` (${raised} raised from Can view)` : ''}.` : `Nothing was shared: every chat was already as asked, or is left alone.`]
  if (answer.skipped.length) {
    const by = new Map<SkipWhy, string[]>()
    for (const s of answer.skipped) by.set(s.why, [...(by.get(s.why) ?? []), s.name])
    for (const [why, names] of by) lines.push(`Left as it was, ${WHY[why]}: ${names.join(', ')}.`)
  }
  if (answer.copy) lines.push(`A copy of floors.json was kept first (${answer.copy}).`)
  return lines
}

export function unsharedReceipt(answer: Pick<UnshareFloorAnswer, 'removed' | 'copy'>, personName: string): string[] {
  const typed = answer.removed.filter(x => x.was === 'type').length
  const lines = [answer.removed.length ? `${personName} was taken out of ${chats(answer.removed.length)}.` : `${personName} had no share on this floor.`]
  const warn = unshareTypedWarning(personName, typed)
  if (warn) lines.push(warn)
  if (answer.copy) lines.push(`A copy of floors.json was kept first (${answer.copy}).`)
  return lines
}

/** A refusal in words (the server's own sentence when it has one). */
export function shareFloorRefusal(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.trim() ? m : 'The floor could not be shared. Nothing was changed.'
}
