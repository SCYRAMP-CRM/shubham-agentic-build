import type { AgentTemplate } from './agent-template.ts'

// F-316 (b) (Shubham's order o8d12, 22 Nov 2026, his words: "and also we can have multiple agents on one floor having diffenet insteaces that also is something i wnat"; the Assistant's reading, not his
// words: one floor holds several different agents (templates), each with its own instances, shown as "Reviewer x3, Writer x2" and not as a flat list). The data model already allows it (the template is a
// field of each CHAT, FloorAgent.template, never of the floor), so this is DISPLAY ONLY: what a floor holds, in a line, worked out from that field. It changes no data, no order and no brief.

/** What the line reads of a chat (the page's FloorAgent has it). */
export interface SummaryAgent {
  template?: AgentTemplate
}

export interface TemplateCount {
  id: string
  /** The name written on the first chat of this id met in the list (a family has one name: the first one that joined it). */
  name: string
  count: number
}

/** At most this many templates are named in the line; the rest are counted ("+2 more"). */
export const TEMPLATE_SUMMARY_SHOWN = 3

/**
 * The templates a list of chats holds and how many chats each has, the biggest first (a tie keeps the order the chats are listed in), and how many chats have none. Chats with no template are not a
 * template of their own: they are counted apart.
 */
export function templateCounts(agents: readonly SummaryAgent[]): { groups: TemplateCount[]; without: number } {
  const byId = new Map<string, TemplateCount>()
  let without = 0
  for (const a of agents) {
    const t = a.template
    if (!t) {
      without++
      continue
    }
    const g = byId.get(t.id)
    if (g) g.count++
    else byId.set(t.id, { id: t.id, name: t.name, count: 1 })
  }
  const groups = [...byId.values()].map((g, order) => ({ g, order })).sort((x, y) => y.g.count - x.g.count || x.order - y.order).map(x => x.g)
  return { groups, without }
}

/**
 * The line under a floor's name: "Reviewer ×3, Writer ×2", then ", +1 more" past TEMPLATE_SUMMARY_SHOWN templates, then ", 2 with no template" for chats that have none. EMPTY when no chat has a
 * template (a floor that has none looks exactly as it did): the line says what a floor is MADE OF, so it has nothing to say about a floor that is made of no template.
 */
export function templateSummary(agents: readonly SummaryAgent[]): string {
  const { groups, without } = templateCounts(agents)
  if (!groups.length) return ''
  const named = groups.slice(0, TEMPLATE_SUMMARY_SHOWN).map(g => `${g.name} ×${g.count}`)
  const more = groups.length - named.length
  if (more > 0) named.push(`+${more} more`)
  if (without > 0) named.push(`${without} with no template`)
  return named.join(', ')
}
